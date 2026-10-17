// Local stdio MCP transport. It has no shell, arbitrary file, or final-acceptance tools.
import { readFileSync } from 'node:fs';
import { bridgeTools } from '../bridge-tools.mjs';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name)+1];
let url, token;
try {
  if (!args.includes('--url') || !args.includes('--token-file')) throw Error('Missing bridge configuration');
  url = new URL(option('--url'));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Only local 127.0.0.1 bridge URLs are allowed');
  token = readFileSync(option('--token-file'),'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid bridge credential');
} catch { console.error('AgentSummary bridge configuration unavailable. Start the local workbench and regenerate connector settings.'); process.exit(1); }
let initialized = false;
async function request(message) {
  const { id, method, params={} } = message;
  const error = (code,text) => ({jsonrpc:'2.0',id,error:{code,message:text}});
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600,'Invalid request');
  if (id === undefined) return null;
  if (method === 'initialize') {
    initialized=true;
    const versions=['2025-06-18','2024-11-05'];
    return {jsonrpc:'2.0',id,result:{protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'agentsummary-workbuddy',version:'0.2.0'},instructions:'只操作用户明确发布的审查副本或接续交接。审查使用 get_review_job/submit_review；接续使用 get_handoff/claim_handoff/save_checkpoint/complete_handoff。审查不得读取原目录；接续须遵守用户授权的目录和范围，不自动授予文件权限。最终验收由用户完成。'}};
  }
  if (!initialized) return error(-32002,'Initialize first');
  if (method === 'ping') return {jsonrpc:'2.0',id,result:{}};
  if (method === 'tools/list') return {jsonrpc:'2.0',id,result:{tools:bridgeTools}};
  if (method !== 'tools/call') return error(-32601,'Method not found');
  if (!bridgeTools.some(tool=>tool.name===params.name)) return error(-32602,'Unknown bridge tool');
  try {
    const response=await fetch(new URL('/api/bridge',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({name:params.name,arguments:params.arguments || {}}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(data)}],...(response.ok?{}:{isError:true})}};
  } catch { return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:'本机工作台不可达或响应无效。请启动工作台；不要改用文件系统或外部地址获取任务。'}]}}; }
}
let buffer=Buffer.alloc(0), chain=Promise.resolve();
function respond(line) {
  chain=chain.then(async()=>{
    let message; try { message=JSON.parse(line); } catch { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})+'\n'); return; }
    if (!message || typeof message!=='object' || Array.isArray(message)) { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}})+'\n'); return; }
    const result=await request(message); if(result) process.stdout.write(JSON.stringify(result)+'\n');
  }).catch(()=>{ console.error('Bridge request failed'); process.exitCode=1; });
}
process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  if(buffer.length>2_000_000){console.error('MCP request too large');process.exit(1);}
  let end;
  while((end=buffer.indexOf(10))>=0){const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);if(line.trim())respond(line);}
});
process.stdin.on('end',()=>{if(buffer.length && buffer.toString('utf8').trim())respond(buffer.toString('utf8'));});
