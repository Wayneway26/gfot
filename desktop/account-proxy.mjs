import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {InputError} from './state.mjs';
import {readEvents} from './engine.mjs';

// A Responses gateway. Protocol translation into OpenCode tool events is handled
// by its bundled OpenAI SDK; subscription credentials never enter that process.
export function prepareSubscriptionRequest(body,{legacy=false,model}){
 if(body.model!==model||!Array.isArray(body.input))throw new InputError('代理模型或上下文格式不匹配');
 const forbidden=['background','conversation','max_output_tokens','max_tool_calls','metadata','moderation','multi_agent','prompt','prompt_cache_retention','safety_identifier','temperature','top_logprobs','top_p','truncation','user','previous_response_id'];
 const result=structuredClone(body);for(const key of forbidden)delete result[key];result.store=false;result.stream=true;
 result.input=result.input.map(item=>{
  if(item.role==='system')return {...item,role:'developer'};
  if(!legacy&&item.type==='function_call')return {...item,namespace:item.namespace||'gfot'};
  return item;
 });
 if(!legacy&&result.tools?.length){
  if(result.tools.some(t=>t.type!=='function'&&t.type!=='namespace'))throw new InputError('此订阅连接只支持本地 function 工具');
  const functions=result.tools.filter(t=>t.type==='function');result.tools=[...result.tools.filter(t=>t.type==='namespace'),...(functions.length?[{type:'namespace',name:'gfot',description:'User-approved local coding tools',tools:functions}]:[])];
  if(result.tool_choice?.type==='function')result.tool_choice={...result.tool_choice,namespace:result.tool_choice.namespace||'gfot'};
 }
 if(legacy)result.instructions||='You are a coding assistant. Use the provided tools only with user approval.';
 result.include=[...new Set([...(result.include||[]),'reasoning.encrypted_content'])];
 return result;
}
export async function startAccountProxy({accounts,fetchImpl=fetch}){
 const grants=new Map(),controllers=new Set();let origin;
 const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const fail=(status,message)=>{if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message,type:'gfot_account_proxy'}}));};
  let controller,grant;
  try{
   if(req.headers.host!==new URL(origin).host||req.headers.origin)return fail(403,'仅允许本机执行器请求');
   const token=req.headers.authorization?.replace(/^Bearer /,'');grant=[...grants.values()].find(g=>same(token,g.token));if(!grant)return fail(401,'代理授权已失效');
   controller=new AbortController();controllers.add(controller);grant.controllers.add(controller);
   controller.signal.addEventListener('abort',()=>{if(!req.complete)req.destroy();},{once:true});
   const deadline=setTimeout(()=>controller.abort(),15*60*1000);
   res.on('close',()=>{clearTimeout(deadline);if(!res.writableEnded)controller.abort();});
   if(req.url!=='/v1/responses'||req.method!=='POST')return fail(404,'此代理仅接受 Responses 推理请求');
   if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'请求需要 JSON');
   let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>2*1024*1024)return fail(413,'上下文超过代理请求上限');chunks.push(b);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return fail(400,'JSON 格式无效');}
   const a=accounts.find(grant.accountId),prepared=prepareSubscriptionRequest(body,{legacy:a.source==='codex-local',model:grant.model});
   if(grants.get(grant.token)!==grant||controller.signal.aborted)throw new InputError('代理授权已撤销');
   let c=await accounts.access(a.id);
   const request=()=>{if(grants.get(grant.token)!==grant||controller.signal.aborted)throw new InputError('代理授权已撤销');return fetchImpl(accounts.endpoint(a)+'/responses',{method:'POST',headers:accounts.headers(a,c),body:JSON.stringify(prepared),signal:controller.signal,redirect:'error'});};
   let upstream=await request();
   if(upstream.status===401&&a.source==='chatgpt'){await upstream.body?.cancel();c=await accounts.access(a.id,{force:true});upstream=await request();}
   if(!upstream.ok){await upstream.body?.cancel();return fail(upstream.status===429?429:upstream.status===401?401:502,upstream.status===429?'该账号限流或额度不足。结束本轮后可选择其他账号继续；不会在执行中途自动重放任务。':upstream.status===401?'账号授权失效，请重新登录或导入':'上游订阅请求失败（'+upstream.status+'）');}
   // Some Codex gateways omit Content-Type; completion events remain mandatory.
   const contentType=upstream.headers.get('content-type');
   if(contentType&&!contentType.includes('text/event-stream')){await upstream.body?.cancel();return fail(502,'上游未返回 Responses 事件流');}
   res.writeHead(200,{'content-type':'text/event-stream'});
   let completed=false;
   // Parse then re-emit complete SSE frames, so malformed/truncated upstream
   // responses cannot be reported as a successful account check.
   for await(const event of readEvents(upstream.body)){
    if(controller.signal.aborted||grants.get(grant.token)!==grant)throw new InputError('代理授权已撤销');
    if(event.type==='response.completed')completed=true;
    if(!res.write('event: '+String(event.type||'message').replace(/[\r\n]/g,'')+'\ndata: '+JSON.stringify(event)+'\n\n'))await new Promise((resolve,reject)=>{res.once('drain',resolve);res.once('close',()=>reject(Error('closed')));});
   }
   if(!completed){res.write('event: error\ndata: '+JSON.stringify({type:'error',code:'gfot_incomplete_stream',message:'上游流未完整完成，请核对执行结果后继续。'})+'\n\n');}
   else accounts.markInference(a.id);
   res.end();
  }catch(error){fail(error instanceof InputError?400:502,error instanceof InputError?error.message:'订阅代理连接中断，请核对执行结果后重试');}
  finally{if(controller){controllers.delete(controller);grant?.controllers.delete(controller);}}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 function grant(accountId,model){accounts.find(accountId);const token=randomBytes(32).toString('hex');grants.set(token,{token,accountId,model,controllers:new Set()});return {baseURL:origin+'/v1',key:token,revoke(){const g=grants.get(token);if(g)for(const c of g.controllers)c.abort();grants.delete(token);}};}
 return {url:origin,grant,revokeAccount(id){for(const [token,g]of grants)if(g.accountId===id){for(const c of g.controllers)c.abort();grants.delete(token);}},async close(){for(const c of controllers)c.abort();grants.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
export async function verifyResponses(profile,key,fetchImpl=fetch){
 const call=async input=>{
  let response;try{response=await fetchImpl(profile.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({...input,model:profile.model,store:false,stream:true}),redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw new InputError('Responses 连接失败或超时');}
  if(!response.ok){await response.body?.cancel();throw new InputError('Responses 检查失败（'+response.status+'），请核对账号授权、模型和额度');}
  let completed;for await(const event of readEvents(response.body)){if(event.type==='response.completed')completed=event.response;if(event.type==='response.failed'||event.type==='error')throw new InputError('Responses 推理未成功完成');}
  if(!completed)throw new InputError('Responses 流没有完成事件，不能认定推理成功');return completed;
 };
 const first=await call({input:[{role:'user',content:'Diagnostic only. Call gfot_connection_probe with ok=true.'}],tools:[{type:'function',name:'gfot_connection_probe',description:'Harmless protocol diagnostic; no file access or commands.',parameters:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}],tool_choice:{type:'function',name:'gfot_connection_probe'}});
 const tool=first.output?.find(p=>p.type==='function_call'&&p.name==='gfot_connection_probe');let args;try{args=JSON.parse(tool?.arguments);}catch{}
 if(!tool||args?.ok!==true)return {inference:true,toolCalling:false,note:'模型完成了推理，但没有返回预期的工具调用。'};
 const second=await call({input:[{role:'user',content:'Diagnostic only. Call gfot_connection_probe with ok=true.'},...first.output,...first.output.filter(p=>p.type==='function_call').map(p=>({type:'function_call_output',call_id:p.call_id,output:p.call_id===tool.call_id?'{}':'{"unsupported":true}'})),{role:'user',content:'Acknowledge the diagnostic result briefly.'}]});
 const text=second.output?.filter(p=>p.type==='message').flatMap(p=>p.content||[]).some(p=>p.type==='output_text'&&p.text);
 return {inference:true,toolCalling:!!text,note:text?'Responses 推理、工具调用与结果回传通过。额度是否充足仍以服务端执行结果为准。':'工具调用成功，但没有确认工具结果。'};
}
