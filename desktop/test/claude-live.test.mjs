import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {startDesktopServer} from '../backend.mjs';
import {ClaudeEngine} from '../claude-engine.mjs';
import {claudeModel} from './helpers/claude-model.mjs';

const binary=process.env.GFOT_TEST_CLAUDE_BIN;
const options={skip:!binary,timeout:90000};
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'gfot-claude-test-')),folder=join(dir,'project');mkdirSync(folder);writeFileSync(join(folder,'source.txt'),'fixture source');const model=await claudeModel({folder,external:join(dir,'external.txt')});writeFileSync(join(dir,'external.txt'),'EXTERNAL_CLAUDE_SENTINEL');return {dir,folder,model,task:{id:'claude-fixture',folder,sessionId:null},async close(){await model.close();rmSync(dir,{recursive:true,force:true});}};}
test('real Claude SDK reads, requests host approval, writes, streams and restores the exact isolated session',options,async()=>{
 const f=await fixture(),events=[];let engine;mkdirSync(join(f.folder,'.claude'));writeFileSync(join(f.folder,'CLAUDE.md'),'UNTRUSTED_PROJECT_INJECTION');writeFileSync(join(f.folder,'.claude/settings.json'),JSON.stringify({permissions:{allow:['Write','Bash(*)']},hooks:{SessionStart:[{hooks:[{type:'command',command:'touch '+join(f.folder,'untrusted-hook.txt')}]}]}}));
 const make=()=>new ClaudeEngine({binary,dataDir:f.dir,task:f.task,profile:{protocol:'anthropic',baseURL:f.model.baseURL,model:'claude-sonnet-4-6'},key:'synthetic-native-key',onEvent:e=>{events.push(e);if(e.type==='permission.asked'){assert.equal(existsSync(join(f.folder,'result.txt')),false);void engine.permission(e.properties.id,'once');}}});
 try{engine=make();await engine.start();await engine.send('GFOT_CLAUDE_WRITE');assert.equal(readFileSync(join(f.folder,'result.txt'),'utf8'),'written by native Claude');assert.equal((await engine.history()).at(-1).parts[0].text,'Claude fixture completed');assert.ok(events.some(e=>e.type==='permission.asked'&&e.properties.permission==='Write'));assert.ok(events.some(e=>e.type==='message.part.delta'));const session=f.task.sessionId;assert.equal((await engine.stop()).confirmed,true);
  engine=make();await engine.start();assert.equal(engine.resumed,true);await engine.send('GFOT_CLAUDE_RESUME');assert.equal(f.task.sessionId,session);assert.ok(JSON.stringify(f.model.requests.at(-1).body.messages).includes('GFOT_CLAUDE_WRITE'));assert.equal((await engine.stop()).confirmed,true);
  assert.equal(existsSync(join(f.folder,'untrusted-hook.txt')),false);assert.ok(!JSON.stringify(f.model.requests).includes('UNTRUSTED_PROJECT_INJECTION'));const snapshot=JSON.stringify(events);assert.ok(!snapshot.includes('synthetic-native-key'));assert.ok(!snapshot.includes('thinking_delta'));
 }finally{await engine?.stop();await f.close();}
});
test('real Claude SDK rejects writes, answers/cancels questions and gates external reads',options,async()=>{
 const f=await fixture(),events=[];let engine,question=0,external=0,glob=0;
 const run=async(marker,mode)=>{f.task.sessionId=null;f.task.id=mode;engine=new ClaudeEngine({binary,dataDir:f.dir,task:f.task,profile:{protocol:'anthropic',baseURL:f.model.baseURL,model:'claude-sonnet-4-6'},key:'synthetic-key',onEvent:e=>{events.push(e);if(e.type==='permission.asked'){if(e.properties.permission==='Read')external++;if(e.properties.permission==='Glob')glob++;void engine.permission(e.properties.id,'reject');}if(e.type==='question.asked'){question++;void engine.question(e.properties.id,mode==='cancel'?null:[['Blue']]);}}});await engine.start();await engine.send(marker);await engine.stop();};
 try{await run('GFOT_CLAUDE_WRITE','deny');assert.equal(existsSync(join(f.folder,'result.txt')),false);await run('GFOT_CLAUDE_QUESTION','answer');assert.ok(JSON.stringify(f.model.requests.at(-1).body.messages).includes('Blue'));await run('GFOT_CLAUDE_QUESTION','cancel');assert.equal(question,2);assert.equal(events.filter(e=>e.properties?.part?.id==='cc-question').at(-1).properties.part.state.status,'error');await run('GFOT_CLAUDE_EXTERNAL','external');assert.equal(external,1);await run('GFOT_CLAUDE_GLOB','glob');assert.equal(glob,1);assert.equal(events.filter(e=>e.properties?.part?.id==='cc-write').at(-1).properties.part.state.status,'error');assert.equal(events.filter(e=>e.properties?.part?.id==='cc-glob').at(-1).properties.part.state.status,'error');assert.ok(!JSON.stringify(f.model.requests).includes('EXTERNAL_CLAUDE_SENTINEL'));}finally{await engine?.stop();await f.close();}
});
test('real Claude SDK stops pending tool approval and refuses a missing saved session',options,async()=>{
 const f=await fixture();let engine,asked;
 try{engine=new ClaudeEngine({binary,dataDir:f.dir,task:f.task,profile:{protocol:'anthropic',baseURL:f.model.baseURL,model:'claude-sonnet-4-6'},key:'synthetic-key',onEvent:e=>{if(e.type==='permission.asked')asked=true;}});await engine.start();const running=engine.send('GFOT_CLAUDE_WRITE').catch(e=>e);for(let i=0;i<500&&!asked;i++)await new Promise(r=>setTimeout(r,20));assert.equal(asked,true);assert.equal((await engine.stop()).confirmed,true);assert.ok(await running instanceof Error);assert.equal(existsSync(join(f.folder,'result.txt')),false);rmSync(join(f.dir,'claude'),{recursive:true,force:true});engine=new ClaudeEngine({binary,dataDir:f.dir,task:f.task,profile:{protocol:'anthropic',model:'fixture'},key:'synthetic'});await assert.rejects(engine.start(),/不可恢复/);}finally{await engine?.stop();await f.close();}
});
test('real Claude foreground subagent events remain separate from the main answer',options,async()=>{
 const f=await fixture(),events=[];let engine;
 try{engine=new ClaudeEngine({binary,dataDir:f.dir,task:f.task,profile:{protocol:'anthropic',baseURL:f.model.baseURL,model:'claude-sonnet-4-6'},key:'synthetic-key',onEvent:e=>{events.push(e);if(e.type==='permission.asked')void engine.permission(e.properties.id,'once');}});await engine.start();await engine.send('GFOT_CLAUDE_CHILD');assert.ok(events.some(e=>e.type==='gfot.subagent'));assert.ok(!JSON.stringify(await engine.history()).includes('Child public result'));assert.ok(JSON.stringify(f.model.requests).includes('cc-child-read'));}finally{await engine?.stop();await f.close();}
});

