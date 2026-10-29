import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {finishExecution} from './execution-state.mjs';
import {ensureProject} from './task-context.mjs';
import {join,isAbsolute} from 'node:path';
export class InputError extends Error {}
export const requireText=(value,name,max=30000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new InputError(`请填写${name}`);return value.trim();};
export function profileInput(input,existing,seal){
 let url;try{url=new URL(requireText(input.baseURL,'服务地址'));}catch{throw new InputError('请填写有效的服务地址');}
 const mode=input.mode||existing?.mode||'local';
 const protocol=input.protocol||existing?.protocol||'chat';if(!['chat','responses','anthropic'].includes(protocol))throw new InputError('请选择支持的接口协议');
 if(!['local','direct'].includes(mode))throw new InputError('请选择本机服务或 HTTPS API 直连');
 if(url.username||url.password||url.search||url.hash)throw new InputError('服务地址不能包含账号、密码、查询参数或片段');
 if(mode==='local'&&(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new InputError('本机模式仅连接回环 HTTP 地址；远程服务请选择 HTTPS API 直连');
 if(mode==='direct'&&url.protocol!=='https:')throw new InputError('API 直连必须使用 HTTPS，不能明文发送访问密钥');
 if(existing?.secret&&!input.apiKey&&!input.clearKey&&new URL(existing.baseURL).origin!==url.origin)throw new InputError('更改服务地址后，请重新输入该服务的访问密钥，或选择清除旧密钥');
 const secret=input.apiKey?seal(requireText(input.apiKey,'访问密钥',4096)):input.clearKey?null:existing?.secret||null;
 if(mode==='direct'&&!secret)throw new InputError('请填写该服务的 API Key（订阅登录 Token 不等于 API Key）');
 const profile={...(existing?.credentialSource&&!input.apiKey&&!input.clearKey?{credentialSource:existing.credentialSource}:{}),id:existing?.id||randomUUID(),label:requireText(input.label,'连接名称',80),mode,baseURL:url.toString().replace(/\/$/,''),model:requireText(input.model,'模型 ID',160),protocol,secret};
 if(existing?.verification&&['mode','baseURL','model','secret','protocol'].every(k=>(existing[k]??(k==='mode'?'local':k==='protocol'?'chat':null))===profile[k]))profile.verification=existing.verification;
 return profile;
}
export function vault(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Missing desktop vault key');
 return {seal(text){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');},open(value){if(!value)return '';const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');}};
}
export function createStore(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,'desktop.json');let state;
 try{state=JSON.parse(readFileSync(path,'utf8'));if(state.version!==1||!Array.isArray(state.tasks)||!Array.isArray(state.profiles))throw Error('Unsupported data');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,profiles:[],tasks:[]};}
 state.projects||=[];
 for(const task of state.tasks){task.projectId=ensureProject(state,task.folder).id;task.toolHistory||=[];task.agentId||='opencode';task.contextNotes||='';task.agentSessions||=task.sessionId?{[task.agentId]:{sessionId:task.sessionId,cursor:task.messages.length}}:{};}
 for(const task of state.tasks)if((task.transition||['running','starting','permission'].includes(task.status))){if(['running','starting','permission'].includes(task.status)&&(['acp','claude'].includes(task.executorKind)||['opencode-local','workbuddy','workbuddy-ai'].includes(task.agentId)))task.executionUnconfirmed={agentId:task.agentId,at:new Date().toISOString()};task.status='interrupted';finishExecution(task,'interrupted');const partial=[...(task.liveProgress||[]),task.draft].filter(Boolean).join('\n\n').slice(-100000);if(partial.trim())task.messages.push({id:randomUUID(),role:'assistant',agentId:task.agentId,text:partial,presentation:'progress',interrupted:true,at:new Date().toISOString()});task.liveProgress=[];task.draft='';if(task.harnessRun?.status==='running')task.harnessRun.status='interrupted';delete task.transition;task.pending=[];task.error='上次执行被中断。核对文件和执行记录后再继续。';}
 function save(){writeFileSync(path+'.tmp',JSON.stringify(state,null,2),{mode:0o600});renameSync(path+'.tmp',path);}
 save();return {state,save};
}
export function publicState(state){const {hostId,accounts=[],...visible}=state;return {...visible,accounts:accounts.map(({secret,...a})=>({...a,hasCredentials:!!secret})),profiles:state.profiles.map(({secret,...p})=>({...p,hasKey:!!secret}))};}
export function newTask(input,folder){
 if(!isAbsolute(folder))throw new InputError('请选择绝对目录');
 return {id:randomUUID(),title:requireText(input.title||'新任务','任务名称',120),folder,profileId:input.profileId||'',status:'idle',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],events:[],pending:[],sessionId:null};
}
