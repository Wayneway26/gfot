// Loaded by the pinned dsh runtime. This plugin owns gfot interaction only;
// dsh retains its agent loop, native tools, sessions and subagent execution.
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,basename,join} from 'node:path';

export const name='gfot-host';
export const inject=['tools','approval','userQuestions','systemPrompt','agents','workingDirectory'];
export function apply(ctx,config={}){
 const pending=new Map();
 const notify=(method,params)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 lines.on('line',line=>{if(line.length>2000000)return;let m;try{m=JSON.parse(line);}catch{return;}const request=pending.get(m.id);if(!request||m.method)return;pending.delete(m.id);request.settle(m.error?null:m.result);});
 const request=(method,params,signal)=>new Promise(resolve=>{
  if(signal?.aborted)return resolve(null);
  const id='gfot-'+randomUUID(),abort=()=>{pending.delete(id);notify('gfot.cancelled',{id});settle(null);};
  const settle=value=>{signal?.removeEventListener('abort',abort);resolve(value);};
  pending.set(id,{settle});signal?.addEventListener('abort',abort,{once:true});
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
 });
 ctx.on('dispose',()=>{lines.close();for(const p of pending.values())p.settle(null);pending.clear();});
 if(config.systemPrompt)ctx.systemPrompt.section({name:'gfot-harness',order:100,text:config.systemPrompt,interpolate:false});
 let steps=0;ctx.on('agent/pre-step',async(_payload,next)=>{if(config.maxSteps&&++steps>config.maxSteps){notify('gfot.error',{message:'Harness² 达到执行步数上限'});return {kind:'reject'};}return next();});
 const reads=new Set(['read','read_image','glob','grep','list','ls']);
 const root=realpathSync(process.cwd()),denied=new Set();
 const canonical=path=>{const tail=[];let current=path;for(;;){try{return join(realpathSync(current),...tail.reverse());}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;const parent=dirname(current);if(parent===current)throw error;tail.push(basename(current));current=parent;}}};
 const outside=async exec=>{
  const cwd=exec.agent?await ctx.workingDirectory.ensure(exec.agent,exec.signal):process.cwd();
  const arg=exec.arguments||{},target=arg.file_path??arg.path??cwd;
  if(typeof target!=='string')throw Error('Invalid filesystem tool path');
  const delta=relative(root,canonical(resolve(cwd,target)));return delta==='..'||delta.startsWith('../')||isAbsolute(delta);
 };
 ctx.tools.guard(exec=>denied.has(exec.token)?'Operation is outside the Harness² workspace.':config.readOnly&&!reads.has(exec.name)?'Harness² configuration editors may only inspect files.':undefined);
 ctx.on('tools/result',exec=>{denied.delete(exec.token);});
 ctx.on('tools/pre-execute',async(exec,next)=>{
  if(reads.has(exec.name)){
   let external;try{external=await outside(exec);}catch{return {kind:'deny',reason:'Cannot resolve filesystem tool target'};}
   if(external){
    if(config.readOnly||config.isolateWorkspace){denied.add(exec.token);return {kind:'deny',reason:'Harness² may only inspect its project copy.'};}
    const answer=await request('gfot.approval',{sessionId:exec.agent?.session.id,toolName:exec.name,callId:exec.callId,input:exec.arguments,reason:'Read or search outside the selected project'},exec.signal);
    if(answer?.outcome!=='allowed-once')return {kind:'deny',reason:'External read was not approved'};
   }
  }
  const decision=await next();if(decision.kind==='deny'||decision.kind==='cancel')return decision;
  if(config.readOnly)return reads.has(exec.name)?decision:{kind:'deny',reason:'Read-only Harness² editor'};
  if(decision.kind==='ask'||reads.has(exec.name)||exec.name==='ask_user_question')return decision;
  const answer=await request('gfot.approval',{sessionId:exec.agent?.session.id,toolName:exec.name,callId:exec.callId,input:exec.arguments},exec.signal);
  return answer?.outcome==='allowed-once'?decision:{kind:'deny',reason:'The user did not approve this operation.'};
 });
 ctx.on('approval/request',async req=>{
  if(config.readOnly)return 'rejected';
  const answer=await request('gfot.approval',{sessionId:req.agent.session.id,toolName:req.toolName,callId:req.callId,reason:req.reason},req.signal);
  return answer?.outcome==='allowed-once'?'allowed-once':'rejected';
 });
 ctx.on('user-questions/request',async req=>{
  const answer=await request('gfot.question',{sessionId:req.agent?.session.id,questions:req.questions},req.signal);
  if(!answer)throw Error('Question cancelled');return answer;
 });
 ctx.on('agent/assistant-stream',({agent,frame})=>{
  // Never transmit private reasoning text to the gfot UI or its task store.
  if(frame.type==='start')notify('gfot.stream',{sessionId:agent.session.id,type:'start',attemptId:frame.attemptId});
  if(frame.type==='chunk'){
   const c=frame.chunk;
   if(c.type==='text-delta')notify('gfot.stream',{sessionId:agent.session.id,type:'text',text:c.text});
   if(c.type==='reasoning-delta')notify('gfot.stream',{sessionId:agent.session.id,type:'thinking'});
  }
 });
 notify('gfot.ready',{version:1});
}
