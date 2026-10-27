import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,realpathSync,cpSync} from 'node:fs';
import {join,relative,extname,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {InputError} from './state.mjs';
const runner=fileURLToPath(new URL('./h2-runner.py',import.meta.url));
export const harnessFiles=['systemprompt.md','guardrails.md','LongTermMEMORY.md','tool_descriptions/tool_guidance.md'];
export const defaultHarness={
 'systemprompt.md':'Complete the user task. Inspect the project before making a focused change.\n',
 'guardrails.md':'Respect gfot tool approvals. Never change permissions, fetch credentials, or access the original project from a probe copy.\n',
 'LongTermMEMORY.md':'No task-specific lessons adopted yet.\n',
 'tool_descriptions/tool_guidance.md':'Read relevant source, make the smallest useful change, and verify behavior. Report checks actually performed.\n',
};
export function validHarness(tree){
 if(!tree||typeof tree!=='object'||Array.isArray(tree)||Object.keys(tree).length!==4||harnessFiles.some(p=>typeof tree[p]!=='string')||Object.values(tree).join('').length>24000)throw new InputError('Harness 仅允许四个 Markdown 配置，总长度不超过 24000 字符');
 return tree;
}
export function harnessPrompt(tree){return harnessFiles.map(p=>`## ${p}\n${validHarness(tree)[p]}`).join('\n\n');}
const pythonChoices=()=>[process.env.GFOT_PYTHON,'python3','/opt/homebrew/bin/python3.13','/opt/homebrew/bin/python3.12','/opt/miniconda3/bin/python3','/usr/local/bin/python3'].filter(Boolean);
const pythonCache=new Map();
export function harnessStatus(runnerPath=runner){
 const cachedPython=pythonCache.get(runnerPath);
 if(cachedPython?.unavailable)return {available:false,reason:'Harness² 需要 Python 3.12 或 3.13。安装后重新打开应用，或设置 GFOT_PYTHON。'};
 if(cachedPython)return {available:true,python:cachedPython.version,method:'Harness² sequential k=1',maxSessions:10};
 for(const command of [...new Set(pythonChoices())])try{
  const output=execFileSync(command,['-I','-B',runnerPath,'--check'],{cwd:dirname(runnerPath),timeout:3000,maxBuffer:10000,stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(String(output));if(result.available){pythonCache.set(runnerPath,{command,version:result.python});return harnessStatus(runnerPath);}
 }catch{}
 pythonCache.set(runnerPath,{unavailable:true});
 return {available:false,reason:'Harness² 需要 Python 3.12 或 3.13。安装后重新打开应用，或设置 GFOT_PYTHON。'};
}
const excluded=new Set(['node_modules','dist','build','data','vendor','venv','__pycache__','target','coverage']);
const extensions=new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.json','.md','.html','.css','.scss','.toml','.yml','.yaml','.txt','.sh','.go','.rs','.java','.sql']);
export function projectSnapshot(folder,{allowEmpty=false}={}){
 const root=realpathSync(folder),files=[];let bytes=0;
 const walk=(dir)=>{for(const item of readdirSync(dir,{withFileTypes:true})){
  const name=item.name;if(name.startsWith('.')||excluded.has(name)||name==='desktop.json'||/auth|credential|secret|token|password|\.pem$|\.key$|lock\.json$|lock\.yaml$/i.test(name))continue;
  const path=join(dir,name),stat=lstatSync(path);if(stat.isSymbolicLink())continue;
  if(stat.isDirectory()){walk(path);continue;}if(!stat.isFile()||!extensions.has(extname(name))||stat.size>256000)continue;
  const content=readFileSync(path);if(content.includes(0))continue;bytes+=content.length;
  if(files.length>=200||bytes>2000000)throw new InputError('项目文本快照超过 200 文件或 2 MB，请选择较小的子项目');
  files.push({path:relative(root,path),content:content.toString('utf8')});
 }};walk(root);if(!files.length&&!allowEmpty)throw new InputError('目录没有可用于 Harness² 探测的文本源文件');return files;
}
function writeSnapshot(files,dir){mkdirSync(dir,{recursive:true,mode:0o700});for(const file of files){const path=join(dir,file.path);mkdirSync(join(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,file.content,{mode:0o600});}}
function parseProposal(text){
 const block=text.match(/```(?:json)?\s*([\s\S]*?)```/);let value;try{value=JSON.parse(block?block[1]:text);}catch{throw new InputError('配置提案没有返回有效 JSON');}
 return {harness:validHarness(value.harness),notes:typeof value.notes==='string'?value.notes.slice(0,8000):''};
}
export class Harness2Engine{
 constructor(options){Object.assign(this,{redact:v=>v,...options});this.cancelled=false;this.sessions=0;this.result=null;this.id=randomUUID();this.root=join(this.dataDir,'harness2',this.task.id,this.id);this.done=new Promise((resolve,reject)=>{this.finish=resolve;this.fail=reject;});this.done.catch(()=>{});}
 get password(){return this.current?.password;}
 async start(){
  const runnerPath=this.harnessRunner||runner,status=harnessStatus(runnerPath);if(!status.available)throw new InputError(status.reason);
  const rel=relative(realpathSync(this.task.folder),realpathSync(this.dataDir));if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw new InputError('项目目录不能包含 gfot 数据目录，请选择独立项目文件夹');
  this.snapshot=projectSnapshot(this.task.folder);mkdirSync(this.root,{recursive:true,mode:0o700});this.root=realpathSync(this.root);
  this.child=spawn(pythonCache.get(runnerPath).command,['-I','-B',runnerPath],{cwd:this.root,detached:true,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:this.root,LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}});
  const lines=createInterface({input:this.child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{if(line.length>2000000){void this.stop();return;}let message;try{message=JSON.parse(line);}catch{return;}
   if(message.type==='request'){if(this.handling){this.fail(Error('Harness² protocol overlap'));void this.stop();return;}this.handling=true;void this.handle(message).then(reply=>{if(!this.cancelled)this.child.stdin.write(JSON.stringify({ok:true,...reply})+'\n');}).catch(error=>{if(!this.cancelled)this.child.stdin.write(JSON.stringify({ok:false,error:'Executor session failed'})+'\n');this.sessionError=error.message;}).finally(()=>{this.handling=false;});}
   else if(message.type==='result')this.result=message;
   else if(message.type==='failure')this.failure=message.error;
  });
  this.child.stderr.on('data',()=>{});this.child.stdin.on('error',()=>{});
  this.child.once('error',()=>this.fail(Error('无法启动 Harness² Python 进程')));
  this.child.once('exit',code=>{lines.close();if(this.cancelled)this.fail(Error('Harness² 已停止'));else if(code!==0||!this.result)this.fail(Error(this.sessionError||this.failure||'Harness² 未完整结束'));else this.finish(this.result);});
  const initial=validHarness(this.task.adoptedHarness?.tree||defaultHarness);
  this.child.stdin.write(JSON.stringify({root:this.root,parentPid:process.pid,prompt:this.prompt,harness:initial})+'\n');
 }
 async handle(message){
  if(this.cancelled)throw Error('Stopped');if(++this.sessions>10)throw Error('Harness² 达到 10 次会话上限');
  if(!['execute','propose'].includes(message.action)||typeof message.label!=='string'||!/^[a-z0-9.]+$/i.test(message.label))throw Error('Invalid stage');
  const proposer=message.action==='propose';let folder,prompt,systemPrompt;
  if(proposer){
   const context=realpathSync(message.contextDir),rel=relative(this.root,context);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid context directory');
   folder=join(this.root,'editors',message.label);mkdirSync(folder,{recursive:true,mode:0o700});cpSync(context,join(folder,'context'),{recursive:true});
   prompt=message.mission+'\n\nGFOT OUTPUT CONTRACT: Do not edit files or run commands. Read the context files. Reply only with JSON {"harness": {"systemprompt.md":"...", "guardrails.md":"...", "LongTermMEMORY.md":"...", "tool_descriptions/tool_guidance.md":"..."}, "notes":"evidence-based rationale"}. Return all four text files, no scripts, plugins, permissions or subagents. Keep combined text under 24000 characters.';
  }else{
   folder=join(this.root,'probes',message.label);writeSnapshot(this.snapshot,folder);
   systemPrompt=harnessPrompt(message.harness);
   prompt='This is an isolated Harness² probe copy. Do not access the original project or any external directory.\n\nUser task:\n'+this.prompt;
  }
  this.onPhase({label:message.label,action:message.action,sessions:this.sessions,files:this.snapshot.length});
  const subtask={id:this.task.id+'-h2-'+this.id+'-'+this.sessions,title:'Harness² '+message.label,folder,sessionId:null};
  const engine=this.current=this.engineFactory({binary:this.binary,dataDir:this.dataDir,task:subtask,profile:this.profile,key:this.key,readOnly:proposer,isolateWorkspace:true,systemPrompt,maxSteps:16,onEvent:event=>{if(this.current===engine&&!this.cancelled)this.onEvent(event);}});
  const timeout=setTimeout(()=>{this.sessionError='Harness² 单次会话超过 3 分钟';void engine.stop();},180000);
  try{
   await engine.start();if(this.cancelled)throw Error('Stopped');
   const answer=await engine.send(prompt);if(answer?.info?.error)throw Error('Harness² 执行器返回错误');
   const history=await engine.history();const text=history.filter(m=>m.info?.role==='assistant').flatMap(m=>m.parts||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('\n');
   if(this.cancelled||!text.trim())throw Error('Harness² 会话没有完整回答');
   if(proposer)return this.redact(parseProposal(text));
   const before=new Map(this.snapshot.map(f=>[f.path,f.content])),after=new Map(projectSnapshot(folder,{allowEmpty:true}).map(f=>[f.path,f.content])),changes=[];
   for(const path of new Set([...before.keys(),...after.keys()]))if(before.get(path)!==after.get(path))changes.push({path,change:!after.has(path)?'deleted':!before.has(path)?'added':'modified'});
   const evidence=this.redact({answer:text,trajectory:JSON.stringify({changes,messages:history},null,2)});
   if(Buffer.byteLength(JSON.stringify(evidence),'utf8')>1500000)throw new InputError('候选执行证据超过 1.5 MB，停止此候选，避免静默丢失执行事件');
   return evidence;
  }finally{clearTimeout(timeout);await engine.stop();if(this.current===engine)this.current=null;}
 }
 send(){return this.done;}
 permission(id,reply){if(!this.current)throw new InputError('探测回合已结束');return this.current.permission(id,reply);}
 question(id,answers){if(!this.current)throw new InputError('探测回合已结束');return this.current.question(id,answers);}
 stop(){return this.stopping||=(async()=>{this.cancelled=true;await this.current?.stop();const pid=this.child?.pid;if(pid){try{process.kill(-pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,100));try{process.kill(-pid,'SIGKILL');}catch{}}this.fail(Error('Harness² 已停止'));})();}
}
