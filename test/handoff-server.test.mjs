import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function start(dir){
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',AGENTSUMMARY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('startup timeout'));},5000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.stderr.on('data',b=>error+=b);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',()=>{clearTimeout(timer);reject(Error(error||'server exited'));});});return {child,url};
}
const stop=child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{child.once('exit',resolve);child.kill();});
const cp={version:'v1',summary:'front end ready',artifact:'diff and dirty file list',evidence:'cookie decision',tests:'not run',issues:'backend pending',next:'finish backend'};
test('HTTP + real stdio: two-way handoff, checkpoint persistence, stale worker rejection and no automatic acceptance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'handoff-api-'));let service;
 try{
  service=await start(dir);
  const user=async(path,body)=>{const r=await fetch(service.url+'/api/projects'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const bridge=async(name,args={})=>{const r=await fetch(service.url+'/api/bridge',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+readFileSync(join(dir,'bridge-token'),'utf8')},body:JSON.stringify({name,arguments:args})});return {status:r.status,data:await r.json()};};
  const p=(await user('',{title:'Synthetic continuation',goal:'login',repo:'/synthetic/repo',baseline:'base',scope:'login',criteria:'validates',implementer:'Codex',reviewer:'independent'})).data;
  assert.deepEqual((await bridge('list_handoffs')).data.handoffs,[]);
  assert.equal((await user('/'+p.id,{action:'handoff_publish',target:'WorkBuddy',reason:'quota',consent:false,stopped:true,expectedGeneration:0,expectedRevision:1,expectedCycle:1,previousHandoffId:null,expectedSequence:0,checkpoint:cp})).status,400);
  const offered=(await user('/'+p.id,{action:'handoff_publish',target:'WorkBuddy',reason:'quota',consent:true,stopped:true,expectedGeneration:0,expectedRevision:1,expectedCycle:1,previousHandoffId:null,expectedSequence:0,checkpoint:cp})).data;
  const h=offered.handoffs.at(-1);assert.equal(h.status,'offered');
  assert.equal((await user('/'+p.id,{action:'dispatch'})).status,400);
  const claimArgs={handoffId:h.id,agent:'WorkBuddy',observedRepo:p.repo,observedVersion:'v1'};
  assert.equal((await bridge('claim_handoff',{...claimArgs,observedVersion:'wrong'})).status,400);
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_handoff',arguments:{handoffId:h.id}}},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'claim_handoff',arguments:claimArgs}}];
  const result=spawnSync(process.execPath,['scripts/workbuddy-mcp.mjs','--url',service.url,'--token-file',join(dir,'bridge-token')],{input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);
  const replies=result.stdout.trim().split('\n').map(s=>JSON.parse(s));assert.ok(!replies[2].result.isError);const claim=JSON.parse(replies[2].result.content[0].text);
  assert.ok(!JSON.stringify((await user('/'+p.id)).data).includes(claim.claimToken));
  const save={handoffId:h.id,claimToken:claim.claimToken,expectedSequence:0,checkpoint:{...cp,version:'v2'}};
  assert.equal((await bridge('save_checkpoint',save)).status,200);assert.equal((await bridge('save_checkpoint',save)).status,400);
  await stop(service.child);service=await start(dir);
  const restored=(await user('/'+p.id)).data;assert.equal(restored.handoffs.at(-1).latestCheckpoint.version,'v2');
  const back=(await user('/'+p.id,{action:'handoff_publish',target:'Codex',reason:'switch back',consent:true,stopped:true,expectedGeneration:1,expectedRevision:1,expectedCycle:1,previousHandoffId:h.id,expectedSequence:1,checkpoint:{...cp,version:'v2'}})).data;
  assert.equal((await bridge('complete_handoff',{...save,expectedSequence:1})).status,400);
  const b=back.handoffs.at(-1);assert.equal((await user('/'+p.id,{action:'handoff_claim',handoffId:b.id,agent:'Codex',observedRepo:p.repo,observedVersion:'v2'})).status,200);
  const completed=(await user('/'+p.id,{action:'result',...cp,version:'v3'})).data;
  assert.equal(completed.stage,'review');assert.equal(completed.status,'ready');assert.equal(completed.acceptance,undefined);assert.equal(completed.reviews.length,0);assert.equal(completed.handoffs.at(-1).status,'obsolete');
  assert.equal((await bridge('get_handoff',{handoffId:b.id})).status,400);
 }finally{if(service)await stop(service.child);rmSync(dir,{recursive:true,force:true});}
});
