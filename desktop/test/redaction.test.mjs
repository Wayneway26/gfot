import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {startDesktopServer} from '../backend.mjs';
test('short access keys preserve control IDs and split streaming credentials remain masked',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-redaction-'));let service,release;
 const engineFactory=o=>({async start(){o.task.sessionId='session-1';},async send(){
  o.onEvent({type:'message.part.delta',properties:{sessionID:'session-1',field:'text',delta:'prefix '+o.key.slice(0,1)}});
  assert.ok(!o.task.draft.endsWith(o.key.slice(0,1)),'partial credential prefix must be masked');
  o.onEvent({type:'message.part.delta',properties:{sessionID:'session-1',field:'text',delta:o.key.slice(1)}});
  assert.equal(o.task.draft,'prefix [redacted]');
  o.onEvent({type:'permission.asked',properties:{sessionID:'session-1',id:'permission-1',permission:'edit',metadata:{note:o.key}}});
  await new Promise(r=>release=r);return {info:{}};
 },async history(){return [];},async permission(id){assert.equal(id,'permission-1');release();},async stop(){release?.();}});
 try{service=await startDesktopServer({dataDir:dir,key:randomBytes(32),engineFactory});const call=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{authorization:'Bearer '+service.auth,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,route.endsWith('/prompt')?202:200);return r.json();};
 for(const key of ['1','quoted-"key\\with-end']){
  const s=await call('profiles',{label:'test',baseURL:'http://localhost:1234/v1',model:'test',apiKey:key});const {taskId}=await call('tasks',{title:'test',folder:dir,profileId:s.profiles.at(-1).id});
  await call('tasks/'+taskId+'/prompt',{text:'synthetic'});for(let i=0;i<50&&!service.state.tasks[0].pending.length;i++)await new Promise(r=>setTimeout(r,10));
  const task=service.state.tasks[0];assert.equal(task.pending[0].id,'permission-1');assert.equal(task.pending[0].metadata.note,'[redacted]');assert.equal(task.draft,'prefix [redacted]');
  await call('tasks/'+taskId+'/permission',{id:'permission-1',reply:'once'});for(let i=0;i<50&&task.status!=='idle';i++)await new Promise(r=>setTimeout(r,10));assert.equal(task.status,'idle');
 }
 }finally{await service?.close();rmSync(dir,{recursive:true,force:true});}
});
