import test from 'node:test';import assert from 'node:assert/strict';import {startAccountProxy,prepareSubscriptionRequest,verifyResponses} from '../account-proxy.mjs';import {responseSSE} from './helpers/account-fixture.mjs';

test('managed subscription requests use namespaces, complete history, no storage and supported fields',()=>{
 const original={model:'m',input:[{type:'message',role:'system',content:'instruction'},{type:'function_call',call_id:'call',name:'read',arguments:'{}'}],tools:[{type:'function',name:'read',parameters:{type:'object'}}],max_output_tokens:100,previous_response_id:'old',temperature:1,store:true,stream:false};
 const result=prepareSubscriptionRequest(original,{model:'m'});assert.equal(result.input[0].role,'developer');assert.equal(result.input[1].namespace,'gfot');assert.equal(result.tools[0].type,'namespace');assert.equal(result.tools[0].tools[0].name,'read');assert.equal(result.store,false);assert.equal(result.stream,true);assert.equal(result.previous_response_id,undefined);assert.equal(result.max_output_tokens,undefined);assert.equal(original.store,true);
 assert.throws(()=>prepareSubscriptionRequest(original,{model:'other'}),/不匹配/);assert.throws(()=>prepareSubscriptionRequest({...original,tools:[{type:'tool_search'}]},{model:'m'}),/只支持/);
});
test('proxy binds a temporary token to one account/model and rejects unauthenticated requests',async()=>{
 const calls=[],a={id:'account',source:'chatgpt'};let marked=0;
 const accounts={find:id=>{assert.equal(id,'account');return a;},access:async()=>({accessToken:'upstream-secret'}),headers:(_a,c)=>({authorization:'Bearer '+c.accessToken}),endpoint:()=> 'https://api.openai.com/v1',markInference(){marked++;}};
 const proxy=await startAccountProxy({accounts,fetchImpl:async(url,options)=>{calls.push({url,options});return responseSSE({model:'m'});}});
 try{const grant=proxy.grant('account','m');const request=(key,body)=>fetch(grant.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request('wrong',{model:'m',input:[]})).status,401);assert.equal(calls.length,0);
  assert.equal((await request(grant.key,{model:'other',input:[]})).status,400);assert.equal(calls.length,0);
  const response=await request(grant.key,{model:'m',input:[{role:'user',content:'fixture'}]});const text=await response.text();assert.equal(response.status,200);assert.match(text,/response.completed/);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].options.headers.authorization,'Bearer upstream-secret');assert.equal(marked,1);
  grant.revoke();assert.equal((await request(grant.key,{model:'m',input:[]})).status,401);
 }finally{await proxy.close();}
});
test('quota failures remain explicit and never switch or replay through another account',async()=>{
 let count=0;const a={id:'account',source:'codex-local'},accounts={find:()=>a,access:async()=>({}),headers:()=>({}),endpoint:()=> 'https://chatgpt.com/backend-api/codex',markInference(){throw Error('must not mark success');}};
 const proxy=await startAccountProxy({accounts,fetchImpl:async()=>{count++;return new Response('private raw error',{status:429});}});
 try{const g=proxy.grant('account','m'),r=await fetch(g.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+g.key,'content-type':'application/json'},body:JSON.stringify({model:'m',input:[]})});assert.equal(r.status,429);const text=await r.text();assert.match(text,/额度不足/);assert.ok(!text.includes('private raw error'));assert.equal(count,1);}finally{await proxy.close();}
});
test('Responses diagnostic requires completion and verifies tool result round trip',async()=>{
 let calls=0;const result=await verifyResponses({baseURL:'https://example.test/v1',model:'m'},'key',async(_url,options)=>{calls++;const body=JSON.parse(options.body);return calls===1?responseSSE({model:'m',tool:{name:'gfot_connection_probe',args:{ok:true}}}):(assert.ok(body.input.some(p=>p.type==='function_call_output')),responseSSE({model:'m'}));});assert.equal(result.toolCalling,true);assert.equal(calls,2);
 await assert.rejects(verifyResponses({baseURL:'https://example.test',model:'m'},'key',async()=>new Response('data: {"type":"response.output_text.delta","delta":"not finished"}\n\n',{headers:{'content-type':'text/event-stream'}})),/完成事件/);
});
test('revoking a grant while its request body is uploading prevents upstream execution',async()=>{
 const {request}=await import('node:http');let calls=0;const a={id:'a',source:'codex-local'},accounts={find:()=>a,access:async()=>({}),headers:()=>({}),endpoint:()=> 'https://chatgpt.com/backend-api/codex',markInference(){}};
 const proxy=await startAccountProxy({accounts,fetchImpl:async()=>{calls++;return responseSSE();}});
 try{const g=proxy.grant('a','m'),body=JSON.stringify({model:'m',input:[]});let client;const ended=new Promise(resolve=>{client=request(g.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+g.key,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',resolve);});client.on('error',resolve);client.write(body.slice(0,8));});
  await new Promise(r=>setTimeout(r,50));g.revoke();client.end(body.slice(8));await ended;assert.equal(calls,0);
 }finally{await proxy.close();}
});

test('missing Content-Type accepts valid completion events but never validates arbitrary bytes',async()=>{
 let marked=0,valid=true;const a={id:'a',source:'codex-local'},accounts={find:()=>a,access:async()=>({}),headers:()=>({}),endpoint:()=> 'https://chatgpt.com/backend-api/codex',markInference(){marked++;}};
 const proxy=await startAccountProxy({accounts,fetchImpl:async()=>new Response(new TextEncoder().encode(valid?(await responseSSE({model:'m'}).text()):'not an event stream'),{headers:{}})});
 try{const g=proxy.grant('a','m');const call=()=>fetch(g.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+g.key,'content-type':'application/json'},body:JSON.stringify({model:'m',input:[]})});
  const ok=await call();assert.match(await ok.text(),/response.completed/);assert.equal(marked,1);
  valid=false;const bad=await call();assert.match(await bad.text(),/gfot_incomplete_stream/);assert.equal(marked,1);
 }finally{await proxy.close();}
});
