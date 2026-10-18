import { continuationPanel, continuationAction, continuationGuidance } from './handoff.js';
import { bridgePanel, bridgePrompt, openBridgeSetup, openBridgeResult } from './workbuddy.js';
import { openReviewExport } from './review-export.js';
const $ = (s, el = document) => el.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let projects = [], selected = sessionStorage.getItem('selectedProject');
const labels = { ready: '待开始', running: '执行中', rework: '需返工', awaiting: '待用户验收', accepted: '已验收', blocked: '已阻塞', cancelled: '已取消' };
async function api(path, options = {}) { const r = await fetch('/api/projects' + path, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined }); const value = await r.json(); if (!r.ok) throw Error(value.error); return value; }
function toast(text) { $('#toast').textContent = text; $('#toast').style.display = 'block'; setTimeout(() => $('#toast').style.display = 'none', 3000); }
function download(name, content, type = 'text/markdown') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function refresh() { projects = await api(''); render(); }
const button = (text, action, cls = '') => `<button class="${cls}" data-action="${action}">${text}</button>`;
const detail = (label, value) => `<div class="field-label">${label}</div><div class="detail">${escape(value)}</div>`;
const stageNames = { implement: '实现', review: '审查', delivery: '交付' };
let activeTab = 'overview';
let taskFilter = 'all';
let searchQuery = '';
const formatDate = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const statusTag = p => `<span class="status" data-status="${escape(p.status)}"><span class="status-symbol" aria-hidden="true"></span>${labels[p.status]}</span>`;
const shortRepo = repo => repo.replace(/\/$/, '').split('/').pop() || repo;
function selectProject(id) {
  selected = id;
  activeTab = 'overview';
  if (id) sessionStorage.setItem('selectedProject', id);
  else sessionStorage.removeItem('selectedProject');
  render();
  window.scrollTo(0, 0);
}
function projectRows() {
  const filtered = projects.filter(p => {
    const matchesFilter = taskFilter === 'all' || (taskFilter === 'active' ? !['accepted', 'cancelled'].includes(p.status) : p.status === 'accepted');
    return matchesFilter && `${p.title} ${p.repo} ${p.implementer} ${p.reviewer}`.toLowerCase().includes(searchQuery.toLowerCase());
  });
  if (!filtered.length) return '<div class="list-empty">没有符合条件的任务</div>';
  return `<div class="task-table"><div class="table-head"><span>任务</span><span>状态</span><span class="agent-column">当前执行端</span><span class="date-column">更新于</span><span></span></div>${filtered.map(p => `<button class="task-row" data-select="${p.id}"><span class="task-name"><strong>${escape(p.title)}</strong><span class="task-repo">${escape(shortRepo(p.repo))}<span class="row-separator">·</span>${stageNames[p.stage]} / 第 ${p.cycle} 轮</span></span><span>${statusTag(p)}</span><span class="agent-column cell-muted">${escape(p.stage === 'delivery' ? '用户验收' : p.stage === 'implement' ? p.implementer : p.reviewer)}</span><time class="date-column">${formatDate(p.updatedAt)}</time><span class="row-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>`;
}
function renderHome() {
  const active = projects.filter(p => !['accepted', 'cancelled'].includes(p.status)).length;
  return `<div class="page-heading"><div><h1>任务</h1><span class="page-description">${projects.length} 个任务<span class="row-separator">·</span>${active} 个进行中</span></div>${button('新建任务', 'new', 'primary')}</div>
    <div class="list-toolbar"><div class="filters" aria-label="任务筛选">${[['all', '全部', projects.length], ['active', '进行中', active], ['accepted', '已验收', projects.filter(p => p.status === 'accepted').length]].map(([value, label, count]) => `<button data-filter="${value}" class="${taskFilter === value ? 'selected' : ''}" aria-pressed="${taskFilter === value}">${label}<span>${count}</span></button>`).join('')}</div><input class="search" aria-label="搜索任务" type="search" placeholder="搜索任务…" value="${escape(searchQuery)}"></div>
    <div id="task-list">${projects.length ? projectRows() : `<div class="empty"><h2>还没有任务</h2><p>新建任务，填写目标、仓库和验收条件。</p>${button('新建任务', 'new', 'primary')}</div>`}</div>`;
}
function nextAction(p) {
  const continuation=continuationGuidance(p,{button});
  if(continuation)return continuation;
  const job=p.reviewJobs?.at(-1);
  if(p.stage==='review' && p.status==='running' && job && ['queued','reviewing','submitted','expired'].includes(job.status)) return [job.status==='queued'?'审查副本等待领取':job.status==='reviewing'?'审查副本已领取':job.status==='submitted'?'审查结果已返回':'派发已过期',job.status==='submitted'?'核对证据与问题后应用，不会自动验收。':'通过 WorkBuddy 连接器领取与提交；状态以实际工具回执为依据。',button(job.status==='submitted'?'查看返回结果':'连接配置',job.status==='submitted'?'bridge_result':'bridge_setup','primary')];
  if (p.status === 'blocked') return ['任务已阻塞', escape(p.blockReason), button('解除阻塞', 'resume', 'primary')];
  if (p.status === 'accepted') return ['已验收', escape(p.acceptance), button('查看交付包', 'delivery')];
  if (p.status === 'cancelled') return ['任务已取消', '已保留此前的执行与交接记录。', ''];
  if (p.status === 'awaiting') return ['等待验收', '审查已通过，请核对代码变更与验证结果。', button('查看交付包', 'delivery', 'primary') + button('验收', 'accept') + button('退回', 'reject')];
  if (p.status === 'running') return [`${stageNames[p.stage]}进行中`, `完成后录入结果。执行状态由你手工更新。`, button(p.stage === 'implement' ? '录入实现结果' : '录入审查结果', p.stage === 'implement' ? 'result' : 'review', 'primary') + button('查看任务包', 'pack') + (p.stage === 'review' ? button('准备审查副本', 'bundle') : '')];
  return [p.status === 'rework' ? '待返工' : `待${stageNames[p.stage]}`, `将任务包交给 ${escape(p.stage === 'implement' ? p.implementer : p.reviewer)}，然后确认发出。`, button('查看任务包', 'pack', 'primary') + (p.stage === 'review' ? button('准备审查副本', 'bundle') : '') + button('确认已发出', 'dispatch')];
}
function overviewContent(p) {
  const criteria = p.criteria.split('\n').filter(s => s.trim());
  return `<section class="document-section"><h2>目标</h2><p class="detail goal-text">${escape(p.goal)}</p></section>
    <section class="document-section"><h2>验收条件 <span class="section-count">${criteria.length}</span></h2><ul class="criteria-list">${criteria.map(c => `<li><span class="criterion-marker" aria-hidden="true"></span><span>${escape(c)}</span></li>`).join('')}</ul></section>
    <section class="document-section"><h2>范围与约束</h2><dl class="scope-list"><dt>修改范围</dt><dd>${escape(p.scope)}</dd><dt>约束</dt><dd>${escape(p.constraints)}</dd></dl></section>
    <section class="document-section activity-section"><h2>动态 <span class="section-count">${p.history.length}</span></h2><ol class="activity-list">${p.history.map(h => `<li><span class="activity-dot" aria-hidden="true"></span><div>${escape(h.message)}</div><time>${formatDate(h.at)}</time></li>`).join('')}</ol></section>`;
}
function memoryContent(p) {
  return `<section class="document-section"><div class="section-head"><div><h2>项目记忆</h2><p class="hint">待复核的结论不会加入新的任务包。</p></div>${button('记录结论', 'memory')}</div>${p.memories.length ? p.memories.map(m => `<article class="memory ${m.state === '待复核' ? 'stale' : ''}"><div class="record-meta"><span class="tag">${escape(m.kind)}</span><span>${escape(m.state)}</span><time>${formatDate(m.at)}</time></div><p class="detail">${escape(m.text)}</p><div class="memory-source">${escape(m.evidence)}<span class="row-separator">·</span><code>${escape(m.version)}</code><span class="row-separator">·</span>${escape(m.confirmedBy)}</div></article>`).join('') : '<div class="tab-empty">暂无结论记录</div>'}</section>`;
}
function recordsContent(p) {
  const records = [...p.runs.map(r => ({ ...r, type: '实现' })), ...p.reviews.map(r => ({ ...r, type: '审查' }))].sort((a, b) => b.at.localeCompare(a.at));
  const properties = { summary: '完成内容', artifact: '变更引用', version: '代码版本', evidence: '决策与依据', tests: '验证结果', issues: '已知问题', next: '后续操作', raw: '原始输出', reviewedVersion: '审查版本', source: '审查来源', criteriaEvidence: '验收判断', findings: '审查问题' };
  return `<section class="document-section"><h2>执行记录</h2>${records.length ? records.map(r => `<details class="run"><summary><span>${r.type}<span class="row-separator">·</span>第 ${r.cycle} 轮</span><span class="record-meta">${r.stale ? '待复核' : r.verdict ? r.verdict === 'pass' ? '审查通过' : '需返工' : '材料已录入'}<time>${formatDate(r.at)}</time></span></summary><div class="run-content">${Object.entries(properties).filter(([key]) => r[key]).map(([key, label]) => detail(label, r[key])).join('')}<div class="record-footnote">需求 v${r.revision}</div></div></details>`).join('') : '<div class="tab-empty">暂无执行记录</div>'}</section>`;
}
function renderProject(p) {
  const guidance = nextAction(p);
  const stage = { implement: 0, review: 1, delivery: 2 }[p.stage];
  return `<div class="project-heading"><div class="project-reference">${escape(shortRepo(p.repo))}<span class="row-separator">/</span><code>${p.id.slice(0, 8)}</code></div><div class="title-line"><h1>${escape(p.title)}</h1>${statusTag(p)}</div><div class="project-meta-line">需求 v${p.revision}<span class="row-separator">·</span>第 ${p.cycle} 轮<span class="row-separator">·</span>更新于 ${formatDate(p.updatedAt)}</div></div>
    <div class="workflow" aria-label="任务阶段">${['实现', '审查', '交付'].map((name, i) => `<span class="workflow-step ${i === stage ? 'current' : i < stage ? 'done' : ''}" ${i === stage ? 'aria-current="step"' : ''}><span class="step-number">${i < stage ? '✓' : i + 1}</span>${name}</span>${i < 2 ? '<span class="step-line" aria-hidden="true"></span>' : ''}`).join('')}</div>
    <section class="action-strip"><div><h2>${guidance[0]}</h2><p>${guidance[1]}</p></div><div class="actions">${guidance[2]}</div></section>
    ${continuationPanel(p)}${bridgePanel(p)}<div class="project-layout"><div class="project-document"><div class="tabs" role="tablist" aria-label="任务详情">${[['overview', '概览'], ['records', '执行记录', p.runs.length + p.reviews.length], ['memory', '记忆', p.memories.length]].map(([value, label, count]) => `<button id="tab-${value}" role="tab" aria-controls="project-content" aria-selected="${activeTab === value}" tabindex="${activeTab === value ? 0 : -1}" data-tab="${value}">${label}${count !== undefined ? `<span class="tab-count">${count}</span>` : ''}</button>`).join('')}</div><div id="project-content" role="tabpanel" aria-labelledby="tab-${activeTab}">${activeTab === 'overview' ? overviewContent(p) : activeTab === 'memory' ? memoryContent(p) : recordsContent(p)}</div></div>
    <section class="properties" aria-label="任务属性"><h2>属性</h2><dl><dt>仓库</dt><dd class="repo-path">${escape(p.repo)}</dd><dt>代码基准</dt><dd><code>${escape(p.baseline)}</code></dd><dt>实现</dt><dd><span class="agent-initial" aria-hidden="true">${escape(p.implementer.slice(0, 1))}</span>${escape(p.implementer)}</dd><dt>审查</dt><dd><span class="agent-initial" aria-hidden="true">${escape(p.reviewer.slice(0, 1))}</span>${escape(p.reviewer)}</dd><dt>创建于</dt><dd>${formatDate(p.createdAt)}</dd></dl><div class="property-actions">${p.stage==='implement' && ['ready','running','rework'].includes(p.status)?button('切换执行端','handoff_publish'):''}${button('编辑需求与版本', 'revise')}${button('导出项目数据', 'export')}${!['accepted', 'cancelled', 'blocked'].includes(p.status) ? button('标记阻塞', 'block') : ''}${!['accepted', 'cancelled'].includes(p.status) ? button('取消任务', 'cancel') : ''}</div><details class="project-options"><summary>更多操作</summary>${button('删除本地记录', 'delete', 'danger')}</details><p class="property-footnote">执行状态由用户记录。<br>任务包需在外部 Agent 中运行。</p></section></div>`;
}
function render() {
  const p = projects.find(p => p.id === selected);
  $('#project-count').textContent = projects.length;
  $('#overview').classList.toggle('active', !p);
  $('#projects').innerHTML = projects.map(x => `<button data-select="${x.id}" class="${x.id === selected ? 'active' : ''}" title="${escape(x.title)}"><span class="nav-state" data-status="${x.status}" aria-hidden="true"></span><span>${escape(x.title)}</span></button>`).join('') || '<span class="nav-empty">暂无任务</span>';
  $('#breadcrumb').textContent = p?.title || '全部任务';
  $('#view').innerHTML = p ? renderProject(p) : renderHome();
}
function modal(title, content) { $('#dialog-content').innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="close" aria-label="关闭">×</button></div>${content}`; $('.close').onclick = () => $('#dialog').close(); if (!$('#dialog').open) $('#dialog').showModal(); }
const field = (name, label, value = '', multiline = false, placeholder = '') => `<label>${escape(label)}${multiline ? `<textarea name="${name}" aria-label="${escape(label)}" required placeholder="${escape(placeholder)}">${escape(value)}</textarea>` : `<input name="${name}" aria-label="${escape(label)}" required value="${escape(value)}" placeholder="${escape(placeholder)}">`}</label>`;
function form(title, fields, submit, onsubmit, importable = false) {
  modal(title, `<form>${importable ? '<label class="import">导入执行端返回的 JSON（仅填入表单，提交前请核对）<input type="file" accept=".json,application/json" id="import-result"></label>' : ''}${fields}<div class="error" role="alert"></div><div class="actions"><button type="submit" class="primary">${submit}</button></div></form>`);
  if (importable) $('#import-result').onchange = async e => { try { const f = e.target.files[0]; if (!f) return; if (f.size > 2_000_000) throw Error('文件不能超过 2 MB'); const values = JSON.parse(await f.text()); for (const el of $('form').elements) if (el.name && Object.hasOwn(values, el.name) && typeof values[el.name] === 'string') el.value = values[el.name]; toast('已填入，请核对后提交'); } catch (err) { $('.error').textContent = '导入失败：' + err.message; } };
  $('form').onsubmit = async e => { e.preventDefault(); const b = $('button[type=submit]'); b.disabled = true; try { await onsubmit(Object.fromEntries(new FormData(e.target))); $('#dialog').close(); await refresh(); } catch (err) { $('.error').textContent = err.message; } finally { b.disabled = false; } };
}
function create() { form('创建代码任务', field('title', '任务名称', '', false, '例如：为登录模块增加输入校验') + field('goal', '目标', '', true) + `<div class="two-cols">${field('repo', '仓库位置', '', false, '/path/to/repository')}${field('baseline', '代码基准', '', false, '提交 SHA 或明确的快照标识')}</div>` + field('scope', '修改范围', '', true) + field('constraints', '约束（无则填无）', '无') + field('criteria', '验收条件（每行一项）', '', true) + `<div class="two-cols">${field('implementer', '实现执行端', 'Codex')}${field('reviewer', '审查执行端', '', false, '另一工具或独立新会话')}</div><p class="hint">执行端名称用于分工记录，不代表已接入。仓库路径不会自动读取或发送。</p>`, '创建任务', async values => { const p = await api('', { method: 'POST', body: values }); selectProject(p.id); }); }
async function action(name) {
  const p = projects.find(p => p.id === selected);
  if (name === 'new') return create();
  if (!p && name !== 'bridge_setup') return;
  if (name === 'bridge_setup') return openBridgeSetup({modal,download});
  if(name.startsWith('handoff_'))return continuationAction(name,p,{form,field,api,modal,download,toast});
  const job=p.reviewJobs?.at(-1);
  const applyBridge=async jobId=>{await api('/'+p.id,{method:'POST',body:{action:'bridge_apply',jobId}});await refresh();};
  if (name === 'bridge_result' || name === 'bridge_apply') return openBridgeResult(p,{modal,apply:applyBridge});
  if (name === 'bridge_prompt') {try {await navigator.clipboard.writeText(bridgePrompt(job));toast('已复制领取指令');}catch{toast('复制失败，请在连接器中领取任务');}return;}
  if (name === 'bridge_cancel' || name === 'bridge_retry') return form(name==='bridge_cancel'?'取消本次派发':'重新派发审查', '<p class="note">旧领取凭证和迟到结果将失效；记录仍然保留。</p>', '确认', async()=>{await api('/'+p.id,{method:'POST',body:{action:name,jobId:job.id}});});
  if (name === 'bundle') return openReviewExport(p, { api, modal, download, toast, refresh });
  const send = values => api('/' + p.id, { method: 'POST', body: { ...values, action: name } });
  if (name === 'pack' || name === 'delivery') {
    const result = await api(`/${p.id}/${name}`); modal(name === 'pack' ? '交接包预览' : '统一交付包', `<p class="hint">检查后再发送；本地路径需要对方可访问，必要时附文件或 diff。</p><pre class="pack-preview">${escape(result.text)}</pre><div class="actions"><button id="copy-pack" class="primary">复制全文</button><button id="download-pack">下载 Markdown</button></div>`);
    $('#copy-pack').onclick = async () => { try { await navigator.clipboard.writeText(result.text); toast('已复制'); } catch { toast('复制不可用，请下载 Markdown'); } }; $('#download-pack').onclick = () => download(`${p.title.replace(/[/\\]/g, '-')}-${name}.md`, result.text); return;
  }
  if (name === 'export') return download('gfot-project.json', JSON.stringify(p, null, 2), 'application/json');
  if (name === 'delete') return form('删除本地项目记录', '<p class="note">只删除此工作台中的记录，不影响仓库和外部会话。此操作不可撤销，建议先导出项目。</p>' + field('confirmation', `输入项目名称“${p.title}”确认`), '删除记录', async v => { if (v.confirmation !== p.title) throw Error('项目名称不匹配'); await api('/' + p.id, { method: 'DELETE' }); selected = null; });
  if (name === 'result') return form('带回实现结果', field('summary', '完成内容', '', true) + field('artifact', '提交引用或 diff（接收方必须可访问）', '', true) + field('version', '当前代码版本或快照标识') + field('evidence', '关键决策、约束与证据', '', true) + field('tests', '验证方式与结果，明确未执行项', '', true) + field('issues', '已知问题 / 待验证判断', '无', true) + field('next', '下一步动作与完成条件', '对照原始验收条件进行独立审查', true) + '<label>原始输出（可选）<textarea name="raw"></textarea></label>', '保存并进入审查', send, true);
  if (name === 'review') return form('带回独立审查结果', `<label>审查结论<select name="verdict" aria-label="审查结论"><option value="rework">存在阻断问题，需要返工</option><option value="pass">无阻断问题，可提交用户验收</option></select></label>` + field('reviewedVersion', '实际审查的代码版本', '', false, '须与本轮实现版本完全一致') + field('source', '审查执行端 / 独立会话说明', p.reviewer) + field('criteriaEvidence', '逐项验收判断与证据', '', true) + field('findings', '阻断问题、建议及未验证事项（无则填无）', '', true), '保存审查结论', send, true);
  if (name === 'memory') return form('记录项目结论', '<label>类型<select name="kind" aria-label="类型"><option>事实</option><option>决策</option><option>假设</option></select></label>' + field('text', '结论', '', true) + field('evidence', '来源 / 文件版本 / 验证证据', '', true) + field('version', '证据对应代码版本', p.runs.findLast(r => r.revision === p.revision && !r.stale)?.version || p.baseline), '保存结论', send);
  if (name === 'revise') return form('更新需求与代码版本', '<p class="note">这会开启新一轮实现，既有结果、审查和记忆将待复核。此前记录保留。</p>' + field('repo', '仓库位置（改名或迁移后更新）', p.repo) + field('goal', '目标', p.goal, true) + field('criteria', '验收条件', p.criteria, true) + field('baseline', '代码基准', p.baseline), '更新并重新开始', send);
  if (name === 'accept') return form('确认交付验收', '<p class="note">请确认已检查实际代码变更、逐项验收证据与剩余风险。</p>' + field('note', '验收说明', '', true), '确认验收通过', send);
  if (name === 'block' || name === 'reject') return form(name === 'block' ? '标记阻塞' : '退回实现', field('reason', name === 'block' ? '阻塞原因与解除条件' : '退回原因与修复要求', '', true), '确认', send);
  if (name === 'cancel') return form('取消任务', '<p>取消后保留已有记录，但不能继续执行。</p>', '确认取消', send);
  await send({}); await refresh();
}
document.addEventListener('click', e => {
  const project = e.target.closest('[data-select]');
  if (project) return selectProject(project.dataset.select);
  const filter = e.target.closest('[data-filter]');
  if (filter) { taskFilter = filter.dataset.filter; render(); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { activeTab = tab.dataset.tab; render(); document.getElementById('tab-' + activeTab).focus(); return; }
  const target = e.target.closest('[data-action]');
  if (target) action(target.dataset.action).catch(err => toast(err.message));
});
document.addEventListener('input', e => {
  if (e.target.matches('.search')) { searchQuery = e.target.value; $('#task-list').innerHTML = projectRows(); }
});
document.addEventListener('keydown', e => {
  if (!e.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = ['overview', 'records', 'memory'];
  const index = tabs.indexOf(activeTab);
  activeTab = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
  render(); document.getElementById('tab-' + activeTab).focus();
});
$('#overview').onclick = () => selectProject(null);
$('#new-project').onclick = create;
$('#bridge-settings').onclick = ()=>openBridgeSetup({modal,download}).catch(error=>toast(error.message));
$('#bridge-settings-mobile').onclick = $('#bridge-settings').onclick;
setInterval(async()=>{
  const p=projects.find(p=>p.id===selected);
  if(document.hidden || $('#dialog').open || !(p?.reviewJobs?.some(j=>['queued','reviewing','submitted'].includes(j.status)) || p?.handoffs?.some(h=>['offered','claimed'].includes(h.status))))return;
  try{const next=await api('');if(JSON.stringify(next)!==JSON.stringify(projects)){projects=next;render();}}catch{/* Keep the last saved view during temporary disconnects. */}
},4000);
refresh().catch(err => { $('#view').textContent = '加载失败：' + err.message; });
