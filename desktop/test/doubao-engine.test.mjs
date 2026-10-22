import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {DoubaoEngine} from '../doubao-engine.mjs';
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(overrides={}){let calls=[],state={status:'completed',reply:{text:'done'}};const sdk={check:async()=>true,identity:async()=>'account-a',create:async(text,options)=>{calls.push({text,options});const result={conversationId:'123456789012',runId:'123456789013'};options.onReceipt(result);return result;},send:async()=>{throw Error('unexpected resend');},status:async()=>state,stop:async()=>({stopped:true}),...overrides};const task={folder:'/fixture',sessionId:null},events=[],sessions=[];const engine=new DoubaoEngine({task,sdk,pollMs:1,onEvent:e=>events.push(e),onSession:id=>sessions.push(JSON.parse(id))});return {engine,task,events,sessions,calls,sdk,setState:value=>{state=value;}};}
async function authorize(f){const id=f.events.find(e=>e.type==='permission.asked')?.properties.id;assert.ok(id);await f.engine.permission(id,'once');}

test('Doubao requires explicit native-turn authorization and checkpoints receipt before status polling',async()=>{
 const f=fixture();await f.engine.start();const turn=f.engine.send('write fixture');await tick();assert.equal(f.calls.length,0);await authorize(f);await turn;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.permission,'AlwaysAsk');assert.deepEqual(f.calls[0].options.skillPaths,[]);assert.equal(f.calls[0].options.workspace,'/fixture');
 assert.ok(f.sessions.some(s=>s.pending&&s.runId==='123456789013'));assert.equal(f.sessions.at(-1).pending,false);assert.equal((await f.engine.history())[0].parts[0].text,'done');await f.engine.stop();
});
test('reject or stop before authorization never submits a native task',async()=>{
 for(const stop of [false,true]){const f=fixture();await f.engine.start();const turn=assert.rejects(f.engine.send('write'),/未获授权/);await tick();if(stop)await f.engine.stop();else await f.engine.permission(f.events[0].properties.id,'reject');await turn;assert.equal(f.calls.length,0);}
});
test('pending native interaction is cancelled rather than implicitly approved',async()=>{
 let stopped;const f=fixture({status:async()=>({status:'waiting_input',pending:[{kind:'approval'}]}),stop:async(id,o)=>{stopped={id,...o};return {stopped:true};}});await f.engine.start();const turn=assert.rejects(f.engine.send('write'),/原生确认/);await tick();await authorize(f);await turn;await f.engine.stop();assert.equal(stopped.runId,'123456789013');assert.equal(JSON.parse(f.task.sessionId).pending,false);
});
test('lost acceptance receipt stays unknown across restart and is never replayed',async()=>{
 const f=fixture({create:async()=>{throw Error('connection lost');}});await f.engine.start();const turn=assert.rejects(f.engine.send('change'),/connection lost/);await tick();await authorize(f);await turn;await assert.rejects(f.engine.stop(),/接收状态未知/);
 const restored=new DoubaoEngine({task:f.task,sdk:f.sdk});await assert.rejects(restored.start(),/接收状态未知/);assert.equal(JSON.parse(f.task.sessionId).pending,true);
});
test('unconfirmed cancellation retains the native run and rejects false stopped state',async()=>{
 const f=fixture({status:async()=>({status:'waiting_input'}),stop:async()=>({stopped:false})});await f.engine.start();const turn=assert.rejects(f.engine.send('go'),/原生确认/);await tick();await authorize(f);await turn;await assert.rejects(f.engine.stop(),/尚未确认/);assert.equal(JSON.parse(f.task.sessionId).pending,true);
});
test('native account change prevents resuming another account session',async()=>{
 const f=fixture();await f.engine.start();f.engine.save();const other=new DoubaoEngine({task:f.task,sdk:{...f.sdk,identity:async()=>'account-b'}});await assert.rejects(other.start(),/不匹配/);
});
test('stop during acceptance waits for exact receipt and cancels that run',async()=>{
 let accept,stopped;const f=fixture({create:(_text,options)=>new Promise(resolve=>{accept=()=>{const r={conversationId:'123456789012',runId:'123456789013'};options.onReceipt(r);resolve(r);};}),stop:async(id,o)=>{stopped={id,...o};return {stopped:true};}});await f.engine.start();const turn=assert.rejects(f.engine.send('go'),/已停止/);await tick();await authorize(f);await tick();const stop=f.engine.stop();accept();await stop;await turn;assert.equal(stopped.runId,'123456789013');
});
test('vendored desktop automation matches the pinned and documented patch hashes',()=>{
 const base=new URL('../vendor/doubao-cli/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('UPSTREAM.json',base)));
 for(const [name,hash]of Object.entries(manifest.files)){assert.equal(createHash('sha256').update(readFileSync(new URL(name,base))).digest('hex'),hash,name);if(!manifest.patches[name])assert.equal(hash,manifest.upstreamFiles[name],name);}
});

test('late acceptance after an unknown-stop result can be cancelled on retry without replay',async()=>{
 let accept,stopCount=0;const f=fixture({create:(_text,o)=>new Promise(resolve=>{accept=()=>{const r={conversationId:'123456789012',runId:'123456789013'};o.onReceipt(r);resolve(r);};}),stop:async()=>{stopCount++;return {stopped:true};}});f.engine.acceptanceTimeoutMs=1;await f.engine.start();const turn=assert.rejects(f.engine.send('go'),/已停止/);await tick();await authorize(f);await tick();await assert.rejects(f.engine.stop(),/接收状态未知/);accept();await turn;await f.engine.stop();assert.equal(stopCount,1);assert.equal(JSON.parse(f.task.sessionId).pending,false);
});
test('a stalled native observer has a host deadline and preserves pending receipt for recovery',async()=>{
 const f=fixture({status:()=>new Promise(()=>{})});f.engine.callTimeoutMs=5;await f.engine.start();const turn=assert.rejects(f.engine.send('go'),/响应超时/);await tick();await authorize(f);await turn;assert.equal(JSON.parse(f.task.sessionId).pending,true);await f.engine.stop();assert.equal(JSON.parse(f.task.sessionId).pending,false);
});
test('cancelling during the pre-send account check cannot launch a native turn',async()=>{
 const f=fixture();await f.engine.start();let release;f.sdk.identity=()=>new Promise(resolve=>{release=()=>resolve('account-a');});const turn=assert.rejects(f.engine.send('go'),/已停止/);await tick();await authorize(f);await tick();await f.engine.stop();release();await turn;assert.equal(f.calls.length,0);
});
