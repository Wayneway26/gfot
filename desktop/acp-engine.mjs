import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {InputError} from './state.mjs';

export function agentEnvironment(extra={}){
 const env={};
 for(const key of ['HOME','PATH','SHELL','LANG','TMPDIR','USER','LOGNAME','XDG_CONFIG_HOME','XDG_DATA_HOME'])if(process.env[key])env[key]=process.env[key];
 env.PATH=env.PATH||'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
 return {...env,...extra};
}
export class AcpEngine{
 constructor({launch,task,onEvent=()=>{},readOnly=false}){Object.assign(this,{launch,task,onEvent,readOnly});this.requests=new Map();this.permissions=new Map();this.sequence=0;this.buffer='';this.output='';this.stopped=false;this.replaying=false;}
 write(message){if(this.stopped||!this.child?.stdin.writable)throw Error('Agent 连接已关闭');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
 request(method,params,timeout=45000){return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.requests.delete(id);reject(Error('Agent 请求超时：'+method));},timeout);this.requests.set(id,{resolve,reject,timer,method});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.requests.delete(id);reject(e);}});}
 fail(error){for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(error);}this.requests.clear();}
 receive(message){
  if(message.jsonrpc!=='2.0')return;
  if(!message.method){const r=this.requests.get(message.id);if(!r)return;if(r.method==='session/prompt')this.nativeTurnFinished=true;clearTimeout(r.timer);this.requests.delete(message.id);message.error?r.reject(Error('Agent: '+String(message.error.message||'协议错误').slice(0,1000))):r.resolve(message.result);return;}
  if(message.method==='session/update'){
   if(this.replaying||message.params?.sessionId!==this.task.sessionId)return;
   const u=message.params.update||{};
   if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text'){
    const text=String(u.content.text||'');if(this.output.length+text.length>200000){this.fail(Error('Agent 输出超过限制'));void this.stop();return;}
    this.output+=text;this.onEvent({type:'message.part.delta',properties:{sessionID:this.task.sessionId,field:'text',delta:text}});
   }else if(['tool_call','tool_call_update'].includes(u.sessionUpdate))this.onEvent({type:'message.part.updated',properties:{sessionID:this.task.sessionId,part:{type:'tool',id:u.toolCallId,tool:u.title||u.kind||'工具',state:{status:u.status||'pending',...(u.rawInput!==undefined?{input:u.rawInput}:{}),...(u.rawOutput!==undefined?{output:u.rawOutput}:u.content?{output:u.content}:{})}}}});
   return;
  }
  if(message.id===undefined)return;
  if(message.method==='session/request_permission'&&message.params?.sessionId===this.task.sessionId){
   const p=message.params,id=String(message.id);if(this.readOnly||this.cancelling){this.write({id:message.id,result:{outcome:{outcome:'cancelled'}}});return;}
   this.permissions.set(id,{rpcId:message.id,options:p.options||[]});
   this.onEvent({type:'permission.asked',properties:{id,sessionID:this.task.sessionId,permission:p.toolCall?.title||p.toolCall?.kind||'Agent 工具',patterns:p.toolCall?.locations?.map(l=>l.path)||[],metadata:p.toolCall?.rawInput||{}}});return;
  }
  this.write({id:message.id,error:{code:-32601,message:'Client capability not supported'}});
 }
 async start(){
  if(this.stopped)throw Error('Agent 已停止');
  this.child=spawn('/bin/sh',['-c',readFileSync(new URL('./agent-supervise.sh',import.meta.url),'utf8'),'gfot-agent-supervisor',String(process.pid),this.launch.command,...this.launch.args],{cwd:this.task.folder,env:agentEnvironment(this.launch.env),detached:true,stdio:['pipe','pipe','pipe']});
  this.exit=new Promise(resolve=>this.child.once('close',resolve));
  this.child.on('error',()=>this.fail(Error('无法启动本地 Agent，请检查安装和执行权限')));
  this.child.once('exit',code=>{this.fail(Error('本地 Agent 已退出（'+code+'）。请在原应用完成登录，并重新检查连接。'));});
  this.child.stdin.on('error',()=>this.fail(Error('Agent 输入连接关闭')));
  this.child.stderr.on('data',()=>{}); // Do not persist native Agent logs or credentials.
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>2000000){this.fail(Error('Agent 协议消息过大'));void this.stop();return;}
   let pos;while((pos=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,pos);this.buffer=this.buffer.slice(pos+1);let m;try{m=JSON.parse(line);}catch{continue;}try{this.receive(m);}catch{this.fail(Error('Agent 协议消息无效'));void this.stop();return;}}
  });
  const init=await this.request('initialize',{protocolVersion:1,clientInfo:{name:'gfot',version:'0.6.0'},clientCapabilities:{}});
  if(init?.protocolVersion!==1)throw Error('Agent ACP 版本不兼容');this.info=init;
  if(this.task.sessionId&&init.agentCapabilities?.loadSession){
   this.replaying=true;try{await this.request('session/load',{sessionId:this.task.sessionId,cwd:this.task.folder,mcpServers:[]});this.resumed=true;}finally{this.replaying=false;}
  }else{
   const session=await this.request('session/new',{cwd:this.task.folder,mcpServers:[]});
   if(typeof session?.sessionId!=='string'||!session.sessionId)throw Error('Agent 未返回会话 ID');this.task.sessionId=session.sessionId;this.resumed=false;
  }
 }
 async send(text){this.output='';this.nativeTurnFinished=false;this.turnPromise=this.request('session/prompt',{sessionId:this.task.sessionId,prompt:[{type:'text',text}]},15*60*1000);const result=await this.turnPromise;if(this.cancelling)throw Error('Agent 已停止');if(result.stopReason!=='end_turn'){const nativeError=result._meta?.['codebuddy.ai/errorMessage']||'';if(nativeError.includes('Authentication required'))throw new InputError('此 Agent 的 CLI 尚未登录。请通过其 CLI 完成登录；桌面应用登录不一定与 CLI 共享。');throw Error('Agent 本轮未完成：'+result.stopReason+(nativeError?' · '+String(nativeError).slice(0,800):''));}return {info:{},parts:[{type:'text',text:this.output}]};}
 async history(){return [{info:{id:randomUUID(),role:'assistant',time:{created:Date.now()}},parts:[{type:'text',text:this.output}]}];}
 async permission(id,reply){const p=this.permissions.get(id);if(!p)throw new InputError('审批请求已失效');const choice=p.options.find(o=>o.kind===(reply==='once'?'allow_once':'reject_once'));if(!choice&&reply==='once')throw new InputError('Agent 未提供单次批准选项');this.write({id:p.rpcId,result:{outcome:choice?{outcome:'selected',optionId:choice.optionId}:{outcome:'cancelled'}}});this.permissions.delete(id);}
 async question(){throw new InputError('此 Agent 未提供结构化问题接口');}
 stop(){return this.stopping||=(async()=>{
  this.cancelling=true;
  if(!this.stopped){try{for(const p of this.permissions.values())this.write({id:p.rpcId,result:{outcome:{outcome:'cancelled'}}});if(this.task.sessionId)this.write({method:'session/cancel',params:{sessionId:this.task.sessionId}});}catch{}}
  if(this.turnPromise)await Promise.race([this.turnPromise.catch(()=>{}),new Promise(r=>setTimeout(r,2500))]);
  this.cancellationConfirmed=!this.turnPromise||this.nativeTurnFinished===true;this.permissions.clear();this.stopped=true;this.fail(Error('Agent 已停止'));const pid=this.child?.pid;if(!pid)return {confirmed:this.cancellationConfirmed};
  try{process.kill(-pid,'SIGTERM');}catch{}
  await Promise.race([this.exit,new Promise(r=>setTimeout(r,700))]);
  try{process.kill(-pid,'SIGKILL');}catch{}
  return {confirmed:this.cancellationConfirmed};
 })();}
}
