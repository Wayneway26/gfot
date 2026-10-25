export const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text){
 const tokens=String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
 return tokens.map(t=>t.startsWith('`')&&t.endsWith('`')?'<code>'+html(t.slice(1,-1))+'</code>':t.startsWith('**')&&t.endsWith('**')?'<strong>'+html(t.slice(2,-2))+'</strong>':html(t)).join('');
}
// A small text-only Markdown subset. Raw HTML, images and executable URLs stay text.
export function markdown(text){
 const lines=String(text??'').split('\n');let out='',paragraph=[],list=null;
 const flush=()=>{if(paragraph.length){out+='<p>'+paragraph.map(inline).join('<br>')+'</p>';paragraph=[];}if(list){out+='</'+list+'>';list=null;}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i],fence=line.match(/^\s*```([\w+-]*)\s*$/);
  if(fence){flush();const code=[];while(++i<lines.length&&!/^\s*```\s*$/.test(lines[i]))code.push(lines[i]);out+='<div class="code-block"><div class="code-heading"><span>'+html(fence[1]||'代码')+'</span><button type="button" data-copy-code>复制</button></div><pre><code>'+html(code.join('\n'))+'</code></pre></div>';continue;}
  const heading=line.match(/^(#{1,4})\s+(.+)$/),item=line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
  if(heading){flush();const level=Math.min(heading[1].length+1,5);out+='<h'+level+'>'+inline(heading[2])+'</h'+level+'>';}
  else if(item){if(paragraph.length){out+='<p>'+paragraph.map(inline).join('<br>')+'</p>';paragraph=[];}const tag=item[1]?'ul':'ol';if(list!==tag){if(list)out+='</'+list+'>';out+='<'+tag+'>';list=tag;}out+='<li>'+inline(item[2])+'</li>';}
  else if(!line.trim()){flush();}
  else if(/^\s*---+\s*$/.test(line)){flush();out+='<hr>';}
  else{if(list){out+='</'+list+'>';list=null;}paragraph.push(line);}
 }
 flush();return out;
}
export function transcript(task,agentName){
 const groups=[];for(const m of task.messages||[]){if(m.role==='user')groups.push({user:m,answers:[]});else{if(!groups.length)groups.push({answers:[]});groups.at(-1).answers.push(m);}}
 return groups.map((g,index)=>{
  const user=g.user?.continuation?`<details class="continuation-note"><summary>已切换，继续原任务</summary><p>${html(g.user.text)}</p></details>`:g.user?`<article class="message user"><div class="role">${g.user.continuation?'接着完成任务':'你'}</div><div class="text">${html(g.user.text)}</div></article>`:'';
  const finalIndex=g.answers.findLastIndex(m=>m.presentation!=='progress');
  const final=g.answers[finalIndex],progress=g.answers.filter(m=>m!==final);
  const process=progress.length?`<details class="turn-process" data-process="${index}"><summary>执行过程 <span>${progress.length} 条更新</span></summary>${progress.map(m=>`<div class="process-update"><div class="role">${html(agentName(m.agentId||'opencode'))}${m.interrupted?' · 未完成':''}</div><div class="markdown">${markdown(m.text)}</div></div>`).join('')}</details>`:'';
  return user+process+(final?`<article class="message assistant ${final.interrupted?'interrupted':''}"><div class="role">${html(agentName(final.agentId||'opencode'))}${final.interrupted?' · 未完成':' · 回答'}</div><div class="markdown">${markdown(final.text)}</div></article>`:'');
 }).join('')+liveResponse(task);
}
export function liveResponse(task){
 const progress=task.liveProgress?.length?`<details class="live-preview" data-process="live-progress"><summary>执行过程 · ${task.liveProgress.length} 条更新</summary>${task.liveProgress.map(t=>'<div class="markdown process-update">'+markdown(t)+'</div>').join('')}</details>`:'';
 if(!task.draft)return progress;
 const text='<div class="markdown live-text">'+markdown(task.draft)+'</div>';
 return progress+(task.execution?.phase==='output'?`<article class="message draft"><div class="role">正在输出</div>${text}</article>`:`<details class="live-preview" data-process="live"><summary>查看当前输出</summary>${text}</details>`);
}
const statuses={pending:'准备中',running:'进行中',in_progress:'进行中',completed:'完成',failed:'失败',error:'失败',cancelled:'已取消'};
export function executionMarkup(task){
 const e=task.execution;if(!e)return '';
 const active=!e.finishedAt,phase=task.transition?'正在交接给下一个 Agent':task.pending?.length?'等待你的确认':e.label;
 const tools=e.steps||[],done=tools.filter(t=>t.status==='completed').length;
 return `<div class="execution-line ${active?'active':''}"><span class="execution-indicator" aria-hidden="true"></span><strong>${html(phase)}</strong><span class="execution-elapsed" data-start="${html(e.startedAt)}" data-end="${html(e.finishedAt||'')}"></span></div>${e.detail?`<div class="execution-detail">${html(e.detail)}</div>`:''}${tools.length?`<details class="execution-steps"><summary>${active?'执行动态':'本轮执行记录'} · 最近 ${tools.length} 项操作${done?'，'+done+' 项完成':''}</summary><ol>${tools.map(t=>`<li><span class="step-state ${t.status==='completed'?'complete':''}">${html(statuses[t.status]||'已报告')}</span><span>${html(t.tool)}</span>${t.detail?`<pre>${html(t.detail)}</pre>`:''}</li>`).join('')}</ol></details>`:''}`;
}

export function recentTasks(tasks){
 const activity=task=>{const updated=Date.parse(task.updatedAt),created=Date.parse(task.createdAt);return Number.isFinite(updated)?updated:Number.isFinite(created)?created:0;};
 return [...tasks].sort((a,b)=>activity(b)-activity(a)).slice(0,4);
}
