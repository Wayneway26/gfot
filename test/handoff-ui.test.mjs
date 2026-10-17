import test from 'node:test';
import assert from 'node:assert/strict';
import {continuationGuidance,continuationPanel,continuationAction} from '../public/handoff.js';
const button=(label,action)=>`<button data-action="${action}">${label}</button>`;
const task=()=>({id:'project',stage:'implement',status:'running',implementer:'Codex',repo:'/repo',baseline:'base',revision:2,cycle:3,handoffGeneration:4,handoffs:[{id:'h',status:'offered',sequence:5,digest:'hash',snapshot:{from:'Codex',to:'WorkBuddy'},latestCheckpoint:{version:'v2'}}]});
test('guidance is pure for ordinary, paused, offered and claimed tasks; remote names are escaped',()=>{
 assert.equal(continuationGuidance({stage:'implement',status:'ready'},{button}),null);
 const p=task();assert.match(continuationGuidance(p,{button})[2],/handoff_claim/);
 p.handoffs[0].status='claimed';assert.match(continuationGuidance(p,{button})[2],/result/);
 p.status='blocked';assert.equal(continuationGuidance(p,{button}),null);
 p.handoffs[0].snapshot.to='<img src=x onerror=alert(1)>';assert.ok(!continuationPanel(p).includes('<img'));
});
test('switch form sends captured requirement and checkpoint versions and never assumes consent',async()=>{
 const p=task();let submit,body,fields;
 continuationAction('handoff_publish',p,{form:(_title,f,_button,fn)=>{fields=f;submit=fn;},field:()=>'',api:async(_path,options)=>{body=options.body;}});
 assert.match(fields,/name="stopped" required/);assert.match(fields,/name="consent" required/);
 await submit({target:'WorkBuddy',reason:'quota',stopped:'on',consent:'on',version:'v2'});
 assert.deepEqual([body.expectedGeneration,body.expectedRevision,body.expectedCycle,body.previousHandoffId,body.expectedSequence],[4,2,3,'h',5]);
 assert.equal(body.stopped,true);assert.equal(body.consent,true);
 await submit({target:'WorkBuddy',reason:'quota',version:'v2'});assert.equal(body.consent,false);assert.equal(body.stopped,false);
});
