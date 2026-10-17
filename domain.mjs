import { randomUUID } from 'node:crypto';

export class ValidationError extends Error {}
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`请填写${label}`);
  return value.trim();
};
const now = () => new Date().toISOString();
function event(p, message) { p.updatedAt = now(); p.history.unshift({ at: p.updatedAt, revision: p.revision, cycle: p.cycle, message }); }
function requirementSnapshot(p) { return { revision: p.revision, repo: p.repo, goal: p.goal, criteria: p.criteria, baseline: p.baseline, scope: p.scope, constraints: p.constraints }; }
export function createProject(input) {
  const p = { id: randomUUID(), createdAt: now(), updatedAt: now(), revision: 1, cycle: 1,
    stage: 'implement', status: 'ready', blockedFrom: null, memories: [], runs: [], reviews: [], history: [],
    title: required(input.title, '任务名称'), goal: required(input.goal, '目标'),
    repo: required(input.repo, '仓库位置'), baseline: required(input.baseline, '代码基准'),
    scope: required(input.scope, '修改范围'), constraints: input.constraints?.trim() || '无额外约束',
    criteria: required(input.criteria, '验收条件'), implementer: required(input.implementer, '实现执行端'),
    reviewer: required(input.reviewer, '审查执行端') };
  p.requirements = [requirementSnapshot(p)]; p.dispatches = []; event(p, '项目已创建，等待发出实现任务'); return p;
}
export function currentRun(p) { return p.runs.findLast(r => r.revision === p.revision && r.cycle === p.cycle && !r.stale); }
export function currentReview(p) { return p.reviews.findLast(r => r.revision === p.revision && r.cycle === p.cycle && !r.stale); }
export function act(p, action, input = {}) {
  if (action === 'memory') {
    if (!['事实', '决策', '假设'].includes(input.kind)) throw new ValidationError('请选择结论类型');
    p.memories.unshift({ id: randomUUID(), kind: input.kind, text: required(input.text, '结论'), evidence: required(input.evidence, '来源或证据'), version: required(input.version || currentRun(p)?.version || p.baseline, '证据版本'), revision: p.revision, state: '有效', confirmedBy: '用户录入', at: now() });
    event(p, '用户添加了一条项目记忆'); return p;
  }
  if (action === 'revise') {
    const goal = required(input.goal, '目标'), criteria = required(input.criteria, '验收条件'), baseline = required(input.baseline, '代码基准'), repo = input.repo === undefined ? p.repo : required(input.repo, '仓库位置');
    if (p.status === 'cancelled') throw new ValidationError('已取消项目不能修改需求');
    p.goal = goal; p.criteria = criteria; p.baseline = baseline; p.repo = repo; p.revision++; p.cycle++;
    p.requirements ||= []; p.requirements.push(requirementSnapshot(p)); delete p.acceptance;
    p.runs.forEach(r => r.stale = true); p.reviews.forEach(r => r.stale = true);
    p.memories.forEach(m => m.state = '待复核'); p.stage = 'implement'; p.status = 'ready'; p.blockedFrom = null;
    event(p, `需求更新为 v${p.revision}，旧结果、审查和记忆待复核；重新执行实现`); return p;
  }
  if (['accepted', 'cancelled'].includes(p.status)) throw new ValidationError('项目已结束，请修改需求开启新一轮或新建项目');
  if (action === 'block') {
    if (p.status === 'blocked') throw new ValidationError('项目已阻塞');
    p.blockReason = required(input.reason, '阻塞原因与解除条件'); p.blockedFrom = p.status; p.status = 'blocked'; event(p, `已阻塞：${p.blockReason}`); return p;
  }
  if (action === 'resume') {
    if (p.status !== 'blocked') throw new ValidationError('项目未阻塞');
    p.status = p.blockedFrom; p.blockedFrom = null; event(p, '用户确认阻塞已解除'); return p;
  }
  if (action === 'cancel') { p.status = 'cancelled'; event(p, '用户取消项目'); return p; }
  if (p.status === 'blocked') throw new ValidationError('请先解除阻塞');
  if (action === 'dispatch') {
    if (!['ready', 'rework'].includes(p.status)) throw new ValidationError('当前步骤不能重复发出');
    p.dispatches ||= []; p.dispatches.push({ at: now(), revision: p.revision, cycle: p.cycle, stage: p.stage, input: taskPack(p), source: '用户确认' });
    p.status = 'running'; event(p, `用户确认已发出${p.stage === 'implement' ? '实现' : '审查'}任务（手工状态）`);
  } else if (action === 'result') {
    if (p.stage !== 'implement' || p.status !== 'running') throw new ValidationError('请先发出实现任务');
    const run = { id: randomUUID(), at: now(), revision: p.revision, cycle: p.cycle, stale: false,
      summary: required(input.summary, '完成内容'), artifact: required(input.artifact, '提交引用或 diff'),
      version: required(input.version, '当前代码版本或快照标识'), evidence: required(input.evidence, '关键决策与依据'),
      tests: required(input.tests, '验证结果或未执行说明'), issues: required(input.issues, '已知问题（无则填无）'),
      next: required(input.next, '下一步动作与完成条件'), raw: input.raw || '' };
    p.runs.push(run); p.memories.forEach(m => m.state = '待复核'); p.stage = 'review'; p.status = 'ready';
    event(p, `第 ${p.cycle} 轮实现材料齐全（仅格式检查），等待独立审查；既有记忆待复核`);
  } else if (action === 'review') {
    if (p.stage !== 'review' || p.status !== 'running' || !currentRun(p)) throw new ValidationError('请先发出当前版本的审查任务');
    if (!['pass', 'rework'].includes(input.verdict)) throw new ValidationError('请选择审查结论');
    const review = { id: randomUUID(), at: now(), revision: p.revision, cycle: p.cycle, stale: false,
      verdict: input.verdict, criteriaEvidence: required(input.criteriaEvidence, '逐项验收判断与证据'),
      findings: required(input.findings, '问题、严重程度及未验证事项'),
      reviewedVersion: required(input.reviewedVersion, '审查代码版本'), source: required(input.source, '审查会话或执行端说明') };
    if (review.reviewedVersion !== currentRun(p).version) throw new ValidationError('审查版本与实现版本不一致，请确认版本或更新需求后重新执行');
    p.reviews.push(review);
    if (review.verdict === 'rework') { p.stage = 'implement'; p.status = 'rework'; p.cycle++; event(p, '审查要求返工，保留此前记录并开启新一轮实现'); }
    else { p.stage = 'delivery'; p.status = 'awaiting'; event(p, 'Agent 报告审查通过，等待用户验收'); }
  } else if (action === 'accept') {
    if (p.stage !== 'delivery' || p.status !== 'awaiting' || currentReview(p)?.verdict !== 'pass') throw new ValidationError('当前项目尚未满足验收条件');
    p.acceptance = required(input.note, '验收说明'); p.status = 'accepted'; event(p, `用户验收通过：${p.acceptance}`);
  } else if (action === 'reject') {
    if (p.status !== 'awaiting') throw new ValidationError('只有待验收项目可以退回');
    const reason = required(input.reason, '退回原因'); p.cycle++; p.stage = 'implement'; p.status = 'rework'; event(p, `用户退回：${reason}`);
  } else throw new ValidationError('不支持的操作');
  return p;
}
export function taskPack(p) {
  const run = currentRun(p), previousRun = p.runs.findLast(r => r.revision === p.revision && !r.stale), review = p.reviews.findLast(r => r.revision === p.revision && !r.stale);
  return `# ${p.title} · ${p.stage === 'implement' ? '实现任务包' : '审查任务包'}\n\n需求 v${p.revision} / 第 ${p.cycle} 轮\n\n## 目标\n${p.goal}\n\n## 仓库与版本\n仓库：${p.repo}\n基准：${p.baseline}\n请确认本地路径可访问；无法访问时请要求提供文件或 diff，勿假设已读取。\n\n## 范围与约束\n${p.scope}\n${p.constraints}\n\n## 原始验收条件\n${p.criteria}\n\n## 当前有效记忆\n${p.memories.filter(m => m.state === '有效').map(m => `- [${m.kind}] ${m.text}（${m.evidence}；版本 ${m.version}）`).join('\n') || '无。待复核结论不能作为已确认事实。'}\n\n${p.stage === 'review' && run ? `## 实现交接\n${JSON.stringify(run, null, 2)}\n\n逐项核对原始验收条件与实际变更；列出阻断问题、非阻断建议和未验证事项。审查版本必须为：${run.version}。\n` : `## 上轮实现与待修复代码\n${previousRun ? JSON.stringify(previousRun, null, 2) : '首次执行，无上轮变更'}\n\n## 最近审查与返工记录\n${review ? JSON.stringify(review, null, 2) : '首次执行，无审查记录'}\n${p.history.filter(h => h.revision === p.revision && h.message.startsWith('用户退回')).slice(0, 1).map(h => h.message).join('\n')}\n\n请返回完成内容、变更引用或 diff、当前代码版本、关键决策与证据、验证结果（包括未执行项）、已知问题和下一步完成条件。\n`}\n## 结果传回\n在工作台填写对应字段，或导入 JSON。不要声称执行了未运行的验证。\n${p.stage === 'review' ? JSON.stringify({ verdict: 'pass 或 rework', reviewedVersion: run?.version, source: '执行端 / 独立会话说明', criteriaEvidence: '逐项验收与证据', findings: '阻断问题、建议、未验证项；无则写无' }, null, 2) : JSON.stringify({ summary: '', artifact: '', version: '', evidence: '', tests: '', issues: '无', next: '', raw: '' }, null, 2)}\n`;
}
export function delivery(p) {
  if (p.stage !== 'delivery' || !currentRun(p) || currentReview(p)?.verdict !== 'pass') throw new ValidationError('尚未形成通过审查的交付包');
  const r = currentRun(p), review = currentReview(p);
  return `# ${p.title} · 交付说明\n\n状态：${p.status === 'accepted' ? '用户已验收' : '待用户验收'}\n需求版本：v${p.revision}\n仓库：${p.repo}\n基准：${p.baseline}\n交付版本：${r.version}\n\n## 目标\n${p.goal}\n\n## 原始验收条件\n${p.criteria}\n\n## 变更摘要\n${r.summary}\n\n## 代码变更引用 / diff\n${r.artifact}\n\n## 关键决策与依据\n${r.evidence}\n\n## 验证（执行端报告，未自动核实）\n${r.tests}\n\n## 逐项审查\n${review.criteriaEvidence}\n审查来源：${review.source}\n审查版本：${review.reviewedVersion}\n\n## 问题与剩余风险\n${r.issues}\n${review.findings}\n\n## 后续操作\n${r.next}\n\n## 用户验收\n${p.acceptance || '尚未验收'}\n`;
}
