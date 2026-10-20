import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profileInput,vault} from '../state.mjs';
import {listModels,verifyConnection} from '../connections.mjs';
import {startDesktopServer} from '../backend.mjs';
const profile={mode:'direct',label:'Example',baseURL:'https://models.example/v1',model:'fixture'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('HTTPS direct profiles keep encrypted keys and require explicit secure mode',()=>{
 const box=vault(randomBytes(32)),input={...profile,apiKey:'private-api-key'};
 const p=profileInput(input,null,box.seal);assert.equal(box.open(p.secret),'private-api-key');
 for(const bad of [{mode:'local'}, {baseURL:'http://models.example/v1'}, {baseURL:'https://user:password@models.example/v1'}, {baseURL:'https://models.example/v1?key=secret'}, {apiKey:''}])assert.throws(()=>profileInput({...input,...bad},null,box.seal));
 assert.throws(()=>profileInput({...input,baseURL:'https://other.example/v1',apiKey:''},p,box.seal));
 const changed=profileInput({...input,baseURL:'https://other.example/v1',clearKey:true,apiKey:'replacement'},p,box.seal);assert.equal(box.open(changed.secret),'replacement');
 p.verification={at:'fixture',toolCalling:true};assert.deepEqual(profileInput({...input,apiKey:'',label:'renamed'},p,box.seal).verification,p.verification);assert.equal(profileInput({...input,apiKey:'',model:'different'},p,box.seal).verification,undefined);
});

test('discovery uses selected endpoint and key, caps responses, and rejects redirects/errors without reflecting provider data',async()=>{
 const result=await listModels(profile,'secret',async(url,options)=>{assert.equal(url,'https://models.example/v1/models');assert.equal(options.headers.Authorization,'Bearer secret');assert.equal(options.redirect,'error');return json({data:[{id:'fixture'},{id:'fixture'},{id:'other'},null]});});assert.deepEqual(result.models,['fixture','other']);assert.equal(result.modelListed,true);
 await assert.rejects(listModels(profile,'secret',async()=>json({error:'secret reflected by server'},401)),error=>error.status===401&&!error.message.includes('secret'));
 await assert.rejects(listModels(profile,'secret',async()=>new Response('x'.repeat(1024*1024+1))),/大小限制/);
 await assert.rejects(listModels(profile,'secret',async()=>new Response('<html>not API</html>')),/JSON/);
});

test('verification proves two-way tool protocol with fixed messages and no file execution',async()=>{
 const calls=[];
 const result=await verifyConnection(profile,'secret',async(url,options)=>{calls.push(JSON.parse(options.body));assert.equal(url,profile.baseURL+'/chat/completions');
  return calls.length===1?json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'probe-1',type:'function',function:{name:'gfot_connection_probe',arguments:'{"ok":true}'}}]}}]}):json({choices:[{message:{role:'assistant',content:'Diagnostic completed'}}]});
 });assert.equal(result.toolCalling,true);assert.equal(result.inference,true);assert.equal(calls.length,2);assert.ok(calls[1].messages.some(m=>m.role==='tool'&&m.tool_call_id==='probe-1'));assert.ok(!JSON.stringify(calls).includes('/Users/'));assert.equal(calls[0].tools[0].function.name,'gfot_connection_probe');
 const unsupported=await verifyConnection(profile,'secret',async()=>json({choices:[{message:{role:'assistant',content:'hello'}}]}));assert.equal(unsupported.inference,true);assert.equal(unsupported.toolCalling,false);
});

test('desktop API requires consent for paid diagnostic and never persists unsaved discovery keys',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-connect-api-'));let service,calls=0;
 const connectionFetch=async(url,options)=>{calls++;if(url.endsWith('/models'))return json({data:[{id:'fixture'}]});const body=JSON.parse(options.body);return body.tools?json({choices:[{message:{role:'assistant',tool_calls:[{id:'p',type:'function',function:{name:'gfot_connection_probe',arguments:'{"ok":true}'}}]}}]}):json({choices:[{message:{role:'assistant',content:'ok'}}]});};
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),connectionFetch});const call=async(route,body)=>{const response=await fetch(service.url+'/api/'+route,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  let r=await call('connections/models',{...profile,model:'',apiKey:'unsaved-private-key'});assert.equal(r.status,200);assert.equal(calls,1);assert.ok(!readFileSync(join(dir,'desktop.json'),'utf8').includes('unsaved-private-key'));assert.equal(service.state.profiles.length,0);
  const saved=await call('profiles',{...profile,apiKey:'saved-private-key'});const id=saved.data.profiles[0].id;assert.ok(!JSON.stringify(saved).includes('saved-private-key'));
  r=await call('profiles/verify',{id});assert.equal(r.status,400);assert.equal(calls,1);
  r=await call('profiles/verify',{id,consent:true});assert.equal(r.status,200);assert.equal(r.data.toolCalling,true);assert.equal(calls,3);assert.equal(service.state.profiles[0].verification.toolCalling,true);
  assert.ok(!readFileSync(join(dir,'desktop.json'),'utf8').includes('saved-private-key'));
  await call('profiles',{...profile,id,model:'changed-model'});assert.equal(service.state.profiles[0].verification,undefined);
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('editing during a diagnostic never sends the old key to the new endpoint',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-diagnostic-race-'));let service,release,started;
 const began=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve),requests=[];
 const connectionFetch=async(url,options)=>{requests.push({url,key:options.headers.Authorization});
  if(requests.length===1){started();await pending;return json({choices:[{message:{role:'assistant',tool_calls:[{id:'p',type:'function',function:{name:'gfot_connection_probe',arguments:'{"ok":true}'}}]}}]});}
  return json({choices:[{message:{role:'assistant',content:'ok'}}]});
 };
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),connectionFetch});const call=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const saved=await call('profiles',{...profile,apiKey:'old-private-key'}),id=saved.data.profiles[0].id;
  const diagnostic=call('profiles/verify',{id,consent:true});await began;
  await call('profiles',{...profile,id,baseURL:'https://new-service.example/v1',apiKey:'new-private-key'});release();
  assert.equal((await diagnostic).status,400);assert.equal(requests.length,2);
  assert.ok(requests.every(r=>r.url==='https://models.example/v1/chat/completions'&&r.key==='Bearer old-private-key'));
  assert.equal(service.state.profiles[0].baseURL,'https://new-service.example/v1');assert.equal(service.state.profiles[0].verification,undefined);
 }finally{release?.();await service?.close();rmSync(dir,{recursive:true,force:true});}
});
test('Anthropic discovery uses native key and version headers',async()=>{
 const result=await listModels({...profile,protocol:'anthropic'},'anthropic-secret',async(_url,options)=>{assert.equal(options.headers['x-api-key'],'anthropic-secret');assert.equal(options.headers['anthropic-version'],'2023-06-01');assert.equal(options.headers.Authorization,undefined);return json({data:[{id:'fixture'}]});});assert.equal(result.modelListed,true);
});
