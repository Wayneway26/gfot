import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCredentialImports,parseOpenCodeCredentials} from '../credential-import.mjs';
import {startDesktopServer} from '../backend.mjs';

const document=JSON.stringify({deepseek:{type:'api',key:'synthetic-import-key'},openai:{type:'oauth',access:'never-copy',refresh:'never-refresh'},command:{type:'wellknown',token:'never-run'}});
test('OpenCode preview hides secrets, rejects OAuth as API keys, and expires or consumes tickets',()=>{
 let time=0;const imports=createCredentialImports({now:()=>time}),preview=imports.preview(document);
 assert.ok(!JSON.stringify(preview).includes('synthetic-import-key'));assert.ok(!JSON.stringify(preview).includes('never-copy'));
 assert.equal(imports.key(preview.id,'deepseek'),'synthetic-import-key');assert.throws(()=>imports.key(preview.id,'openai'),/不能/);
 imports.discard(preview.id);assert.throws(()=>imports.key(preview.id,'deepseek'),/过期/);
 const next=imports.preview(document);time=300001;assert.throws(()=>imports.key(next.id,'deepseek'),/过期/);
 for(const value of ['null','[]','{','x'.repeat(90001)])assert.throws(()=>parseOpenCodeCredentials(value));imports.close();
});

test('credential API requires desktop-selected preview and endpoint consent, seals only chosen key and makes no provider requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-import-'));let service,calls=0;
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),connectionFetch:async()=>{calls++;throw Error('must not call');}});
  const call=async(route,body,cookie=false)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'gfot='+service.auth}:{authorization:'Bearer '+service.auth})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  assert.equal((await call('credentials/opencode/preview',{document},true)).status,403);
  const preview=(await call('credentials/opencode/preview',{document})).data;
  const input={id:preview.id,provider:'deepseek',label:'Imported',model:'fixture',mode:'direct',baseURL:'https://models.example/v1',protocol:'chat'};
  assert.equal((await call('credentials/opencode/import',input)).status,400);
  assert.equal((await call('credentials/opencode/import',{...input,consent:true,baseURL:'http://evil.example/v1'})).status,400);
  assert.equal((await call('credentials/opencode/import',{...input,consent:true,provider:'openai'})).status,400);
  const saved=await call('credentials/opencode/import',{...input,consent:true},true);assert.equal(saved.status,200);assert.deepEqual(saved.data.profiles[0].credentialSource,{agent:'opencode',provider:'deepseek'});
  assert.ok(!JSON.stringify(saved).includes('synthetic-import-key'));const disk=readFileSync(join(dir,'desktop.json'),'utf8');for(const secret of ['synthetic-import-key','never-copy','never-refresh'])assert.ok(!disk.includes(secret));
  assert.equal((await call('credentials/opencode/import',{...input,consent:true})).status,400);assert.equal(calls,0);
  assert.equal(saved.data.modelSources.find(s=>s.id==='qoder').modelAccess,'unverified');assert.equal(saved.data.modelSources.find(s=>s.id==='workbuddy').modelAccess,'unverified');
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});
