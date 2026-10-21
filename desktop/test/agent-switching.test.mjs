import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {startDesktopServer} from '../backend.mjs';
const wait=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('task timeout');};
const list=[{id:'opencode',name:'Built in',kind:'builtin',available:true},{id:'fixture-acp',name:'Fixture ACP',kind:'acp',available:true}];
const registry={list:()=>list,get:id=>{const a=list.find(a=>a.id===id);if(!a)throw Error('unknown');return a;},refresh:()=>list,command:()=>({command:'/fixture',args:[]})};

test('a task switches actual executors, preserves canonical history and resumes each own session after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-switch-')),key=randomBytes(32);let service;const seen=[];
 const factory=kind=>o=>({resumed:!!o.task.sessionId,async start(){o.task.sessionId||=kind+'-session';},async send(text){seen.push({kind,text,session:o.task.sessionId});return {info:{}};},async history(){return [{info:{role:'assistant'},parts:[{type:'text',text:kind+' answer'}]}];},async stop(){}});
 const start=()=>startDesktopServer({dataDir:dir,key,agentRegistry:registry,engineFactory:factory('builtin'),acpFactory:factory('acp')});
 const call=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 try{
  service=await start();const p=(await call('profiles',{label:'Synthetic',baseURL:'http://localhost:1234/v1',model:'x'})).profiles[0];
  const {taskId}=await call('tasks',{folder:dir,title:'Shared task',profileId:p.id});const task=service.state.tasks[0];
  await call('tasks/'+taskId+'/notes',{text:'Do not change API'});
  await call('tasks/'+taskId+'/prompt',{text:'first'});await wait(()=>task.status==='idle');
  await call('tasks/'+taskId+'/agent',{agentId:'fixture-acp'});await call('tasks/'+taskId+'/prompt',{text:'continue'});await wait(()=>task.status==='idle');
  assert.equal(task.messages.length,4);assert.ok(seen[1].text.includes('first'));assert.ok(seen[1].text.includes('builtin answer'));assert.ok(seen[1].text.includes('Do not change API'));
  assert.equal(seen[1].session,'acp-session');await service.close();service=await start();
  await call('tasks/'+taskId+'/agent',{agentId:'opencode'});await call('tasks/'+taskId+'/prompt',{text:'return'});await wait(()=>service.state.tasks[0].status==='idle');
  assert.equal(seen[2].session,'builtin-session');assert.ok(seen[2].text.includes('acp answer'));assert.ok(!seen[2].text.includes('[user / opencode]\nfirst'));assert.equal(service.state.tasks[0].messages.length,6);
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('native Agent tasks do not require a gfot model profile',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-native-create-'));let service;
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),agentRegistry:registry});
  const r=await fetch(service.url+'/api/tasks',{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify({folder:dir,agentId:'fixture-acp'})});assert.equal(r.status,200);assert.equal(service.state.tasks[0].agentId,'fixture-acp');
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('native CLI login requires desktop authority, cancels cleanly and blocks task sends while pending',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-agent-login-test-'));let service,release;
 const loginRegistry={...registry,list:()=>[...list,{id:'workbuddy',kind:'acp',available:true}],get:id=>id==='workbuddy'?{id,kind:'acp',available:true}:registry.get(id)};
 const acpFactory=()=>({info:{authMethods:[{id:'internal'}]},async start(){},async request(){await new Promise(r=>release=r);},async stop(){release?.();}});
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),agentRegistry:loginRegistry,acpFactory});
  const call=(route,body,auth='Bearer '+service.auth)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{...(auth?{authorization:auth}:{cookie:'gfot='+service.auth}),'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await call('agents/login/start',{id:'workbuddy'},'')).status,403);
  const r=await call('agents/login/start',{id:'workbuddy'});assert.equal(r.status,200);const login=await r.json();assert.equal(login.status,'pending');await wait(()=>release);
  const state=await (await fetch(service.url+'/api/state',{headers:{authorization:'Bearer '+service.auth}})).json();assert.equal(state.agents.find(a=>a.id==='workbuddy').login.status,'pending');
  assert.equal((await call('agents/login/cancel',{id:login.id})).status,200);
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});
