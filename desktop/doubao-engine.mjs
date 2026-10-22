import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {InputError} from './state.mjs';
const terminal=new Set(['completed','failed','cancelled']);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Only the fixed local desktop transport is exposed, never cookie/headless APIs.
export async function loadDoubaoSDK(root=fileURLToPath(new URL('./vendor/doubao-cli/',import.meta.url))){
 const load=name=>import(pathToFileURL(join(root,'src',name+'.mjs')).href);
 const [app,cdp,automation]=await Promise.all([load('app'),load('cdp'),load('automation')]);
 const selected=app.resolveApp('doubao',{}); // Ignore arbitrary endpoint/environment overrides.
 const run=fn=>app.withApp(selected,fn);
 return {
  check:()=>run(async()=>{const status=await cdp.cdpStatus();if(!status.available)throw Error('请先以本机调试模式启动豆包（127.0.0.1:9225），详见本机 Agent 接入说明。');return true;}),
  identity:()=>run(()=>cdp.withChatClient(async client=>{
   const uid=await client.evaluate('localStorage.getItem("flow_tea_user_id")');
   if(!uid||uid==='0')throw Error('请先在豆包登录');
   return createHash('sha256').update(JSON.stringify([selected.dataDir,app.activeProfile(selected),uid])).digest('hex');
  })),
  create:(text,options)=>run(()=>automation.createConversation(text,options)),
  send:(id,text,options)=>run(()=>automation.sendMessage(id,text,options)),
  status:(id,options)=>run(()=>automation.taskStatus(id,options)),
  stop:(id,options)=>run(()=>automation.stopConversation(id,options)),
 };
}
export class DoubaoEngine{
 constructor({task,onEvent=()=>{},onSession=()=>{},sdk,root,pollMs=700,timeoutMs=14*60*1000,callTimeoutMs=8000,acceptanceTimeoutMs=5000}){Object.assign(this,{task,onEvent,onSession,sdk,root,pollMs,timeoutMs,callTimeoutMs,acceptanceTimeoutMs});this.output='';this.cancelled=false;}
 async invoke(method,args=[],timeout=this.callTimeoutMs){
  let timer;try{return await Promise.race([Promise.resolve().then(()=>this.sdk[method](...args)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('豆包接口响应超时：'+method)),timeout);})]);}finally{clearTimeout(timer);}
 }
 save(){this.task.sessionId=JSON.stringify(this.session);this.onSession(this.task.sessionId);}
 async identity(){if(await this.invoke('identity')!==this.session.identity)throw Error('豆包账号或本机配置已变化，请切回原账号再继续此任务');}
 async start(){
  this.sdk||=await loadDoubaoSDK(this.root);await this.invoke('check');const identity=await this.invoke('identity');
  if(this.task.sessionId){try{this.session=JSON.parse(this.task.sessionId);}catch{throw Error('豆包会话记录无效');}
   if(this.session.version!==1||this.session.identity!==identity)throw Error('豆包账号或会话记录不匹配');
   if(this.session.pending){
    if(!this.session.conversationId||!this.session.runId)throw Error('上次豆包请求的接收状态未知。请先在豆包核对任务，勿自动重放；可新建任务继续。');
    const state=await this.invoke('status',[this.session.conversationId,{runId:this.session.runId}]);
    if(!terminal.has(state.status))throw Error('上次豆包任务仍未结束，请先停止该轮任务再继续。');
    this.session.pending=false;this.save();
   }
  }else this.session={version:1,identity,pending:false};
  this.resumed=!!this.session.conversationId;
 }
 emit(text){if(typeof text!=='string'||text.length>200000)throw Error('豆包输出超过限制或格式无效');if(text===this.output)return;this.output=text;this.onEvent({type:'message.part.updated',properties:{sessionID:this.task.sessionId,part:{type:'text',text}}});}
 async send(text){
  if(this.cancelled)throw Error('豆包执行已停止');
  // This approval grants one native turn, not a per-tool interception guarantee.
  const id=randomUUID();const approved=new Promise(resolve=>{this.approval={id,resolve};});
  this.onEvent({type:'permission.asked',properties:{id,sessionID:this.task.sessionId,permission:'授权豆包执行本轮任务（含原生文件与命令工具）',patterns:[this.task.folder],metadata:{scope:'one native turn',note:'豆包执行自己的工具策略；gfot 不能逐项拦截。遇到未适配的原生确认会停止。'}}});
  if(!await approved||this.cancelled)throw Error('本轮豆包执行未获授权');
  await this.identity();if(this.cancelled)throw Error('豆包执行已停止');this.session.pending=true;this.session.runId=null;this.save();
  let acceptedResolve;this.accepted=new Promise(resolve=>{acceptedResolve=resolve;});
  const receipt=r=>{if(r?.conversationId&&r?.runId){this.session.conversationId=r.conversationId;this.session.runId=r.runId;this.save();acceptedResolve();if(this.cancelled)void this.stop().catch(error=>this.onEvent({type:'session.error',properties:{error:{message:error.message}}}));}};
  const options={waitForReply:false,timeoutMs:45000,runtime:'local',workspace:this.task.folder,permission:'AlwaysAsk',skillPaths:[],onReceipt:receipt};
  const operation=this.session.conversationId?this.invoke('send',[this.session.conversationId,text,options],60000):this.invoke('create',[text,options],60000);
  try{
   const result=await operation;receipt(result);
   if(!this.session.runId)throw Error('豆包未返回本轮接收凭据；不会自动重试');
   const deadline=Date.now()+this.timeoutMs;
   while(!this.cancelled){
    await this.identity();const state=await this.invoke('status',[this.session.conversationId,{runId:this.session.runId}]);
    if(state.reply?.text)this.emit(state.reply.text);
    if(terminal.has(state.status)){this.session.pending=false;this.save();if(state.status!=='completed')throw Error('豆包本轮未完成：'+state.status);return {info:{},parts:[{type:'text',text:this.output}]};}
    if(state.status==='waiting_input')throw Error('豆包请求原生确认或补充输入，当前版本尚未适配该控件；已请求停止此轮，请在 gfot 补充要求后重新发送。');
    if(Date.now()>=deadline)throw Error('豆包本轮执行超时');
    await delay(this.pollMs);
   }
   throw Error('豆包执行已停止');
  }catch(error){receipt(error.receipt||error.result);throw error;}
  finally{acceptedResolve();}
 }
 async permission(id,reply){if(this.approval?.id!==id)throw new InputError('审批已失效');this.approval.resolve(reply==='once');this.approval=null;}
 async question(){throw new InputError('尚未适配豆包结构化问题');}
 async history(){return [{info:{id:randomUUID(),role:'assistant',time:{created:Date.now()}},parts:[{type:'text',text:this.output}]}];}
 stop(){return this.stopping||=(async()=>{
  this.cancelled=true;this.approval?.resolve(false);this.approval=null;
  if(this.session?.pending&&!this.session.runId&&this.accepted)await Promise.race([this.accepted,delay(this.acceptanceTimeoutMs)]);
  if(!this.session?.pending)return;
  if(!this.session.conversationId||!this.session.runId)throw Error('豆包请求接收状态未知，无法确认停止。请在原应用核对；gfot 不会重放请求。');
  await this.identity();const result=await this.invoke('stop',[this.session.conversationId,{runId:this.session.runId,timeoutMs:12000}],15000);
  if(result.stopped!==true)throw Error('尚未确认豆包停止，请在原应用核对。');
  this.session.pending=false;this.save();
 })().catch(error=>{this.stopping=null;throw error;});}
}