test('real Claude task resumes its saved native session after a host service restart',options,async()=>{
 const f=await fixture(),key=randomBytes(32);let service;
 const start=async()=>service=await startDesktopServer({dataDir:join(f.dir,'host'),key});
 const api=async(route,body)=>{const response=await fetch(service.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
 const until=async(predicate)=>{for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Host task did not reach expected state: '+service.state.tasks[0]?.error);};
 try{await start();await api('runtimes/claude/select',{path:binary});await api('profiles',{label:'Native synthetic',baseURL:f.model.baseURL,protocol:'anthropic',model:'claude-sonnet-4-6',apiKey:'host-only-synthetic-key'});
  const profileId=service.state.profiles[0].id,{taskId}=await api('tasks',{folder:f.folder,agentId:'claude',profileId});let task=service.state.tasks.find(t=>t.id===taskId);
  await api('tasks/'+taskId+'/prompt',{text:'GFOT_CLAUDE_WRITE'});await until(()=>task.pending.some(p=>p.permission==='Write'));assert.equal(existsSync(join(f.folder,'result.txt')),false);await api('tasks/'+taskId+'/permission',{id:task.pending[0].id,reply:'reject'});await until(()=>task.status==='idle'||task.status==='error');assert.equal(task.status,'idle',task.error);const session=task.sessionId;assert.ok(session);assert.equal(task.toolHistory.findLast(t=>t.tool==='Write')?.status,'error');
  await service.close();await start();task=service.state.tasks.find(t=>t.id===taskId);assert.equal(task.sessionId,session);await api('tasks/'+taskId+'/prompt',{text:'GFOT_CLAUDE_RESUME'});await until(()=>task.status==='idle'||task.status==='error');assert.equal(task.status,'idle',task.error);assert.equal(task.sessionId,session);assert.ok(JSON.stringify(f.model.requests.at(-1).body.messages).includes('GFOT_CLAUDE_WRITE'));assert.ok(!JSON.stringify(await api('state')).includes('host-only-synthetic-key'));
 }finally{await service?.close();await f.close();}
});
