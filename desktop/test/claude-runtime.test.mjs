import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ClaudeEngine} from '../claude-engine.mjs';
import {inspectClaudeRuntime} from '../claude-runtime.mjs';
import {claudeToolDecision} from '../claude-policy.mjs';
import {createAgentRegistry} from '../local-agents.mjs';
import {startDesktopServer} from '../backend.mjs';
test('Claude runtime selection rejects invalid paths and unsupported versions with isolated version probes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-cli-version-'));
 try{const valid=join(dir,'claude');writeFileSync(valid,'#!/bin/sh\nprintf "2.1.312 (Claude Code)\\n"\n',{mode:0o700});const runtime=await inspectClaudeRuntime(valid);assert.equal(runtime.version,'2.1.312');
  const registry=createAgentRegistry({appRoots:[],claudeRuntime:()=>runtime});assert.equal(registry.get('claude').kind,'claude');assert.equal(registry.list().find(a=>a.id==='claude').requiresProfile,true);assert.equal(registry.list().find(a=>a.id==='claude').supportsHarness,false);
  writeFileSync(valid,'#!/bin/sh\nprintf "2.1.311 (Claude Code)\\n"\n');await assert.rejects(inspectClaudeRuntime(valid),/2\.1\.312/);await assert.rejects(inspectClaudeRuntime('relative'),/请选择/);await assert.rejects(inspectClaudeRuntime(dir),/不可执行/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Claude tool policy resolves symlinks and distinguishes questions, reads and approvals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-cli-policy-')),folder=join(dir,'project');mkdirSync(folder);mkdirSync(join(dir,'outside'));symlinkSync(join(dir,'outside'),join(folder,'linked'));
 try{assert.equal(claudeToolDecision(folder,'Read',{file_path:join(folder,'source.txt')}).allow,true);assert.equal(claudeToolDecision(folder,'Read',{file_path:join(folder,'linked/secret.txt')}).ask,true);assert.equal(claudeToolDecision(folder,'Glob',{pattern:'../outside/*',path:folder}).ask,true);assert.equal(claudeToolDecision(folder,'Glob',{pattern:join(dir,'outside/*'),path:folder}).ask,true);assert.equal(claudeToolDecision(folder,'Glob',{pattern:'**/*.mjs',path:folder}).allow,true);assert.equal(claudeToolDecision(folder,'Grep',{path:join(dir,'outside')}).ask,true);assert.equal(claudeToolDecision(folder,'Write',{file_path:join(folder,'a')}).ask,true);assert.equal(claudeToolDecision(folder,'AskUserQuestion',{}).question,true);assert.ok(claudeToolDecision(folder,'Unknown',{}).deny);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('Claude API restricts file selection to native authority and rejects non-Anthropic task connections',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-cli-api-')),binary=join(dir,'claude');writeFileSync(binary,'#!/bin/sh\nprintf "2.1.312 (Claude Code)\\n"\n',{mode:0o700});let service;
 try{service=await startDesktopServer({dataDir:join(dir,'data'),key:randomBytes(32)});
  const call=async(route,body,cookie=false)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'gfot='+service.auth}:{authorization:'Bearer '+service.auth})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await call('runtimes/claude/select',{path:binary},true)).status,403);const selected=await call('runtimes/claude/select',{path:binary});assert.equal(selected.status,200);assert.equal(selected.body.agents.find(a=>a.id==='claude').available,true);
  const p=(await call('profiles',{label:'Chat only',baseURL:'http://127.0.0.1:1234/v1',model:'fixture'})).body.profiles[0];assert.equal((await call('tasks',{folder:dir,agentId:'claude',profileId:p.id})).status,400);
  const q=(await call('profiles',{label:'Native Claude',baseURL:'http://127.0.0.1:1234/v1',model:'fixture',protocol:'anthropic'})).body.profiles.at(-1);assert.equal((await call('tasks',{folder:dir,agentId:'claude',profileId:q.id})).status,200);
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('stopping during a runtime version probe cannot launch a late Claude process',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-claude-start-stop-')),binary=join(dir,'claude');let engine;
 try{writeFileSync(binary,'#!/bin/sh\nsleep 2\nprintf "2.1.312 (Claude Code)\\n"\n',{mode:0o700});
  engine=new ClaudeEngine({binary,dataDir:dir,task:{id:'stopped-start',folder:dir},profile:{protocol:'anthropic'},key:'synthetic'});
  const starting=engine.start().catch(error=>error);for(let i=0;i<100&&!engine.probe;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(engine.probe);
  assert.equal((await engine.stop()).confirmed,true);assert.ok(await starting instanceof Error);assert.equal(engine.child,undefined);assert.equal(engine.query,undefined);assert.ok(engine.probe.signalCode||engine.probe.exitCode!==null);await assert.rejects(engine.start(),/已停止/);
 }finally{await engine?.stop();rmSync(dir,{recursive:true,force:true});}
});

test('Claude public event mapping omits private thinking and labels child output separately',async()=>{
 const events=[],engine=new ClaudeEngine({task:{sessionId:'fixture'},onEvent:event=>events.push(event)});
 engine.receive({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING_SENTINEL'}}});
 engine.receive({type:'assistant',message:{content:[{type:'thinking',thinking:'PRIVATE_REASONING_SENTINEL'},{type:'text',text:'Public answer'}]}});
 engine.receive({type:'assistant',parent_tool_use_id:'child-1',message:{content:[{type:'text',text:'Child answer'}]}});
 assert.ok(!JSON.stringify(events).includes('PRIVATE_REASONING_SENTINEL'));assert.equal((await engine.history())[0].parts[0].text,'Public answer');assert.equal(events.at(-1).properties.agentId,'child-1');assert.equal((await engine.stop()).confirmed,true);
});
