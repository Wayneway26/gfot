import test from 'node:test';
import assert from 'node:assert/strict';
import {startModelProxy} from '../model-proxy.mjs';

for(const protocol of ['chat','responses','anthropic'])test('model relay '+protocol+' preserves JSON, SSE and tool payloads with host-owned credentials',async()=>{
 const seen=[],events='data: {"tool_call":{"arguments":"{}"}}\n\ndata: [DONE]\n\n';
 const proxy=await startModelProxy({fetchImpl:async(url,options)=>{seen.push({url,...options});return new Response(events,{headers:{'content-type':'text/event-stream','set-cookie':'must-not-forward=secret'}});}});
 const profile={protocol,model:'fixture',baseURL:'https://models.example/v1'},grant=proxy.grant(profile,'upstream-secret');
 try{
  const path={chat:'/chat/completions',responses:'/responses',anthropic:'/messages'}[protocol];
  const headers={'content-type':'application/json',...(protocol==='anthropic'?{'x-api-key':grant.key}:{authorization:'Bearer '+grant.key}),cookie:'must-not-forward=local','anthropic-beta':'fine-grained-tool-streaming-2025-05-14'};
  const body={model:'fixture',stream:true,messages:[{role:'user',content:'fixture'}],tools:[{name:'test'}]};
  const response=await fetch(grant.baseURL+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(response.status,200);assert.equal(await response.text(),events);assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(seen[0].url,profile.baseURL+path);assert.deepEqual(JSON.parse(seen[0].body),body);assert.equal(seen[0].redirect,'error');
  assert.equal(seen[0].headers.cookie,undefined);assert.equal(seen[0].headers['anthropic-beta'],protocol==='anthropic'?'fine-grained-tool-streaming-2025-05-14':undefined);
  assert.equal(seen[0].headers[protocol==='anthropic'?'x-api-key':'Authorization'],protocol==='anthropic'?'upstream-secret':'Bearer upstream-secret');
  assert.notEqual(grant.key,'upstream-secret');
 }finally{grant.revoke();await proxy.close();}
});

test('model relay rejects missing auth, browser origins, wrong protocol/model, oversized payloads and revoked grants before upstream',async()=>{
 let calls=0;const proxy=await startModelProxy({fetchImpl:async()=>{calls++;throw Error('must not call');}}),grant=proxy.grant({model:'fixed',baseURL:'https://example.test/v1'},'secret');
 const call=(body,extra={},path='/chat/completions',key=grant.key)=>fetch(grant.baseURL+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,...extra},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  assert.equal((await call({model:'fixed'},{},undefined,'wrong')).status,401);
  assert.equal((await call({model:'fixed'},{origin:'https://evil.example'})).status,403);
  assert.equal((await call({model:'fixed'},{},'/responses')).status,404);
  assert.equal((await call({model:'other'})).status,400);
  assert.equal((await call('{')).status,400);
  assert.equal((await call({model:'fixed',messages:'x'.repeat(2*1024*1024)})).status,413);
  grant.revoke();assert.equal((await call({model:'fixed'})).status,401);assert.equal(calls,0);
 }finally{await proxy.close();}
});

test('upstream quota and auth errors are sanitized and never retried',async()=>{
 let calls=0;const proxy=await startModelProxy({fetchImpl:async()=>new Response('reflected-secret',{status:++calls===1?429:401})});const grant=proxy.grant({model:'fixed',baseURL:'https://example.test/v1'},'secret');
 try{for(const status of [429,401]){const response=await fetch(grant.baseURL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+grant.key},body:'{"model":"fixed"}'});assert.equal(response.status,status);assert.ok(!(await response.text()).includes('reflected-secret'));}assert.equal(calls,2);}finally{await proxy.close();}
});

test('revocation aborts an in-flight request without releasing a late response',async()=>{
 let started,signal;const began=new Promise(resolve=>started=resolve);
 const proxy=await startModelProxy({fetchImpl:async(_url,options)=>{signal=options.signal;started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),grant=proxy.grant({model:'fixed',baseURL:'https://example.test/v1'},'secret');
 try{const pending=fetch(grant.baseURL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+grant.key},body:'{"model":"fixed"}'}).then(r=>r.text()).catch(()=>null);await began;grant.revoke();assert.equal(signal.aborted,true);assert.equal(await pending,null);}finally{await proxy.close();}
});

test('Anthropic relay normalizes upstream roots and preserves the native SDK beta query and header',async()=>{
 const requests=[],proxy=await startModelProxy({fetchImpl:async(url,options)=>{requests.push({url,headers:options.headers});return new Response('data: {}\n\n',{headers:{'content-type':'text/event-stream'}});}});
 try{for(const baseURL of ['https://anthropic.example','https://anthropic.example/v1']){
  const grant=proxy.grant({protocol:'anthropic',model:'fixture',baseURL},'synthetic-key');
  const request=(suffix,features='fine-grained-tool-streaming-2025-05-14')=>fetch(grant.baseURL+'/messages'+suffix,{method:'POST',headers:{'content-type':'application/json','x-api-key':grant.key,'anthropic-beta':features},body:'{"model":"fixture","stream":true}'});
  const response=await request('?beta=true');assert.equal(response.status,200);await response.text();
  assert.equal(requests.at(-1).url,'https://anthropic.example/v1/messages?beta=true');assert.equal(requests.at(-1).headers['anthropic-beta'],'fine-grained-tool-streaming-2025-05-14');
  assert.equal((await request('?token=must-not-forward')).status,404);assert.equal((await request('?beta=true','bad feature')).status,400);grant.revoke();
 }assert.equal(requests.length,2);}finally{await proxy.close();}
});
