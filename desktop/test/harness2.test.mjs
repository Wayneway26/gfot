import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Harness2Engine,defaultHarness,harnessStatus,projectSnapshot,validHarness} from '../harness2.mjs';
import {startDesktopServer} from '../backend.mjs';
import {engineEnvironment} from '../engine.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await sleep(20);}throw Error('condition timed out');}
const available=harnessStatus().available;

test('H2 snapshots exclude hidden files, credentials, dependency trees and symlinks; bounds fail explicitly',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-snapshot-'));
 try{for(const name of ['project','outside','project/node_modules','project/.git'])mkdirSync(join(dir,name),{recursive:true});
  writeFileSync(join(dir,'project/main.mjs'),'export const value = 1;');writeFileSync(join(dir,'project/auth.json'),'private');writeFileSync(join(dir,'project/.env'),'private');writeFileSync(join(dir,'project/node_modules/private.js'),'private');writeFileSync(join(dir,'outside/private.js'),'outside');symlinkSync(join(dir,'outside/private.js'),join(dir,'project/link.js'));
  assert.deepEqual(projectSnapshot(join(dir,'project')).map(f=>f.path),['main.mjs']);
  for(let i=0;i<201;i++)writeFileSync(join(dir,'project',i+'.txt'),'bounded');assert.throws(()=>projectSnapshot(join(dir,'project')),/200/);
  assert.throws(()=>validHarness({...defaultHarness,'plugin/unsafe.ts':'execute'}),/四个/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('real Harness2 core produces a 4/3 ledger, keeps probes separate and requires fresh explicit adoption', {skip:!available,timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-core-')),dataDir=join(dir,'data'),folder=join(dir,'project');mkdirSync(folder);mkdirSync(dataDir);writeFileSync(join(folder,'value.txt'),'original');
 let service,calls=0,release,normalOptions;const options=[];
 const engineFactory=o=>{options.push(o);let text='';return {
  async start(){o.task.sessionId='s'+options.length;},
  async send(prompt){calls++;if(o.readOnly){assert.ok(readFileSync(join(o.task.folder,'context/harness/systemprompt.md'),'utf8'));text=JSON.stringify({harness:{...defaultHarness,'systemprompt.md':'Inspect the task and verify the result.'},notes:'Observed probe evidence '+o.key});}
   else if(o.task.title.startsWith('Harness²')){o.onEvent({type:'permission.asked',properties:{id:'approval-'+calls,sessionID:o.task.sessionId,permission:'edit',patterns:['value.txt']}});await new Promise(r=>release=r);if(calls===1)unlinkSync(join(o.task.folder,'value.txt'));else writeFileSync(join(o.task.folder,'value.txt'),'probe only');text='Completed isolated work';}
   else{normalOptions=o;text='normal work';}return {info:{}};},
  async history(){return [{info:{id:'a',role:'assistant'},parts:[{type:'text',text}]}];},
  async permission(){release();},async question(){},async stop(){release?.();},
 };};
 try{
  service=await startDesktopServer({dataDir,binary:'/synthetic',key:randomBytes(32),engineFactory});
  const call=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const profile=(await call('profiles',{label:'test',baseURL:'http://127.0.0.1:9876/v1',model:'synthetic',apiKey:'test-credential-never-publish'})).body.profiles[0];
  const taskId=(await call('tasks',{title:'project',folder,profileId:profile.id})).body.taskId;
  assert.equal((await call('tasks/'+taskId+'/harness',{text:'Change value',consent:false})).status,400);
  assert.equal(calls,0);assert.equal((await call('tasks/'+taskId+'/harness',{text:'Change value',consent:true})).status,202);
  const task=service.state.tasks[0];
  for(let i=0;i<600&&['starting','running','permission'].includes(task.status);i++){
   if(task.pending.length)await call('tasks/'+taskId+'/permission',{id:task.pending[0].id,reply:'once'});await sleep(10);
  }
  assert.equal(task.status,'idle',task.error);assert.equal(task.harnessRun.status,'ready',JSON.stringify(task.harnessRun.result));assert.equal(task.harnessRun.result.successful,true);
  assert.equal(task.harnessRun.result.method.ledger.R,4);assert.equal(task.harnessRun.result.method.ledger.P,3);assert.equal(calls,7);assert.match(task.harnessRun.result.candidates[0].trajectoryExcerpt,/\"change\": \"deleted\"/);const probedPrompt=options.find(o=>o.task.title==='Harness² c1').systemPrompt;
  assert.equal(readFileSync(join(folder,'value.txt'),'utf8'),'original');assert.equal(new Set(options.filter(o=>!o.readOnly).map(o=>o.task.folder)).size,4);
  assert.equal((await call('tasks/'+taskId+'/harness-adopt',{consent:false,runId:task.harnessRun.runId})).status,400);
  assert.equal((await call('tasks/'+taskId+'/harness-adopt',{consent:true,runId:'stale'})).status,400);
  const visible=(await call('state')).body;assert.ok(!JSON.stringify(visible).includes('test-credential-never-publish'));
  await call('tasks/'+taskId+'/harness-adopt',{consent:true,runId:task.harnessRun.runId});assert.equal(task.harnessRun.status,'adopted');
  await call('tasks/'+taskId+'/prompt',{text:'Continue'});await until(()=>task.status==='idle');assert.match(normalOptions.systemPrompt,/Inspect the task/);assert.equal(normalOptions.systemPrompt,probedPrompt);
  await call('tasks/'+taskId+'/harness-clear',{});assert.equal(task.adoptedHarness,undefined);
  assert.ok(!JSON.stringify(task.harnessRun.result).includes('test-credential-never-publish'));
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('H2 stop cancels the current executor and cannot produce an adoptable result',{skip:!available,timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-stop-'));mkdirSync(join(dir,'data'));mkdirSync(join(dir,'project'));writeFileSync(join(dir,'project/source.txt'),'source');let release,stopped=0;
 const engine=new Harness2Engine({binary:'/synthetic',dataDir:join(dir,'data'),task:{id:'stop-test',folder:join(dir,'project')},prompt:'fixture',profile:{},key:'',onPhase(){},onEvent(){},engineFactory:()=>({async start(){},send(){return new Promise(r=>release=r);},async history(){return [];},async stop(){stopped++;release?.({info:{}});}})});
 try{await engine.start();const waiting=assert.rejects(engine.send(),/停止|Stopped/);await until(()=>release);await engine.stop();await waiting;assert.ok(stopped>0);assert.equal(engine.result,null);}
 finally{await engine.stop();rmSync(dir,{recursive:true,force:true});}
});

test('read-only proposal policy and adopted prompts preserve tool permissions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-permissions-'));
 try{const base={dataDir:dir,task:{id:'p'},profile:{protocol:'chat',model:'m',baseURL:'http://127.0.0.1/v1',label:'test'},key:'temporary',password:'local'};
  const proposal=JSON.parse(engineEnvironment({...base,readOnly:true}).OPENCODE_CONFIG_CONTENT);assert.equal(proposal.permission['*'],'deny');assert.equal(proposal.permission.external_directory,'deny');
  const adopted=JSON.parse(engineEnvironment({...base,systemPrompt:'adopted instructions'}).OPENCODE_CONFIG_CONTENT);assert.equal(adopted.agent.build.prompt,'adopted instructions');assert.equal(adopted.permission.edit,'ask');assert.equal(adopted.permission.bash,'ask');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('upstream vendored Python files match their recorded source hashes',()=>{
 const base=new URL('../vendor/harness2/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('UPSTREAM.json',base),'utf8'));
 assert.match(manifest.commit,/^[a-f0-9]{40}$/);assert.equal(manifest.license,'Apache-2.0');
 for(const [name,hash]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(new URL(name,base))).digest('hex'),hash,name);
});

test('failed proposal sessions remain visible as upstream fallbacks and cannot count as a successful refinement',{skip:!available,timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-fallback-'));mkdirSync(join(dir,'data'));mkdirSync(join(dir,'project'));writeFileSync(join(dir,'project/source.txt'),'source');
 const engine=new Harness2Engine({binary:'/synthetic',dataDir:join(dir,'data'),task:{id:'fallback-test',folder:join(dir,'project')},prompt:'fixture',profile:{},key:'',onPhase(){},onEvent(){},engineFactory:o=>({async start(){},async send(){return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:o.readOnly?'invalid proposal':'completed fixture'}]}];},async stop(){}})});
 try{await engine.start();const result=await engine.send();assert.equal(result.successful,false);assert.deepEqual(result.method.fell_back,['inv1','dom1','c1']);assert.equal(result.method.ledger.R,4);assert.equal(result.costsKnown,false);}
 finally{await engine.stop();rmSync(dir,{recursive:true,force:true});}
});

test('oversized rollout evidence fails explicitly rather than silently dropping trajectory events',{skip:!available,timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-h2-evidence-'));mkdirSync(join(dir,'data'));mkdirSync(join(dir,'project'));writeFileSync(join(dir,'project/source.txt'),'source');
 const engine=new Harness2Engine({binary:'/synthetic',dataDir:join(dir,'data'),task:{id:'large-test',folder:join(dir,'project')},prompt:'fixture',profile:{},key:'',onPhase(){},onEvent(){},engineFactory:()=>({async start(){},async send(){return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:'x'.repeat(1600000)}]}];},async stop(){}})});
 try{await engine.start();await assert.rejects(engine.send(),/1.5 MB/);assert.equal(engine.result,null);}
 finally{await engine.stop();rmSync(dir,{recursive:true,force:true});}
});
