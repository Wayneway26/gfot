import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createAgentRegistry,continuationText} from '../local-agents.mjs';

test('local Agent discovery distinguishes installed UI from a callable executor and exposes no commands',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-discovery-'));try{
  mkdirSync(join(dir,'WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin'),{recursive:true});writeFileSync(join(dir,'WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'),'fixture');mkdirSync(join(dir,'Doubao.app'));mkdirSync(join(dir,'Qoder.app'));
  const r=createAgentRegistry({appRoots:[dir],bundledBinary:'/fixture/opencode'}),list=r.list();
  assert.equal(list.find(a=>a.id==='workbuddy').available,true);assert.equal(list.find(a=>a.id==='doubao').kind,'doubao');assert.equal(list.find(a=>a.id==='qianwen').installed,false);
  assert.equal(list.find(a=>a.id==='qoder').installed,true);assert.equal(list.find(a=>a.id==='qoder').available,false);assert.throws(()=>r.get('qoder'),/尚无/);
  assert.ok(!JSON.stringify(list).includes(dir));assert.throws(()=>r.command('doubao'));assert.throws(()=>r.command('unknown'));
  const c=r.command('workbuddy');assert.ok(c.args.includes('--acp'));assert.ok(c.args.includes('--serve'));assert.ok(!c.args.includes('--dangerously-skip-permissions'));assert.ok(c.env.CODEBUDDY_CONFIG_DIR.endsWith('.workbuddy'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('continuation forwards only unsynced visible history and notes; omissions are explicit',()=>{
 const task={folder:'/project',contextNotes:'Keep API stable',messages:[{role:'user',text:'first'},{role:'assistant',text:'answer',agentId:'workbuddy'},{role:'user',text:'second'},{role:'assistant',text:'second answer'},{role:'user',text:'current'}]};
 const t=continuationText(task,'current',{cursor:2});assert.equal(t.forwarded,2);assert.ok(!t.text.includes('first'));assert.ok(t.text.includes('Keep API stable'));assert.ok(t.text.endsWith('current'));
 const fresh=continuationText(task,'current',{fresh:true});assert.equal(fresh.forwarded,4);
 const small=continuationText(task,'current',{fresh:true,maxChars:15});assert.ok(small.omitted>0);assert.ok(small.text.endsWith('current'));
});
