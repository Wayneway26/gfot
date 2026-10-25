import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const {createAppearanceStore}=createRequire(import.meta.url)('../appearance.cjs');
const source=readFileSync(new URL('../ui/theme.js',import.meta.url),'utf8');
function controller({initialTheme,storageFailure=false,setTheme}={}){
 const ready=[],mediaListeners=[],values=new Map(),error={textContent:''};const root={dataset:{}};
 const buttons=['light','dark','system'].map(choice=>({dataset:{themeChoice:choice},attributes:{},disabled:false,setAttribute(k,v){this.attributes[k]=v;},addEventListener(_type,fn){this.click=fn;}}));
 const media={matches:false,addEventListener(_type,fn){mediaListeners.push(fn);}};
 const storage={getItem(k){if(storageFailure)throw Error('storage unavailable');return values.get(k);},setItem(k,v){if(storageFailure)throw Error('storage unavailable');values.set(k,v);}};
 const document={documentElement:root,querySelectorAll:()=>buttons,querySelector:()=>error,addEventListener(_type,fn){ready.push(fn);}};
 runInNewContext(source,{document,window:{matchMedia:()=>media,...(initialTheme?{gfotDesktop:{initialTheme,setTheme}}:{})},localStorage:storage});
 return {root,buttons,error,values,ready(){ready.forEach(fn=>fn());},system(dark){media.matches=dark;mediaListeners.forEach(fn=>fn());}};
}
test('native appearance preference survives a fresh store and rejects invalid writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-appearance-'));try{const store=createAppearanceStore(dir);assert.equal(store.get(),'system');store.set('dark');assert.equal(createAppearanceStore(dir).get(),'dark');assert.throws(()=>store.set('../bad'));assert.equal(createAppearanceStore(dir).get(),'dark');assert.deepEqual(JSON.parse(readFileSync(join(dir,'appearance.json'))),{theme:'dark'});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid or corrupted appearance data falls back to system without touching task state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gfot-appearance-'));try{writeFileSync(join(dir,'desktop.json'),'private task state');for(const text of ['{','null','{"theme":"invalid"}']){writeFileSync(join(dir,'appearance.json'),text);assert.equal(createAppearanceStore(dir).get(),'system');}assert.equal(readFileSync(join(dir,'desktop.json'),'utf8'),'private task state');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('early theme application uses native preference without relying on per-port browser storage',()=>{
 const c=controller({initialTheme:'dark',storageFailure:true});assert.equal(c.root.dataset.theme,'dark');c.ready();assert.equal(c.buttons[1].attributes['aria-pressed'],'true');assert.equal(c.root.dataset.themeReady,'true');
});
test('system changes follow only system mode; explicit browser selection remains stable',async()=>{
 const c=controller();c.ready();assert.equal(c.root.dataset.theme,'light');c.system(true);assert.equal(c.root.dataset.theme,'dark');await c.buttons[0].click();c.system(false);c.system(true);assert.equal(c.root.dataset.theme,'light');assert.equal(c.values.get('gfot-theme'),'light');await c.buttons[2].click();assert.equal(c.root.dataset.theme,'dark');
});
test('failed native saves retain previous appearance, show an error and allow retry',async()=>{
 let release;const c=controller({initialTheme:'light',setTheme:()=>new Promise((_resolve,reject)=>release=reject)});c.ready();const pending=c.buttons[1].click();assert.ok(c.buttons.every(b=>b.disabled));release(Error('disk unavailable'));await pending;assert.equal(c.root.dataset.theme,'light');assert.equal(c.buttons[0].attributes['aria-pressed'],'true');assert.ok(c.buttons.every(b=>!b.disabled));assert.match(c.error.textContent,/未保存/);
});
