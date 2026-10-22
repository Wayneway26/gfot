import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {ensureProject,recordTool,checkpoint,sharedContext,observeWorkspace,classifyFailure} from '../task-context.mjs';
test('projects share explicit notes while task evidence stays scoped and bounded',()=>{
 const state={projects:[]};const p=ensureProject(state,'/one');p.notes='Project contract';assert.equal(ensureProject(state,'/one').id,p.id);assert.notEqual(ensureProject(state,'/two').id,p.id);
 const task={id:'t',folder:'/one',projectId:p.id,agentId:'a',messages:[{role:'user',text:'Build login'},{role:'assistant',text:'partial changes',interrupted:true}],status:'error',error:'quota exceeded'};
 recordTool(task,{id:'tool1',tool:'test',state:{status:'completed',output:'2 passed'}});task.checkpoint=checkpoint(task,{available:true,files:[{path:'login.ts',status:' M'}]});
 const context=sharedContext(task,p,[{id:'other',projectId:'different',checkpoint:{objective:'PRIVATE OTHER PROJECT'}}]);
 for(const text of ['Project contract','Build login','2 passed','login.ts','partial changes'])assert.ok(context.includes(text));assert.ok(!context.includes('PRIVATE OTHER PROJECT'));assert.equal(task.checkpoint.outputInterrupted,true);
 for(let i=0;i<100;i++)recordTool(task,{id:String(i),tool:'tool',state:{output:'x'.repeat(9000)}});assert.equal(task.toolHistory.length,24);assert.ok(task.toolHistory.every(t=>t.output.length<=2000));
 assert.equal(classifyFailure('usage_limit_reached'), 'usage-limit');assert.equal(classifyFailure('HTTP 429'),'usage-limit');assert.equal(classifyFailure('Authentication required'),'authentication');
});
test('workspace observation records filenames without reading content and handles non repositories',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-workspace-state-'));try{assert.equal((await observeWorkspace(dir)).available,false);execFileSync('/usr/bin/git',['init','-q',dir]);writeFileSync(join(dir,'file with spaces.txt'),'private content');const state=await observeWorkspace(dir);assert.equal(state.available,true);assert.equal(state.files[0].path,'file with spaces.txt');assert.ok(!JSON.stringify(state).includes('private content'));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('tool identifiers from different native Agents do not overwrite each other',()=>{
 const task={agentId:'one',sessionId:'s1'};recordTool(task,{id:'1',tool:'edit',state:{status:'completed',output:'one result'}});task.agentId='two';task.sessionId='s2';recordTool(task,{id:'1',tool:'test',state:{status:'completed',output:'two result'}});assert.equal(task.toolHistory.length,2);assert.equal(task.toolHistory[0].output,'one result');
});
test('restart preserves partial output and clears a stale switch without launching a new executor',async()=>{
 const {createStore}=await import('../state.mjs');const dir=mkdtempSync(join(tmpdir(),'gfot-switch-restart-'));try{
  writeFileSync(join(dir,'desktop.json'),JSON.stringify({version:1,profiles:[],tasks:[{id:'t',folder:dir,messages:[{role:'user',text:'original goal'}],status:'running',draft:'partial work',transition:{targetId:'other'},agentId:'workbuddy'}]}));
  const first=createStore(dir);assert.equal(first.state.tasks[0].status,'interrupted');assert.equal(first.state.tasks[0].messages[1].text,'partial work');assert.equal(first.state.tasks[0].transition,undefined);assert.ok(first.state.tasks[0].projectId);assert.equal(first.state.tasks[0].executionUnconfirmed.agentId,'workbuddy');
  const second=createStore(dir);assert.equal(second.state.tasks[0].messages.length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
