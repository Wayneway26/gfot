import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore,publicState,newTask,profileInput,vault,requireText,InputError} from './state.mjs';
import {OpenCodeEngine} from './engine.mjs';
import {Harness2Engine,harnessStatus,harnessPrompt,validHarness} from './harness2.mjs';
import {listModels,verifyConnection} from './connections.mjs';
import {createAccountManager} from './accounts.mjs';
import {startAccountProxy,verifyResponses} from './account-proxy.mjs';
const publicDir=fileURLToPath(new URL('./ui/',import.meta.url));
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/brand-mark.svg':'brand-mark.svg'};
const matches=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export async function startDesktopServer({dataDir,binary,key,harnessRunner,connectionFetch=fetch,accountFetch=fetch,engineFactory=options=>new OpenCodeEngine(options)}){
 const storage=createStore(dataDir),secrets=vault(key),clients=new Set(),active=new Map(),pendingRuns=new Set();let timer,closed=false;
 const state=storage.state;
 const accounts=createAccountManager({state,vault:secrets,save:storage.save,changed:()=>changed(),credentialsChanged:id=>{accountProxy.revokeAccount(id);for(const p of state.profiles)if(p.accountId===id)delete p.verification;},fetchImpl:accountFetch});
 const accountProxy=await startAccountProxy({accounts,fetchImpl:accountFetch});
 const safe=value=>{
  const values=[...state.profiles.map(p=>secrets.open(p.secret)),...accounts.sensitiveValues(),...Array.from(active.values(),r=>r.engine?.password),...Array.from(active.values(),r=>r.engine?.key)].filter(Boolean);
  const redact=v=>typeof v==='string'?values.reduce((text,secret)=>text.split(secret).join('[redacted]'),v):Array.isArray(v)?v.map(redact):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,item])=>[k,redact(item)])):v;
  return redact(value);
 };
 const view=()=>({...publicState(state),engine:{name:'OpenCode',bundled:!!binary,version:'1.19.3'},harness2:{integrated:true,...harnessStatus(harnessRunner)},capabilities:{automaticFailover:false,quotaQuery:true,quotaSources:['codex-local'],accountImport:['codex-local'],chatGPTLogin:true}});
 function changed(){if(closed)return;for(const client of clients)client.write('event: state\ndata: '+JSON.stringify(view())+'\n\n');clearTimeout(timer);timer=setTimeout(storage.save,80);}
 function addEvent(task,event){task.events.push({...event,at:new Date().toISOString()});task.events=task.events.slice(-150);changed();}
 function onEvent(task,event){
  const raw=event.properties||{};if(!active.get(task.id)?.harness2&&raw.sessionID&&task.sessionId&&raw.sessionID!==task.sessionId)return;
  const properties=safe(raw);for(const field of ['id','sessionID'])if(raw[field]!==undefined)properties[field]=raw[field];
  if(properties.part)for(const field of ['id','messageID','sessionID'])if(raw.part[field]!==undefined)properties.part[field]=raw.part[field];
  const draft=value=>{
   const runtime=active.get(task.id);if(!runtime)return;runtime.rawDraft=value.slice(-100000);let hidden=0;
   for(const secret of [...state.profiles.map(p=>secrets.open(p.secret)),runtime.engine?.password,runtime.engine?.key,...accounts.sensitiveValues()].filter(Boolean))for(let n=Math.min(secret.length-1,runtime.rawDraft.length);n>hidden;n--)if(runtime.rawDraft.endsWith(secret.slice(0,n))){hidden=n;break;}
   task.draft=safe(hidden?runtime.rawDraft.slice(0,-hidden)+'[redacted]':runtime.rawDraft);changed();
  };
  if(event.type==='permission.asked'||event.type==='permission.updated'){if(!task.pending.some(p=>p.id===properties.id))task.pending.push({...properties,kind:'permission'});task.status='permission';addEvent(task,{type:'permission',text:'等待批准：'+(properties.permission||properties.type||'工具操作')});}
  else if(event.type==='question.asked'){task.pending.push({...properties,kind:'question'});task.status='permission';addEvent(task,{type:'question',text:'执行器需要你的回答'});}
  else if(event.type==='message.part.updated'){
   const part=properties.part;if(!part)return;
   if(part.type==='text'){draft(String(raw.part.text||''));}
   if(part.type==='tool'){const status=part.state?.status||'';const text=(part.tool||'工具')+' · '+status;const last=task.events.at(-1);if(last?.partID===part.id){last.text=text;last.detail=JSON.stringify(part.state?.input||{}).slice(0,4000);changed();}else addEvent(task,{type:'tool',partID:part.id,text,detail:JSON.stringify(part.state?.input||{}).slice(0,4000)});}
  }else if(event.type==='message.part.delta'&&properties.field==='text'){draft((active.get(task.id)?.rawDraft||'')+String(raw.delta||''));}
  else if(event.type==='session.error'){task.error=JSON.stringify(properties.error||{}).slice(0,3000);changed();}
 }
 async function run(task,text,profile){
  const runtime={engine:null,cancelled:false};let finalStatus='idle',grant;active.set(task.id,runtime);
  const deadline=setTimeout(()=>{runtime.cancelled=true;task.error='本轮超过 15 分钟，已请求停止。核对执行记录后再继续。';void runtime.engine?.stop();},15*60*1000);
  try{
   if(profile.mode==='account')grant=accountProxy.grant(profile.accountId,profile.model);
   const resolved=grant?{...profile,baseURL:grant.baseURL,protocol:'responses'}:profile;
   const engine=runtime.engine=engineFactory({binary,dataDir,task,profile:resolved,key:grant?.key||secrets.open(profile.secret),systemPrompt:task.adoptedHarness?harnessPrompt(task.adoptedHarness.tree):undefined,onEvent:event=>onEvent(task,event)});
   await engine.start();if(runtime.cancelled)return;
   task.status='running';storage.save();changed();
   const answer=await engine.send(text);if(runtime.cancelled)return;
   const history=safe(await engine.history());
   task.messages=history.filter(m=>['user','assistant'].includes(m.info?.role)).map(m=>({id:m.info.id,role:m.info.role,text:m.parts.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'),at:new Date((m.info.time?.created)||Date.now()).toISOString()})).filter(m=>m.text).slice(-200);
   if(answer?.info?.error)throw Error(JSON.stringify(answer.info.error));
   task.error=null;addEvent(task,{type:'done',text:'本轮执行已结束，请检查实际变更与验证结果。'});
  }catch(error){if(!runtime.cancelled){finalStatus='error';task.error=safe(String(error.message)).slice(0,4000);addEvent(task,{type:'error',text:task.error});}}
  finally{clearTimeout(deadline);await runtime.engine?.stop();grant?.revoke();task.status=runtime.cancelled?'stopped':finalStatus;task.pending=[];task.draft='';active.delete(task.id);task.updatedAt=new Date().toISOString();storage.save();changed();}
 }
 async function runHarness(task,text,profile){
  const runtime={engine:null,cancelled:false,harness2:true};let grant,finalStatus='idle';active.set(task.id,runtime);
  task.harnessRun={status:'running',runId:randomUUID(),startedAt:new Date().toISOString(),phases:[]};
  const deadline=setTimeout(()=>{runtime.cancelled=true;void runtime.engine?.stop();},15*60*1000);
  try{
   if(profile.mode==='account')grant=accountProxy.grant(profile.accountId,profile.model);
   const resolved=grant?{...profile,baseURL:grant.baseURL,protocol:'responses'}:profile;
   const engine=runtime.engine=new Harness2Engine({binary,dataDir,harnessRunner,task,prompt:text,profile:resolved,key:grant?.key||secrets.open(profile.secret),engineFactory,redact:safe,
    onEvent:event=>onEvent(task,event),onPhase:phase=>{task.pending=[];task.draft='';task.status='running';task.harnessRun.phases.push(phase);task.harnessRun.phase=phase;addEvent(task,{type:'harness2',text:'Harness² · '+phase.label+' · '+(phase.action==='propose'?'提出配置':'副本探测')});}});
   await engine.start();if(runtime.cancelled)return;const result=safe(await engine.send());if(runtime.cancelled)return;
   task.harnessRun={...task.harnessRun,status:result.successful?'ready':'failed',result,completedAt:new Date().toISOString()};
   task.messages.push({id:randomUUID(),role:'assistant',text:'Harness² 优化'+(result.successful?'完成，配置等待你确认采用。':'未通过，不能采用配置。')+' 原项目未自动写回。'+(result.method?.ledger?' 探测 '+result.method.ledger.R+' 次，配置阶段 '+result.method.ledger.P+' 次。':''),at:new Date().toISOString()});
   task.error=null;
  }catch(error){if(!runtime.cancelled){finalStatus='error';task.error=safe(String(error.message)).slice(0,4000);task.harnessRun.status='failed';addEvent(task,{type:'error',text:task.error});}}
  finally{clearTimeout(deadline);await runtime.engine?.stop();grant?.revoke();if(runtime.cancelled)task.harnessRun.status='stopped';task.status=runtime.cancelled?'stopped':finalStatus;task.pending=[];task.draft='';active.delete(task.id);task.updatedAt=new Date().toISOString();storage.save();changed();}
 }
 function accountProfile(input,existing){
  const account=accounts.find(requireText(input.accountId,'账号'));if(!account.secret)throw new InputError('账号已退出，请先登录或导入');
  const p={id:existing?.id||randomUUID(),label:requireText(input.label,'连接名称',120),mode:'account',accountId:account.id,model:requireText(input.model,'模型 ID',160),protocol:'responses',secret:null};
  if(existing?.verification&&existing.accountId===p.accountId&&existing.model===p.model)p.verification=existing.verification;return p;
 }

 const auth=randomBytes(32).toString('hex');let origin;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  try{
   if(req.headers.host!==new URL(origin).host)return send(403,{error:'仅允许应用本机地址'});
   const bearer=req.headers.authorization==='Bearer '+auth;
   const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('gfot='))?.slice(5);
   if(!bearer&&!matches(cookie,auth))return send(401,{error:'请从 gfot 桌面应用访问'});
   if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'请求来源不允许'});
   const path=new URL(req.url,origin).pathname;
   if(req.method==='GET'&&files[path]){if(bearer)res.setHeader('Set-Cookie',`gfot=${auth}; HttpOnly; SameSite=Strict; Path=/`);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(files[path])]+'; charset=utf-8');return res.end(readFileSync(join(publicDir,files[path])));}
   if(req.method==='GET'&&path==='/api/state')return send(200,view());
   if(req.method==='GET'&&path==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','connection':'keep-alive'});res.write('event: state\ndata: '+JSON.stringify(view())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
   if(req.method!=='POST')return send(404,{error:'未找到该操作'});
   if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要 JSON'});
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)return send(413,{error:'内容过大'});chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('JSON 格式无效');}if(!input||typeof input!=='object'||Array.isArray(input))throw new InputError('需要对象');
   if(path==='/api/accounts/import'){
    if(!bearer)return send(403,{error:'请使用桌面端文件选择器导入'});
    if(active.size)throw new InputError('请先停止执行，再导入账号');
    const accountId=accounts.importCodex(requireText(input.document,'凭证文件',90000),input.label);return send(200,{accountId});
   }
   if(path==='/api/accounts/login/start'){
    if(!bearer)return send(403,{error:'请通过桌面按钮打开登录'});
    if(input.accountId&&active.size)throw new InputError('请先停止任务，再重新登录已有账号');
    return send(200,await accounts.beginLogin(input.accountId));
   }
   if(path==='/api/accounts/login/status')return send(200,accounts.loginStatus(input.id));
   if(path==='/api/accounts/login/cancel'){accounts.cancelLogin(input.id);return send(200,{ok:true});}
   if(path==='/api/accounts/models')return send(200,await accounts.models(input.id));
   if(path==='/api/accounts/quota')return send(200,await accounts.quota(input.id));
   if(path==='/api/accounts/logout'){
    if(active.size)throw new InputError('请先停止任务，再退出账号');
    accountProxy.revokeAccount(input.id);return send(200,await accounts.signOut(input.id));
   }
   if(path==='/api/profiles'){
    if(active.size)throw new InputError('请先停止执行，再修改连接设置');
    const existing=input.id?state.profiles.find(p=>p.id===input.id):undefined;if(input.id&&!existing)throw new InputError('连接不存在');
    const profile=(input.mode||existing?.mode)==='account'?accountProfile(input,existing):profileInput(input,existing,secrets.seal);if(existing){delete existing.verification;Object.assign(existing,profile);}else state.profiles.push(profile);storage.save();changed();return send(200,view());
   }
   if(path==='/api/connections/models'){
    const existing=input.id?state.profiles.find(p=>p.id===input.id):undefined;if(input.id&&!existing)throw new InputError('连接不存在');
    const profile=profileInput({...input,model:input.model||'model-list-only'},existing,secrets.seal);
    return send(200,profile.mode==='account'?await accounts.models(profile.accountId):await listModels(profile,secrets.open(profile.secret),connectionFetch));
   }
   if(path==='/api/profiles/test'||path==='/api/profiles/verify'){
    const profile=state.profiles.find(p=>p.id===input.id);if(!profile)throw new InputError('请先保存连接');
    if(path.endsWith('/test'))return send(200,profile.mode==='account'?await accounts.models(profile.accountId):await listModels(profile,secrets.open(profile.secret),connectionFetch));
    if(input.consent!==true)throw new InputError('请先确认：此检查会发送固定诊断消息并可能消耗模型用量，不会读取项目文件');
    const snapshot=JSON.stringify(profile),target=structuredClone(profile),targetKey=secrets.open(target.secret);
    let result;
    let diagnosticGrant;
    try{
     if(target.mode==='account'){diagnosticGrant=accountProxy.grant(target.accountId,target.model);result=await verifyResponses({...target,baseURL:diagnosticGrant.baseURL},diagnosticGrant.key);}
     else if(target.protocol==='responses')result=await verifyResponses(target,targetKey,connectionFetch);
     else if(target.protocol==='anthropic')throw new InputError('Anthropic 连接请通过一次实际任务验证；此处暂不做付费诊断');
     else result=await verifyConnection(target,targetKey,connectionFetch);
    }catch(error){
     if(JSON.stringify(state.profiles.find(p=>p.id===input.id))===snapshot){profile.verification={at:new Date().toISOString(),inference:false,toolCalling:false};storage.save();changed();}
     throw error;
    }finally{diagnosticGrant?.revoke();}
    if(JSON.stringify(state.profiles.find(p=>p.id===input.id))!==snapshot)throw new InputError('检查期间连接已改变，请重新检查');
    profile.verification={at:new Date().toISOString(),inference:result.inference,toolCalling:result.toolCalling};storage.save();changed();
    return send(200,result);
   }
   if(path==='/api/tasks'){
    let folder;try{folder=realpathSync(requireText(input.folder,'项目目录',4096));if(!statSync(folder).isDirectory())throw Error();}catch{throw new InputError('项目目录不存在或不可访问');}
    if(!state.profiles.some(p=>p.id===input.profileId))throw new InputError('请先配置并选择模型连接');
    const task=newTask(input,folder);state.tasks.unshift(task);storage.save();changed();return send(200,{taskId:task.id});
   }
   const match=path.match(/^\/api\/tasks\/([^/]+)\/(prompt|stop|permission|question|harness|harness-adopt|harness-clear)$/);if(!match)return send(404,{error:'未找到该操作'});
   const task=state.tasks.find(t=>t.id===match[1]);if(!task)throw new InputError('任务不存在');const runtime=active.get(task.id);
   if(match[2]==='harness-adopt'){
    if(runtime)throw new InputError('请先停止执行');if(input.consent!==true)throw new InputError('请确认采用此配置');
    if(task.harnessRun?.status!=='ready'||!task.harnessRun.result?.successful)throw new InputError('没有成功的配置可以采用');
    if(input.runId!==task.harnessRun.runId)throw new InputError('优化记录已变化，请刷新后再采用');
    task.adoptedHarness={tree:validHarness(task.harnessRun.result.harness),adoptedAt:new Date().toISOString()};task.harnessRun.status='adopted';storage.save();changed();return send(200,view());
   }
   if(match[2]==='harness-clear'){if(runtime)throw new InputError('请先停止执行');delete task.adoptedHarness;storage.save();changed();return send(200,view());}
   if(match[2]==='harness'){
    if(runtime||active.size>=2)throw new InputError('请等待当前执行结束');if(input.consent!==true)throw new InputError('请确认副本探测和最多 10 次模型会话');
    const status=harnessStatus(harnessRunner);if(!status.available)throw new InputError(status.reason);
    const text=requireText(input.text,'优化任务'),profile=state.profiles.find(p=>p.id===(input.profileId||task.profileId));if(!profile)throw new InputError('请选择连接');
    task.status='starting';task.error=null;task.pending=[];storage.save();const execution=runHarness(task,text,structuredClone(profile));pendingRuns.add(execution);void execution.finally(()=>pendingRuns.delete(execution));changed();return send(202,{started:true});
   }
   if(match[2]==='prompt'){
    if(runtime)throw new InputError('本轮尚未结束');if(active.size>=2)throw new InputError('首版最多同时执行两个任务');
    const text=requireText(input.text,'任务内容');const profile=state.profiles.find(p=>p.id===(input.profileId||task.profileId));if(!profile)throw new InputError('请选择可用的连接');
    task.profileId=profile.id;task.status='starting';task.error=null;task.pending=[];task.draft='';task.messages.push({id:randomBytes(12).toString('hex'),role:'user',text:safe(text),at:new Date().toISOString()});storage.save();const execution=run(task,text,structuredClone(profile));pendingRuns.add(execution);void execution.finally(()=>pendingRuns.delete(execution));changed();return send(202,{started:true});
   }
   if(match[2]==='stop'){if(runtime){runtime.cancelled=true;void runtime.engine?.stop();}return send(200,{stopping:!!runtime});}
   if(!runtime)throw new InputError('执行已结束');const pending=task.pending.find(p=>p.id===input.id);if(!pending)throw new InputError('请求已失效');
   if(match[2]==='permission'){if(pending.kind!=='permission'||!['once','reject'].includes(input.reply))throw new InputError('请选择批准一次或拒绝');await runtime.engine.permission(input.id,input.reply);}
   else{if(pending.kind!=='question'||!Array.isArray(input.answers)||!input.answers.every(a=>Array.isArray(a)&&a.every(s=>typeof s==='string')))throw new InputError('请回答问题');await runtime.engine.question(input.id,input.answers);}
   task.pending=task.pending.filter(p=>p.id!==input.id);task.status=task.pending.length?'permission':'running';changed();return send(200,{ok:true});
  }catch(error){send(error instanceof InputError?400:500,{error:error instanceof InputError?error.message:'操作失败：请检查连接和执行器状态'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {url:origin,auth,state,close:async()=>{closed=true;clearTimeout(timer);await Promise.all(Array.from(active.values(),async runtime=>{runtime.cancelled=true;await runtime.engine?.stop();}));await Promise.allSettled(pendingRuns);accounts.close();await accountProxy.close();storage.save();for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}};
}
