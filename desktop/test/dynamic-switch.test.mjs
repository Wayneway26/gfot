import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomBytes} from 'node:crypto';
import {startDesktopServer} from '../backend.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));const wait=async f=>{for(let i=0;i<300;i++){if(f())return;await delay(10);}throw Error('timeout');};
const agents=[{id:'opencode',name:'Codex account executor',kind:'builtin',available:true},{id:'other',name:'Other native',kind:'acp',available:true}];const registry={list:()=>agents,refresh:()=>agents,get:id=>{const a=agents.find(a=>a.id===id);if(!a)throw Error('unsupported');return a;},command:()=>({})};
async function harness(factories){const dir=mkdtempSync(join(tmpdir(),'gfot-dynamic-')),key=randomBytes(32);let service;const start=async()=>{service=await startDesktopServer({dataDir:dir,key,agentRegistry:registry,...factories});return service;};await start();
 const request=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const call=async(path,body)=>{const r=await request(path,body);assert.ok(r.status<300,JSON.stringify(r));return r.data;};
 const profile=(await call('profiles',{label:'Synthetic',model:'fixture',baseURL:'http://127.0.0.1:1234/v1'})).profiles[0];const {taskId}=await call('tasks',{folder:dir,title:'Build feature',profileId:profile.id});
 return {dir,key,start,call,request,taskId,get service(){return service;},get task(){return service.state.tasks.find(t=>t.id===taskId);},async close(){await service.close();rmSync(dir,{recursive:true,force:true});}};
}
test('quota failure switches and continues the same project/task with persisted tools and objective',async()=>{
 let received;const h=await harness({engineFactory:o=>({async start(){o.task.sessionId='source';},async send(){o.onEvent({type:'message.part.updated',properties:{part:{id:'tests',type:'tool',tool:'run tests',state:{status:'completed',output:'3 passed, 1 failed in login'}}}});o.onEvent({type:'message.part.delta',properties:{field:'text',delta:'Login view is implemented; validation remains'}});throw Error('usage_limit_reached');},async stop(){}}),acpFactory:o=>({async start(){o.task.sessionId='target';},async send(text){received=text;return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:'continued successfully'}]}];},async stop(){}})});
 try{
  await h.call('projects/'+h.task.projectId+'/notes',{text:'Use the existing API contract'});await h.call('tasks/'+h.taskId+'/prompt',{text:'Implement the login feature'});await wait(()=>h.task.status==='error');assert.equal(h.task.blocked.kind,'usage-limit');
  h.task.messages.splice(1,0,...Array.from({length:40},(_,i)=>({id:'old-'+i,role:'assistant',text:'older context '.repeat(200)})));
  const beforeId=h.task.id,beforeFolder=h.task.folder;await h.call('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true});await wait(()=>h.task.status==='idle');
  assert.equal(h.task.id,beforeId);assert.equal(h.task.folder,beforeFolder);assert.ok(received.length<=60000);assert.ok(h.task.lastTransfer.historyOmitted>0);for(const s of ['Implement the login feature','Use the existing API contract','3 passed, 1 failed','validation remains','usage_limit_reached'])assert.ok(received.includes(s),s);
  assert.equal(h.task.messages.filter(m=>m.role==='user'&&!m.continuation).length,1);assert.ok(h.task.messages.some(m=>m.continuation));assert.equal(h.task.agentSessions.opencode.sessionId,'source');assert.equal(h.task.switchHistory.length,1);
  await h.service.close();await h.start();assert.equal(h.task.switchHistory.length,1);assert.equal(h.service.state.projects[0].notes,'Use the existing API contract');assert.equal(h.task.checkpoint.agentId,'other');
 }finally{await h.close();}
});
test('switch during a running turn serializes cancellation, checkpointing and target execution',async()=>{
 let release,stopRelease,targetStarted=false;const h=await harness({engineFactory:o=>({async start(){o.task.sessionId='source';},send:()=>new Promise(r=>release=r),async stop(){await new Promise(r=>stopRelease=r);release({info:{}});}}),acpFactory:o=>({async start(){targetStarted=true;o.task.sessionId='target';},async send(){return {info:{}};},async history(){return [];},async stop(){}})});
 try{await h.call('tasks/'+h.taskId+'/prompt',{text:'Build feature'});await wait(()=>release);const switching=h.call('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true});await wait(()=>stopRelease);assert.equal(targetStarted,false);assert.equal((await h.request('tasks/'+h.taskId+'/prompt',{text:'race'})).status,400);assert.equal((await h.request('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true})).status,400);
  // First stop is the switch request; final cleanup also calls stop, matching idempotent native engines.
  const r=stopRelease;h.task.status='running';r();await wait(()=>stopRelease!==r);stopRelease();await switching;await wait(()=>h.task.status==='idle');assert.equal(targetStarted,true);assert.ok(h.task.checkpoint);assert.equal(h.task.agentId,'other');
 }finally{await h.close();}
});
test('invalid target and empty-task continuation do not strand the switch lock',async()=>{
 const h=await harness({});try{assert.equal((await h.request('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true})).status,400);assert.equal((await h.request('tasks/'+h.taskId+'/switch',{agentId:'other',resume:false})).status,200);assert.equal((await h.request('tasks/'+h.taskId+'/switch',{agentId:'opencode',resume:false})).status,200);assert.equal(h.task.transition,undefined);}finally{await h.close();}
});

test('closing during checkpoint observation cannot launch the target executor',async()=>{
 let release,started=false;const h=await harness({workspaceObserver:()=>new Promise(r=>release=r),acpFactory:()=>({async start(){started=true;},async stop(){}})});
 try{h.task.messages.push({role:'user',text:'original goal'});const switching=h.request('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true});await wait(()=>release);const closing=h.service.close();release({available:false});const result=await switching;await closing;assert.equal(result.status,400);assert.equal(started,false);assert.equal(h.task.transition,undefined);}finally{await h.close();}
});
test('pending continuations reserve global capacity and exclude native login and connection edits',async()=>{
 const releases=[];let observes=0;const h=await harness({workspaceObserver:()=>++observes<=2?new Promise(r=>releases.push(r)):Promise.resolve({available:false}),agentRegistry:{...registry,get:id=>id==='workbuddy'?{id,kind:'acp',available:true}:registry.get(id)},acpFactory:o=>({async start(){o.task.sessionId='native';},async send(){return {info:{}};},async history(){return [];},async stop(){}})});
 try{const ids=[];for(let i=0;i<2;i++){const {taskId}=await h.call('tasks',{folder:h.dir,agentId:'other'});h.service.state.tasks.find(t=>t.id===taskId).messages.push({role:'user',text:'goal'});ids.push(taskId);}
  const switches=ids.map(id=>h.request('tasks/'+id+'/switch',{agentId:'other',resume:true}));await wait(()=>releases.length===2);
  assert.equal((await h.request('tasks/'+h.taskId+'/prompt',{text:'over capacity'})).status,400);assert.equal((await h.request('agents/login/start',{id:'workbuddy'})).status,400);assert.equal((await h.request('profiles',{label:'race',model:'x',baseURL:'http://localhost:1/v1'})).status,400);
  releases.forEach(r=>r({available:false}));for(const result of await Promise.all(switches))assert.equal(result.status,202);await wait(()=>ids.every(id=>h.service.state.tasks.find(t=>t.id===id).status==='idle'));
 }finally{await h.close();}
});
test('known logged-out target is rejected before stopping the source',async()=>{
 let release,stopCount=0;const h=await harness({engineFactory:o=>({async start(){o.task.sessionId='source';},send:()=>new Promise(r=>release=r),async history(){return [];},async stop(){stopCount++;release?.({info:{}});}})});
 try{await h.call('tasks/'+h.taskId+'/prompt',{text:'source still working'});await wait(()=>release);h.service.state.accounts.push({id:'logged-out',secret:null,canRefresh:false});h.service.state.profiles.push({id:'bad',mode:'account',model:'x',accountId:'logged-out'});
  const r=await h.request('tasks/'+h.taskId+'/switch',{agentId:'opencode',profileId:'bad',resume:true});assert.equal(r.status,400);assert.match(r.data.error,/已退出/);assert.equal(stopCount,0);assert.equal(h.task.status,'running');
 }finally{await h.close();}
});
test('a switching active task keeps its execution slot after old cleanup and before target start',async()=>{
 let observations=0,releaseObservation;const pending=new Map();const h=await harness({workspaceObserver:()=>++observations===2?new Promise(r=>releaseObservation=r):Promise.resolve({available:false}),engineFactory:o=>{let release;return {async start(){o.task.sessionId='source-'+o.task.id;},send:()=>new Promise(r=>{release=r;pending.set(o.task.id,true);}),async stop(){release?.({info:{}});},async history(){return [];}};},acpFactory:o=>({async start(){o.task.sessionId='target';},async send(){return {info:{}};},async history(){return [];},async stop(){}})});
 try{await h.call('tasks/'+h.taskId+'/prompt',{text:'source'});await wait(()=>pending.has(h.taskId));const switching=h.call('tasks/'+h.taskId+'/switch',{agentId:'other',resume:true});await wait(()=>releaseObservation);
  const profile=h.service.state.profiles[0].id;const second=(await h.call('tasks',{folder:h.dir,profileId:profile})).taskId;await h.call('tasks/'+second+'/prompt',{text:'second working'});const third=(await h.call('tasks',{folder:h.dir,profileId:profile})).taskId;assert.equal((await h.request('tasks/'+third+'/prompt',{text:'must wait'})).status,400);
  releaseObservation({available:false});await switching;await wait(()=>h.task.status==='idle');
 }finally{await h.close();}
});
test('a prompt body completed after service closure cannot launch an executor',async()=>{
 const http=await import('node:http');let started=false;const h=await harness({engineFactory:()=>({async start(){started=true;},async stop(){}})});
 try{const body=JSON.stringify({text:'late body'}),url=new URL(h.service.url+'/api/tasks/'+h.taskId+'/prompt');let request;
  const response=new Promise((resolve,reject)=>{request=http.request(url,{method:'POST',headers:{authorization:'Bearer '+h.service.auth,'content-type':'application/json','content-length':Buffer.byteLength(body)}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});request.on('error',reject);});
  request.write(body.slice(0,5));await delay(20);const closing=h.service.close();request.end(body.slice(5));assert.equal(await response,503);await closing;assert.equal(started,false);
 }finally{await h.close();}
});
test('unacknowledged ACP stop blocks handoff until explicit native completion confirmation',async()=>{
 let rejectTurn;const h=await harness({acpFactory:o=>({async start(){o.task.sessionId='native';},send:()=>new Promise((_,reject)=>rejectTurn=reject),async stop(){rejectTurn?.(Error('transport closed'));return {confirmed:false};}})});
 try{await h.call('tasks/'+h.taskId+'/agent',{agentId:'other'});await h.call('tasks/'+h.taskId+'/prompt',{text:'native working'});await wait(()=>rejectTurn);const result=await h.request('tasks/'+h.taskId+'/switch',{agentId:'opencode',resume:true});assert.equal(result.status,400);await wait(()=>h.task.status==='error');assert.ok(h.task.executionUnconfirmed);assert.equal(h.task.agentId,'other');assert.equal((await h.request('tasks/'+h.taskId+'/switch',{agentId:'opencode',resume:false})).status,400);await h.call('tasks/'+h.taskId+'/confirm-stopped',{confirmed:true});await h.call('tasks/'+h.taskId+'/switch',{agentId:'opencode',resume:false});assert.equal(h.task.agentId,'opencode');
 }finally{await h.close();}
});
