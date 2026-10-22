import {randomUUID} from 'node:crypto';
const labels={starting:'正在连接 Agent',waiting:'等待 Agent 响应',thinking:'正在思考',working:'正在处理任务',output:'正在生成回答',permission:'等待你的确认',stopping:'正在停止执行',finishing:'正在整理结果'};
export function beginExecution(task){task.execution={id:randomUUID(),startedAt:new Date().toISOString(),phase:'starting',label:labels.starting,steps:[]};}
export function executionPhase(task,phase,detail=''){
 const e=task.execution;if(!e||e.finishedAt||e.phase==='stopping'&&phase!=='stopping')return;
 if(task.pending?.length&&phase!=='stopping')phase='permission';
 e.phase=phase;e.label=labels[phase]||labels.working;e.detail=String(detail).slice(0,300);
}
export function toolActivity(task,part){
 const e=task.execution;if(!e||e.finishedAt)return;
 const tool=String(part.tool||'工具').slice(0,120),status=part.state?.status||'pending';let step=e.steps.find(s=>s.id===part.id);
 if(!step){step={id:part.id||randomUUID(),kind:'tool',tool,startedAt:new Date().toISOString()};e.steps.push(step);e.steps=e.steps.slice(-40);}
 const action=/read|glob|grep|list|search|读取|搜索/i.test(tool)?'正在查阅项目':/edit|write|patch|修改|写入/i.test(tool)?'正在修改文件':/bash|terminal|exec|command|命令/i.test(tool)?'正在运行命令':'正在使用工具';
 Object.assign(step,{tool,status,detail:part.state?.input!==undefined?String(typeof part.state.input==='string'?part.state.input:JSON.stringify(part.state.input)).slice(0,500):step.detail||''});
 if(['completed','failed','error','cancelled'].includes(status))step.finishedAt=new Date().toISOString();
 if(!['completed','failed','error','cancelled'].includes(status)){executionPhase(task,'working',tool);if(e.phase==='working')e.label=action;}
 else if(e.phase!=='output'&&e.phase!=='thinking'){const current=e.steps.find(t=>!['completed','failed','error','cancelled'].includes(t.status));executionPhase(task,current?'working':'waiting',current?current.tool:tool+' · '+(['failed','error'].includes(status)?'未成功':'已返回'));}
}
export function finishExecution(task,status){const e=task.execution;if(!e)return;e.phase=status;e.label=status==='idle'?'本轮结束':status==='stopped'?'已停止':status==='interrupted'?'执行中断':'执行出错';e.finishedAt=new Date().toISOString();e.detail='';}
