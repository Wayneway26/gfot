import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const input = { title: 'HTTP integration fixture', goal: 'reject invalid input', repo: '/test/repo', baseline: 'abc', scope: 'login', criteria: 'tests pass', implementer: 'A', reviewer: 'B' };
async function start(dir) {
 const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', GFOT_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
 const url = await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => { child.kill(); reject(Error('server startup timed out')); }, 5000); child.stdout.on('data', chunk => { output += chunk; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', code => { clearTimeout(timer); reject(Error(`server exited ${code}`)); }); });
 return { child, url };
}
async function stop(child) { if (child.exitCode !== null) return; await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); }
test('HTTP validation, persistence across restart, exports and cross-origin isolation', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'gfot-test-')); let service;
 try {
  service = await start(dir);
  const html=await (await fetch(service.url+'/')).text();
  assert.match(html, /<title>gfot<\/title>/);
  assert.match(html, /aria-label="gfot 首页"/);
  const request = (path, body) => fetch(service.url + '/api/projects' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  assert.equal((await request('', {})).status, 400);
  let response = await request('', input); assert.equal(response.status, 200); const p = await response.json();
  assert.equal((await request('/' + p.id, { action: 'accept', note: 'premature' })).status, 400);
  assert.equal((await request('/' + p.id)).status, 200);
  assert.match((await (await request('/' + p.id + '/pack')).json()).text, /reject invalid input/);
  assert.equal((await request('/' + p.id + '/delivery')).status, 400);
  const badOrigin = await fetch(service.url + '/api/projects', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(badOrigin.status, 403);
  const badHost = await new Promise((resolve, reject) => { http.get(service.url + '/api/projects', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); }); assert.equal(badHost, 403);
  await stop(service.child); service = await start(dir);
  const restored = await (await request('/' + p.id)).json(); assert.equal(restored.title, input.title); assert.equal(restored.history.length, 1);
  await request('/' + p.id, { action: 'dispatch' });
  assert.equal((await request('/' + p.id, { action: 'result', summary: 'missing materials' })).status, 400);
  const unchanged = await (await request('/' + p.id)).json(); assert.equal(unchanged.status, 'running'); assert.equal(unchanged.runs.length, 0);
  assert.equal((await fetch(service.url + '/../../domain.mjs')).status, 404);
  for (const path of ['/review-policy.js', '/review-export.js']) assert.equal((await fetch(service.url + path)).status, 200);
  await request('/' + p.id, { action: 'result', summary: 'fixed', artifact: 'actual diff', version: 'bundle-v1', evidence: 'log', tests: 'passed', issues: 'none', next: 'review' });
  const bundleEndpoint = '/' + p.id + '/review-bundle';
  assert.equal((await request(bundleEndpoint, { files: [{ path: 'data/projects.json', content: 'FORBIDDEN' }], confirmVersion: 'bundle-v1' })).status, 400);
  assert.equal((await request(bundleEndpoint, { files: [{ path: 'server.mjs', content: 'hello' }] })).status, 400);
  const bundleResponse = await request(bundleEndpoint, { files: [{ path: 'server.mjs', content: 'selected source' }], confirmVersion: 'bundle-v1' });
  assert.equal(bundleResponse.status, 200);
  const bundle = await bundleResponse.json();
  assert.deepEqual(bundle.manifest.map(f => f.path), ['server.mjs']);
  assert.ok(bundle.text.includes('selected source'));
  const afterExport = await (await request('/' + p.id)).json();
  assert.equal(afterExport.stage, 'review'); assert.equal(afterExport.status, 'ready');
  assert.ok(!JSON.stringify(afterExport).includes('selected source'));
  await stop(service.child); service = await start(dir);
  const afterRestart = await (await request('/' + p.id)).json();
  assert.ok(!JSON.stringify(afterRestart).includes('selected source'));
 } finally { if (service) await stop(service.child); rmSync(dir, { recursive: true, force: true }); }
});

