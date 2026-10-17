// Synthetic fixture only; no repository source is published by this script.
import { writeFileSync } from 'node:fs';
const request=async(path,body)=>{const response=await fetch('http://127.0.0.1:4317/api/projects'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
const p=await request('',{title:'WorkBuddy 连接演示（合成示例）',goal:'验证 MCP 领取及回传；仅静态检查示例加法函数，不读取原目录。',repo:'synthetic-only',baseline:'demo-base',scope:'example.mjs；仅用于连接演示',criteria:'函数使用 a + b 返回两个数的和\n不能运行命令的事项如实注明',constraints:'只用 AgentSummary MCP，不运行命令，不读其他文件，不使用记忆连接器。此演示不代表产品源码通过审查。',implementer:'演示夹具',reviewer:'WorkBuddy'});
await request('/'+p.id,{action:'dispatch'});
await request('/'+p.id,{action:'result',summary:'合成加法函数，仅用于协议联调',artifact:'新增 export const add = (a, b) => a + b;',version:'mcp-demo-v1',evidence:'静态文本示例',tests:'未运行；本任务仅验证 MCP',issues:'没有运行证据',next:'静态审查后通过连接器交回，不作用户验收'});
writeFileSync(new URL('./demo-project.json',import.meta.url),JSON.stringify({projectId:p.id,version:'mcp-demo-v1'},null,2));
writeFileSync(new URL('./example.mjs',import.meta.url),'export const add = (a, b) => a + b;\n');
console.log(JSON.stringify({projectId:p.id}));
