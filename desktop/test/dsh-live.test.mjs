import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DshEngine} from '../dsh-engine.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(external=[]){
 const dir=mkdtempSync(join(tmpdir(),'gfot-dsh-test-')),folder=join(dir,'project'),requests=[];mkdirSync(folder);
 const server=http.createServer(async(req,res)=>{
  let text='';for await(const part of req)text+=part;
  const body=JSON.parse(text);requests.push(body);const all=JSON.stringify(body.messages),toolReply=id=>body.messages.some(m=>m.role==='tool'&&m.tool_call_id===id);
  let delta,finish='stop';
  const externalIndex=Math.max(-1,...Array.from(all.matchAll(/GFOT_EXTERNAL_(\d+)/g),m=>Number(m[1])));
  if(externalIndex>=0&&!toolReply('external-'+externalIndex)){
   const tool=external[externalIndex];delta={tool_calls:[{index:0,id:'external-'+externalIndex,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]};finish='tool_calls';
  }else if(all.includes('GFOT_QUESTION')&&!toolReply('question-one')){
   assert.ok(body.tools.some(t=>t.function.name==='ask_user_question'));
   delta={tool_calls:[{index:0,id:'question-one',type:'function',function:{name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'color',question:'Choose a color',options:[{label:'Blue'},{label:'Red'}]}]})}}]};finish='tool_calls';
  }else if(all.includes('GFOT_WRITE')&&!toolReply('write-one')){
   delta={tool_calls:[{index:0,id:'write-one',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:'result.txt',content:'written by real dsh'})}}]};finish='tool_calls';
  }else delta={content:all.includes('GFOT_QUESTION')?'Question answered':'DSH verified'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={dataDir:dir,profile:{baseURL:'http://127.0.0.1:'+server.address().port+'/v1',model:'alpha',protocol:'chat'},key:'fixture-dsh-key'};
 return {dir,folder,requests,options,async close(){await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}

test('real dsh gates file changes, streams output, restores exact session with a new model, and answers native questions',{timeout:90000},async()=>{
 const f=await fixture(),task={id:'native',folder:f.folder,sessionId:null},events=[];let e;
 try{
  e=new DshEngine({...f.options,task,onEvent:event=>{events.push(event);if(event.type==='permission.asked')void e.permission(event.properties.id,'once');}});
  await e.start();await e.send('GFOT_WRITE');
  assert.equal(readFileSync(join(f.folder,'result.txt'),'utf8'),'written by real dsh');
  assert.ok(events.some(e=>e.type==='permission.asked'&&e.properties.permission==='write'));
  assert.ok(events.some(e=>e.type==='message.part.delta'&&e.properties.delta==='DSH verified'));
  assert.ok(events.some(e=>e.type==='message.part.updated'&&e.properties.part.state.status==='completed'));
  const session=task.sessionId;assert.equal((await e.stop()).confirmed,true);
  e=new DshEngine({...f.options,profile:{...f.options.profile,model:'beta'},task,onEvent:event=>{events.push(event);if(event.type==='question.asked')void e.question(event.properties.id,[['Blue']]);}});
  await e.start();assert.equal(e.resumed,true);assert.equal(task.sessionId,session);
  await e.send('GFOT_QUESTION');
  assert.equal((await e.history()).at(-1).parts[0].text,'Question answered');
  assert.equal(f.requests.at(-1).model,'beta');
  assert.ok(JSON.stringify(f.requests.at(-1).messages).includes('GFOT_WRITE'),'restored native history reaches new model');
  assert.ok(JSON.stringify(f.requests.at(-1).messages).includes('Blue'));
 }finally{await e?.stop();await f.close();}
});

test('real dsh fences absolute and symlink reads/searches for Harness2 and requires approval for external ordinary reads',{timeout:90000},async()=>{
 const tools=[],f=await fixture(tools);let e,approvals=0;
 try{
  const outside=join(f.dir,'outside');mkdirSync(outside);writeFileSync(join(outside,'secret.txt'),'EXTERNAL_SENTINEL_NOT_FOR_PROBES');symlinkSync(outside,join(f.folder,'linked'));
  tools.push({name:'read',args:{file_path:join(outside,'secret.txt')}},{name:'read',args:{file_path:'linked/secret.txt'}},{name:'grep',args:{pattern:'SENTINEL',path:outside}},{name:'glob',args:{pattern:'*',path:'linked'}});
  e=new DshEngine({...f.options,task:{id:'editor-boundary',folder:f.folder},readOnly:true,onEvent:event=>{if(event.type==='permission.asked')approvals++;}});
  await e.start();for(let i=0;i<4;i++)await e.send('GFOT_EXTERNAL_'+i);
  assert.equal(approvals,0);assert.ok(!JSON.stringify(f.requests).includes('EXTERNAL_SENTINEL_NOT_FOR_PROBES'));await e.stop();
  tools.push({name:'read',args:{file_path:join(outside,'secret.txt')}});
  e=new DshEngine({...f.options,task:{id:'probe-boundary',folder:f.folder},isolateWorkspace:true});await e.start();await e.send('GFOT_EXTERNAL_4');assert.ok(!JSON.stringify(f.requests).includes('EXTERNAL_SENTINEL_NOT_FOR_PROBES'));await e.stop();
  tools.push({name:'read',args:{file_path:join(outside,'secret.txt')}});
  e=new DshEngine({...f.options,task:{id:'external-deny',folder:f.folder},onEvent:event=>{if(event.type==='permission.asked'){approvals++;void e.permission(event.properties.id,'reject');}}});await e.start();await e.send('GFOT_EXTERNAL_5');assert.equal(approvals,1);assert.ok(!JSON.stringify(f.requests).includes('EXTERNAL_SENTINEL_NOT_FOR_PROBES'));await e.stop();
  tools.push({name:'read',args:{file_path:join(outside,'secret.txt')}});
  e=new DshEngine({...f.options,task:{id:'external-allow',folder:f.folder},onEvent:event=>{if(event.type==='permission.asked'){approvals++;void e.permission(event.properties.id,'once');}}});await e.start();await e.send('GFOT_EXTERNAL_6');assert.equal(approvals,2);assert.ok(JSON.stringify(f.requests.at(-1)).includes('EXTERNAL_SENTINEL_NOT_FOR_PROBES'));
 }finally{await e?.stop();await f.close();}
});

test('real dsh rejects declined writes, cancels a pending approval, and cannot mutate in a Harness2 editor',{timeout:90000},async()=>{
 const f=await fixture();let e;
 try{
  e=new DshEngine({...f.options,task:{id:'deny',folder:f.folder},onEvent:event=>{if(event.type==='permission.asked')void e.permission(event.properties.id,'reject');}});
  await e.start();await e.send('GFOT_WRITE');assert.equal(existsSync(join(f.folder,'result.txt')),false);await e.stop();
  let decision;
  e=new DshEngine({...f.options,task:{id:'cancel',folder:f.folder},onEvent:event=>{if(event.type==='permission.asked')decision=event.properties.id;}});
  await e.start();const running=e.send('GFOT_WRITE').catch(error=>error);for(let i=0;i<300&&!decision;i++)await sleep(20);
  assert.ok(decision);assert.equal(existsSync(join(f.folder,'result.txt')),false);assert.equal((await e.stop()).confirmed,true);assert.match((await running).message,/停止|退出/);assert.equal(existsSync(join(f.folder,'result.txt')),false);
  e=new DshEngine({...f.options,task:{id:'editor',folder:f.folder},readOnly:true});
  await e.start();await e.send('GFOT_WRITE');assert.equal(existsSync(join(f.folder,'result.txt')),false);
 }finally{await e?.stop();await f.close();}
});