test('UTF-8 characters split across request chunks survive saving and handoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gfot-utf8-'));
  let service;
  try {
    service = await start(dir);
    const title = '修复中文标题与 emoji 🧪';
    const payload = Buffer.from(JSON.stringify({ ...input, title }));
    // Split inside both a three-byte Chinese character and a four-byte emoji.
    const chineseSplit = payload.indexOf(Buffer.from('修')) + 1;
    const emojiSplit = payload.indexOf(Buffer.from('🧪')) + 2;
    const response = await new Promise((resolve, reject) => {
      const request = http.request(service.url + '/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, result => {
        const chunks = [];
        result.on('data', chunk => chunks.push(chunk));
        result.on('error', reject);
        result.on('end', () => resolve({ status: result.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      request.on('error', reject);
      request.flushHeaders();
      request.write(payload.subarray(0, chineseSplit));
      // Separate network writes so the server receives partial UTF-8 sequences.
      setTimeout(() => {
        request.write(payload.subarray(chineseSplit, emojiSplit));
        setTimeout(() => request.end(payload.subarray(emojiSplit)), 30);
      }, 30);
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.title, title);
    await stop(service.child);
    service = await start(dir);
    const restored = await (await fetch(service.url + '/api/projects/' + response.data.id)).json();
    assert.equal(restored.title, title);
    const pack = await (await fetch(service.url + '/api/projects/' + response.data.id + '/pack')).json();
    assert.ok(pack.text.includes(title));
  } finally {
    if (service) await stop(service.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkBuddy authenticated API and real stdio MCP roundtrip survive restart', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-bridge-'));let service;
 try{
  service=await start(dir);
  let token=readFileSync(join(dir,'bridge-token'),'utf8');
  const user=async(path,body)=>{const r=await fetch(service.url+'/api/projects'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const bridge=async(name,args={},auth=token)=>{const r=await fetch(service.url+'/api/bridge',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth},body:JSON.stringify({name,arguments:args})});return {status:r.status,data:await r.json()};};
  assert.equal((await bridge('list_review_jobs',{},'wrong')).status,401);
  const p=(await user('',input)).data;
  await user('/'+p.id,{action:'dispatch'});
  await user('/'+p.id,{action:'result',summary:'done',artifact:'diff',version:'mcp-v1',evidence:'log',tests:'passed',issues:'none',next:'review'});
  assert.deepEqual((await bridge('list_review_jobs')).data.jobs,[]);
  const publishing={files:[{path:'source.mjs',content:'export const add=(a,b)=>a+b;'}],confirmVersion:'mcp-v1',publishConsent:true};
  const job=(await user('/'+p.id+'/workbuddy',publishing)).data;
  const c=(await bridge('get_review_job',{jobId:job.id})).data;
  assert.match(c.markdown,/export const add/);
  const visible=(await user('/'+p.id)).data;
  assert.ok(!JSON.stringify(visible).includes(c.claimToken));
  assert.ok(!JSON.stringify(visible).includes('export const add'));
  const configuration=await (await fetch(service.url+'/api/workbuddy/config')).json();
  assert.ok(configuration.config.mcpServers.gfot.args.includes(join(dir,'bridge-token')));
  assert.ok(!JSON.stringify(configuration).includes(token));
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'integration-test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'bridge_status',arguments:{}}}];
  const mcp=spawnSync(process.execPath,['scripts/workbuddy-mcp.mjs','--url',service.url,'--token-file',join(dir,'bridge-token')],{input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:15000});
  assert.equal(mcp.status,0,mcp.stderr);
  const output=mcp.stdout.trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(output[0].result.serverInfo.name,'gfot-workbuddy');
  assert.equal(JSON.parse(output[2].result.content[0].text).service,'gfot');
  assert.equal(output.length,3);assert.equal(output[1].result.tools.length,9);assert.ok(!output[2].result.isError);
  assert.equal(JSON.parse(output[2].result.content[0].text).scope,'仅用户发布的审查副本');
  await stop(service.child);service=await start(dir);
  assert.equal(readFileSync(join(dir,'bridge-token'),'utf8'),token);
  const submitted=await bridge('submit_review',{jobId:job.id,claimToken:c.claimToken,bundleId:c.bundleId,reviewedVersion:c.reviewedVersion,verdict:'pass',source:'test bridge',criteriaEvidence:'static check only',findings:'runtime not independently verified'});
  assert.equal(submitted.status,200);assert.equal(submitted.data.applied,false);
  assert.equal((await user('/'+p.id)).data.stage,'review');
  await stop(service.child);service=await start(dir);
  assert.equal((await user('/'+p.id)).data.reviewJobs[0].status,'submitted');
  const applied=await user('/'+p.id,{action:'bridge_apply',jobId:job.id});assert.equal(applied.data.status,'awaiting');assert.ok(!applied.data.acceptance);
  assert.equal((await bridge('read_file',{path:'/etc/passwd'})).status,400);
 }finally{if(service)await stop(service.child);rmSync(dir,{recursive:true,force:true});}
});
