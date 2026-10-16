import { createHash } from 'node:crypto';
import { currentRun, ValidationError } from './domain.mjs';
import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './public/review-policy.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fenced(text, language = '') {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}
// Pure packaging: it never resolves repo paths or reads from the server filesystem.
export function buildReviewBundle(project, input) {
  const run = currentRun(project);
  if (!run || project.stage !== 'review' || !['ready', 'running'].includes(project.status)) throw new ValidationError('请先录入实现结果，再准备本轮审查副本');
  if (input.confirmVersion !== run.version) throw new ValidationError('请确认选中文件对应当前交付版本');
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > MAX_FILES) throw new ValidationError(`请选择 1–${MAX_FILES} 个文件`);
  let totalBytes = 0;
  const paths = new Set();
  const files = input.files.map(file => {
    if (!file || typeof file !== 'object') throw new ValidationError('文件格式无效');
    const issue = fileIssue(file.path);
    if (issue) throw new ValidationError(`${String(file.path).slice(0, 80)}：${issue}`);
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new ValidationError('不允许重复或仅大小写不同的文件路径');
    paths.add(key);
    if (typeof file.content !== 'string' || file.content.includes('\0')) throw new ValidationError('只支持 UTF-8 文本文件');
    const bytes = Buffer.from(file.content, 'utf8');
    if (bytes.toString('utf8') !== file.content) throw new ValidationError('文件包含无效的文本编码');
    if (bytes.length > MAX_FILE_BYTES) throw new ValidationError('单个文件不能超过 300 KB');
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new ValidationError('文件总大小不能超过 1 MB');
    return { path: file.path, bytes: bytes.length, sha256: hash(bytes), content: file.content };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  const safe = text => String(text ?? '').split(project.repo).join('[原项目路径已省略]');
  const task = { title: safe(project.title), goal: safe(project.goal), scope: safe(project.scope), constraints: safe(project.constraints), criteria: safe(project.criteria), changes: safe(run.artifact), summary: safe(run.summary), tests: safe(run.tests), issues: safe(run.issues) };
  const contentId = hash(JSON.stringify({ projectId: project.id, revision: project.revision, cycle: project.cycle, reviewedVersion: run.version, task, manifest }));
  const bundleId = `review-${contentId.slice(0, 16)}`;
  const reportShape = { verdict: 'pass 或 rework', reviewedVersion: run.version, source: '执行端及可确认的会话说明', criteriaEvidence: '逐项判断与证据；不能执行的验证须明确说明', findings: '阻断问题、非阻断建议、未验证事项' };
  const text = `# 审查副本：${task.title}\n\n副本 ID：${bundleId}\n代码交付版本：${run.version}\n需求 v${project.revision} / 第 ${project.cycle} 轮\n\n## 使用范围\n此文件包含用户选择的文本快照及差异。只审查本文中的内容，不读取原项目或追踪源码中的文件路径。没有附带原项目目录访问权、运行数据、会话历史或完整项目导出。\n这是材料隔离，不是外部 Agent 的权限沙箱。若 Agent 在本机仍有广泛访问权，提示词无法强制约束它。执行代码需要另行受控环境；静态审查时不要执行源码或安装依赖。文件筛选不是秘密检测，请发送前核对内容。\n\n## 目标\n${task.goal}\n\n## 范围与约束\n${task.scope}\n${task.constraints}\n\n## 原始验收条件\n${task.criteria}\n\n## 实现摘要\n${task.summary}\n\n## 实际差异或变更引用\n${fenced(task.changes, 'diff')}\n\n## 执行端提供的验证记录（并非本副本的独立验证）\n${task.tests}\n\n## 已知问题\n${task.issues}\n\n## 全部输入文件清单\n路径为副本内部标识，不是可访问的原项目路径。每个摘要覆盖下方源码文本的 UTF-8 字节。代码版本与副本 ID 是两种不同标识；返回 reviewedVersion 时使用代码交付版本。\n${fenced(JSON.stringify(manifest, null, 2), 'json')}\n\n## 源码快照\n${files.map(file => `### ${file.path}\n\n${fenced(file.content)}\n`).join('\n')}\n## 返回格式\n返回合法 JSON。不要声称执行了未运行的验证，不替用户验收，也不操作工作台。\n${fenced(JSON.stringify(reportShape, null, 2), 'json')}\n`;
  return { bundleId, reviewedVersion: run.version, manifest, totalBytes, task, text, boundary: 'materials-only' };
}
