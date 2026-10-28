import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startDesktopServer} from '../backend.mjs';
import {DshEngine,defaultDshRoot} from '../dsh-engine.mjs';
import {responseSSE} from './helpers/account-fixture.mjs';

for(const protocol of ['responses','anthropic'])test('real dsh '+protocol+' uses imported OpenCode keys behind a relay and switches key/model in the same native session',{timeout:90000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-import-live-')),target=join(dir,'result.txt'),seen=[],engines=[];let service;
 const connectionFetch=async(url,options)=>{
  const body=JSON.parse(options.body);seen.push({url,key:options.headers.Authorization,body});
  assert.equal(options.redirect,'error');assert.equal(url,protocol==='anthropic'?'https://synthetic.example/v1/messages?beta=true':'https://synthetic.example/v1/responses');
  if(protocol==='anthropic'){
   seen.at(-1).key=options.headers['x-api-key'];
   const done=body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='tool_result'));
   const tool=body.tools?.find(t=>t.name==='write');return anthropicSSE(body.model,tool&&!done?{name:'write',args:{file_path:target,content:'imported credential relay verified'}}:null);
  }
  const tool=body.tools?.find(t=>t.name==='write'),done=body.input.some(t=>t.type==='function_call_output');
  return responseSSE({id:'import-'+seen.length,model:body.model,...(tool&&!done?{tool:{name:'write',args:{file_path:target,content:'imported credential relay verified'}}}:{text:'Imported account verified'})});
 };
 try{
  service=await startDesktopServer({dataDir:join(dir,'data'),key:randomBytes(32),dshRoot:defaultDshRoot,connectionFetch,dshFactory:options=>{engines.push(options);return new DshEngine(options);}});
  const call=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;};
  const add=async(provider,key,model)=>{
   const preview=await call('credentials/opencode/preview',{document:JSON.stringify({[provider]:{type:'api',key}})});
   const view=await call('credentials/opencode/import',{id:preview.id,provider,mode:'direct',protocol,label:provider,model,baseURL:'https://synthetic.example/v1',consent:true});return view.profiles.at(-1);
  };
  const one=await add('first','import-key-one','alpha'),two=await add('second','import-key-two','beta');
  const {taskId}=await call('tasks',{folder:dir,title:'Import relay',profileId:one.id});
  let approved=false;
  const wait=async()=>{for(let i=0;i<600;i++){
   const task=service.state.tasks[0];for(const pending of [...task.pending])if(pending.kind==='permission'){assert.equal(existsSync(target),false);approved=true;await call('tasks/'+taskId+'/permission',{id:pending.id,reply:'once'});}
   if(['idle','error'].includes(task.status)){assert.equal(task.status,'idle',task.error);return;}
   await new Promise(resolve=>setTimeout(resolve,50));
  }throw Error('real dsh timed out');};
  await call('tasks/'+taskId+'/prompt',{text:'Write result.txt and confirm.'});await wait();assert.equal(approved,true);assert.equal(readFileSync(target,'utf8'),'imported credential relay verified');
  const session=service.state.tasks[0].sessionId;await call('tasks/'+taskId+'/prompt',{text:'Continue with the second account.',profileId:two.id});await wait();assert.equal(service.state.tasks[0].sessionId,session);
  assert.equal(engines.length,2);for(const engine of engines){assert.match(engine.profile.baseURL,/^http:\/\/127\.0\.0\.1:/);assert.match(engine.key,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(engine.profile).includes('import-key'));}
  assert.ok(seen.some(r=>r.key===(protocol==='anthropic'?'import-key-one':'Bearer import-key-one')&&r.body.model==='alpha'));
  assert.ok(seen.some(r=>r.key===(protocol==='anthropic'?'import-key-two':'Bearer import-key-two')&&r.body.model==='beta'&&JSON.stringify(r.body.input||r.body.messages).includes('Write result.txt')));
  const publicView=JSON.stringify(await call('state')),disk=readFileSync(join(dir,'data/desktop.json'),'utf8');for(const key of ['import-key-one','import-key-two']){assert.ok(!publicView.includes(key));assert.ok(!disk.includes(key));}
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});

function anthropicSSE(model,tool){
 const events=[{type:'message_start',message:{id:'fixture-message',type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:'write-fixture',name:tool.name,input:{}}:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.args)}:{type:'text_delta',text:'Imported account verified'}},
  {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}},{type:'message_stop'}];
 return new Response(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
}
