import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {InputError} from './state.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const dshVersion='0.2.1-rc.2';
export const defaultDshRoot=join(here,'runtime','dsh');
export const dshBinary=root=>join(root||defaultDshRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js');
const textOf=message=>(message?.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('\n');

export class DshEngine{
 constructor(options){Object.assign(this,{nodeBinary:process.execPath,dshRoot:defaultDshRoot,onEvent:()=>{},...options});this.pending=new Map();this.decisions=new Map();this.tools=new Map();this.children=new Set();this.responses=[];this.buffer='';this.nextId=0;this.stopped=false;}
 event(type,properties={}){if(!this.stopped)this.onEvent({type,properties:{sessionID:this.task.sessionId,...properties}});}
 write(message){if(!this.child?.stdin.writable)throw Error('dsh connection closed');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
 request(method,params,timeout=45000){return new Promise((resolveRequest,reject)=>{
  const id=++this.nextId,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('dsh request timed out: '+method));},timeout);
  this.pending.set(id,{resolve:resolveRequest,reject,timer});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
 });}
 fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 async start(){
  if(this.stopped)throw Error('dsh 已停止');
  const bin=dshBinary(this.dshRoot);if(!existsSync(bin))throw new InputError('dsh 运行时缺失，请重新安装 gfot 或运行 npm run runtime:dsh');
  const home=join(this.dataDir,'dsh',this.task.id);mkdirSync(home,{recursive:true,mode:0o700});
  const protocol={chat:'openai-completions',responses:'openai-responses',anthropic:'anthropic-messages'}[this.profile.protocol||'chat'];
  if(!protocol)throw new InputError('dsh 不支持此模型协议');
  // Anthropic's SDK appends /v1/messages; OpenAI SDKs append /responses or
  // /chat/completions. Profiles use a /v1 prefix, so normalize only Anthropic.
  const baseURL=protocol==='anthropic-messages'?this.profile.baseURL.replace(/\/v1\/?$/,''):this.profile.baseURL;
  const patch=[
   {id:'llm-pi-ai',config:{providers:{gfot:{api:protocol,baseURL,apiKeyEnv:'GFOT_DSH_MODEL_KEY',models:[{id:this.profile.model,contextWindow:64000,maxTokens:8192}],...(protocol==='openai-completions'?{compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens'}}:{})}}}},
   {id:'llm-deepseek',disabled:true},{id:'llm-deepseek-account',disabled:true},
   {id:'system-prompt',config:{personaPrefix:'You are gfot, a software engineering agent. Inspect the selected project, use tools to complete the task, ask the user when essential information is missing, and verify your changes.'}},
   {id:'sandbox-policy',config:{mode:this.readOnly?'read-only':'workspace-write',workspaceRoot:resolve(this.task.folder)}},
   {id:'approval',config:{policy:this.readOnly?'never':'ask'}},
   {id:'permission',config:{presets:{gfot:{sandbox:this.readOnly?'read-only':'workspace-write',approval:this.readOnly?'never':'ask'}},defaultPreset:'gfot'}},
   {id:'sdk-jsonrpc-server',config:{maxTokensAsSuccess:false}},
   {id:'plugin-manager',disabled:true},{id:'tool-plugin-manager',disabled:true},{id:'tool-cordis',disabled:true},
   {id:'session-telemetry-otel',disabled:true},{id:'otel',disabled:true},
   {id:'skill-filesystem',disabled:true},
   {insert:[{id:'tool-ask-user',name:'@deepseek-ai/dsh-tool-ask-user',config:{mode:'legacy'}},{id:'gfot-host',name:existsSync(join(this.dshRoot,'gfot-host.mjs'))?join(this.dshRoot,'gfot-host.mjs'):fileURLToPath(new URL('./dsh-host.mjs',import.meta.url)),config:{readOnly:!!this.readOnly,isolateWorkspace:!!this.isolateWorkspace,systemPrompt:this.systemPrompt||'',maxSteps:this.maxSteps||0}}]},
  ];
  const patchFile=join(home,'gfot.patch.json');writeFileSync(patchFile,JSON.stringify(patch),{mode:0o600});
  const env={HOME:home,PATH:process.env.PATH||'/opt/homebrew/bin:/usr/bin:/bin',TMPDIR:process.env.TMPDIR||'/tmp',LANG:process.env.LANG||'en_US.UTF-8',ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',GFOT_DSH_MODEL_KEY:this.key||'local-proxy'};
  this.child=spawn('/bin/sh',['-c',readFileSync(join(here,'agent-supervise.sh'),'utf8'),'gfot-dsh-supervisor',String(process.pid),this.nodeBinary,bin,'sdk','--patch',patchFile],{cwd:this.task.folder,env,detached:true,stdio:['pipe','pipe','pipe']});
  this.exit=new Promise(resolveExit=>this.child.once('close',resolveExit));
  this.child.on('error',()=>this.fail(Error('无法启动 dsh')));this.child.once('exit',()=>this.fail(Error('dsh 执行进程已退出')));
  this.child.stdin.on('error',()=>this.fail(Error('dsh 输入连接关闭')));
  this.stderr='';this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk.toString()).slice(-6000);});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;if(this.buffer.length>4000000){this.fail(Error('dsh 协议消息超过限制'));void this.stop();return;}
   let pos;while((pos=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,pos);this.buffer=this.buffer.slice(pos+1);let m;try{m=JSON.parse(line);}catch{continue;}try{this.receive(m);}catch(error){this.fail(error);void this.stop();}}
  });
  await this.request('initialize',{cwd:this.task.folder,provider:'gfot',model:this.profile.model,maxTokens:8192});
  if(!this.hostReady)throw Error('dsh 未加载 gfot 交互插件，拒绝启动任务');
  if(this.stopped)throw Error('dsh 已停止');
  if(this.task.sessionId){await this.request('session/resume',{sessionId:this.task.sessionId});this.resumed=true;}
  else{this.task.sessionId='session-'+randomUUID().replaceAll('-','');this.resumed=false;}
 }
 receive(m){
  if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(String(m.error.message||'dsh protocol error'))):p.resolve(m.result);return;}
  const p=m.params||{};
  if(m.method==='gfot.ready'){this.hostReady=true;return;}
  if(m.method==='gfot.error'){this.turnError=String(p.message||'dsh execution failed');return;}
  if(m.method==='subagent.started'&&(p.parentSessionId===this.task.sessionId||this.children.has(p.parentSessionId))){this.children.add(p.childSessionId);this.event('gfot.activity',{phase:'working',detail:'dsh 子 Agent 正在执行'});return;}
  const own=p.sessionId===this.task.sessionId||this.children.has(p.sessionId);
  if(m.id!==undefined){
   if(!own||!['gfot.approval','gfot.question'].includes(m.method)||this.stopped){this.write({id:m.id,error:{code:-32601,message:'Host request unavailable'}});return;}
   this.decisions.set(m.id,{method:m.method,params:p});
   if(m.method==='gfot.approval')this.event('permission.asked',{id:m.id,permission:p.toolName,patterns:[this.task.folder],metadata:{input:p.input??this.tools.get(p.sessionId+':'+p.callId)?.input,reason:p.reason,childSession:p.sessionId===this.task.sessionId?undefined:p.sessionId}});
   else this.event('question.asked',{id:m.id,questions:p.questions});return;
  }
  if(m.method==='gfot.cancelled'){if(this.decisions.delete(p.id))this.event('gfot.request.cancelled',{id:p.id});return;}
  if(!own)return;
  if(m.method==='gfot.stream'&&p.sessionId===this.task.sessionId){
   if(p.type==='start'){this.event('gfot.output.boundary');this.event('gfot.activity',{phase:'waiting'});}
   if(p.type==='thinking')this.event('gfot.activity',{phase:'thinking'});
   if(p.type==='text')this.event('message.part.delta',{field:'text',delta:p.text});return;
  }
  if(m.method!=='session.event')return;
  const e=p.event,d=e?.data||{};
  if(e?.type==='assistant/message'&&p.sessionId===this.task.sessionId){const text=textOf(d.message);if(text)this.responses.push(text);}
  if(e?.type==='turn/end'&&p.sessionId===this.task.sessionId&&d.reason?.kind!=='completed')this.turnError='dsh 本轮未完成：'+(d.reason?.error?.message||d.reason?.kind||'unknown');
  if(e?.type==='tool/call'){
   let input;try{input=JSON.parse(d.arguments);}catch{input=d.arguments;}
   const id=p.sessionId+':'+d.callId;this.tools.set(id,{tool:d.name,input});this.event('message.part.updated',{part:{id,type:'tool',tool:d.name,state:{status:'running',input}}});
  }
  if(e?.type==='tool/result'){
   const id=p.sessionId+':'+d.message?.toolCallId,t=this.tools.get(id)||{};this.event('message.part.updated',{part:{id,type:'tool',tool:t.tool,state:{status:d.message?.isError?'error':'completed',input:t.input,output:textOf(d.message)}}});
  }
 }
 async send(text){
  if(this.stopped)throw Error('dsh 已停止');this.responses=[];this.turnError=null;
  await this.request('session/prompt',{sessionId:this.task.sessionId,contentBlocks:[{type:'text',text}]});
  await this.request('session/wait',{sessionId:this.task.sessionId},15*60*1000);
  if(this.stopped)throw Error('dsh 已停止');if(this.turnError)throw Error(this.turnError);
  return {info:{},parts:[{type:'text',text:this.responses.at(-1)||''}]};
 }
 async history(){return this.responses.map((text,i)=>({info:{role:'assistant',presentation:i===this.responses.length-1?'final':'progress'},parts:[{type:'text',text}]}));}
 async permission(id,reply){const p=this.decisions.get(id);if(p?.method!=='gfot.approval')throw new InputError('审批请求已失效');this.write({id,result:{outcome:reply==='once'?'allowed-once':'rejected'}});this.decisions.delete(id);}
 async question(id,answers){
  const p=this.decisions.get(id);if(p?.method!=='gfot.question')throw new InputError('问题已失效');
  const questions=p.params.questions;if(answers.length!==questions.length)throw new InputError('请回答全部问题');
  const result={answers:questions.map((q,i)=>{const labels=new Set((q.options||[]).map(o=>o.label)),selected=answers[i].filter(s=>labels.has(s)),custom=answers[i].filter(s=>!labels.has(s)).join('\n');return {id:q.id,selected,...(custom?{custom}:{})};})};
  this.write({id,result});this.decisions.delete(id);
 }
 stop(){return this.stopping||=(async()=>{
  this.stopped=true;this.fail(Error('dsh 已停止'));this.decisions.clear();const pid=this.child?.pid;if(!pid)return {confirmed:true};
  const alive=()=>{try{process.kill(-pid,0);return true;}catch{return false;}};
  // No prompt-cancel in the pinned SDK protocol: close the entire owned group,
  // including dsh descendants, before another executor can touch this folder.
  this.child.stdin.end();try{process.kill(-pid,'SIGTERM');}catch{}
  let deadline=Date.now()+1800;while(alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
  if(alive()){try{process.kill(-pid,'SIGKILL');}catch{}deadline=Date.now()+2500;while(alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));}
  return {confirmed:!alive()};
 })();}
}
