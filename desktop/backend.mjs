import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFileSync,realpathSync,statSync,mkdtempSync,rmSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createAgentRegistry,continuationText} from './local-agents.mjs';
import {ensureProject,recordTool,observeWorkspace,checkpoint,sharedContext,classifyFailure,continuationRequest} from './task-context.mjs';
import {beginExecution,executionPhase,toolActivity,finishExecution} from './execution-state.mjs';
import {AcpEngine} from './acp-engine.mjs';
import {DoubaoEngine} from './doubao-engine.mjs';
import {createStore,publicState,newTask,profileInput,vault,requireText,InputError} from './state.mjs';
import {OpenCodeEngine} from './engine.mjs';
import {Harness2Engine,harnessStatus,harnessPrompt,validHarness} from './harness2.mjs';
import {listModels,verifyConnection} from './connections.mjs';
import {createAccountManager} from './accounts.mjs';
import {startAccountProxy,verifyResponses} from './account-proxy.mjs';
const publicDir=fileURLToPath(new URL('./ui/',import.meta.url));
const files={'/':'index.html','/app.js':'app.js','/render.js':'render.js','/style.css':'style.css','/brand-mark.svg':'brand-mark.svg'};
const matches=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export async function startDesktopServer({dataDir,binary,key,harnessRunner,connectionFetch=fetch,accountFetch=fetch,agentRegistry,agentAppRoots,doubaoRoot,workspaceObserver=observeWorkspace,doubaoFactory=options=>new DoubaoEngine(options),acpFactory=options=>new AcpEngine(options),engineFactory=options=>new OpenCodeEngine(options)}){
 const storage=createStore(dataDir),secrets=vault(key),clients=new Set(),active=new Map(),pendingRuns=new Set();let timer,closed=false;const switches=new Map(),reservations=new Set();
 const occupiedSlots=()=>active.size+[...reservations].filter(id=>!active.has(id)).length;
 const state=storage.state;
 const agents=agentRegistry||createAgentRegistry({bundledBinary:binary,...(agentAppRoots?{appRoots:agentAppRoots}:{})});
 const checking=new Map(),nativeLogins=new Map();
 const accounts=createAccountManager({state,vault:secrets,save:storage.save,changed:()=>changed(),credentialsChanged:id=>{accountProxy.revokeAccount(id);for(const p of state.profiles)if(p.accountId===id)delete p.verification;},fetchImpl:accountFetch});
 const accountProxy=await startAccountProxy({accounts,fetchImpl:accountFetch});
 const safe=value=>{
  const values=[...state.profiles.map(p=>secrets.open(p.secret)),...accounts.sensitiveValues(),...Array.from(active.values(),r=>r.engine?.password),...Array.from(active.values(),r=>r.engine?.key)].filter(Boolean);
  const redact=v=>typeof v==='string'?values.reduce((text,secret)=>text.split(secret).join('[redacted]'),v):Array.isArray(v)?v.map(redact):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,item])=>[k,redact(item)])):v;
  return redact(value);
 };
 const view=()=>({...publicState(state),agents:agents.list().map(a=>({...a,check:state.agentChecks?.[a.id],login:[...nativeLogins.values()].find(l=>l.agentId===a.id)?.public})),engine:{name:'OpenCode',bundled:!!binary,version:'1.19.3'},harness2:{integrated:true,...harnessStatus(harnessRunner)},capabilities:{agentSwitching:true,sharedProjectContext:true,dynamicContinuation:true,automaticFailover:false,quotaQuery:true,quotaSources:['codex-local'],accountImport:['codex-local'],chatGPTLogin:true}});
 function changed(){if(closed)return;for(const client of clients)client.write('event: state\ndata: '+JSON.stringify(view())+'\n\n');clearTimeout(timer);timer=setTimeout(storage.save,80);}
 function addEvent(task,event){task.events.push({...event,at:new Date().toISOString()});task.events=task.events.slice(-150);changed();}
 function onEvent(task,event,runtime){
  if(active.get(task.id)!==runtime||runtime.cancelled||runtime.eventsClosed)return;
  const raw=event.properties||{};
  if(!runtime.harness2&&task.sessionId&&[raw.sessionID,raw.part?.sessionID].some(id=>id&&id!==task.sessionId))return;
  const properties=safe(raw);for(const field of ['id','sessionID'])if(raw[field]!==undefined)properties[field]=raw[field];
  if(properties.part)for(const field of ['id','messageID','sessionID'])if(raw.part[field]!==undefined)properties.part[field]=raw.part[field];
  const boundary=()=>{const runtime=active.get(task.id);if(!runtime)return;if(task.draft?.trim())task.liveProgress=[...(task.liveProgress||[]),task.draft].slice(-20).map(t=>t.slice(-5000));runtime.rawDraft='';task.draft='';storage.save();};
  const selectPart=id=>{const runtime=active.get(task.id);if(!runtime||!id)return;if(runtime.draftPartId&&runtime.draftPartId!==id)boundary();runtime.draftPartId=id;};
  const draft=value=>{
   const runtime=active.get(task.id);if(!runtime)return;runtime.rawDraft=value.slice(-100000);let hidden=0;
   for(const secret of [...state.profiles.map(p=>secrets.open(p.secret)),runtime.engine?.password,runtime.engine?.key,...accounts.sensitiveValues()].filter(Boolean))for(let n=Math.min(secret.length-1,runtime.rawDraft.length);n>hidden;n--)if(runtime.rawDraft.endsWith(secret.slice(0,n))){hidden=n;break;}
   task.draft=safe(hidden?runtime.rawDraft.slice(0,-hidden)+'[redacted]':runtime.rawDraft);executionPhase(task,'output');changed();
  };
  if(event.type==='permission.asked'||event.type==='permission.updated'){if(!task.pending.some(p=>p.id===properties.id))task.pending.push({...properties,kind:'permission'});task.status='permission';executionPhase(task,'permission');addEvent(task,{type:'permission',text:'等待批准：'+(properties.permission||properties.type||'工具操作')});}
  else if(event.type==='question.asked'){task.pending.push({...properties,kind:'question'});task.status='permission';executionPhase(task,'permission');addEvent(task,{type:'question',text:'执行器需要你的回答'});}
  else if(event.type==='message.part.updated'){
   const part=properties.part;if(!part)return;
   if(part.type==='reasoning'){executionPhase(task,'thinking');changed();}
   if(part.type==='text'){selectPart(raw.part.id);draft(String(raw.part.text||''));}
   if(part.type==='tool'){toolActivity(task,part);if(!active.get(task.id)?.harness2)recordTool(task,part);const status=part.state?.status||'';const text=(part.tool||'工具')+' · '+status;const last=task.events.at(-1);if(last?.partID===part.id){last.text=text;last.detail=JSON.stringify(part.state?.input||{}).slice(0,4000);changed();}else addEvent(task,{type:'tool',partID:part.id,text,detail:JSON.stringify(part.state?.input||{}).slice(0,4000)});}
  }else if(event.type==='gfot.activity'){executionPhase(task,properties.phase,properties.detail);changed();}
  else if(event.type==='gfot.output.boundary'){boundary();changed();}
  else if(event.type==='message.part.delta'&&properties.field==='reasoning'){executionPhase(task,'thinking');changed();}
  else if(event.type==='message.part.delta'&&properties.field==='text'){selectPart(raw.partID);draft((active.get(task.id)?.rawDraft||'')+String(raw.delta||''));}
  else if(event.type==='session.error'){task.error=JSON.stringify(properties.error||{}).slice(0,3000);changed();}
 }
 async function stopExecutor(runtime,task){
  const outcome=await runtime.engine?.stop();
  if(outcome?.confirmed===false){task.executionUnconfirmed={agentId:task.agentId,at:new Date().toISOString()};storage.save();throw new InputError('原生 Agent 未确认本轮结束。请核对原应用，关闭切换窗口后在任务中确认，再进行交接。');}
 }
 async function run(task,text,profile,agent){
  const runtime={engine:null,cancelled:false};runtime.finished=new Promise(resolve=>runtime.finish=resolve);let finalStatus='idle',grant,outputRecorded=false;active.set(task.id,runtime);
  const deadline=setTimeout(()=>{runtime.cancelled=true;task.error='本轮超过 15 分钟，已请求停止。核对执行记录后再继续。';void runtime.engine?.stop().catch(error=>{task.error=safe(error.message);changed();});},15*60*1000);
  try{
   const slots=task.agentSessions||={};
   const saved=slots[agent.id]||(agent.kind==='builtin'&&task.sessionId&&!Object.keys(slots).length?{sessionId:task.sessionId,cursor:task.messages.length-1}:{});
   const engineTask=task;engineTask.sessionId=saved.sessionId||null;
   const wasFresh=!engineTask.sessionId;
   if(agent.kind==='builtin'&&profile.mode==='account')grant=accountProxy.grant(profile.accountId,profile.model);
   const resolved=grant?{...profile,baseURL:grant.baseURL,protocol:'responses'}:profile;
   const engine=runtime.engine=agent.kind==='builtin'?engineFactory({binary,dataDir,task:engineTask,profile:resolved,key:grant?.key||secrets.open(profile.secret),systemPrompt:task.adoptedHarness?harnessPrompt(task.adoptedHarness.tree):undefined,onEvent:event=>onEvent(task,event,runtime)}):agent.kind==='doubao'?doubaoFactory({root:doubaoRoot,task:engineTask,onEvent:event=>onEvent(task,event,runtime),onSession:sessionId=>{task.sessionId=sessionId;slots[agent.id]={sessionId,cursor:saved.cursor||0};storage.save();}}):acpFactory({launch:agents.command(agent.id),task:engineTask,onEvent:event=>onEvent(task,event,runtime)});
   await engine.start();
   slots[agent.id]={sessionId:engineTask.sessionId,cursor:wasFresh||engine.resumed===false?0:saved.cursor||0};
   task.sessionId=engineTask.sessionId;storage.save();if(runtime.cancelled)return;
   const packet=sharedContext(task,state.projects.find(p=>p.id===task.projectId),state.tasks,{detailed:true}),shared=packet.text;
   const adopted=agent.kind!=='builtin'&&task.adoptedHarness?'Task instructions explicitly adopted by the user:\n'+harnessPrompt(task.adoptedHarness.tree)+'\n\n':'';
   const transfer=continuationText(task,text,{fresh:wasFresh||engine.resumed===false,cursor:saved.cursor||0,includeNotes:false,maxChars:Math.max(0,60000-shared.length-adopted.length-text.length-700)});
   const outgoing=adopted+shared+'\n'+transfer.text;
   if(outgoing.length>60000)throw new InputError('共享记忆、执行指令与本条消息超过上下文预算，请缩短项目或任务记忆后继续。');
   task.lastTransfer={at:new Date().toISOString(),agentId:agent.id,characters:outgoing.length,historyForwarded:transfer.forwarded,historyOmitted:transfer.omitted,evidenceOmitted:packet.omittedEvidence,tools:packet.toolCount};storage.save();
   if(transfer.forwarded||transfer.omitted)addEvent(task,{type:'handoff',text:'共享上下文：'+transfer.forwarded+' 条对话'+(transfer.omitted?'；较早的 '+transfer.omitted+' 条未传递，请补充任务备注。':'' )});
   task.status='running';executionPhase(task,'waiting');storage.save();changed();
   const answer=await engine.send(outgoing);if(runtime.cancelled)return;
   executionPhase(task,'finishing');changed();
   const history=safe(await engine.history());
   const lastUser=history.findLastIndex(m=>m.info?.role==='user');
   const answers=history.slice(lastUser+1).filter(m=>m.info?.role==='assistant'&&(m.parts||[]).some(p=>p.type==='text'&&p.text));
   for(const [index,m] of answers.entries()){
    const answerText=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('\n');
    if(answerText){task.messages.push({id:randomUUID(),role:'assistant',agentId:agent.id,text:answerText,presentation:m.info.presentation||(!answer?.info?.error&&index===answers.length-1?'final':'progress'),at:new Date(m.info.time?.created||Date.now()).toISOString()});outputRecorded=true;}
   }
   if(!outputRecorded){
    // Some native adapters stream public text without returning it in history.
    const progress=task.liveProgress||[],streamed=[...progress,...(task.draft?.trim()?[task.draft]:[])];
    for(const [index,text] of streamed.entries())if(text.trim()){
     task.messages.push({id:randomUUID(),role:'assistant',agentId:agent.id,text,presentation:!answer?.info?.error&&index>=progress.length?'final':'progress',at:new Date().toISOString()});outputRecorded=true;
    }
   }
   slots[agent.id]={sessionId:engineTask.sessionId,cursor:task.messages.length};
   if(agent.kind!=='builtin'){state.agentChecks||={};state.agentChecks[agent.id]={at:new Date().toISOString(),connected:true,inference:true};}
   if(outputRecorded){task.liveProgress=[];task.draft='';runtime.rawDraft='';}
   if(answer?.info?.error)throw Error(JSON.stringify(answer.info.error));
   task.blocked=null;task.error=null;addEvent(task,{type:'done',text:'本轮执行已结束，请检查实际变更与验证结果。'});
  }catch(error){if(!runtime.cancelled){finalStatus='error';task.error=safe(String(error.message)).slice(0,4000);task.blocked={kind:classifyFailure(task.error),agentId:agent.id,at:new Date().toISOString()};addEvent(task,{type:'error',text:task.error});}}
  finally{runtime.eventsClosed=true;clearTimeout(deadline);let stopFailed=false;try{await stopExecutor(runtime,task);}catch(error){stopFailed=true;task.error=safe(error.message);addEvent(task,{type:'error',text:task.error});}grant?.revoke();if(!outputRecorded&&(runtime.cancelled||finalStatus==='error')){const partial=[...(task.liveProgress||[]),task.draft].filter(Boolean).join('\n\n').slice(-100000);if(partial.trim())task.messages.push({id:randomUUID(),role:'assistant',agentId:agent.id,text:partial,presentation:'progress',interrupted:true,at:new Date().toISOString()});}const finishedStatus=stopFailed?'error':runtime.cancelled?'stopped':finalStatus;task.pending=[];task.liveProgress=[];task.draft='';const workspace=await workspaceObserver(task.folder);task.status=finishedStatus;finishExecution(task,finishedStatus);task.checkpoint=checkpoint(task,workspace);active.delete(task.id);task.updatedAt=new Date().toISOString();storage.save();changed();runtime.finish();}
 }
 async function runHarness(task,text,profile){
  beginExecution(task);const runtime={engine:null,cancelled:false,harness2:true};let grant,finalStatus='idle';active.set(task.id,runtime);
  task.harnessRun={status:'running',runId:randomUUID(),startedAt:new Date().toISOString(),phases:[]};
  const deadline=setTimeout(()=>{runtime.cancelled=true;void runtime.engine?.stop().catch(error=>{task.error=safe(error.message);changed();});},15*60*1000);
  try{
   if(profile.mode==='account')grant=accountProxy.grant(profile.accountId,profile.model);
   const resolved=grant?{...profile,baseURL:grant.baseURL,protocol:'responses'}:profile;
   const engine=runtime.engine=new Harness2Engine({binary,dataDir,harnessRunner,task,prompt:text,profile:resolved,key:grant?.key||secrets.open(profile.secret),engineFactory,redact:safe,
    onEvent:event=>onEvent(task,event,runtime),onPhase:phase=>{if(active.get(task.id)!==runtime||runtime.cancelled||runtime.eventsClosed)return;task.pending=[];task.liveProgress=[];task.draft='';task.status='running';executionPhase(task,'working','提示词优化 · '+phase.label);task.harnessRun.phases.push(phase);task.harnessRun.phase=phase;addEvent(task,{type:'harness2',text:'Harness² · '+phase.label+' · '+(phase.action==='propose'?'提出配置':'副本探测')});}});
   await engine.start();if(runtime.cancelled)return;const result=safe(await engine.send());if(runtime.cancelled)return;
   task.harnessRun={...task.harnessRun,status:result.successful?'ready':'failed',result,completedAt:new Date().toISOString()};
   task.messages.push({id:randomUUID(),role:'assistant',text:'Harness² 优化'+(result.successful?'完成，配置等待你确认采用。':'未通过，不能采用配置。')+' 原项目未自动写回。'+(result.method?.ledger?' 探测 '+result.method.ledger.R+' 次，配置阶段 '+result.method.ledger.P+' 次。':''),at:new Date().toISOString()});
   task.error=null;
  }catch(error){if(!runtime.cancelled){finalStatus='error';task.error=safe(String(error.message)).slice(0,4000);task.harnessRun.status='failed';addEvent(task,{type:'error',text:task.error});}}
  finally{runtime.eventsClosed=true;clearTimeout(deadline);await runtime.engine?.stop();grant?.revoke();if(runtime.cancelled)task.harnessRun.status='stopped';task.status=runtime.cancelled?'stopped':finalStatus;finishExecution(task,task.status);task.pending=[];task.liveProgress=[];task.draft='';active.delete(task.id);task.updatedAt=new Date().toISOString();storage.save();changed();}
 }

 function launch(task,text,profile,agent,{continuation=false}={}){
  if(profile)task.profileId=profile.id;task.executorKind=agent.kind;task.status='starting';task.error=null;task.blocked=null;task.pending=[];task.liveProgress=[];task.draft='';beginExecution(task);
  task.messages.push({id:randomUUID(),role:'user',agentId:agent.id,text:safe(text),continuation,at:new Date().toISOString()});storage.save();
  const execution=run(task,text,profile?structuredClone(profile):null,agent);pendingRuns.add(execution);void execution.finally(()=>pendingRuns.delete(execution));changed();
 }
 function nativeTurnPending(task){
  if(task.executionUnconfirmed)return true;
  if(task.agentId!=='doubao'||!task.agentSessions?.doubao?.sessionId)return false;
  try{return !!JSON.parse(task.agentSessions.doubao.sessionId).pending;}catch{return true;}
 }
 async function switchTask(task,input){
  const agent=agents.get(input.agentId),profile=state.profiles.find(p=>p.id===(input.profileId||task.profileId));
  if(input.resume===true&&agent.kind==='builtin'){
   if(!profile||!profile.model)throw new InputError('请先选择内置执行器的模型与账号连接');
   if(profile.mode==='account'){const account=accounts.find(profile.accountId);if(!account.secret)throw new InputError('目标账号已退出，请先登录或导入');if(account.status==='reauth-required'||(!account.canRefresh&&account.expiresAt<=Date.now()))throw new InputError('目标账号凭证不可用，请重新登录或导入');}
   else if(profile.mode==='direct'&&!profile.secret)throw new InputError('目标连接缺少 API Key');
  }
  if(switches.has(task.id))throw new InputError('此任务正在交接');
  if(input.resume===true&&!task.messages.some(m=>m.role==='user'&&!m.continuation))throw new InputError('请先输入任务目标');
  if([...nativeLogins.values()].some(l=>l.public.status==='pending'))throw new InputError('请先完成或取消 Agent 登录');
  const runtime=active.get(task.id);if(runtime?.harness2)throw new InputError('请先结束提示词优化，再切换执行器');
  if(!runtime&&occupiedSlots()>=2&&input.resume===true)throw new InputError('请等待其他任务结束');
  if(input.resume===true)reservations.add(task.id);
  const from=task.agentId;task.transition={targetId:agent.id,startedAt:new Date().toISOString()};storage.save();changed();
  const operation=Promise.resolve().then(async()=>{try{
   if(runtime){runtime.cancelled=true;executionPhase(task,'stopping');try{await stopExecutor(runtime,task);let timer;try{await Promise.race([runtime.finished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('旧执行器尚未确认结束，暂不能切换')),70000);})]);}finally{clearTimeout(timer);}}catch(error){throw new InputError('交接未完成：'+safe(error.message));}}
   if(closed)throw new InputError('服务正在关闭');
   if(nativeTurnPending(task))throw new InputError('原生 Agent 上一轮尚未确认结束，请先核对并确认，暂不能交接给其他 Agent');
   task.checkpoint=checkpoint(task,await workspaceObserver(task.folder));
   if(closed)throw new InputError('服务正在关闭');
   task.agentId=agent.id;task.executorKind=agent.kind;task.sessionId=task.agentSessions?.[agent.id]?.sessionId||null;
   task.switchHistory=[...(task.switchHistory||[]),{from,to:agent.id,checkpointId:task.checkpoint.id,at:new Date().toISOString(),continued:input.resume===true}].slice(-20);
   delete task.transition;storage.save();addEvent(task,{type:'handoff',text:'已交接给 '+agent.name+'，保留原项目、任务和执行进度。'});
   if(input.resume===true){reservations.delete(task.id);launch(task,continuationRequest,profile,agent,{continuation:true});}
   return {taskId:task.id,continued:input.resume===true,checkpointId:task.checkpoint.id};
  }finally{delete task.transition;storage.save();changed();switches.delete(task.id);reservations.delete(task.id);}});
  switches.set(task.id,operation);return operation;
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
   if(closed)return send(503,{error:'服务正在关闭'});
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
   if(closed)return send(503,{error:'服务正在关闭'});
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('JSON 格式无效');}if(!input||typeof input!=='object'||Array.isArray(input))throw new InputError('需要对象');
   if(path==='/api/agents/refresh'){agents.refresh();changed();return send(200,view());}
   if(path==='/api/agents/login/start'){
    if(!bearer)return send(403,{error:'请通过桌面客户端启动登录'});
    const agent=agents.get(input.id);if(!['workbuddy','workbuddy-ai'].includes(agent.id))throw new InputError('请在此 Agent 的原应用中登录');
    if(active.size||switches.size||checking.size||[...nativeLogins.values()].some(l=>l.public.status==='pending'))throw new InputError('请先结束执行或当前登录');
    const id=randomUUID(),folder=mkdtempSync(join(tmpdir(),'gfot-agent-login-'));
    const engine=acpFactory({launch:agents.command(agent.id),task:{folder,sessionId:null}}),login={agentId:agent.id,engine,public:{id,status:'pending',note:'请在浏览器中完成 CLI 登录；gfot 不读取登录 Token。'}};
    for(const [oldId,old] of nativeLogins)if(old.agentId===agent.id)nativeLogins.delete(oldId);nativeLogins.set(id,login);changed();
    const pending=(async()=>{try{await engine.start();const methodId=agent.id==='workbuddy'?'internal':'external';if(!engine.info.authMethods?.some(m=>m.id===methodId))throw Error('此版本没有相应的 CLI 登录方式');await engine.request('authenticate',{methodId},5*60*1000);if(login.public.status==='pending'){login.public.status='complete';login.public.note='CLI 登录完成，可返回任务发送消息验证执行。';}}
     catch(error){if(login.public.status==='pending'){login.public.status='error';login.public.note=safe(String(error.message)).slice(0,1000);}}
     finally{await engine.stop();rmSync(folder,{recursive:true,force:true});changed();}})();
    pendingRuns.add(pending);void pending.finally(()=>pendingRuns.delete(pending));return send(200,login.public);
   }
   if(path==='/api/agents/login/cancel'){
    const login=nativeLogins.get(input.id);if(!login)throw new InputError('登录不存在');login.public.status='cancelled';login.public.note='登录已取消';await login.engine.stop();changed();return send(200,{ok:true});
   }
   if(path==='/api/agents/check'){
    const agent=agents.get(input.id);if(!['acp','doubao'].includes(agent.kind))throw new InputError('此 Agent 无需执行接口检查');
    if(checking.has(agent.id)||active.size||switches.size)throw new InputError('请等待执行或检查结束');
    checking.set(agent.id,null);const folder=mkdtempSync(join(tmpdir(),'gfot-agent-check-'));let engine;
    try{engine=agent.kind==='doubao'?doubaoFactory({root:doubaoRoot,task:{folder,sessionId:null},readOnly:true}):acpFactory({launch:agents.command(agent.id),task:{folder,sessionId:null},readOnly:true});checking.set(agent.id,engine);await engine.start();
     state.agentChecks||={};state.agentChecks[agent.id]={at:new Date().toISOString(),connected:true,inference:false};storage.save();changed();return send(200,{ok:true,note:'协议与会话创建通过，尚未调用模型。首次任务仍需验证账号与额度。'});
    }catch(error){state.agentChecks||={};state.agentChecks[agent.id]={at:new Date().toISOString(),connected:false,inference:false};storage.save();changed();throw new InputError(safe(error.message));}
    finally{await engine?.stop();checking.delete(agent.id);rmSync(folder,{recursive:true,force:true});}
   }
   if(path==='/api/accounts/import'){
    if(!bearer)return send(403,{error:'请使用桌面端文件选择器导入'});
    if(active.size||switches.size)throw new InputError('请先停止执行，再导入账号');
    const accountId=accounts.importCodex(requireText(input.document,'凭证文件',90000),input.label);return send(200,{accountId});
   }
   if(path==='/api/accounts/login/start'){
    if(!bearer)return send(403,{error:'请通过桌面按钮打开登录'});
    if(input.accountId&&(active.size||switches.size))throw new InputError('请先停止任务，再重新登录已有账号');
    return send(200,await accounts.beginLogin(input.accountId));
   }
   if(path==='/api/accounts/login/status')return send(200,accounts.loginStatus(input.id));
   if(path==='/api/accounts/login/cancel'){accounts.cancelLogin(input.id);return send(200,{ok:true});}
   if(path==='/api/accounts/models')return send(200,await accounts.models(input.id));
   if(path==='/api/accounts/quota')return send(200,await accounts.quota(input.id));
   if(path==='/api/accounts/logout'){
    if(active.size||switches.size)throw new InputError('请先停止任务，再退出账号');
    accountProxy.revokeAccount(input.id);return send(200,await accounts.signOut(input.id));
   }
   if(path==='/api/profiles'){
    if(active.size||switches.size)throw new InputError('请先停止执行，再修改连接设置');
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
   const projectMatch=path.match(/^\/api\/projects\/([^/]+)\/notes$/);
   if(projectMatch){const project=state.projects.find(p=>p.id===projectMatch[1]);if(!project)throw new InputError('项目不存在');if(state.tasks.some(t=>t.projectId===project.id&&(active.has(t.id)||switches.has(t.id))))throw new InputError('请先结束本项目的执行或交接');if(typeof input.text!=='string'||input.text.length>8000)throw new InputError('项目记忆最多 8000 字符');project.notes=safe(input.text);storage.save();changed();return send(200,view());}
   if(path==='/api/tasks'){
    let folder;try{folder=realpathSync(requireText(input.folder,'项目目录',4096));if(!statSync(folder).isDirectory())throw Error();}catch{throw new InputError('项目目录不存在或不可访问');}
    const agent=agents.get(input.agentId||'opencode');if(agent.kind==='unavailable')throw new InputError('此应用尚未提供客户端内执行接口');
    if(agent.requiresProfile!==false&&agent.kind==='builtin'&&!state.profiles.some(p=>p.id===input.profileId))throw new InputError('请先配置并选择模型连接');
    const task=newTask(input,folder);task.projectId=ensureProject(state,folder).id;task.agentId=agent.id;task.agentSessions={};task.contextNotes='';state.tasks.unshift(task);storage.save();changed();return send(200,{taskId:task.id});
   }
   const match=path.match(/^\/api\/tasks\/([^/]+)\/(prompt|stop|permission|question|harness|harness-adopt|harness-clear|agent|switch|confirm-stopped|notes)$/);if(!match)return send(404,{error:'未找到该操作'});
   const task=state.tasks.find(t=>t.id===match[1]);if(!task)throw new InputError('任务不存在');const runtime=active.get(task.id);
   if(match[2]==='switch')return send(input.resume===true?202:200,await switchTask(task,input));
   if(switches.has(task.id))throw new InputError('此任务正在交接，请等待');
   if(match[2]==='agent'){if(runtime)throw new InputError('请先结束或停止当前回合');await switchTask(task,{...input,resume:false});return send(200,view());}
   if(match[2]==='confirm-stopped'){if(runtime)throw new InputError('请先等待执行清理结束');if(input.confirmed!==true||!task.executionUnconfirmed)throw new InputError('请明确确认已在原应用核对旧任务结束');delete task.executionUnconfirmed;storage.save();changed();return send(200,view());}
   if(match[2]==='notes'){
    if(runtime)throw new InputError('请先结束或停止当前回合');if(typeof input.text!=='string'||input.text.length>8000)throw new InputError('任务备注最多 8000 字符');task.contextNotes=safe(input.text);storage.save();changed();return send(200,view());
   }
   if(match[2]==='harness-adopt'){
    if(runtime)throw new InputError('请先停止执行');if(input.consent!==true)throw new InputError('请确认采用此配置');
    if(task.harnessRun?.status!=='ready'||!task.harnessRun.result?.successful)throw new InputError('没有成功的配置可以采用');
    if(input.runId!==task.harnessRun.runId)throw new InputError('优化记录已变化，请刷新后再采用');
    task.adoptedHarness={tree:validHarness(task.harnessRun.result.harness),adoptedAt:new Date().toISOString()};task.harnessRun.status='adopted';storage.save();changed();return send(200,view());
   }
   if(match[2]==='harness-clear'){if(runtime)throw new InputError('请先停止执行');delete task.adoptedHarness;storage.save();changed();return send(200,view());}
   if(match[2]==='harness'){
    if((task.agentId||'opencode')!=='opencode')throw new InputError('Harness² 副本探测请先选择内置 OpenCode 和模型连接；采用后的指令可用于其他 Agent');
    if(runtime||occupiedSlots()>=2)throw new InputError('请等待当前执行结束');if(input.consent!==true)throw new InputError('请确认副本探测和最多 10 次模型会话');
    const status=harnessStatus(harnessRunner);if(!status.available)throw new InputError(status.reason);
    const text=requireText(input.text,'优化任务'),profile=state.profiles.find(p=>p.id===(input.profileId||task.profileId));if(!profile)throw new InputError('请选择连接');
    task.status='starting';task.error=null;task.pending=[];storage.save();const execution=runHarness(task,text,structuredClone(profile));pendingRuns.add(execution);void execution.finally(()=>pendingRuns.delete(execution));changed();return send(202,{started:true});
   }
   if(match[2]==='prompt'){
    if(runtime)throw new InputError('本轮尚未结束');if(task.executionUnconfirmed)throw new InputError('请先核对并确认上一轮原生任务结束');if([...nativeLogins.values()].some(l=>l.public.status==='pending'))throw new InputError('请先完成或取消 Agent 登录');if(occupiedSlots()>=2)throw new InputError('首版最多同时执行两个任务');
    const text=requireText(input.text,'任务内容');const agent=agents.get(task.agentId||'opencode');if(agent.kind==='unavailable')throw new InputError('此应用尚未提供客户端内执行接口');const profile=state.profiles.find(p=>p.id===(input.profileId||task.profileId));if(agent.kind==='builtin'&&!profile)throw new InputError('请选择可用的连接');
    launch(task,text,profile,agent);return send(202,{started:true});
   }
   if(match[2]==='stop'){if(runtime){runtime.cancelled=true;executionPhase(task,'stopping');changed();void runtime.engine?.stop().catch(error=>{task.error=safe(error.message);changed();});}return send(200,{stopping:!!runtime});}
   if(!runtime)throw new InputError('执行已结束');const pending=task.pending.find(p=>p.id===input.id);if(!pending)throw new InputError('请求已失效');
   if(match[2]==='permission'){if(pending.kind!=='permission'||!['once','reject'].includes(input.reply))throw new InputError('请选择批准一次或拒绝');await runtime.engine.permission(input.id,input.reply);}
   else{if(pending.kind!=='question'||!Array.isArray(input.answers)||!input.answers.every(a=>Array.isArray(a)&&a.every(s=>typeof s==='string')))throw new InputError('请回答问题');await runtime.engine.question(input.id,input.answers);}
   task.pending=task.pending.filter(p=>p.id!==input.id);task.status=task.pending.length?'permission':'running';if(task.execution?.phase==='permission')executionPhase(task,task.pending.length?'permission':'waiting');changed();return send(200,{ok:true});
  }catch(error){send(error instanceof InputError?400:500,{error:error instanceof InputError?error.message:'操作失败：请检查连接和执行器状态'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {url:origin,auth,state,close:async()=>{closed=true;clearTimeout(timer);await Promise.all([...checking.values()].filter(Boolean).map(e=>e.stop()));await Promise.all([...nativeLogins.values()].map(async l=>{l.public.status='cancelled';await l.engine.stop();}));await Promise.allSettled(Array.from(active.values(),async runtime=>{runtime.cancelled=true;await runtime.engine?.stop();}));await Promise.allSettled(pendingRuns);await Promise.allSettled(switches.values());accounts.close();await accountProxy.close();storage.save();for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}};
}
