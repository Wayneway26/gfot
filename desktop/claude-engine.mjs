import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {InputError} from './state.mjs';
import {inspectClaudeRuntime} from './claude-runtime.mjs';
import {claudeTools,claudeToolDecision} from './claude-policy.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const defaultClaudeRoot=join(here,'runtime/claude');
const clip=value=>typeof value==='string'?value.slice(0,12000):JSON.stringify(value??'').slice(0,12000);

export class ClaudeEngine{
 constructor(options){Object.assign(this,{onEvent:()=>{},...options,claudeRoot:options.claudeRoot||defaultClaudeRoot});this.decisions=new Map();this.approved=new Map();this.toolInputs=new Map();this.finishedTools=new Set();this.responses=[];this.stopped=false;this.abort=new AbortController();}
 event(type,properties={}){if(!this.stopped)this.onEvent({type,properties:{sessionID:this.task.sessionId,...properties}});}
 async start(){
  if(this.profile?.protocol!=='anthropic'||this.profile.mode==='account')throw new InputError('Claude 执行器目前只支持 Anthropic 原生连接；GPT 等跨协议连接尚未接入');
  if(this.stopped)throw Error('Claude 执行器已停止');
  await inspectClaudeRuntime(this.binary,{signal:this.abort.signal,onProcess:child=>{this.probe=child;this.probeExit=new Promise(resolve=>child.once('close',resolve));}});
  if(this.stopped)throw Error('Claude 执行器已停止');
  const sdkFile=join(this.claudeRoot,'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');if(!existsSync(sdkFile))throw new InputError('Claude SDK 适配层缺失，请重新安装 gfot');
  this.home=join(this.dataDir,'claude',this.task.id);mkdirSync(this.home,{recursive:true,mode:0o700});mkdirSync(join(this.home,'settings-root'),{recursive:true,mode:0o700});
  this.resumed=!!this.task.sessionId;
  if(this.resumed){
   if(!/^[0-9a-f-]{36}$/i.test(this.task.sessionId))throw new InputError('Claude 会话标识无效');
   const projects=join(this.home,'config/projects');let found=false;
   try{for(const entry of readdirSync(projects,{withFileTypes:true})){if(!entry.isDirectory())continue;const file=join(projects,entry.name,this.task.sessionId+'.jsonl');if(existsSync(file)&&lstatSync(file).isFile()){found=true;break;}}}catch{}
   if(!found)throw new InputError('原 Claude 会话不可恢复，请保留任务记录并核对原生会话数据；不会自动创建空会话');
  }else this.task.sessionId=randomUUID();
  const {query}=await import(pathToFileURL(sdkFile).href);if(this.stopped)throw Error('Claude 执行器已停止');
  const env={HOME:this.home,CLAUDE_CONFIG_DIR:join(this.home,'config'),PATH:process.env.PATH||'/usr/bin:/bin',TMPDIR:process.env.TMPDIR||'/tmp',LANG:process.env.LANG||'en_US.UTF-8',ANTHROPIC_API_KEY:this.key,ANTHROPIC_BASE_URL:this.profile.baseURL.replace(/\/v1$/,''),ANTHROPIC_MODEL:this.profile.model,ANTHROPIC_DEFAULT_HAIKU_MODEL:this.profile.model,ANTHROPIC_DEFAULT_SONNET_MODEL:this.profile.model,ANTHROPIC_DEFAULT_OPUS_MODEL:this.profile.model,CLAUDE_CODE_SUBAGENT_MODEL:this.profile.model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1',CLAUDE_AGENT_SDK_CLIENT_APP:'gfot/0.13'};
  this.input=new Promise(resolve=>this.acceptPrompt=resolve);const engine=this;
  async function* prompts(){const text=await engine.input;if(text===null)return;yield {type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:engine.task.sessionId};await new Promise(resolve=>engine.endInput=resolve);}
  this.query=query({prompt:prompts(),options:{pathToClaudeCodeExecutable:this.binary,cwd:this.task.folder,projectConfigRoot:join(this.home,'settings-root'),env,settingSources:[],strictMcpConfig:true,mcpServers:{},plugins:[],tools:claudeTools,skills:[],permissionMode:'default',permissionPrompts:'host',includePartialMessages:true,maxTurns:32,model:this.profile.model,...(this.resumed?{resume:this.task.sessionId}:{sessionId:this.task.sessionId}),systemPrompt:{type:'preset',preset:'claude_code',append:this.systemPrompt||'Work on the selected project. Respect host approvals and verify results.'},abortController:this.abort,
   spawnClaudeCodeProcess:options=>{
    if(this.stopped)throw Error('Claude 执行器已停止');
    const child=spawn('/bin/sh',['-c',readFileSync(join(here,'agent-supervise.sh'),'utf8'),'gfot-claude-supervisor',String(process.pid),options.command,...options.args],{cwd:options.cwd,env:options.env,detached:true,stdio:['pipe','pipe','pipe']});this.child=child;this.exit=new Promise(resolve=>child.once('close',resolve));return child;
   },
   hooks:{PreToolUse:[{timeout:900,hooks:[async(input,_id,{signal})=>this.preTool(input,signal)]}],PostToolUse:[{hooks:[async input=>{this.toolResult(input,false);return {}; }]}],PostToolUseFailure:[{hooks:[async input=>{this.toolResult(input,true);return {}; }]}],SubagentStart:[{hooks:[async input=>{this.event('gfot.subagent',{text:'子 Agent 已启动',agentId:input.agent_id,agentType:input.agent_type});return {}; }]}],SubagentStop:[{hooks:[async input=>{this.event('gfot.subagent',{text:'子 Agent 已结束',agentId:input.agent_id});return {}; }]}]},
   canUseTool:async(tool,input,options)=>{
    const agentId=options.agentID||this.toolInputs.get(options.toolUseID)?.source;
    if(tool==='AskUserQuestion'){
     const questions=input.questions;if(!Array.isArray(questions)||!questions.length||questions.length>8)return {behavior:'deny',message:'Invalid user questions'};
     const answers=await this.ask('question',{questions,canCancel:true,agentId},options.signal);if(!answers){this.toolResult({tool_use_id:options.toolUseID,tool_name:tool,error:'The user cancelled this question'},true);return {behavior:'deny',message:'The user cancelled this question'};}
     return {behavior:'allow',updatedInput:{...input,answers:Object.fromEntries(questions.map((q,i)=>[q.question,answers[i].join(', ')]))}};
    }
    if(this.approved.get(options.toolUseID)===true)return {behavior:'allow',updatedInput:input};
    const permitted=await this.ask('permission',{permission:tool,metadata:{input,reason:options.decisionReason,agentId}},options.signal);
    if(!permitted)this.toolResult({tool_use_id:options.toolUseID,tool_name:tool,error:'The user did not approve this operation'},true);
    return permitted?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'The user did not approve this operation'};
   },stderr:()=>{},
  }});
  await Promise.race([this.query.initializationResult(),new Promise((_,reject)=>{this.initTimer=setTimeout(()=>reject(Error('Claude 执行器启动超时')),30000);})]);clearTimeout(this.initTimer);if(this.stopped)throw Error('Claude 执行器已停止');
 }
 ask(kind,properties,signal){return new Promise(resolve=>{
  if(this.stopped||signal?.aborted)return resolve(null);
  const id='claude-'+randomUUID(),settle=value=>{signal?.removeEventListener('abort',cancel);this.decisions.delete(id);resolve(value);},cancel=()=>{this.event('gfot.request.cancelled',{id});settle(null);};
  this.decisions.set(id,{kind,settle,questions:properties.questions});signal?.addEventListener('abort',cancel,{once:true});this.event(kind==='question'?'question.asked':'permission.asked',{id,...properties});
 });}
 async preTool(input,signal){
  const name=input.tool_name,id=input.tool_use_id,args=input.tool_input||{},source=input.agent_id;
  this.toolInputs.set(id,{name,args,source});this.event('message.part.updated',{part:{id,type:'tool',tool:source?name+' · 子 Agent '+source:name,state:{status:'running',input:args}}});
  const decision=claudeToolDecision(this.task.folder,name,args,input.cwd||this.task.folder);
  let allow=!!decision.allow;if(decision.ask)allow=!!(await this.ask('permission',{permission:name,patterns:[args.file_path||args.path].filter(Boolean),metadata:{input:args,reason:decision.reason,agentId:source}},signal));
  if(decision.question)return {};
  this.approved.set(id,allow);if(!allow)this.toolResult({tool_use_id:id,tool_name:name,error:decision.deny||'The user did not approve this operation'},true);return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:allow?'allow':'deny',permissionDecisionReason:decision.deny||(!allow?'Not approved by the user':'Approved by the gfot host')}};
 }
 toolResult(input,failed){const id=input.tool_use_id;if(this.finishedTools.has(id))return;this.finishedTools.add(id);const tool=this.toolInputs.get(id)||{};this.approved.delete(id);this.event('message.part.updated',{part:{id,type:'tool',tool:tool.source?tool.name+' · 子 Agent '+tool.source:input.tool_name,state:{status:failed?'error':'completed',input:tool.args,output:failed?undefined:clip(input.tool_response),error:failed?clip(input.error):undefined}}});}
 receive(message){
  const child=message.parent_tool_use_id;
  if(message.type==='user'&&Array.isArray(message.message?.content))for(const part of message.message.content){if(part.type==='tool_result'&&this.toolInputs.has(part.tool_use_id))this.toolResult({tool_use_id:part.tool_use_id,tool_response:part.content,error:part.content},!!part.is_error);}
  if(message.type==='stream_event'){
   if(child)return;const e=message.event;
   if(e.type==='message_start'){this.streamMessageId=e.message.id;this.event('gfot.activity',{phase:'thinking'});}
   if(e.type==='content_block_start'&&e.content_block?.type==='text'){this.blockIndex=e.index;this.event('gfot.output.boundary');}
   if(e.type==='content_block_delta'&&e.delta?.type==='text_delta')this.event('message.part.delta',{field:'text',partID:this.streamMessageId+':'+e.index,delta:e.delta.text});
   if(e.type==='content_block_delta'&&e.delta?.type==='thinking_delta')this.event('gfot.activity',{phase:'thinking'});
  }
  if(message.type==='assistant'){
   const text=(message.message.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
   if(child){if(text)this.event('gfot.subagent',{agentId:child,text:'子 Agent 更新',detail:text.slice(0,12000)});return;}
   if(text)this.responses.push(text);if(message.error)this.turnError='Claude 执行失败：'+message.error;
  }
  if(message.type==='system'&&message.subtype==='init'&&message.session_id!==this.task.sessionId)throw Error('Claude 返回了不同的会话，已停止执行');
 }
 async send(text){
  if(this.stopped)throw Error('Claude 执行器已停止');this.acceptPrompt(text);let result;
  for await(const message of this.query){this.receive(message);if(message.type==='result'){result=message;break;}}
  if(this.stopped)throw Error('Claude 执行器已停止');
  if(!result||result.subtype!=='success'||result.is_error||this.turnError)throw Error(this.turnError||'Claude 本轮未完成：'+clip(result?.errors||result?.subtype||'连接中断'));
  if(!this.responses.length&&result.result)this.responses.push(result.result);return {info:{}};
 }
 async history(){return this.responses.map((text,i)=>({info:{role:'assistant',presentation:i===this.responses.length-1?'final':'progress'},parts:[{type:'text',text}]}));}
 async permission(id,reply){const pending=this.decisions.get(id);if(pending?.kind!=='permission')throw new InputError('审批已失效');pending.settle(reply==='once');}
 async question(id,answers){const pending=this.decisions.get(id);if(pending?.kind!=='question')throw new InputError('问题已失效');if(answers!==null&&answers.length!==pending.questions.length)throw new InputError('请回答全部问题');pending.settle(answers);}
 stop(){return this.stopping||=(async()=>{
  this.stopped=true;clearTimeout(this.initTimer);for(const pending of [...this.decisions.values()])pending.settle(null);this.acceptPrompt?.(null);this.endInput?.();
  if(this.query){try{await Promise.race([this.query.interrupt(),new Promise(resolve=>setTimeout(resolve,1000))]);}catch{}try{this.query.close();}catch{}}
  this.abort.abort();if(this.probeExit)await Promise.race([this.probeExit,new Promise(resolve=>setTimeout(resolve,1500))]);
  const probeDone=!this.probe||this.probe.exitCode!==null||this.probe.signalCode!==null;
  const pid=this.child?.pid;if(!pid)return {confirmed:probeDone};
  const alive=()=>{try{process.kill(-pid,0);return true;}catch{return false;}};
  try{process.kill(-pid,'SIGTERM');}catch{}
  let deadline=Date.now()+2000;while(alive()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
  if(alive()){try{process.kill(-pid,'SIGKILL');}catch{}deadline=Date.now()+1500;while(alive()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));}
  return {confirmed:probeDone&&!alive()};
 })();}
}
