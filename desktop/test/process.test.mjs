import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OpenCodeEngine} from '../engine.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
test('stop waits for a command that ignores SIGTERM to be killed',async()=>{
 const engine=new OpenCodeEngine({task:{},onEvent(){}});
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});engine.child=child;
 try{await new Promise(resolve=>child.stdout.once('data',resolve));await engine.stop();assert.equal(alive(child.pid),false);}finally{try{process.kill(-child.pid,'SIGKILL');}catch{}}
});
test('supervisor kills the executor group when its owning service disappears',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-supervisor-')),fixture=join(dir,'executor.sh');writeFileSync(fixture,'#!/bin/sh\nexec /bin/sleep 60\n',{mode:0o700});
 const owner=spawn('/bin/sleep',['60']);const child=spawn('/bin/sh',[fileURLToPath(new URL('../supervise.sh',import.meta.url)),fixture,String(owner.pid)],{detached:true,stdio:'ignore'});
 try{await sleep(150);assert.ok(alive(child.pid));owner.kill('SIGKILL');for(let i=0;i<80&&alive(child.pid);i++)await sleep(50);assert.equal(alive(child.pid),false);}finally{owner.kill('SIGKILL');try{process.kill(-child.pid,'SIGKILL');}catch{}rmSync(dir,{recursive:true,force:true});}
});
