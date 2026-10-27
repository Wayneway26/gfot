import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {jwtPayload} from '../chatgpt-oauth.mjs';
import {defaultDshRoot} from '../dsh-engine.mjs';
import {startDesktopServer} from '../backend.mjs';import {codexDocument,token,responseSSE} from './helpers/account-fixture.mjs';
const binary=resolve('node_modules/opencode-darwin-'+process.arch+'/bin/opencode');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const runtime of ['OpenCode','dsh'])for(const source of ['local','managed'])test('real '+runtime+' '+source+' credential proxy: edit approval and same-session account switch',{skip:!existsSync(binary),timeout:120000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-account-execution-')),target=join(dir,'account.txt'),observed=[];let service,permissionSeen=false;const pendingNonces=new Map();const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig'};
 const accountFetch=async(url,options)=>{
  if(url.includes('openid-configuration'))return new Response(JSON.stringify({jwks_uri:'https://auth.openai.com/jwks'}));
  if(url==='https://auth.openai.com/jwks')return new Response(JSON.stringify({keys:[jwk]}));
  if(url.endsWith('/oauth/token')){
   const clientId=new URLSearchParams(options.body).get('client_id'),sub=clientId.replace('issued-','');
   const content=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:clientId,sub,nonce:pendingNonces.get(clientId),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
   return new Response(JSON.stringify({access_token:token({sub}),refresh_token:'own-refresh-'+sub,id_token:content+'.'+sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url'),expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'}));
  }
  assert.ok(url.startsWith(source==='local'?'https://chatgpt.com/backend-api/codex/':'https://api.openai.com/v1/'));
  if(url.includes('/models'))return new Response(JSON.stringify({models:[{slug:'fixture-codex',visibility:'list'}]}));
  const body=JSON.parse(options.body);observed.push({body,authorization:options.headers.authorization,accountId:options.headers['ChatGPT-Account-Id']||jwtPayload(options.headers.authorization.slice(7)).sub});assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.max_output_tokens,undefined);
  const name=(body.tools||[]).flatMap(t=>t.type==='namespace'?t.tools:[t]).map(t=>t.name).find(n=>['write','apply_patch'].includes(n));
  const toolDone=body.input.some(item=>item.type==='function_call_output');
  return responseSSE({id:'resp_fixture_'+observed.length,model:body.model,...(!toolDone&&name?{tool:{name,args:name==='write'?{[runtime==='dsh'?'file_path':'filePath']:target,content:'account proxy ok\n'}:{patchText:'*** Begin Patch\n*** Add File: '+target+'\n+account proxy ok\n*** End Patch'}}}:{text:'Synthetic account execution completed.'})});
 };
 try{service=await startDesktopServer({dataDir:join(dir,'appdata'),key:randomBytes(32),binary,...(runtime==='dsh'?{dshRoot:defaultDshRoot}:{}),accountFetch});
  const call=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
  const addAccount=async id=>{
   if(source==='local')return (await call('accounts/import',{document:codexDocument(id),label:'Synthetic account '+id})).accountId;
   const started=await call('accounts/login/start',{}),url=new URL(started.authorizationURL),clientId='issued-'+id;pendingNonces.set(clientId,url.searchParams.get('nonce'));
   const callback=new URL(url.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:url.searchParams.get('state'),client_id:clientId,code:'fixture'}).toString();await fetch(callback);
   for(let i=0;i<100;i++){const status=await call('accounts/login/status',{id:started.id});if(status.status==='complete')return status.accountId;if(status.status==='error')throw Error(status.error);await sleep(20);}throw Error('Fixture OAuth timed out');
  };
  const a=await addAccount('one'),b=await addAccount('two');
  const p=(await call('profiles',{mode:'account',accountId:a,label:'Account one',model:'fixture-codex'})).profiles[0];
  const q=(await call('profiles',{mode:'account',accountId:b,label:'Account two',model:'fixture-codex'})).profiles[1];
  const {taskId}=await call('tasks',{title:'Synthetic account proxy',folder:dir,profileId:p.id});
  const wait=async()=>{for(let i=0;i<900;i++){const task=service.state.tasks[0];for(const pending of [...task.pending]){if(pending.kind==='permission'){permissionSeen=true;await call('tasks/'+taskId+'/permission',{id:pending.id,reply:'once'});}}if(['idle','error','stopped'].includes(task.status)){assert.equal(task.status,'idle',task.error);return;}await sleep(100);}throw Error('Execution timed out');};
  await call('tasks/'+taskId+'/prompt',{text:'Write account.txt and acknowledge completion.'});await wait();assert.ok(permissionSeen);assert.equal(readFileSync(target,'utf8'),'account proxy ok\n');
  const session=service.state.tasks[0].sessionId;await call('tasks/'+taskId+'/prompt',{text:'Continue the previous task using the second account.',profileId:q.id});await wait();assert.equal(service.state.tasks[0].sessionId,session);
  assert.ok(observed.some(r=>r.accountId==='one'&&jwtPayload(r.authorization.slice(7)).sub==='one'));assert.ok(observed.some(r=>r.accountId==='two'));
  assert.ok(observed.some(r=>r.accountId==='two'&&JSON.stringify(r.body.input).includes('Write account.txt')),'second account receives prior task context');assert.ok(service.state.tasks[0].messages.length>=4);assert.match(service.state.tasks[0].messages.at(-1).text,/Synthetic account/);
  const view=await call('state');assert.ok(!JSON.stringify(view).includes('fixture-signature'));assert.ok(!readFileSync(join(dir,'appdata/desktop.json'),'utf8').includes('fixture-signature'));
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});
