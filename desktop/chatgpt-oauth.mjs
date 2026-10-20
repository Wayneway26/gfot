import http from 'node:http';
import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
import {InputError} from './state.mjs';
const issuer='https://auth.openai.com';
export const resource='https://api.openai.com/v1';
export const tokenURL=issuer+'/api/accounts/oauth/token';
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const jwtPayload=token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw new InputError('凭证不是可识别的 JWT');}};
export async function oauthJSON(url,options={},fetchImpl=fetch){
 let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(20000)});}catch{throw new InputError('授权服务连接失败，请检查网络后重试');}
 if(!response.ok){await response.body?.cancel();throw new InputError(response.status===400||response.status===401?'授权已失效或凭证已被轮换，请重新登录':'授权服务暂时不可用（'+response.status+'）');}
 const text=await response.text();if(text.length>1000000)throw new InputError('授权响应过大');try{return JSON.parse(text);}catch{throw new InputError('授权服务返回格式无效');}
}
export async function validateIdentity(token,{clientId,nonce,subject},fetchImpl=fetch){
 const parts=String(token||'').split('.');if(parts.length!==3)throw new InputError('授权缺少身份凭证');
 let header;try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{throw new InputError('身份凭证格式无效');}
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw new InputError('不支持的身份签名算法');
 const discovery=await oauthJSON(issuer+'/.well-known/openid-configuration',{},fetchImpl);
 let jwks;try{jwks=new URL(discovery.jwks_uri);}catch{throw new InputError('授权签名配置无效');}
 if(jwks.protocol!=='https:'||jwks.hostname!=='auth.openai.com'||jwks.username||jwks.password)throw new InputError('授权签名地址不可信');
 const keys=await oauthJSON(jwks.href,{},fetchImpl),jwk=keys.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
 if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new InputError('身份签名验证失败');
 const claims=jwtPayload(token),now=Date.now()/1000;
 if(claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud.includes(clientId):claims.aud===clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||claims.nbf>now+30||typeof claims.sub!=='string'||!claims.sub)throw new InputError('身份凭证已过期或签发目标不匹配');
 if(nonce!==undefined&&claims.nonce!==nonce)throw new InputError('授权 nonce 不匹配');
 if(subject&&claims.sub!==subject)throw new InputError('返回的账号与所选账号不同');
 return claims;
}
export function credentialsFromTokens(tokens,clientId,identity,hostId){
 const granted=String(tokens.scope||'').split(/\s+/);if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw new InputError('未授予 ChatGPT 订阅模型调用权限，请重新登录并同意该权限');
 if(typeof tokens.access_token!=='string'||!tokens.access_token||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new InputError('授权响应缺少有效的访问凭证');
 return {accessToken:tokens.access_token,refreshToken:tokens.refresh_token||null,idToken:tokens.id_token||null,clientId,subject:identity.sub,email:typeof identity.email==='string'?identity.email:'',hostId,scopes:granted,expiresAt:Date.now()+tokens.expires_in*1000,earliestRefreshAt:typeof tokens.earliest_refresh_at==='number'?tokens.earliest_refresh_at*1000:Date.parse(tokens.earliest_refresh_at)||0};
}
export function createChatGPTLogin({hostId,onAccount,fetchImpl=fetch}){
 const attempts=new Map();
 const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 async function start(existing){
  if([...attempts.values()].some(a=>a.status==='pending'))throw new InputError('已有正在进行的登录，请先完成或取消');
  for(const [id,a]of attempts)if(a.status!=='pending')attempts.delete(id);
  const id=randomBytes(24).toString('hex'),state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const a={id,status:'pending',server:null,timer:null,error:null};attempts.set(id,a);
  const finish=()=>{clearTimeout(a.timer);a.server?.close();};
  const server=http.createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Content-Type','text/plain; charset=utf-8');
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method!=='GET'||url.pathname!=='/auth/callback'||req.headers.host!=='127.0.0.1:'+server.address()?.port||!equal(url.searchParams.get('state'),state)){res.writeHead(400);return res.end('授权回调无效，请返回 gfot。');}
   if(a.status!=='pending'||a.exchanging){res.writeHead(409);return res.end('此登录请求已使用。');}a.exchanging=true;
   const code=url.searchParams.get('code'),clientId=existing?.clientId||url.searchParams.get('client_id');
   if(url.searchParams.has('error')||!code||!clientId||clientId==='dynamic_agent_client'||(existing&&url.searchParams.has('client_id')&&url.searchParams.get('client_id')!==existing.clientId)){
    a.status='error';a.error='授权未完成或被取消，请在 gfot 重新登录';res.writeHead(400);res.end(a.error);finish();return;
   }
   res.end('授权正在完成。请返回 gfot 查看登录结果。');
   try{
    const tokens=await oauthJSON(tokenURL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:a.redirectURI,resource}).toString()},fetchImpl);
    const identity=await validateIdentity(tokens.id_token,{clientId,nonce,subject:existing?.subject},fetchImpl);
    const credentials=credentialsFromTokens(tokens,clientId,identity,hostId);
    if(a.status!=='pending')return;
    a.accountId=await onAccount(credentials,existing?.accountId);a.status='complete';
   }catch(error){if(a.status==='pending'){a.status='error';a.error=error instanceof InputError?error.message:'登录验证失败，请重新登录';}}finally{finish();}
  });
  a.server=server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});a.redirectURI='http://127.0.0.1:'+server.address().port+'/auth/callback';
  a.timer=setTimeout(()=>{a.status='error';a.error='登录请求已过期';finish();},15*60*1000);a.timer.unref();
  const url=new URL(issuer+'/api/accounts/authorize');url.search=new URLSearchParams({client_id:existing?.clientId||'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:a.redirectURI,scope:scopes,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...(existing?{}:{agent_name_hint:'gfot'}),...(existing?.idToken?{id_token_hint:existing.idToken}:{}),...(existing?.email?{login_hint:existing.email}:{})}).toString();
  return {id,authorizationURL:url.href};
 }
 function status(id){const a=attempts.get(id);if(!a)throw new InputError('登录请求不存在');return {id,status:a.status,error:a.error,accountId:a.accountId||null};}
 function cancel(id){const a=attempts.get(id);if(a){a.status='cancelled';clearTimeout(a.timer);a.server?.close();}}
 return {start,status,cancel,close(){for(const id of attempts.keys())cancel(id);}};
}
