import test from 'node:test';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {AcpEngine,agentEnvironment} from '../acp-engine.mjs';
const fixture=fileURLToPath(new URL('./helpers/acp-fixture.mjs',import.meta.url));
const options=()=>({launch:{command:process.execPath,args:[fixture],env:{}},task:{folder:'/private/tmp',sessionId:null}});
const until=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture timeout');};

test('ACP streams Unicode output and honors a user approval exactly once',async()=>{
 let permit;const e=new AcpEngine({...options(),onEvent:event=>{if(event.type==='permission.asked')permit=event.properties;}});
 try{await e.start();assert.equal(e.task.sessionId,'fixture-session');const result=e.send('synthetic');await until(()=>permit);assert.equal(permit.permission,'Edit fixture');await e.permission(permit.id,'once');await result;assert.equal((await e.history())[0].parts[0].text,'你好 approved');await assert.rejects(e.permission(permit.id,'once'),/失效/);}finally{await e.stop();}
});
test('ACP resumes its own session without replaying old output into the active response',async()=>{
 const o=options();o.task.sessionId='saved-id';const e=new AcpEngine({...o,readOnly:true});try{await e.start();assert.equal(e.resumed,true);assert.equal(e.task.sessionId,'saved-id');await e.send('readonly');assert.equal(e.output,'你好 denied');}finally{await e.stop();}
});
test('cancelling a pending ACP turn resolves outstanding permissions and stops the group',async()=>{
 const e=new AcpEngine(options());try{await e.start();const p=e.send('wait');const rejection=assert.rejects(p,/停止|cancelled|退出/);await until(()=>e.permissions.size===1);const pid=e.child.pid;await e.stop();await rejection;assert.equal(e.requests.size,0);assert.equal(e.permissions.size,0);assert.throws(()=>process.kill(-pid,0));assert.equal((await e.stop()).confirmed,true);}finally{await e.stop();}
});
test('oversized ACP frames fail closed rather than retaining unlimited output',async()=>{
 const o=options();o.launch.env.FIXTURE_MODE='oversize';const e=new AcpEngine(o);try{await e.start();await assert.rejects(e.send('oversize'),/过大|停止/);}finally{await e.stop();}
});
test('native Agent environment does not inherit provider tokens or Node injection options',()=>{
 process.env.GFOT_TEST_API_KEY='secret';process.env.NODE_OPTIONS='--trace-warnings';try{const env=agentEnvironment();assert.equal(env.GFOT_TEST_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.HOME,process.env.HOME);}finally{delete process.env.GFOT_TEST_API_KEY;delete process.env.NODE_OPTIONS;}
});
test('an owned process exit without native turn acknowledgement is not cancellation confirmation',async()=>{
 const o=options();o.launch.env.FIXTURE_MODE='unconfirmed';const e=new AcpEngine(o);try{await e.start();const turn=assert.rejects(e.send('wait'),/停止|退出/);await until(()=>e.turnPromise);const outcome=await e.stop();await turn;assert.equal(outcome.confirmed,false);}finally{await e.stop();}
});
