const {readFileSync,writeFileSync,renameSync}=require('node:fs');
const {join}=require('node:path');
const choices=new Set(['light','dark','system']);
function createAppearanceStore(dir){
 const file=join(dir,'appearance.json');let theme='system';
 try{const saved=JSON.parse(readFileSync(file,'utf8')).theme;if(choices.has(saved))theme=saved;}catch{}
 return {get(){return theme;},set(value){
  if(!choices.has(value))throw Error('请选择浅色、深色或跟随系统');
  writeFileSync(file+'.tmp',JSON.stringify({theme:value})+'\n',{mode:0o600});renameSync(file+'.tmp',file);theme=value;return theme;
 }};
}
module.exports={createAppearanceStore};
