const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={offered:'等待接手',claimed:'已接手',superseded:'已切换到新交接',cancelled:'已取消',obsolete:'已失效',completed:'实现已交回'};
export function continuationGuidance(p,{button}){
  const h=p.handoffs?.at(-1);
  if(p.stage!=='implement' || p.status!=='running' || !h || !['offered','claimed'].includes(h.status))return null;
  return [h.status==='offered'?'等待接手':'接续实现中',`交接目标：${escape(h.snapshot.to)}。核对同一目录与代码版本；不会自动唤起或停止客户端。`,button('查看交接材料','handoff_pack','primary')+(h.status==='offered'?button('手工确认接手','handoff_claim'):button('录入实现结果','result'))];
}
export function continuationPanel(p){
  const h=p.handoffs?.at(-1);if(!h)return '';
  return `<section class="bridge-panel"><div class="section-head"><h2>项目接续 <span class="tag">${labels[h.status]||'未知状态'}</span></h2><span>${escape(h.snapshot.from)} → ${escape(h.snapshot.to)}</span></div><p class="hint">检查点 ${escape(h.latestCheckpoint.version)} · 回写序号 ${h.sequence}。版本为执行端报告；工作台不会自动停止其他客户端。</p><div class="actions"><button data-action="handoff_pack">查看交接材料</button>${h.status==='offered'?'<button data-action="handoff_claim">手工确认接手</button>':''}${['offered','claimed'].includes(h.status)?'<button data-action="handoff_cancel">取消交接</button>':''}</div></section>`;
}
export function continuationAction(name,p,{form,field,api,modal,download,toast}){
  const h=p.handoffs?.at(-1);
  if(name==='handoff_publish'){
    const cp=h?.latestCheckpoint || {};
    const fields=`<p class="note">先停止原执行端。此操作只管理工作台领取与提交，不会强制停止进程。交接将分享本项目目录路径、任务、当前有效记忆和以下检查点；不自动读取源码或共享聊天历史。</p><label>目标执行端<select name="target"><option${p.implementer==='WorkBuddy'?' selected':''}>Codex</option><option${p.implementer!=='WorkBuddy'?' selected':''}>WorkBuddy</option></select></label>${field('reason','切换原因','额度不足 / 手动切换')}${field('version','当前代码版本或明确快照标识',cp.version||p.baseline)}${field('summary','已完成内容',cp.summary||'',true)}${field('artifact','变更引用及未提交修改说明',cp.artifact||'',true)}${field('evidence','关键决策与证据',cp.evidence||'',true)}${field('tests','测试结果及未执行项',cp.tests||'',true)}${field('issues','阻塞与已知问题',cp.issues||'无',true)}${field('next','剩余待办与下一步',cp.next||'',true)}<label class="bundle-confirm"><input type="checkbox" name="stopped" required>我确认原执行端已经停止修改此项目</label><label class="bundle-confirm"><input type="checkbox" name="consent" required>我授权目标执行端读取此交接；材料可能发送到其模型服务</label>`;
    form('保存检查点并切换执行端',fields,'发布交接',async v=>{const {target,reason,stopped,consent,...checkpoint}=v;await api('/'+p.id,{method:'POST',body:{action:name,target,reason,stopped:stopped==='on',consent:consent==='on',expectedGeneration:p.handoffGeneration||0,expectedRevision:p.revision,expectedCycle:p.cycle,previousHandoffId:h?.id||null,expectedSequence:h?.sequence||0,checkpoint}});});return;
  }
  if(name==='handoff_claim'){
    form('手工确认接手',`<p class="note">请在 ${escape(h.snapshot.to)} 中先核对实际目录与代码版本。填写期望值不能替代实际检查。确认后才更新任务执行端。</p>${field('observedRepo','实际核对的本地目录',p.repo)}${field('observedVersion','实际核对的代码版本')}`,'确认已核对并接手',v=>api('/'+p.id,{method:'POST',body:{action:name,handoffId:h.id,agent:h.snapshot.to,...v}}));return;
  }
  if(name==='handoff_cancel'){
    form('取消接续交接','<p class="note">旧领取凭证将失效，记录保留。请自行停止外部客户端中的任务。</p>','确认取消',()=>api('/'+p.id,{method:'POST',body:{action:name,handoffId:h.id}}));return;
  }
  if(name==='handoff_pack'){
    const text=`请在 ${h.snapshot.to} 接续此任务。若已配置 AgentSummary MCP，调用 get_handoff，handoffId 为 ${h.id}；核对实际目录和版本后调用 claim_handoff。使用 save_checkpoint 保存进度，complete_handoff 交回实现。不要替用户审查通过或验收。\n\n若没有连接器，阅读下方材料、核对目录和版本，再请用户在工作台手工确认接手和录入结果。\n\n材料 SHA256：${h.digest}\n${JSON.stringify(h.snapshot,null,2)}\n\n最新回写（原始材料保持不变）：\n${JSON.stringify(h.latestCheckpoint,null,2)}\n\n接续不会迁移隐藏推理、正在运行的进程或客户端权限。`;
    modal('项目接续交接材料',`<pre class="pack-preview">${escape(text)}</pre><div class="actions"><button id="copy-handoff">复制交接材料</button><button id="download-handoff">下载 Markdown</button></div>`);
    document.querySelector('#copy-handoff').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('请下载交接材料');}};
    document.querySelector('#download-handoff').onclick=()=>download('handoff-'+h.id+'.md',text);return;
  }
  throw Error('未知的接续操作');
}
