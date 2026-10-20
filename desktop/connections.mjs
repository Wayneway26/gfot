import {InputError} from './state.mjs';

const maxResponseBytes = 1024 * 1024;

export class ConnectionError extends InputError {
 constructor(message, status) { super(message); this.status = status; }
}

async function request(profile, key, path, body, fetchImpl = fetch) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 45000);
 try {
  const response = await fetchImpl(profile.baseURL + path, {
   method: body === undefined ? 'GET' : 'POST',
   headers: {...(profile.protocol==='anthropic'?{'x-api-key':key||'local-proxy','anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+(key||'local-proxy')}), ...(body === undefined ? {} : {'content-type': 'application/json'})},
   body: body === undefined ? undefined : JSON.stringify(body),
   signal: controller.signal, redirect: 'error',
  });
  if (!response.ok) {
   await response.body?.cancel();
   const hints = {401: '访问密钥无效或已过期', 403: '账号或模型权限不足', 404: '接口路径或模型不存在，请核对 Base URL', 429: '服务限流或额度不足，请稍后再试或切换连接'};
   throw new ConnectionError(hints[response.status] || '模型服务请求失败', response.status);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
   size += chunk.length;
   if (size > maxResponseBytes) { controller.abort(); throw new ConnectionError('模型服务响应超过大小限制'); }
   chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ConnectionError('服务返回的不是有效 JSON，请确认使用 OpenAI Chat Completions 兼容接口'); }
 } catch (error) {
  if (error instanceof ConnectionError) throw error;
  throw new ConnectionError(controller.signal.aborted ? '连接超时，请检查服务状态或本地模型是否已加载' : '无法连接模型服务，请核对地址、网络和本地服务状态');
 } finally { clearTimeout(timer); }
}

export async function listModels(profile, key, fetchImpl) {
 const result = await request(profile, key, '/models', undefined, fetchImpl);
 if (!Array.isArray(result.data)) throw new ConnectionError('服务未返回兼容的模型列表；可手动填写模型 ID');
 const models = [...new Set(result.data.map(item => item?.id).filter(id => typeof id === 'string' && id.length <= 160))].slice(0, 500);
 return {reachable: true, modelListed: models.includes(profile.model), models, note: '模型列表可达不代表推理、额度或工具调用已验证。'};
}

// Fixed diagnostic messages only. No project files, user conversation or commands.
export async function verifyConnection(profile, key, fetchImpl) {
 const toolName = 'gfot_connection_probe';
 const messages = [{role: 'user', content: 'Connection diagnostic only. Call gfot_connection_probe with ok=true. Do not do anything else.'}];
 const first = await request(profile, key, '/chat/completions', {
  model: profile.model, stream: false, max_tokens: 128, messages,
  tools: [{type: 'function', function: {name: toolName, description: 'A harmless connection test. Does not access files or execute commands.', parameters: {type: 'object', properties: {ok: {type: 'boolean'}}, required: ['ok'], additionalProperties: false}}}],
  tool_choice: {type: 'function', function: {name: toolName}},
 }, fetchImpl);
 const assistant = first.choices?.[0]?.message;
 if (!assistant) throw new ConnectionError('服务未返回兼容的模型消息');
 const call = assistant.tool_calls?.find(item => item.type === 'function' && item.function?.name === toolName && typeof item.id === 'string');
 let args;
 try { args = JSON.parse(call?.function.arguments); } catch {}
 if (!call || args?.ok !== true) return {inference: true, toolCalling: false, note: '模型返回了消息，但未完成工具调用检查。请使用支持 function calling 的模型。'};
 const final = await request(profile, key, '/chat/completions', {
  model: profile.model, stream: false, max_tokens: 128,
  messages: [...messages, assistant, ...assistant.tool_calls.map(item => ({role: 'tool', tool_call_id: item.id, content: item.id === call.id ? '{"ok":true,"diagnostic":true}' : '{"error":"Unsupported diagnostic call"}'})), {role: 'user', content: 'The diagnostic completed. Reply with a short acknowledgement.'}],
 }, fetchImpl);
 const text = final.choices?.[0]?.message?.content;
 return {inference: true, toolCalling: typeof text === 'string' && !!text.trim(), note: typeof text === 'string' && text.trim() ? '推理与工具结果回传通过。此检查不代表订阅额度已查询，也不能替代实际项目任务验证。' : '工具调用成功，但模型未确认工具结果。请核对接口兼容性。'};
}
