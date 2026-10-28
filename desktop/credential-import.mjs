import {randomUUID} from 'node:crypto';
import {InputError} from './state.mjs';

// Only the selected legacy OpenCode export is parsed. OAuth and command entries
// require provider-specific adapters and must never be mistaken for API keys.
export function parseOpenCodeCredentials(document){
 if(typeof document!=='string'||Buffer.byteLength(document)>90000)throw new InputError('凭证文件过大或格式无效');
 let data;try{data=JSON.parse(document);}catch{throw new InputError('所选文件不是有效 JSON');}
 if(!data||Array.isArray(data)||typeof data!=='object')throw new InputError('请选择 OpenCode 的 auth.json');
 const entries=Object.entries(data).filter(([id])=>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id));
 if(entries.length>100)throw new InputError('凭证条目过多，拒绝导入');
 return entries.map(([provider,value])=>{
  const supported=value?.type==='api'&&typeof value.key==='string'&&value.key.trim()&&value.key.length<=4096;
  return {provider,supported:!!supported,...(supported?{key:value.key.trim()}:{reason:value?.type==='oauth'?'OAuth 登录需对应平台适配，不能作为通用 API Key':'不是受支持的 API Key 条目'})};
 });
}

export function createCredentialImports({now=Date.now}={}){
 const pending=new Map();
 const prune=()=>{for(const [id,item]of pending)if(item.expiresAt<=now())pending.delete(id);};
 return {
  preview(document){
   prune();const entries=parseOpenCodeCredentials(document);
   if(!entries.length)throw new InputError('文件中没有可识别的 OpenCode 凭证条目；新版数据库不能按 JSON 导入');
   if(pending.size>=5)pending.delete(pending.keys().next().value);
   const id=randomUUID(),expiresAt=now()+5*60*1000;pending.set(id,{entries,expiresAt});
   return {id,expiresAt,entries:entries.map(({key,...entry})=>entry)};
  },
  key(id,provider){prune();const item=pending.get(id);if(!item)throw new InputError('导入预览已过期，请重新选择文件');const entry=item.entries.find(e=>e.provider===provider);if(!entry?.supported)throw new InputError('此条目不能用于模型 API 接入');return entry.key;},
  discard(id){pending.delete(id);},
  close(){pending.clear();},
 };
}
