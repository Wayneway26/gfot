import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {randomBytes} from 'node:crypto';import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {startDesktopServer} from '../backend.mjs';
const binary=resolve('node_modules/opencode-darwin-'+process.arch+'/bin/opencode');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real bundled OpenCode + synthetic local model: asks permission, writes a fixture and completes', {skip:!existsSync(binary),timeout:120000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-real-engine-')),target=join(dir,'hello.txt');let service,calls=0,permissionSeen=false;const key=randomBytes(32),models=[];
 const gateway=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'gfot-smoke'}]}));return;}
  const buffers=[];for await(const b of req)buffers.push(b);const body=JSON.parse(Buffer.concat(buffers).toString());calls++;models.push(body.model);
  const names=(body.tools||[]).map(t=>t.function?.name);const name=names.includes('write')?'write':names.includes('apply_patch')?'apply_patch':null;
  const hasTool=(body.messages||[]).some(m=>m.role==='tool');
  let delta,finish;
  if(!hasTool&&name){delta={role:'assistant',tool_calls:[{index:0,id:'call_gfot_fixture',type:'function',function:{name,arguments:JSON.stringify(name==='write'?{filePath:target,content:'gfot smoke ok\n'}:{patchText:'*** Begin Patch\n*** Add File: '+target+'\n+gfot smoke ok\n*** End Patch'})}}]};finish='tool_calls';}
  else{delta={role:'assistant',content:'gfot synthetic smoke completed. This is a local test model, not a real provider.'};finish='stop';}
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const chunk of [{...delta},{ }]){res.write('data: '+JSON.stringify({id:'chatcmpl-gfot',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'gfot-smoke',choices:[{index:0,delta:chunk,finish_reason:Object.keys(chunk).length?null:finish}]})+'\n\n');}
  res.end('data: [DONE]\n\n');
 });
 try{await new Promise(r=>gateway.listen(0,'127.0.0.1',r));service=await startDesktopServer({dataDir:join(dir,'appdata'),binary,key});
 const call=async(path,body)=>{const r=await fetch(service.url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
 const s=await call('profiles',{label:'Synthetic local test',baseURL:'http://127.0.0.1:'+gateway.address().port+'/v1',model:'gfot-smoke',apiKey:'fixture-key'});const {taskId}=await call('tasks',{title:'Synthetic smoke',folder:dir,profileId:s.profiles[0].id});await call('tasks/'+taskId+'/prompt',{text:'Write hello.txt in this folder, then report completion.'});
 for(let i=0;i<1000;i++){const t=service.state.tasks[0];for(const pending of [...t.pending]){if(pending.kind==='permission'){permissionSeen=true;await call('tasks/'+taskId+'/permission',{id:pending.id,reply:'once'});}}if(['idle','error','stopped'].includes(t.status)){if(t.status==='error')throw Error(t.error);break;}await sleep(100);}
 const task=service.state.tasks[0];assert.equal(task.status,'idle',JSON.stringify(task.events));assert.ok(calls>=2,'model must receive tool result');assert.ok(permissionSeen,'file write must ask permission');assert.equal(readFileSync(target,'utf8'),'gfot smoke ok\n');assert.match(task.messages.at(-1).text,/synthetic smoke/);
 const sessionId=task.sessionId,profile=service.state.profiles[0],previousCount=task.messages.length;
 await call('profiles',{id:profile.id,label:profile.label,baseURL:profile.baseURL,model:'gfot-next'});
 await service.close();service=await startDesktopServer({dataDir:join(dir,'appdata'),binary,key});
 assert.equal(service.state.tasks[0].sessionId,sessionId);
 await call('tasks/'+taskId+'/prompt',{text:'Continue the same conversation with the new model.'});
 for(let i=0;i<500;i++){if(['idle','error','stopped'].includes(service.state.tasks[0].status))break;await sleep(100);}
 const resumed=service.state.tasks[0];assert.equal(resumed.status,'idle',resumed.error);assert.equal(resumed.sessionId,sessionId);assert.ok(resumed.messages.length>previousCount);assert.ok(models.includes('gfot-next'),'switched model must reach gateway');

 }finally{await service?.close();await new Promise(r=>gateway.close(r));rmSync(dir,{recursive:true,force:true});}
});
