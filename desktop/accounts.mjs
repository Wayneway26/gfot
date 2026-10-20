import {randomUUID} from 'node:crypto';
import {InputError,requireText} from './state.mjs';
import {jwtPayload,oauthJSON,validateIdentity,credentialsFromTokens,tokenURL,resource,createChatGPTLogin} from './chatgpt-oauth.mjs';

export function createAccountManager({state,vault,save,changed=()=>{},credentialsChanged=()=>{},fetchImpl=fetch}){
 state.accounts||=[];state.hostId||='urn:uuid:'+randomUUID();save();
 const locks=new Map(),recentSecrets=new Set();
 const find=id=>{const account=state.accounts.find(a=>a.id===id);if(!account)throw new InputError('账号不存在');return account;};
 const credentials=account=>{if(!account.secret)throw new InputError('账号已退出，请重新登录或导入');return JSON.parse(vault.open(account.secret));};
 const notify=()=>{save();changed();};
 function remember(c){for(const key of ['accessToken','refreshToken','idToken'])if(c[key])recentSecrets.add(c[key]);}
 function saveSession(c,existingId){
  let a=existingId?find(existingId):state.accounts.find(a=>a.source==='chatgpt'&&a.clientId===c.clientId&&a.subject===c.subject);
  if(a&&(a.subject!==c.subject||a.clientId!==c.clientId))throw new InputError('账号身份与原注册不匹配');
  if(!a){a={id:randomUUID(),source:'chatgpt',createdAt:new Date().toISOString()};state.accounts.push(a);}
  Object.assign(a,{label:c.email||'ChatGPT 账号',email:c.email,subject:c.subject,clientId:c.clientId,expiresAt:c.expiresAt,canRefresh:!!c.refreshToken,status:'ready',revision:(a.revision||0)+1,secret:vault.seal(JSON.stringify(c))});remember(c);credentialsChanged(a.id);notify();return a.id;
 }
 const login=createChatGPTLogin({hostId:state.hostId,fetchImpl,onAccount:saveSession});
 function importCodex(document,label){
  let doc;try{doc=JSON.parse(document);}catch{throw new InputError('所选文件不是有效 JSON');}
  const accessToken=doc?.tokens?.access_token;if(typeof accessToken!=='string'||!accessToken)throw new InputError('文件中没有 Codex OAuth access_token；API Key 模式请使用 API 直连');
  const claims=jwtPayload(accessToken);if(claims.iss!=='https://auth.openai.com')throw new InputError('文件不是 OpenAI 授权凭证，请选择 Codex 的 auth.json');if(!Number.isFinite(claims.exp))throw new InputError('无法确定访问凭证有效期，请在 gfot 独立登录');
  const auth=claims['https://api.openai.com/auth']||{},accountId=doc.tokens.account_id||auth.chatgpt_account_id;
  if(typeof accountId!=='string'||!accountId)throw new InputError('凭证缺少 ChatGPT 账号 / 工作区标识');
  let identity={};try{identity=jwtPayload(doc.tokens.id_token);}catch{}
  const subject=claims.sub||identity.sub||'',email=identity.email||claims.email||'';
  let a=state.accounts.find(a=>a.source==='codex-local'&&a.upstreamAccountId===accountId&&a.subject===subject);
  if(!a){a={id:randomUUID(),source:'codex-local',createdAt:new Date().toISOString()};state.accounts.push(a);}
  const c={accessToken,expiresAt:claims.exp*1000,accountId};
  Object.assign(a,{label:label?requireText(label,'账号名称',120):email||'Codex 本地账号',email,subject,upstreamAccountId:accountId,expiresAt:c.expiresAt,canRefresh:false,status:c.expiresAt>Date.now()?'ready':'expired',revision:(a.revision||0)+1,secret:vault.seal(JSON.stringify(c))});remember(c);credentialsChanged(a.id);notify();return a.id;
 }
 async function access(id,{force=false}={}){
  const a=find(id),c=credentials(a);if(!force&&c.expiresAt>Date.now()+60000)return c;
  if(a.source==='codex-local'){
   if(!force&&c.expiresAt>Date.now())return c;
   a.status='expired';notify();throw new InputError('导入的 Codex 访问凭证已过期或失效。请重新导入，或在 gfot 独立登录；不会轮换原客户端的刷新凭证。');
  }
  if(locks.has(id))return locks.get(id);
  if(c.earliestRefreshAt>Date.now()){if(c.expiresAt>Date.now())return c;throw new InputError('凭证尚不能刷新，请稍后重试或重新登录');}
  if(!c.refreshToken)throw new InputError('没有可用的刷新凭证，请重新登录');
  const revision=a.revision;
  const work=(async()=>{
   try{
    const tokens=await oauthJSON(tokenURL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:c.clientId,refresh_token:c.refreshToken,resource}).toString()},fetchImpl);
    const identity=tokens.id_token?await validateIdentity(tokens.id_token,{clientId:c.clientId,subject:c.subject},fetchImpl):{sub:c.subject,email:c.email};
    if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token)throw new InputError('刷新响应缺少轮换后的刷新凭证，请重新登录');
    const next=credentialsFromTokens({...tokens,scope:tokens.scope||c.scopes.join(' '),id_token:tokens.id_token||c.idToken},c.clientId,identity,c.hostId);
    if(!state.accounts.includes(a)||a.revision!==revision){const error=new InputError('刷新期间账号已改变，请重试');error.revocationUnconfirmed=!(await revokeSession(next));throw error;}
    remember(c);remember(next);a.secret=vault.seal(JSON.stringify(next));a.expiresAt=next.expiresAt;a.status='ready';a.revision++;notify();return next;
   }catch(error){if(state.accounts.includes(a)&&a.revision===revision){a.status='reauth-required';notify();}throw error;}
  })();locks.set(id,work);try{return await work;}finally{if(locks.get(id)===work)locks.delete(id);}
 }
 function endpoint(a){return a.source==='chatgpt'?resource:'https://chatgpt.com/backend-api/codex';}
 function headers(a,c){return {authorization:'Bearer '+c.accessToken,'content-type':'application/json','user-agent':'gfot/0.4.0',...(a.source==='codex-local'?{'ChatGPT-Account-Id':c.accountId}:{})};}
 async function models(id){
  const a=find(id),c=await access(id);const url=endpoint(a)+'/models'+(a.source==='codex-local'?'?client_version=0.159.0':'');
  const data=await oauthJSON(url,{headers:headers(a,c)},fetchImpl);
  const rows=Array.isArray(data.models)?data.models:Array.isArray(data.data)?data.data:[];
  const result=[...new Set(rows.filter(m=>m.visibility===undefined||m.visibility==='list').map(m=>m.slug||m.id).filter(v=>typeof v==='string'))].slice(0,300);
  a.modelsCheckedAt=new Date().toISOString();notify();return {models:result,note:'模型目录不等于订阅权限或剩余额度；完成一次推理才能验证当前模型访问。'};
 }
 async function quota(id){
  const a=find(id);if(a.source!=='codex-local')return {supported:false,note:'该授权方式未提供额度查询；请在 ChatGPT 设置中查看用量。'};
  const c=await access(id),data=await oauthJSON('https://chatgpt.com/backend-api/wham/usage',{headers:headers(a,c)},fetchImpl);
  const window=w=>w&&Number.isFinite(w.used_percent)?{usedPercent:Math.min(100,Math.max(0,w.used_percent)),resetAt:Number.isFinite(w.reset_at)?w.reset_at:null,windowSeconds:w.limit_window_seconds||null}:null;
  const result={supported:true,checkedAt:new Date().toISOString(),primary:window(data.rate_limit?.primary_window),secondary:window(data.rate_limit?.secondary_window)};
  if(!result.primary&&!result.secondary)throw new InputError('服务没有返回可识别的额度窗口；这不代表额度为零');a.quota=result;notify();return result;
 }
 async function revokeSession(c){
  if(!c.refreshToken)return false;
  try{const discovery=await oauthJSON('https://auth.openai.com/.well-known/openid-configuration',{},fetchImpl),url=new URL(discovery.revocation_endpoint);if(url.origin!=='https://auth.openai.com')return false;const r=await fetchImpl(url.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:c.refreshToken,token_type_hint:'refresh_token',client_id:c.clientId}).toString()});const ok=r.status===200;await r.body?.cancel();return ok;}catch{return false;}
 }
 async function signOut(id){
  const a=find(id),c=credentials(a),source=a.source,pending=locks.get(id);
  remember(c);a.secret=null;a.status='signed-out';a.canRefresh=false;a.revision++;credentialsChanged(a.id);notify();
  let orphaned=false;if(pending){try{await pending;}catch(error){orphaned=!!error.revocationUnconfirmed;}}
  const revokedOld=source==='chatgpt'?await revokeSession(c):false,revoked=revokedOld&&!orphaned;
  return {revoked,note:source==='codex-local'?'已删除 gfot 的凭证副本，未修改原客户端。':revoked?'已退出并撤销所选旧会话。':'本机凭证已清除；远端撤销未确认，可在 ChatGPT 设置中断开 gfot。'};
 }

 return {find,access,endpoint,headers,models,quota,signOut,importCodex,saveSession,
  async beginLogin(id){if(!id)return login.start();const a=find(id);if(a.source!=='chatgpt')throw new InputError('导入凭证请重新导入或添加独立登录');let c={};try{c=credentials(a);}catch{}return login.start({...c,clientId:a.clientId,subject:a.subject,email:a.email,accountId:a.id});},
  loginStatus:login.status,cancelLogin:login.cancel,
  sensitiveValues(){for(const a of state.accounts)if(a.secret){try{remember(credentials(a));}catch{}}return [...recentSecrets];},
  markInference(id){const a=find(id);a.inferenceAt=new Date().toISOString();notify();},
  close(){login.close();},
 };
}
