import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {InputError} from './state.mjs';

const paths={chat:'/chat/completions',responses:'/responses',anthropic:'/messages'};
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

// Protocol-native relay: dsh speaks each supported protocol. Only short-lived,
// model-bound loopback credentials enter the executor; upstream keys stay here.
export async function startModelProxy({fetchImpl=fetch}={}){
 const grants=new Map();let origin;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const fail=(status,message)=>{if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message,type:'gfot_model_proxy'}}));};
  let grant,controller,timer;
  try{
   if(req.headers.host!==new URL(origin).host||req.headers.origin)return fail(403,'仅允许本机执行器请求');
   const token=req.headers.authorization?.replace(/^Bearer /,'')||req.headers['x-api-key'];
   grant=[...grants.values()].find(g=>same(typeof token==='string'?token:'',g.token));if(!grant)return fail(401,'代理授权已失效');
   const route=new URL(req.url,origin),beta=grant.protocol==='anthropic'&&route.search==='?beta=true';
   if(req.method!=='POST'||route.pathname!=='/v1'+paths[grant.protocol]||(route.search&&!beta))return fail(404,'接口与所选协议不匹配');
   if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'请求需要 JSON');
   controller=new AbortController();grant.controllers.add(controller);timer=setTimeout(()=>controller.abort(),15*60*1000);
   const abort=()=>{if(!req.complete)req.destroy();if(!res.writableEnded)res.destroy();};controller.signal.addEventListener('abort',abort,{once:true});
   res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   const valid=()=>{if(controller.signal.aborted||grants.get(grant.token)!==grant)throw new InputError('代理授权已撤销');};
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return fail(413,'上下文超过代理请求上限');chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return fail(400,'JSON 格式无效');}
   if(!body||Array.isArray(body)||body.model!==grant.model)return fail(400,'代理模型与所选连接不匹配');
   valid();
   const headers={'content-type':'application/json',...(grant.protocol==='anthropic'?{'x-api-key':grant.key||'local-proxy','anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+(grant.key||'local-proxy')})};
   const features=req.headers['anthropic-beta'];
   if(grant.protocol==='anthropic'&&typeof features==='string'){
    if(features.length>1024||!/^[-a-zA-Z0-9,]+$/.test(features))return fail(400,'Anthropic beta 功能格式无效');
    headers['anthropic-beta']=features;
   }
   const endpoint=grant.protocol==='anthropic'?grant.baseURL.replace(/\/v1$/,'')+'/v1/messages':grant.baseURL+paths[grant.protocol];
   const upstream=await fetchImpl(endpoint+(beta?'?beta=true':''),{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:controller.signal});
   valid();
   if(!upstream.ok){await upstream.body?.cancel();return fail([401,403,429].includes(upstream.status)?upstream.status:502,upstream.status===429?'当前连接限流或额度不足，请切换账号后继续；本轮不会自动重放。':upstream.status===401?'上游凭证已失效，请更新账号或 API Key。':'模型服务请求失败（'+upstream.status+'）');}
   const type=upstream.headers.get('content-type')||'';
   if(body.stream===false){
    let bytes=0;const parts=[];for await(const chunk of upstream.body){valid();bytes+=chunk.length;if(bytes>1024*1024)throw new InputError('模型服务 JSON 响应超过大小限制');parts.push(chunk);}
    const text=Buffer.concat(parts).toString();try{JSON.parse(text);}catch{throw new InputError('模型服务未返回有效 JSON');}
    valid();res.writeHead(200,{'content-type':'application/json'});res.end(text);return;
   }
   if(!type.includes('text/event-stream')&&!type.includes('application/json')){await upstream.body?.cancel();return fail(502,'上游未返回模型 JSON 或事件流');}
   res.writeHead(200,{'content-type':type.includes('text/event-stream')?'text/event-stream':'application/json'});
   for await(const chunk of upstream.body){valid();if(!res.write(chunk))await once(res,'drain',{signal:controller.signal});}
   valid();res.end();
  }catch(error){fail(error instanceof InputError?400:502,error instanceof InputError?error.message:'模型代理连接中断，请核对执行记录后继续');}
  finally{clearTimeout(timer);if(controller)grant?.controllers.delete(controller);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 function revoke(token){const g=grants.get(token);grants.delete(token);if(g)for(const controller of g.controllers)controller.abort();}
 return {
  grant(profile,key){
   const protocol=profile.protocol||'chat';if(!paths[protocol])throw new InputError('不支持的模型协议');
   const token=randomBytes(32).toString('hex');grants.set(token,{token,protocol,model:profile.model,baseURL:profile.baseURL,key,controllers:new Set()});
   return {baseURL:origin+'/v1',key:token,protocol,revoke:()=>revoke(token)};
  },
  async close(){for(const token of grants.keys())revoke(token);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
 };
}
