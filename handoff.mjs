import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { normalize, isAbsolute } from 'node:path';
import { act, ValidationError } from './domain.mjs';
const agents = new Set(['Codex', 'WorkBuddy']);
const live = h => ['offered', 'claimed'].includes(h.status);
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 30000) throw new ValidationError(`请提供${name}（最多 30000 字符）`);
  return value.trim();
};
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const taskIdentity = p => hash([p.id,p.repo,p.revision,p.cycle,p.goal,p.criteria,p.baseline,p.scope,p.constraints]);
function record(p,message) { p.updatedAt=now(); p.history.unshift({at:p.updatedAt,revision:p.revision,cycle:p.cycle,message}); }
function checkpoint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('请提供交接检查点');
  const labels={version:'代码版本或快照标识',summary:'已完成内容',artifact:'代码变更及未提交修改说明',evidence:'决策与证据',tests:'测试及未执行项',issues:'阻塞与已知问题',next:'待办与下一步'};
  return Object.fromEntries(Object.entries(labels).map(([key,label])=>[key,required(input[key],label)]));
}
export function handoffView(h) {
  const {claimToken,...view}=h;
  return structuredClone(view);
}
function assertCurrent(p,h) {
  if (!live(h) || h.generation!==p.handoffGeneration || h.taskIdentity!==taskIdentity(p) || p.stage!=='implement' || p.status!=='running') throw new ValidationError('交接已失效、取消或项目已暂停；请在工作台重新交接');
}
export function invalidateHandoffs(p) {
  for (const h of p.handoffs || []) {
    if (live(h) && (h.taskIdentity!==taskIdentity(p) || p.stage!=='implement' || p.status!=='running')) {h.status='obsolete';delete h.claimToken;}
  }
}
export function publishHandoff(p,input) {
  if (!input || input.consent!==true || input.stopped!==true) throw new ValidationError('请确认原执行端已经停止，并授权目标端读取此交接材料');
  if (!agents.has(input.target)) throw new ValidationError('目标执行端只能为 Codex 或 WorkBuddy');
  if (!isAbsolute(p.repo)) throw new ValidationError('同目录接续需要绝对仓库路径，请新建或更正项目');
  if (p.stage!=='implement' || !['ready','rework','running'].includes(p.status)) throw new ValidationError('只有未结束的实现阶段可以交接');
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration!==(p.handoffGeneration||0)) throw new ValidationError('交接代次已变化，请刷新后再试');
  const previous=p.handoffs?.at(-1);
  if(input.expectedRevision!==p.revision || input.expectedCycle!==p.cycle || input.previousHandoffId!==(previous?.id||null) || input.expectedSequence!==(previous?.sequence||0)) throw new ValidationError('需求或检查点序号已变化，请刷新并核对最新进度');
  if ((p.handoffs||[]).length>=50) throw new ValidationError('已达到 50 次交接上限');
  const cp=checkpoint(input.checkpoint),reason=required(input.reason,'切换原因');
  const generation=(p.handoffGeneration||0)+1;
  const snapshot={projectId:p.id,title:p.title,repo:p.repo,goal:p.goal,criteria:p.criteria,scope:p.scope,constraints:p.constraints,baseline:p.baseline,revision:p.revision,cycle:p.cycle,checkpoint:cp,memories:p.memories.filter(m=>m.state==='有效').map(m=>({kind:m.kind,text:m.text,evidence:m.evidence,version:m.version})),from:p.implementer,to:input.target,reason};
  const h={id:randomUUID(),generation,taskIdentity:taskIdentity(p),digest:hash(snapshot),snapshot,status:'offered',createdAt:now(),sequence:0,latestCheckpoint:cp};
  p.handoffs ||= [];
  for(const old of p.handoffs) if(live(old)){old.status='superseded';delete old.claimToken;}
  p.handoffGeneration=generation;p.handoffs.push(h);p.status='running';
  record(p,`已保存检查点，等待 ${input.target} 领取交接；用户确认原执行端已停止`);
  return handoffView(h);
}
export function cancelHandoff(p,input) {
  const h=(p.handoffs||[]).find(h=>h.id===input.handoffId);
  if(!h || !live(h)) throw new ValidationError('没有可取消的交接');
  h.status='cancelled';delete h.claimToken;p.handoffGeneration=(p.handoffGeneration||0)+1;
  if(p.stage==='implement' && p.status==='running')p.status='ready';
  record(p,'用户取消交接；旧领取凭证已失效，原目录中的进程需要用户自行停止');
}
function find(projects,id) {
  for(const p of projects){const h=(p.handoffs||[]).find(h=>h.id===id);if(h)return {p,h};}
  throw new ValidationError('交接不存在或未发布');
}
export function handoffText(h) {
  return `# 项目接续交接\n\n交接 ID：${h.id}\n材料摘要：${h.digest}\n\n${JSON.stringify(h.snapshot,null,2)}\n\n先核对本地仓库路径和实际代码版本，再调用 claim_handoff；observedVersion 必须来自你的核对。工作台不替你读取或验证仓库，不会迁移隐藏推理、运行进程或客户端内部状态。不要修改范围外文件。\n\n领取后保存 claimToken。用 save_checkpoint 回写阶段进度，或用 complete_handoff 提交完整实现结果；两者均携带 expectedSequence。决策先记录在 evidence 中，未经用户确认不写入有效项目记忆。最终审查与验收仍按原流程。`;
}
export function handoffTool(projects,name,args={}) {
  if(!args || typeof args!=='object' || Array.isArray(args))throw new ValidationError('工具参数必须是对象');
  if(name==='list_handoffs')return {handoffs:projects.flatMap(p=>(p.handoffs||[]).filter(h=>live(h)&&h.taskIdentity===taskIdentity(p)&&p.stage==='implement'&&p.status==='running').map(h=>({id:h.id,title:h.snapshot.title,target:h.snapshot.to,status:h.status,generation:h.generation})))};
  if(!['get_handoff','claim_handoff','save_checkpoint','complete_handoff'].includes(name))throw new ValidationError('不支持的交接工具');
  const {p,h}=find(projects,required(args.handoffId,'交接 ID'));assertCurrent(p,h);
  if(name==='get_handoff')return {handoff:handoffView(h),text:handoffText(h)};
  if(name==='claim_handoff'){
    if(args.agent!==h.snapshot.to || typeof args.observedRepo!=='string' || normalize(args.observedRepo)!==normalize(p.repo) || args.observedVersion!==h.snapshot.checkpoint.version)throw new ValidationError('目标执行端、仓库或代码版本不匹配，请先核对；不会自动覆盖代码');
    if(h.status==='claimed'){
      if(!equal(args.claimToken,h.claimToken))throw new ValidationError('已被领取，请使用原凭证或让用户重新交接');
    }else{h.claimToken=randomUUID();h.status='claimed';h.claimedAt=now();p.implementer=args.agent;record(p,`${args.agent} 已领取交接（仓库与版本为执行端自报核对）`);}
    return {handoffId:h.id,claimToken:h.claimToken,sequence:h.sequence,checkpoint:structuredClone(h.latestCheckpoint)};
  }
  if(h.status!=='claimed' || !equal(args.claimToken,h.claimToken))throw new ValidationError('请使用当前交接的领取凭证');
  if(!Number.isSafeInteger(args.expectedSequence) || args.expectedSequence!==h.sequence)throw new ValidationError('检查点序号已变化，请核对当前进度，不能覆盖新结果');
  const cp=checkpoint(args.checkpoint);
  if(name==='complete_handoff'){
    act(p,'result',cp);h.status='completed';h.completedAt=now();delete h.claimToken;
  }
  h.latestCheckpoint=cp;h.sequence++;h.checkpointAt=now();
  record(p,name==='complete_handoff'?'接续实现结果已保存，等待独立审查；尚未验收':'执行端回写了阶段检查点（未经用户确认的决策不自动转为有效记忆）');
  return {handoffId:h.id,status:h.status,sequence:h.sequence,stage:p.stage,accepted:false};
}
