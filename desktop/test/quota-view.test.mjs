import test from 'node:test';
import assert from 'node:assert/strict';
import {accountStatus,quotaWindows,quotaOverview} from '../ui/quota-view.js';
import {createAccountManager} from '../accounts.mjs';
import {vault,publicState} from '../state.mjs';
import {randomBytes} from 'node:crypto';
import {codexDocument} from './helpers/account-fixture.mjs';
test('account status distinguishes missing, expired, refreshable and saved credentials',()=>{
 assert.equal(accountStatus({hasCredentials:false}).label,'已退出');assert.equal(accountStatus({hasCredentials:true,status:'reauth-required'}).label,'需要重新登录');assert.equal(accountStatus({hasCredentials:true,expiresAt:1},2).label,'需要重新导入');assert.equal(accountStatus({hasCredentials:true,expiresAt:1,canRefresh:true},2).label,'需要续期');assert.equal(accountStatus({hasCredentials:true,expiresAt:3},2).label,'凭证已保存');
});
test('quota windows distinguish unknown and exhausted allowance, durations and past resets',()=>{
 assert.match(quotaWindows(null),/尚无可用额度记录/);assert.match(quotaWindows({supported:true,primary:{usedPercent:null}}),/不代表余额为零/);
 const result=quotaWindows({supported:true,primary:{usedPercent:100,windowSeconds:18000,resetAt:1},secondary:{usedPercent:0,windowSeconds:604800}},2000);assert.match(result,/5 小时额度/);assert.match(result,/每周额度/);assert.match(result,/剩余 0%/);assert.match(result,/剩余 100%/);assert.match(result,/已到重置时间，请刷新/);
 assert.match(quotaWindows({supported:true,primary:{usedPercent:120}}),/value="0"/);
});
test('quota overview escapes untrusted labels and errors and does not invent native/API balances',()=>{
 const state={accounts:[{id:'a',label:'<img src=x>',source:'codex-local',hasCredentials:true,quota:{supported:true,checkedAt:1,primary:{usedPercent:25}}}],agents:[{id:'wb',name:'WorkBuddy',kind:'acp',installed:true,check:{connected:true}}],profiles:[{label:'API',mode:'direct',model:'m'}]};
 const result=quotaOverview(state,{pending:new Set(['a']),errors:new Map([['a','<script>bad</script>']])});assert.ok(!result.includes('<img'));assert.ok(!result.includes('<script>'));assert.match(result,/剩余 75%/);assert.match(result,/正在查询/);assert.match(result,/上方保留上次查询记录/);assert.match(result,/暂不支持余额查询/);assert.match(result,/不能查询其登录有效期或剩余额度/);assert.ok(!result.includes('已登录'));
});
test('quota manager persists recognized windows and leaves the prior snapshot intact after query failure',async()=>{
 let failed=false,saves=0;const state={accounts:[],profiles:[],tasks:[]};const manager=createAccountManager({state,vault:vault(randomBytes(32)),save(){saves++;},fetchImpl:async()=>failed?new Response('{}',{status:503}):new Response(JSON.stringify({rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000},secondary_window:{used_percent:50,limit_window_seconds:604800}}}))});
 try{const id=manager.importCodex(codexDocument());const before=saves;const quota=await manager.quota(id);assert.equal(quota.primary.usedPercent,25);assert.ok(saves>before);assert.deepEqual(publicState(state).accounts[0].quota,quota);assert.ok(!JSON.stringify(publicState(state)).includes('fixture-signature'));failed=true;await assert.rejects(manager.quota(id));assert.deepEqual(state.accounts[0].quota,quota);}finally{manager.close();}
});
