import { handoffView } from './handoff.mjs';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { currentRun, act, ValidationError } from './domain.mjs';
import { buildReviewBundle } from './review-bundle.mjs';
const terminal = new Set(['cancelled', 'superseded', 'obsolete', 'applied']);
const now = () => new Date().toISOString();
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) throw new ValidationError(`请提供有效的${name}`);
  return value.trim();
};
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
function record(p, message) { p.updatedAt = now(); p.history.unshift({ at:p.updatedAt, revision:p.revision, cycle:p.cycle, message }); }
export function effectiveJobStatus(job) {
  return !terminal.has(job.status) && job.status !== 'submitted' && Date.parse(job.expiresAt) <= Date.now() ? 'expired' : job.status;
}
export function jobView(job) {
  const { bundle, claimToken, resultHash, ...rest } = job;
  return { ...rest, status:effectiveJobStatus(job), fileCount:bundle.manifest.length, manifest:bundle.manifest };
}
export function projectView(p) { return { ...p, reviewJobs:(p.reviewJobs || []).map(jobView), handoffs:(p.handoffs || []).map(handoffView) }; }
export function invalidateJobs(p) {
  for (const job of p.reviewJobs || []) {
    if (terminal.has(job.status)) continue;
    const run = currentRun(p);
    if (p.revision !== job.revision || p.cycle !== job.cycle || p.stage !== 'review' || !run || run.version !== job.version || ['cancelled','accepted'].includes(p.status)) job.status = 'obsolete';
  }
}
function assertCurrent(p, job) {
  if (terminal.has(job.status) || effectiveJobStatus(job) === 'expired') throw new ValidationError('该派发已取消、失效或过期，请在工作台重新派发');
  const run = currentRun(p);
  if (!run || job.revision !== p.revision || job.cycle !== p.cycle || job.version !== run.version || p.stage !== 'review' || p.status !== 'running') throw new ValidationError('任务已变更或暂停，不能领取或提交旧审查');
}
function enqueue(p, bundle) {
  p.reviewJobs ||= [];
  if (p.reviewJobs.length >= 50) throw new ValidationError('此项目已达到 50 次派发上限，请归档后新建项目');
  const job = { id:randomUUID(), bundleId:bundle.bundleId, version:bundle.reviewedVersion, revision:p.revision, cycle:p.cycle, status:'queued', createdAt:now(), expiresAt:new Date(Date.now()+24*60*60*1000).toISOString(), bundle, result:null };
  p.reviewJobs.push(job); p.reviewer = 'WorkBuddy · MCP';
  if (p.status === 'ready') act(p, 'dispatch');
  record(p, '审查副本已发布到 WorkBuddy 桥接队列，等待领取');
  return jobView(job);
}
export function publishReview(p, input) {
  if (input.publishConsent !== true) throw new ValidationError('请先确认授权 WorkBuddy 读取此份副本');
  const bundle = buildReviewBundle(p, input);
  const active = (p.reviewJobs || []).findLast(j => !terminal.has(j.status));
  if (active) {
    if (active.bundleId === bundle.bundleId && effectiveJobStatus(active) !== 'expired') return jobView(active);
    throw new ValidationError('已有派发，请先取消或重试，不能并发替换审查副本');
  }
  if (p.status !== 'ready') throw new ValidationError('请先结束当前手工审查，再发布到桥接队列');
  return enqueue(p, bundle);
}
export function reviewJobAction(p, input) {
  const job = (p.reviewJobs || []).find(j => j.id === input.jobId);
  if (!job) throw new ValidationError('派发不存在');
  if (input.action === 'bridge_cancel') {
    if (terminal.has(job.status)) throw new ValidationError('派发已结束');
    job.status = 'cancelled';
    if (p.stage === 'review' && p.revision === job.revision && p.cycle === job.cycle && p.status === 'running') p.status = 'ready';
    record(p, '用户取消了 WorkBuddy 派发，迟到结果不会被采用');
  } else if (input.action === 'bridge_retry') {
    if (['applied','obsolete','superseded'].includes(job.status)) throw new ValidationError('该版本不能重试，请重新准备当前副本');
    const run = currentRun(p);
    if (!run || p.stage !== 'review' || run.version !== job.version || p.revision !== job.revision || p.cycle !== job.cycle || !['running','ready'].includes(p.status)) throw new ValidationError('任务已变更或阻塞，请重新准备副本');
    if (p.reviewJobs.some(j => j.id !== job.id && !terminal.has(j.status))) throw new ValidationError('已有新的派发');
    if (p.reviewJobs.length >= 50) throw new ValidationError('已达到派发上限');
    job.status = 'superseded'; enqueue(p, job.bundle);
    record(p, '已重试 WorkBuddy 审查，新派发使用独立领取凭证');
  } else if (input.action === 'bridge_apply') {
    assertCurrent(p, job);
    if (job.status !== 'submitted' || !job.result) throw new ValidationError('尚未收到可应用的审查结果');
    act(p, 'review', job.result); job.status = 'applied'; job.appliedAt = now();
    record(p, '用户确认应用了 WorkBuddy 桥接返回的审查结果');
  } else throw new ValidationError('不支持的桥接操作');
  return projectView(p);
}
function findJob(projects, id) {
  for (const p of projects) {
    const job = (p.reviewJobs || []).find(j => j.id === id);
    if (job) return { p, job };
  }
  throw new ValidationError('派发不存在或未发布');
}
export function bridgeTool(projects, name, args = {}) {
  if(!args || typeof args!=='object' || Array.isArray(args)) throw new ValidationError('工具参数必须是对象');
  if (name === 'bridge_status') return { service:'AgentSummary', transport:'stdio-to-localhost', scope:'仅用户发布的审查副本', automaticPush:false };
  if (name === 'list_review_jobs') return { jobs:projects.flatMap(p => (p.reviewJobs || []).filter(j => ['queued','reviewing','submitted'].includes(effectiveJobStatus(j)) && p.stage === 'review' && p.status === 'running' && p.revision === j.revision && p.cycle === j.cycle).map(j => ({ jobId:j.id, title:j.bundle.task.title, bundleId:j.bundleId, reviewedVersion:j.version, status:effectiveJobStatus(j), expiresAt:j.expiresAt }))) };
  if (!['get_review_job','submit_review'].includes(name)) throw new ValidationError('连接器不支持此工具');
  const { p, job } = findJob(projects, required(args.jobId, '派发 ID'));
  if (name === 'get_review_job') {
    assertCurrent(p, job);
    if (job.status === 'submitted') throw new ValidationError('结果已提交，等待用户应用');
    if (job.status === 'reviewing' && !equal(args.claimToken, job.claimToken)) throw new ValidationError('已被领取；请使用原领取凭证，或在工作台重试');
    if (job.status === 'queued') { job.claimToken = randomUUID(); job.claimedAt = now(); job.status = 'reviewing'; record(p, 'WorkBuddy 桥接客户端已领取审查副本'); }
    return { jobId:job.id, claimToken:job.claimToken, bundleId:job.bundleId, reviewedVersion:job.version, markdown:job.bundle.text, instruction:'只审查副本内容；禁止读取原目录或执行源码；调用 submit_review 返回结果。连接器不提供原目录、命令执行或最终验收权限。' };
  }
  if (!equal(args.claimToken, job.claimToken)) throw new ValidationError('领取凭证不匹配');
  if (args.bundleId !== job.bundleId || args.reviewedVersion !== job.version) throw new ValidationError('副本 ID 或代码版本不匹配');
  const result = { verdict:args.verdict, reviewedVersion:args.reviewedVersion, source:required(args.source,'审查来源'), criteriaEvidence:required(args.criteriaEvidence,'逐项验收证据'), findings:required(args.findings,'问题与未验证事项') };
  if (!['pass','rework'].includes(result.verdict)) throw new ValidationError('审查结论必须为 pass 或 rework');
  const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  if (['submitted','applied'].includes(job.status)) {
    if (job.resultHash !== hash) throw new ValidationError('同一派发已有不同结果，不能覆盖');
    return { receiptId:job.id, status:job.status, duplicate:true, applied:job.status === 'applied' };
  }
  assertCurrent(p, job);
  if (job.status !== 'reviewing') throw new ValidationError('请先领取审查副本');
  job.result = result; job.resultHash = hash; job.submittedAt = now(); job.status = 'submitted';
  record(p, 'WorkBuddy 审查结果已自动接收并保存，等待用户应用');
  return { receiptId:job.id, status:'submitted', applied:false, message:'已接收。用户确认后才应用，不代表最终验收。' };
}
