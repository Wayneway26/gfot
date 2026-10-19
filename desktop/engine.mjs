import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
export async function* readEvents(body){
 const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
 try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>2000000)throw Error('事件超过大小限制');let boundary;while((boundary=buffer.search(/\r?\n\r?\n/))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+(buffer[boundary]==='\r'?4:2));const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]'){try{yield JSON.parse(data);}catch{}}}}}finally{reader.releaseLock();}
}
export function engineEnvironment({dataDir,task,profile,key,password}){
 const dir=join(dataDir,'engine',task.id);mkdirSync(dir,{recursive:true,mode:0o700});
 const config={provider:{gfot:{npm:'@ai-sdk/openai-compatible',name:profile.label,options:{baseURL:profile.baseURL,apiKey:key||'local-proxy'},models:{[profile.model]:{name:profile.model,limit:{context:64000,output:8192}}}}},enabled_providers:['gfot'],model:'gfot/'+profile.model,autoupdate:false,share:'disabled',permission:{'*':'ask',read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'ask',bash:'ask',external_directory:'ask'}};
 return {HOME:process.env.HOME,PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',SHELL:'/bin/zsh',LANG:process.env.LANG||'en_US.UTF-8',TMPDIR:process.env.TMPDIR||'/tmp',XDG_CONFIG_HOME:join(dir,'config'),XDG_DATA_HOME:join(dir,'data'),XDG_CACHE_HOME:join(dir,'cache'),XDG_STATE_HOME:join(dir,'state'),OPENCODE_SERVER_PASSWORD:password,OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_PROJECT_CONFIG:'true',OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_EXTERNAL_SKILLS:'true',OPENCODE_DISABLE_CLAUDE_CODE:'true',OPENCODE_DISABLE_LSP_DOWNLOAD:'true'};
}
export class OpenCodeEngine{
 constructor({binary,dataDir,task,profile,key,onEvent}){Object.assign(this,{binary,dataDir,task,profile,key,onEvent});this.password=randomBytes(24).toString('hex');this.abort=new AbortController();}
 async start(){
  const env=engineEnvironment({dataDir:this.dataDir,task:this.task,profile:this.profile,key:this.key,password:this.password});
  this.child=spawn('/bin/sh',['-c',readFileSync(new URL('./supervise.sh',import.meta.url),'utf8'),'gfot-supervisor',this.binary,String(process.pid)],{cwd:this.task.folder,env,detached:true,stdio:['ignore','pipe','pipe']});
  this.url=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('OpenCode 启动超时')),45000);const read=b=>{text=(text+b.toString()).slice(-20000);const match=text.match(/https?:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}};this.child.stdout.on('data',read);this.child.stderr.on('data',read);this.child.once('error',()=>{clearTimeout(timer);reject(Error('无法启动内置 OpenCode'));});this.child.once('exit',()=>{clearTimeout(timer);reject(Error('OpenCode 进程已退出'));});});
  const events=await this.request('/event',undefined,{stream:true});
  this.eventLoop=(async()=>{try{for await(const event of readEvents(events.body))this.onEvent(event);}catch(e){if(!this.abort.signal.aborted)this.onEvent({type:'gfot.event-error',properties:{message:'执行事件连接中断'}});}})();
  if(this.task.sessionId){try{await this.request('/session/'+this.task.sessionId);}catch{throw Error('原任务会话不可用；为避免丢失上下文，请新建任务并附交接说明。');}}
  else{const session=await this.request('/session',{title:this.task.title});this.task.sessionId=session.id;}
 }
 async request(path,body,{stream=false}={}){
  const response=await fetch(this.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Basic '+Buffer.from('opencode:'+this.password).toString('base64'),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:this.abort.signal,redirect:'error'});
  if(!response.ok)throw Error('执行器请求失败（'+response.status+'）');if(stream)return response;if(response.status===204)return null;return response.json();
 }
 async send(text){return this.request('/session/'+this.task.sessionId+'/message',{model:{providerID:'gfot',modelID:this.profile.model},parts:[{type:'text',text}]});}
 async history(){return this.request('/session/'+this.task.sessionId+'/message');}
 async permission(id,reply){return this.request('/permission/'+encodeURIComponent(id)+'/reply',{reply});}
 async question(id,answers){return this.request('/question/'+encodeURIComponent(id)+'/reply',{answers});}
 stop(){return this.stopping||=(async()=>{
  if(this.url&&!this.abort.signal.aborted){try{await Promise.race([this.request('/session/'+this.task.sessionId+'/abort',{}),new Promise(r=>setTimeout(r,1000))]);}catch{}}
  this.abort.abort();const pid=this.child?.pid;if(!pid)return;
  const alive=()=>{try{process.kill(-pid,0);return true;}catch{return false;}};
  try{process.kill(-pid,'SIGTERM');}catch{}
  const deadline=Date.now()+1600;while(alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));
  if(alive()){try{process.kill(-pid,'SIGKILL');}catch{}await new Promise(r=>setTimeout(r,80));}
 })();}
}
