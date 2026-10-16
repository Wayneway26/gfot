import { readFileSync } from 'node:fs';
const p=JSON.parse(readFileSync('trials/isolation-002/project.json','utf8'));
const log=readFileSync('trials/isolation-002/container-check-v2.log','utf8');
if(!log.includes('# pass 24')||!log.includes('"hostDataUnreadable":true'))throw Error('Missing successful verification evidence');
const response=await fetch('http://127.0.0.1:4317/api/projects/'+p.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'memory',kind:'事实',text:'最终 v2 的15文件副本通过容器边界探针、语法检查及24/24测试；这是自动化执行证据，不是WorkBuddy复审或用户验收。',evidence:'trials/isolation-002/container-check-v2.log；review-copy-v2.md；bundle-v2.json',version:p.version})});
if(!response.ok)throw Error(await response.text());
console.log('Recorded container evidence; review remains pending');
