import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startDesktopServer} from '../backend.mjs';
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
async function setup(engineFactory){
 const dir=mkdtempSync(join(tmpdir(),'gfot-reliability-')),key=randomBytes(32);
 const service=await startDesktopServer({dataDir:dir,key,engineFactory,workspaceObserver:async()=>({available:false})});
 const call=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
 const profile=(await call('profiles',{label:'Fixture',model:'x',baseURL:'http://localhost:1/v1'})).profiles[0];
 const {taskId}=await call('tasks',{folder:dir,profileId:profile.id});
 return {dir,service,task:service.state.tasks[0],call:(action,body)=>call('tasks/'+taskId+'/'+action,body),async close(){await service.close();rmSync(dir,{recursive:true,force:true});}};
}
const part=(id,type,value,sessionID)=>({type:'message.part.updated',properties:{part:{id,type,...value,...(sessionID?{sessionID}:{})}}});
test('prior-turn callbacks and nested foreign-session events cannot contaminate the current turn',async()=>{
 const rounds=[];const h=await setup(o=>{let release;const round={emit:o.onEvent};rounds.push(round);return {async start(){o.task.sessionId='same-session';},async send(){await new Promise(r=>release=r);return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:'done'}]}];},async stop(){release?.();},};});
 try{
  await h.call('prompt',{text:'first'});await wait(()=>h.task.status==='running');await h.call('stop',{});await wait(()=>h.task.status==='stopped');
  // Even a matching session ID does not make an old engine callback current.
  await h.call('prompt',{text:'second'});await wait(()=>rounds.length===2&&h.task.status==='running');
  const before=JSON.stringify(h.task);
  rounds[0].emit(part('old','text',{text:'STALE_OUTPUT'},'same-session'));
  rounds[0].emit({type:'permission.asked',properties:{id:'old-approval',sessionID:'same-session',permission:'stale approval'}});
  rounds[1].emit(part('foreign','tool',{tool:'write',state:{status:'completed',output:'FOREIGN_EVIDENCE'}},'another-session'));
  rounds[1].emit(part('foreign-text','text',{text:'FOREIGN_OUTPUT'},'another-session'));
  assert.equal(JSON.stringify(h.task),before);
  rounds[1].emit(part('current','text',{text:'CURRENT_OUTPUT'},'same-session'));assert.equal(h.task.draft,'CURRENT_OUTPUT');
  await h.call('stop',{});await wait(()=>h.task.status==='stopped');const finished=JSON.stringify(h.task);
  rounds[1].emit(part('late','text',{text:'AFTER_STOP'}));assert.equal(JSON.stringify(h.task),finished);
 }finally{await h.close();}
});
test('a successful turn retains streamed progress and final output when history returns no text',async()=>{
 const h=await setup(o=>({async start(){o.task.sessionId='stream';},async send(){o.onEvent(part('p','text',{text:'Inspecting files'}));o.onEvent({type:'gfot.output.boundary',properties:{}});o.onEvent(part('f','text',{text:'## Completed\nResult survives'}));return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'reasoning',text:'PRIVATE_REASONING'}]}];},async stop(){}}));
 try{await h.call('prompt',{text:'work'});await wait(()=>h.task.status==='idle');const replies=h.task.messages.filter(m=>m.role==='assistant');assert.deepEqual(replies.map(m=>[m.text,m.presentation]),[['Inspecting files','progress'],['## Completed\nResult survives','final']]);assert.equal(h.task.checkpoint.lastOutput,replies[1].text);assert.equal(h.task.draft,'');assert.deepEqual(h.task.liveProgress,[]);assert.ok(!JSON.stringify(h.task).includes('PRIVATE_REASONING'));const saved=JSON.parse(readFileSync(join(h.dir,'desktop.json'),'utf8')).tasks[0];assert.deepEqual(saved.messages,h.task.messages);assert.equal(saved.checkpoint.lastOutput,replies[1].text);const {continuationText}=await import('../local-agents.mjs');assert.match(continuationText({...saved,messages:[...saved.messages,{role:'user',text:'continue'}]},'continue',{fresh:true}).text,/Result survives/);}finally{await h.close();}
});
test('streamed fallback does not duplicate canonical output returned by history',async()=>{
 const h=await setup(o=>({async start(){o.task.sessionId='canonical';},async send(){o.onEvent(part('t','text',{text:'Stream snapshot'}));return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:'Canonical answer'}]}];},async stop(){}}));
 try{await h.call('prompt',{text:'work'});await wait(()=>h.task.status==='idle');assert.deepEqual(h.task.messages.filter(m=>m.role==='assistant').map(m=>m.text),['Canonical answer']);}finally{await h.close();}
});

test('an executor error retains streamed evidence as progress, never a completed answer',async()=>{
 const h=await setup(o=>({async start(){o.task.sessionId='error';},async send(){o.onEvent(part('p','text',{text:'Partial changes, tests incomplete'}));return {info:{error:{message:'quota exceeded'}}};},async history(){return [];},async stop(){}}));
 try{await h.call('prompt',{text:'work'});await wait(()=>h.task.status==='error');const replies=h.task.messages.filter(m=>m.role==='assistant');assert.equal(replies.length,1);assert.equal(replies[0].presentation,'progress');assert.match(replies[0].text,/tests incomplete/);assert.equal(h.task.blocked.kind,'usage-limit');}finally{await h.close();}
});
