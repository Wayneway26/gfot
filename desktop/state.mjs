import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
export class InputError extends Error {}
export const requireText=(value,name,max=30000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new InputError(`请填写${name}`);return value.trim();};
export function profileInput(input,existing,seal){
 let url;try{url=new URL(requireText(input.baseURL,'本地代理地址'));}catch{throw new InputError('请填写有效的本地代理地址');}
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw new InputError('首版仅连接本机 HTTP 模型代理，例如 http://127.0.0.1:15721/v1');
 return {id:existing?.id||randomUUID(),label:requireText(input.label,'连接名称',80),baseURL:url.toString().replace(/\/$/,''),model:requireText(input.model,'模型 ID',160),secret:input.apiKey?seal(requireText(input.apiKey,'本地代理访问密钥',4096)):existing?.secret||null};
}
export function vault(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Missing desktop vault key');
 return {seal(text){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');},open(value){if(!value)return '';const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');}};
}
export function createStore(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,'desktop.json');let state;
 try{state=JSON.parse(readFileSync(path,'utf8'));if(state.version!==1||!Array.isArray(state.tasks)||!Array.isArray(state.profiles))throw Error('Unsupported data');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,profiles:[],tasks:[]};}
 for(const task of state.tasks)if(['running','starting','permission'].includes(task.status)){task.status='interrupted';task.pending=[];task.error='上次执行被中断。核对文件和执行记录后再继续。';}
 function save(){writeFileSync(path+'.tmp',JSON.stringify(state,null,2),{mode:0o600});renameSync(path+'.tmp',path);}
 save();return {state,save};
}
export function publicState(state){return {...state,profiles:state.profiles.map(({secret,...p})=>({...p,hasKey:!!secret}))};}
export function newTask(input,folder){
 if(!isAbsolute(folder))throw new InputError('请选择绝对目录');
 return {id:randomUUID(),title:requireText(input.title||'新任务','任务名称',120),folder,profileId:input.profileId||'',status:'idle',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],events:[],pending:[],sessionId:null};
}
