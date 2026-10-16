# 审查副本：审查材料副本导出

副本 ID：review-777240ec03c87050
代码交付版本：isolation-9a4a96da427b
需求 v2 / 第 2 轮

## 使用范围
此文件包含用户选择的文本快照及差异。只审查本文中的内容，不读取原项目或追踪源码中的文件路径。没有附带原项目目录访问权、运行数据、会话历史或完整项目导出。
这是材料隔离，不是外部 Agent 的权限沙箱。若 Agent 在本机仍有广泛访问权，提示词无法强制约束它。执行代码需要另行受控环境；静态审查时不要执行源码或安装依赖。文件筛选不是秘密检测，请发送前核对内容。

## 目标
只打包用户选中的文本快照，生成可预览、可校验的审查副本，不让导出接口读取真实仓库目录。 同时提供只挂载副本、禁外网、只读的本地容器命令检查器。

## 范围与约束
review-bundle.mjs、public/review-policy.js、public/review-export.js、server 路由、界面入口及测试
材料隔离不等于外部 Agent 权限沙箱；不发送外部服务，不自动标记派发或验收。

## 原始验收条件
选择文件后可勾选或排除，并查看排除原因
拒绝 data/、隐藏目录、凭证文件名、路径跳转、重复路径和过大文件
每份选中文本有 SHA256，副本包含目标、验收条件、diff 和源码
必须确认交付版本，导出不改变任务状态、不保存上传源码
不能宣称 WorkBuddy 已受权限隔离
隔离检查器拒绝远程 Docker 和无容器回退；容器不能读取宿主数据、改写副本或访问外网

## 实现摘要
审查副本导出已完成；新增严格校验 Markdown 快照的解析器，以及只允许本机 Docker、固定镜像摘要、无外网、只读、非特权的命令检查器。

## 实际差异或变更引用
`````diff
--- a/package.json
+++ b/package.json
@@ -6,7 +6,7 @@
   "scripts": {
     "start": "node server.mjs",
     "test": "node --test",
-    "check": "node --check server.mjs && node --check domain.mjs && node --check review-bundle.mjs && node --check public/app.js && node --check public/review-policy.js && node --check public/review-export.js"
+    "check": "node --check server.mjs && node --check domain.mjs && node --check review-bundle.mjs && node --check public/app.js && node --check public/review-policy.js && node --check public/review-export.js && node --check review-snapshot.mjs && node --check scripts/isolated-check.mjs"
   },
   "engines": {
     "node": ">=22"
--- a/review-snapshot.mjs
+++ b/review-snapshot.mjs
@@ -0,0 +1,51 @@
+import { createHash } from 'node:crypto';
+import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './public/review-policy.js';
+
+export function extractReviewFiles(text) {
+  const lines = text.split('\n');
+  let manifest = null, inSources = false, manifests = 0, sourceSections = 0;
+  const sources = new Map();
+  function block(start) {
+    const match = lines[start].match(/^(`{3,})(\w*)$/);
+    if (!match) throw Error('Expected fenced review content');
+    const end = lines.indexOf(match[1], start + 1);
+    if (end < 0) throw Error('Unclosed review content');
+    return { text: lines.slice(start + 1, end).join('\n'), end };
+  }
+  function nextBlock(start) {
+    while (start < lines.length && !/^`{3,}/.test(lines[start])) start++;
+    if (start === lines.length) throw Error('Missing review content');
+    return { ...block(start), start };
+  }
+  for (let i = 0; i < lines.length; i++) {
+    if (lines[i] === '## 全部输入文件清单') {
+      manifests++;
+      const data = nextBlock(i + 1); manifest = JSON.parse(data.text); i = data.end;
+    } else if (lines[i] === '## 源码快照') {
+      sourceSections++; inSources = true;
+    } else if (inSources && lines[i].startsWith('### ')) {
+      const path = lines[i].slice(4);
+      if (sources.has(path.toLowerCase())) throw Error('Duplicate source path');
+      const data = nextBlock(i + 1);
+      sources.set(path.toLowerCase(), { path, content: data.text }); i = data.end;
+    } else if (lines[i].startsWith('## ')) {
+      inSources = false;
+    } else if (/^`{3,}/.test(lines[i])) {
+      i = block(i).end;
+    }
+  }
+  if (manifests !== 1 || sourceSections !== 1 || !Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES || sources.size !== manifest.length) throw Error('Invalid review manifest');
+  let total = 0;
+  const seen = new Set();
+  return manifest.map(entry => {
+    if (!entry || fileIssue(entry.path) || typeof entry.sha256 !== 'string') throw Error('Forbidden review path');
+    const key = entry.path.toLowerCase();
+    if (seen.has(key)) throw Error('Duplicate manifest path'); seen.add(key);
+    const source = sources.get(key);
+    if (!source || source.path !== entry.path) throw Error('Missing source text');
+    const bytes = Buffer.from(source.content, 'utf8'); total += bytes.length;
+    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || bytes.length !== entry.bytes || bytes.includes(0)) throw Error('Invalid review source size');
+    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Review checksum mismatch: ${entry.path}`);
+    return { path: entry.path, content: source.content };
+  });
+}
--- a/scripts/isolated-check.mjs
+++ b/scripts/isolated-check.mjs
@@ -0,0 +1,67 @@
+// Run only the supplied review snapshot. Never mount a repository or the Docker socket.
+import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
+import { join } from 'node:path';
+import { tmpdir } from 'node:os';
+import { spawnSync } from 'node:child_process';
+import { randomUUID } from 'node:crypto';
+import { fileURLToPath } from 'node:url';
+import { extractReviewFiles } from '../review-snapshot.mjs';
+const image = 'node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';
+const bundlePath = process.argv[2];
+if (!bundlePath) { console.error('Usage: node scripts/isolated-check.mjs path/to/review-copy.md'); process.exit(1); }
+const input = readFileSync(bundlePath);
+if (input.length > 3_000_000) throw Error('Review bundle is too large');
+const files = extractReviewFiles(input.toString('utf8'));
+let endpoint = process.env.DOCKER_HOST;
+if (!endpoint) {
+  const context = spawnSync('docker', ['context', 'inspect'], { encoding: 'utf8', timeout: 15_000 });
+  if (context.status !== 0) throw Error('Local Docker context unavailable');
+  endpoint = JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host;
+}
+if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) throw Error('Only a local Unix-socket Docker daemon is allowed');
+const docker = (args, options) => spawnSync('docker', ['--host', endpoint, ...args], options);
+const check = docker(['image', 'inspect', image], { encoding: 'utf8', timeout: 15_000 });
+if (check.status !== 0) throw Error('Pinned Docker image unavailable. No host execution fallback. See README.');
+const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'agentsummary-isolated-')));
+const source = join(scratch, 'source'); mkdirSync(source, { mode: 0o755 });
+try {
+  for (const file of files) {
+    const path = join(source, file.path); mkdirSync(join(path, '..'), { recursive: true, mode: 0o755 });
+    writeFileSync(path, file.content, { mode: 0o444, flag: 'wx' });
+  }
+  const results = [];
+  function run(label, command) {
+    const name = 'agentsummary-review-' + randomUUID();
+    try {
+      const result = docker(['run', '--rm', '--name', name, '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--cpus=1', '--user=1000:1000', '--mount', `type=bind,src=${source},dst=/review,readonly`, '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=134217728,uid=1000,gid=1000', '--workdir=/review', '--env=TMPDIR=/tmp', '--env=AGENTSUMMARY_DATA_DIR=/tmp/agentsummary-data', '--env=npm_config_cache=/tmp/npm-cache', image, ...command], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1_000_000 });
+      const ok = result.status === 0 && !result.error;
+      results.push({ label, ok, exitCode: result.status, output: (result.stdout || '') + (result.stderr || ''), error: result.error?.message });
+      console.log(`=== ${label}: ${ok ? 'PASS' : 'FAIL'} ===\n${results.at(-1).output}`);
+      if (!ok) throw Error(`${label} failed. No host execution fallback.`);
+    } finally {
+      // Only this invocation's randomly named container can be removed.
+      docker(['rm', '-f', name], { stdio: 'ignore', timeout: 15_000 });
+    }
+  }
+  const hostDataPath = fileURLToPath(new URL('../data/projects.json', import.meta.url));
+  const probe = `
+    const fs = require('node:fs'), net = require('node:net');
+    const denied = action => { try { action(); return false; } catch { return true; } };
+    const checks = {
+      sourceReadable: fs.readFileSync('/review/package.json', 'utf8').length > 0,
+      sourceWriteDenied: denied(() => fs.writeFileSync('/review/package.json', 'tamper')),
+      rootWriteDenied: denied(() => fs.writeFileSync('/outside-review', 'tamper')),
+      hostDataUnreadable: denied(() => fs.readFileSync(${JSON.stringify(hostDataPath)})),
+      dockerSocketAbsent: !fs.existsSync('/var/run/docker.sock'),
+    };
+    const socket = net.connect({host:'1.1.1.1', port:443});
+    const timer = setTimeout(() => { socket.destroy(); checks.externalNetworkDenied = true; finish(); }, 1000);
+    function finish() { console.log(JSON.stringify(checks)); if (Object.values(checks).some(v => !v)) process.exitCode = 1; }
+    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); checks.externalNetworkDenied = false; finish(); });
+    socket.on('error', () => { clearTimeout(timer); checks.externalNetworkDenied = true; finish(); });
+  `;
+  run('isolation-boundaries', ['node', '-e', probe]);
+  run('syntax-check', ['npm', 'run', 'check']);
+  run('test-suite', ['npm', 'test']);
+  console.log(JSON.stringify({ image, files: files.length, network: 'none', snapshot: 'read-only', hostRepositoryMounted: false, externalDesktopAgentConfined: false, checks: results.map(({label,ok,exitCode}) => ({label,ok,exitCode})) }, null, 2));
+} finally { rmSync(scratch, { recursive: true, force: true }); }
--- a/test/review-snapshot.test.mjs
+++ b/test/review-snapshot.test.mjs
@@ -0,0 +1,22 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { buildReviewBundle } from '../review-bundle.mjs';
+import { extractReviewFiles } from '../review-snapshot.mjs';
+const project = { id:'test', revision:1, cycle:1, stage:'review', status:'ready', repo:'/private/repo', title:'review', goal:'review source', scope:'test', constraints:'none', criteria:'pass', runs:[{revision:1,cycle:1,version:'v1',artifact:'diff',summary:'changed',tests:'passed',issues:'none'}] };
+function bundle(files) { return buildReviewBundle(project, {files,confirmVersion:'v1'}).text; }
+test('extract exact UTF-8 text including CRLF, empty files and embedded Markdown headings', () => {
+ const files=[{path:'empty.js',content:''},{path:'source.mjs',content:'// 中文 🧪\r\n```\n## 源码快照\n````\n'}];
+ const actual=extractReviewFiles(bundle(files)); assert.deepEqual(actual, files);
+});
+test('reject tampered source content and inconsistent manifest before extracting files', () => {
+ const text=bundle([{path:'source.mjs',content:'trusted bytes'}]);
+ assert.throws(()=>extractReviewFiles(text.replace('trusted bytes','tampered bytes')), /size|checksum/);
+ assert.throws(()=>extractReviewFiles(text.replaceAll('source.mjs','../data.json')), /Forbidden/);
+ assert.throws(()=>extractReviewFiles(text.replace('"bytes": 13','"bytes": 1')), /size/);
+});
+test('reject incomplete bundles and duplicate structural sections', () => {
+ assert.throws(()=>extractReviewFiles('not a review bundle'));
+ const text=bundle([{path:'source.mjs',content:'console.log(1)'}]);
+ assert.throws(()=>extractReviewFiles(text+'\n## 源码快照\n'));
+ assert.throws(()=>extractReviewFiles(text.replace('### source.mjs','### missing.mjs')), /Missing/);
+});
`````

## 执行端提供的验证记录（并非本副本的独立验证）
最新宿主源码 npm run check 通过，npm test 24/24 通过。从界面导出的 v1 副本在 Node22 容器中 syntax-check 与21/21测试通过；边界探针确认不可修改副本、不可写根目录、不可读取宿主数据、无Docker socket、不能连接外网。

## 已知问题
容器只限制其内的命令，不限制 WorkBuddy 桌面进程。macOS sandbox-exec 探针未正常启动，无宿主执行回退。此功能尚未独立外部复审，未再次发送 WorkBuddy。

## 全部输入文件清单
路径为副本内部标识，不是可访问的原项目路径。每个摘要覆盖下方源码文本的 UTF-8 字节。代码版本与副本 ID 是两种不同标识；返回 reviewedVersion 时使用代码交付版本。
```json
[
  {
    "path": "domain.mjs",
    "bytes": 10335,
    "sha256": "9be46063f11b950c70ae1a91cbb40f8b46282fd7a2fe164a065597009f544a7a"
  },
  {
    "path": "package.json",
    "bytes": 497,
    "sha256": "5b83c2ab8733b4762d19aaaeabc64a5d80722e8fc7b979cc7ba56babbcb0fe66"
  },
  {
    "path": "public/app.js",
    "bytes": 21248,
    "sha256": "cb4a17bf601ac81b21931970af83d83eb73241db50ca35879cd5346565eb5527"
  },
  {
    "path": "public/index.html",
    "bytes": 1367,
    "sha256": "d0817333eae8215336715a3b34335b8b1222ba3aa9b835b375945acc9572c596"
  },
  {
    "path": "public/review-export.js",
    "bytes": 5788,
    "sha256": "e4fe157b586d4b2a94c6371088a55d8a14ed5c0abd8d0956a53e3bc7f15792c4"
  },
  {
    "path": "public/review-policy.js",
    "bytes": 1523,
    "sha256": "4f5f22b8f7ae672ca0b43f7cbc32cd3f7bd7f8c6ed2e74e808cf8ef520c81018"
  },
  {
    "path": "public/style.css",
    "bytes": 19676,
    "sha256": "f3e6dbf3d6fe0d0fcdd4b53d729773a329cf34cb8fd60d001850a6c1ccbd08e8"
  },
  {
    "path": "review-bundle.mjs",
    "bytes": 5030,
    "sha256": "241d46bf61b99e1b62cbfe6d696b5c0e32b6bb8ada0098bbfc66c0a82a16c194"
  },
  {
    "path": "review-snapshot.mjs",
    "bytes": 2673,
    "sha256": "cf8c6761914007c0b23ce285b399084c56e10b98a679b6ac5505040854a9a3d1"
  },
  {
    "path": "scripts/isolated-check.mjs",
    "bytes": 4911,
    "sha256": "7b3962c5bee503c8946564cd8fd4b506af79ba08d88ba9708097015aa0c23da0"
  },
  {
    "path": "server.mjs",
    "bytes": 4493,
    "sha256": "f5cfa14d3be14aa1559d66856686cca68bbb1fcef9e8b31deb542c27c9fd1111"
  },
  {
    "path": "test/domain.test.mjs",
    "bytes": 5288,
    "sha256": "cd3f02171f3aa8db6cf5b0c2dbc6905b56190b478470e9a8b7d528c86bef10b8"
  },
  {
    "path": "test/review-bundle.test.mjs",
    "bytes": 4278,
    "sha256": "edb55dfcb799fa1a540e4cfff506e8afb641a18e252891111a7b32b7f361aa17"
  },
  {
    "path": "test/review-snapshot.test.mjs",
    "bytes": 1736,
    "sha256": "5da6927c31d1961deec0b24b10b3a835cbcd124c5c47c750bd86d2a273966506"
  },
  {
    "path": "test/server.test.mjs",
    "bytes": 6784,
    "sha256": "1c2399016b8289afb47e713a35b1cc9dae90b033f7e0886e8adcf25add72b484"
  }
]
```

## 源码快照
### domain.mjs

```
import { randomUUID } from 'node:crypto';

export class ValidationError extends Error {}
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`请填写${label}`);
  return value.trim();
};
const now = () => new Date().toISOString();
function event(p, message) { p.updatedAt = now(); p.history.unshift({ at: p.updatedAt, revision: p.revision, cycle: p.cycle, message }); }
function requirementSnapshot(p) { return { revision: p.revision, goal: p.goal, criteria: p.criteria, baseline: p.baseline, scope: p.scope, constraints: p.constraints }; }
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
    const goal = required(input.goal, '目标'), criteria = required(input.criteria, '验收条件'), baseline = required(input.baseline, '代码基准');
    if (p.status === 'cancelled') throw new ValidationError('已取消项目不能修改需求');
    p.goal = goal; p.criteria = criteria; p.baseline = baseline; p.revision++; p.cycle++;
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

```

### package.json

```
{
  "name": "agentsummary",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test",
    "check": "node --check server.mjs && node --check domain.mjs && node --check review-bundle.mjs && node --check public/app.js && node --check public/review-policy.js && node --check public/review-export.js && node --check review-snapshot.mjs && node --check scripts/isolated-check.mjs"
  },
  "engines": {
    "node": ">=22"
  }
}

```

### public/app.js

```
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
    <div class="project-layout"><div class="project-document"><div class="tabs" role="tablist" aria-label="任务详情">${[['overview', '概览'], ['records', '执行记录', p.runs.length + p.reviews.length], ['memory', '记忆', p.memories.length]].map(([value, label, count]) => `<button id="tab-${value}" role="tab" aria-controls="project-content" aria-selected="${activeTab === value}" tabindex="${activeTab === value ? 0 : -1}" data-tab="${value}">${label}${count !== undefined ? `<span class="tab-count">${count}</span>` : ''}</button>`).join('')}</div><div id="project-content" role="tabpanel" aria-labelledby="tab-${activeTab}">${activeTab === 'overview' ? overviewContent(p) : activeTab === 'memory' ? memoryContent(p) : recordsContent(p)}</div></div>
    <section class="properties" aria-label="任务属性"><h2>属性</h2><dl><dt>仓库</dt><dd class="repo-path">${escape(p.repo)}</dd><dt>代码基准</dt><dd><code>${escape(p.baseline)}</code></dd><dt>实现</dt><dd><span class="agent-initial" aria-hidden="true">${escape(p.implementer.slice(0, 1))}</span>${escape(p.implementer)}</dd><dt>审查</dt><dd><span class="agent-initial" aria-hidden="true">${escape(p.reviewer.slice(0, 1))}</span>${escape(p.reviewer)}</dd><dt>创建于</dt><dd>${formatDate(p.createdAt)}</dd></dl><div class="property-actions">${button('编辑需求与版本', 'revise')}${button('导出项目数据', 'export')}${!['accepted', 'cancelled', 'blocked'].includes(p.status) ? button('标记阻塞', 'block') : ''}${!['accepted', 'cancelled'].includes(p.status) ? button('取消任务', 'cancel') : ''}</div><details class="project-options"><summary>更多操作</summary>${button('删除本地记录', 'delete', 'danger')}</details><p class="property-footnote">执行状态由用户记录。<br>任务包需在外部 Agent 中运行。</p></section></div>`;
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
  if (!p) return;
  if (name === 'bundle') return openReviewExport(p, { api, modal, download, toast });
  const send = values => api('/' + p.id, { method: 'POST', body: { ...values, action: name } });
  if (name === 'pack' || name === 'delivery') {
    const result = await api(`/${p.id}/${name}`); modal(name === 'pack' ? '交接包预览' : '统一交付包', `<p class="hint">检查后再发送；本地路径需要对方可访问，必要时附文件或 diff。</p><pre class="pack-preview">${escape(result.text)}</pre><div class="actions"><button id="copy-pack" class="primary">复制全文</button><button id="download-pack">下载 Markdown</button></div>`);
    $('#copy-pack').onclick = async () => { try { await navigator.clipboard.writeText(result.text); toast('已复制'); } catch { toast('复制不可用，请下载 Markdown'); } }; $('#download-pack').onclick = () => download(`${p.title.replace(/[/\\]/g, '-')}-${name}.md`, result.text); return;
  }
  if (name === 'export') return download('agentsummary-project.json', JSON.stringify(p, null, 2), 'application/json');
  if (name === 'delete') return form('删除本地项目记录', '<p class="note">只删除此工作台中的记录，不影响仓库和外部会话。此操作不可撤销，建议先导出项目。</p>' + field('confirmation', `输入项目名称“${p.title}”确认`), '删除记录', async v => { if (v.confirmation !== p.title) throw Error('项目名称不匹配'); await api('/' + p.id, { method: 'DELETE' }); selected = null; });
  if (name === 'result') return form('带回实现结果', field('summary', '完成内容', '', true) + field('artifact', '提交引用或 diff（接收方必须可访问）', '', true) + field('version', '当前代码版本或快照标识') + field('evidence', '关键决策、约束与证据', '', true) + field('tests', '验证方式与结果，明确未执行项', '', true) + field('issues', '已知问题 / 待验证判断', '无', true) + field('next', '下一步动作与完成条件', '对照原始验收条件进行独立审查', true) + '<label>原始输出（可选）<textarea name="raw"></textarea></label>', '保存并进入审查', send, true);
  if (name === 'review') return form('带回独立审查结果', `<label>审查结论<select name="verdict" aria-label="审查结论"><option value="rework">存在阻断问题，需要返工</option><option value="pass">无阻断问题，可提交用户验收</option></select></label>` + field('reviewedVersion', '实际审查的代码版本', '', false, '须与本轮实现版本完全一致') + field('source', '审查执行端 / 独立会话说明', p.reviewer) + field('criteriaEvidence', '逐项验收判断与证据', '', true) + field('findings', '阻断问题、建议及未验证事项（无则填无）', '', true), '保存审查结论', send, true);
  if (name === 'memory') return form('记录项目结论', '<label>类型<select name="kind" aria-label="类型"><option>事实</option><option>决策</option><option>假设</option></select></label>' + field('text', '结论', '', true) + field('evidence', '来源 / 文件版本 / 验证证据', '', true) + field('version', '证据对应代码版本', p.runs.findLast(r => r.revision === p.revision && !r.stale)?.version || p.baseline), '保存结论', send);
  if (name === 'revise') return form('更新需求与代码版本', '<p class="note">这会开启新一轮实现，既有结果、审查和记忆将待复核。此前记录保留。</p>' + field('goal', '目标', p.goal, true) + field('criteria', '验收条件', p.criteria, true) + field('baseline', '代码基准', p.baseline), '更新并重新开始', send);
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
refresh().catch(err => { $('#view').textContent = '加载失败：' + err.message; });

```

### public/index.html

```
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AgentSummary</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="AgentSummary 首页"><span class="brand-mark" aria-hidden="true">as</span><span>AgentSummary</span></a>
    <button id="overview" class="nav-home"><span aria-hidden="true">▤</span> 全部任务 <span id="project-count" class="count">0</span></button>
    <div class="nav-label"><span>最近任务</span><button id="new-project" class="icon-button" aria-label="新建任务" title="新建任务">＋</button></div>
    <nav id="projects" aria-label="最近任务"></nav>
    <footer><span class="local-indicator" aria-hidden="true"></span> 本地工作区<span class="footer-detail">数据仅保存在此设备</span></footer>
  </aside>
  <main>
    <header><span class="breadcrumbs"><span>工作区</span><span class="slash">/</span><span id="breadcrumb">全部任务</span></span><span class="header-note">手工接力</span></header>
    <div id="view"></div>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><div id="dialog-content"></div></dialog>
  <div id="toast" role="status"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>

```

### public/review-export.js

```
import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './review-policy.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const size = bytes => `${(bytes / 1000).toFixed(1)} KB`;
export function openReviewExport(project, { api, modal, download, toast }) {
  const run = project.runs.findLast(r => r.revision === project.revision && r.cycle === project.cycle && !r.stale);
  if (!run) return toast('请先录入当前实现结果');
  modal('准备审查副本', `<p class="hint">选择文件后核对清单，再生成包含源码、差异和验收条件的单个 Markdown 文件。此操作不会发送给外部 Agent。</p><div class="bundle-pickers"><label>选择源码文件<input id="bundle-files" type="file" multiple></label><label>或选择项目目录<input id="bundle-folder" type="file" webkitdirectory multiple></label></div><div id="bundle-selection"><p class="hint">尚未选择文件。数据、隐藏配置、依赖与构建目录会被排除。</p></div><p class="note">副本不授予原目录访问权，也不能撤销外部 Agent 已有的本机权限。它不扫描源码中的秘密，发送前需要核对内容。</p><label class="bundle-confirm"><input type="checkbox" id="bundle-version">我确认选中的文件对应代码版本 <code>${escape(run.version)}</code></label><div id="bundle-error" class="error" role="alert"></div><div class="actions"><button id="bundle-generate" class="primary" disabled>生成预览</button></div>`);
  const selection = document.querySelector('#bundle-selection');
  const error = document.querySelector('#bundle-error');
  const generate = document.querySelector('#bundle-generate');
  const confirmation = document.querySelector('#bundle-version');
  let candidates = [];
  const selectedFiles = () => [...selection.querySelectorAll('input[data-file-index]:checked')].map(el => candidates[Number(el.dataset.fileIndex)]);
  function update() {
    const chosen = selectedFiles();
    const total = chosen.reduce((sum, item) => sum + item.file.size, 0);
    const exceeded = chosen.length > MAX_FILES || total > MAX_TOTAL_BYTES;
    error.textContent = exceeded ? '最多 80 个文件，总计不超过 1 MB。请减少选择。' : '';
    generate.disabled = !chosen.length || !confirmation.checked || exceeded;
    const count = document.querySelector('#bundle-count');
    if (count) count.textContent = `${chosen.length} 个文件 · ${size(total)}`;
  }
  function choose(event) {
    const available = Array.from(event.target.files).map(file => {
      const path = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
      return { file, path, issue: fileIssue(path) || (file.size > MAX_FILE_BYTES ? '超过单文件 300 KB 限制' : null) };
    });
    candidates = available.filter(item => !item.issue);
    const excluded = available.filter(item => item.issue);
    confirmation.checked = false;
    selection.innerHTML = `<div class="bundle-selection-head"><span id="bundle-count"></span><span>${excluded.length} 个已排除</span></div><div class="bundle-file-list">${candidates.map((item, index) => `<label><input type="checkbox" data-file-index="${index}" checked><span>${escape(item.path)}</span><small>${size(item.file.size)}</small></label>`).join('') || '<p class="hint">没有可选的文本源码。</p>'}</div>${excluded.length ? `<details class="bundle-excluded"><summary>查看排除原因</summary>${excluded.map(item => `<div><code>${escape(item.path)}</code><span>${escape(item.issue)}</span></div>`).join('')}</details>` : ''}`;
    update();
  }
  document.querySelector('#bundle-files').onchange = choose;
  document.querySelector('#bundle-folder').onchange = choose;
  selection.onchange = update;
  confirmation.onchange = update;
  generate.onclick = async () => {
    generate.disabled = true;
    try {
      const chosen = selectedFiles();
      const files = [];
      // Read only checked files. Rejected directory entries are never read.
      for (const item of chosen) {
        const bytes = await item.file.arrayBuffer();
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        files.push({ path: item.path, content });
      }
      const bundle = await api(`/${project.id}/review-bundle`, { method: 'POST', body: { files, confirmVersion: run.version } });
      modal('审查副本预览', `<div class="bundle-meta"><code>${escape(bundle.bundleId)}</code><span>${bundle.manifest.length} 个文件 · ${size(bundle.totalBytes)}</span></div><p class="hint">代码版本：${escape(bundle.reviewedVersion)} · 材料隔离，非权限沙箱</p><div class="bundle-manifest">${bundle.manifest.map(file => `<div><span>${escape(file.path)}</span><code title="${file.sha256}">${file.sha256.slice(0, 12)}</code></div>`).join('')}</div><details class="bundle-task-preview"><summary>本次任务内容</summary><pre class="pack-preview">${escape(JSON.stringify(bundle.task, null, 2))}</pre></details><pre class="pack-preview">${escape(bundle.text)}</pre><div class="actions"><button id="bundle-download" class="primary">下载审查副本</button></div><p class="hint">下载不会自动改变任务状态。实际交给 Agent 后再确认发出。</p>`);
      document.querySelector('#bundle-download').onclick = () => download(`${bundle.bundleId}.md`, bundle.text);
    } catch (err) {
      error.textContent = err instanceof TypeError ? '读取失败：请确认选择的都是有效 UTF-8 文本，或减少文件数量。' : err.message;
      update();
      // update() only owns size errors; keep the actual failure visible.
      error.textContent = err.message;
    }
  };
}

```

### public/review-policy.js

```
// Shared by the browser and server. This is a packaging filter, not a secret scanner.
const deniedDirectories = new Set(['data', '.git', '.aws', '.ssh', '.codex', '.agents', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'trials']);
const allowedExtensions = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'json', 'md', 'txt', 'diff', 'log', 'py', 'go', 'rs', 'java', 'vue', 'svelte', 'yml', 'yaml', 'toml']);
export function fileIssue(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path)) return '需要规范的项目相对路径';
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return '不允许空目录或路径跳转';
  if (parts.some(p => p.startsWith('.') || deniedDirectories.has(p.toLowerCase()))) return '排除数据、隐藏配置、依赖与构建目录';
  const name = parts.at(-1).toLowerCase();
  if (/(^|[._-])(secret|secrets|credential|credentials|token|tokens|password|passwords)([._-]|$)/.test(name) || /^(id_rsa|id_ed25519|passwd|shadow|projects\.json)$/.test(name) || /\.(pem|key|p12|pfx|sqlite|db)$/.test(name)) return '排除可能包含凭证或运行数据的文件';
  const extension = name.split('.').at(-1);
  if (!allowedExtensions.has(extension)) return '仅支持文本源码和审查材料';
  return null;
}
export const MAX_FILES = 80;
export const MAX_FILE_BYTES = 300_000;
export const MAX_TOTAL_BYTES = 1_000_000;

```

### public/style.css

```
:root {
  color-scheme: light;
  --text: #242529;
  --muted: #71737b;
  --faint: #999ba3;
  --line: #e9eaed;
  --accent: #4163c7;
  --sidebar: 216px;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--text);
  background: #fff;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
body { margin: 0; }
button, input, textarea, select { font: inherit; }
button, a, input, textarea, select { -webkit-tap-highlight-color: transparent; }
button { cursor: pointer; border: 1px solid #dddfe4; border-radius: 5px; background: #fff; color: #41434a; padding: 6px 11px; line-height: 1.6; transition: background .12s; }
button:hover { background: #f5f5f7; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
button:disabled { opacity: .5; cursor: wait; }
button.primary { background: #292b30; border-color: #292b30; color: #fff; }
button.primary:hover { background: #44464e; }
.sidebar { position: fixed; inset: 0 auto 0 0; width: var(--sidebar); padding: 21px 12px 15px; display: flex; flex-direction: column; background: #f8f8fa; border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 9px; margin: 0 7px 32px; text-decoration: none; color: #33353b; font-size: 14px; font-weight: 650; letter-spacing: -.4px; }
.brand-mark { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 6px; background: #2e3036; color: #fff; font-size: 12px; font-weight: 600; letter-spacing: -1px; }
.nav-home { display: flex; align-items: center; gap: 9px; text-align: left; border: 0; background: transparent; padding: 7px 9px; font-weight: 500; }
.nav-home > span:first-child { font-size: 16px; color: #7e818a; }
.count { margin-left: auto; color: #90939c; font-size: 11px; font-variant-numeric: tabular-nums; }
.nav-home.active, nav button.active { background: #eaecef; }
.nav-label { display: flex; align-items: center; justify-content: space-between; margin: 28px 7px 7px; color: #8c8e97; font-size: 11px; }
.icon-button { background: transparent; border: 0; padding: 0 3px; font-size: 18px; line-height: 24px; color: #858791; }
nav { overflow-y: auto; }
nav button { width: 100%; display: flex; gap: 9px; align-items: center; border: 0; background: transparent; text-align: left; padding: 8px 10px; margin: 1px 0; font-size: 12px; }
nav button > span:last-child { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nav-state { width: 7px; height: 7px; border-radius: 50%; border: 1px solid #aaadb5; flex-shrink: 0; }
.nav-state[data-status="awaiting"], .nav-state[data-status="running"] { background: #7a8dc5; border-color: #7a8dc5; }
.nav-state[data-status="accepted"] { background: #73917f; border-color: #73917f; }
.nav-state[data-status="blocked"], .nav-state[data-status="rework"] { background: #bd9560; border-color: #bd9560; }
.nav-empty { display: block; color: #a0a2aa; font-size: 12px; padding: 8px 11px; }
footer { margin-top: auto; padding: 24px 9px 0; font-size: 11px; color: #757781; }
.local-indicator { display: inline-block; width: 5px; height: 5px; margin-right: 5px; border-radius: 50%; background: #819687; vertical-align: middle; }
.footer-detail { display: block; font-size: 10px; margin-top: 4px; color: #a0a2aa; padding-left: 12px; }
main { margin-left: var(--sidebar); }
header { height: 52px; padding: 0 32px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 15px; font-size: 12px; }
.breadcrumbs { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #696b75; }
.breadcrumbs > span:first-child { color: #90929a; }
.slash { color: #c6c7cd; margin: 0 12px; }
.header-note { color: #9698a0; flex-shrink: 0; font-size: 11px; }
#view { max-width: 1320px; margin: 0 auto; padding: 31px 36px 60px; }
h1 { font-size: 23px; font-weight: 650; letter-spacing: -.6px; line-height: 1.5; margin: 0; overflow-wrap: anywhere; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 15px; }
p { line-height: 1.8; }
.page-heading { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 31px; gap: 20px; }
.page-description { display: block; font-size: 12px; color: var(--muted); margin-top: 6px; }
.row-separator { color: #b7b9c1; margin: 0 8px; font-weight: 400; }
.list-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 17px; }
.filters { display: flex; gap: 3px; }
.filters button { border: 0; background: transparent; color: #81838d; padding: 5px 9px; font-size: 12px; white-space: nowrap; }
.filters button.selected { background: #f0f1f4; color: #373942; font-weight: 500; }
.filters button span { font-size: 10px; margin-left: 7px; color: #92949d; font-variant-numeric: tabular-nums; }
.search { max-width: 190px; font-size: 12px; padding: 6px 9px; background: #fff; }
.task-table { border-top: 1px solid var(--line); }
.table-head, .task-row { display: grid; grid-template-columns: minmax(180px, 1fr) 120px 150px 108px 16px; gap: 14px; align-items: center; }
.table-head { color: #8a8c95; font-size: 11px; height: 38px; padding: 0 12px; background: #fafafb; border-bottom: 1px solid var(--line); }
.task-row { width: 100%; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; text-align: left; min-height: 74px; padding: 13px 12px; background: #fff; }
.task-row:hover { background: #fafafb; }
.task-name { min-width: 0; }
.task-name strong { display: block; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-repo { display: block; font-size: 11px; color: #92949e; margin-top: 5px; }
.task-repo .row-separator { margin: 0 6px; }
.cell-muted { font-size: 12px; color: #7e808a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.date-column { color: #92949c; font-size: 11px; font-variant-numeric: tabular-nums; }
.row-arrow { color: #c3c5cc; font-size: 13px; }
.status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 11px; color: #737680; }
.status-symbol { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #b7bac4; border-radius: 50%; }
.status[data-status="running"], .status[data-status="awaiting"] { color: #536cae; }
.status[data-status="running"] .status-symbol { border-color: #768cc5; border-right-color: transparent; }
.status[data-status="awaiting"] .status-symbol { background: #e6eaf6; border-color: #7c8fbe; }
.status[data-status="accepted"] { color: #5d7c69; }
.status[data-status="accepted"] .status-symbol { background: #779581; border-color: #779581; }
.status[data-status="rework"], .status[data-status="blocked"] { color: #a07845; }
.status[data-status="rework"] .status-symbol, .status[data-status="blocked"] .status-symbol { border-color: #ba955e; background: #f2e9d9; border-radius: 2px; }
.status[data-status="cancelled"] .status-symbol { background: #d8d9de; border-color: #d8d9de; }
.list-empty, .empty, .tab-empty { padding: 65px 20px; color: #8c8e98; text-align: center; font-size: 12px; }
.empty { border-top: 1px solid var(--line); }
.empty h2 { font-size: 14px; color: #5d5f69; margin-bottom: 8px; }
.empty p { margin: 0 0 22px; }
.project-reference { color: #93959e; font-size: 11px; margin-bottom: 10px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
.title-line { display: flex; align-items: baseline; gap: 18px; }
.title-line h1 { font-size: 22px; }
.project-meta-line { font-size: 11px; color: #9698a1; margin-top: 8px; }
.workflow { display: flex; align-items: center; margin: 26px 0 23px; gap: 14px; width: fit-content; }
.workflow-step { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #a5a7af; }
.step-number { width: 19px; height: 19px; display: grid; place-items: center; border: 1px solid #e0e1e6; border-radius: 50%; font-size: 10px; font-variant-numeric: tabular-nums; }
.workflow-step.current { color: #3c414e; font-weight: 500; }
.current .step-number { color: #fff; background: #454a59; border-color: #454a59; }
.workflow-step.done { color: #7e8595; }
.done .step-number { border-color: #dce0e7; background: #f5f6f8; }
.step-line { width: 36px; height: 1px; background: #e6e7eb; }
.action-strip { display: flex; align-items: center; justify-content: space-between; gap: 22px; padding: 17px 18px; border: 1px solid #e4e7ed; background: #fafbfc; border-radius: 6px; margin-bottom: 29px; }
.action-strip h2 { margin: 0; font-size: 13px; }
.action-strip p { color: #858893; font-size: 12px; margin: 5px 0 0; max-width: 520px; overflow-wrap: anywhere; }
.actions { display: flex; gap: 7px; flex-wrap: wrap; }
.action-strip .actions { flex-shrink: 0; }
.action-strip button { font-size: 12px; }
.project-layout { display: grid; grid-template-columns: minmax(0, 1fr) 225px; gap: 34px; }
.project-document { min-width: 0; }
.tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--line); }
.tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; padding: 10px 0 12px; font-size: 12px; color: #93959e; }
.tabs button[aria-selected="true"] { border-bottom-color: #4d5260; color: #383d49; }
.tab-count { margin-left: 6px; font-size: 10px; color: #a0a2ab; }
.document-section { padding: 26px 0; border-bottom: 1px solid var(--line); }
.document-section:last-child { border-bottom: 0; }
.detail { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; color: #666a75; font-size: 13px; margin: 0; }
.goal-text { max-width: 720px; }
.section-count { font-size: 10px; color: #a6a8b0; margin-left: 6px; font-weight: 400; }
.criteria-list { padding: 0; list-style: none; margin: 0; }
.criteria-list li { display: flex; align-items: baseline; gap: 10px; margin: 9px 0; color: #646873; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.criterion-marker { display: block; width: 11px; height: 11px; border: 1px solid #cdd0d7; border-radius: 2px; flex-shrink: 0; position: relative; top: 1px; }
.scope-list { display: grid; grid-template-columns: 70px minmax(0, 1fr); row-gap: 12px; margin: 0; font-size: 12px; }
.scope-list dt { color: #a0a2ab; }
.scope-list dd { margin: 0; color: #747884; white-space: pre-wrap; overflow-wrap: anywhere; }
.properties { padding: 11px 0 0 24px; border-left: 1px solid var(--line); }
.properties h2 { color: #92959f; font-size: 11px; margin-bottom: 20px; font-weight: 500; }
.properties dl { margin: 0; }
.properties dt { font-size: 11px; color: #9699a3; margin: 18px 0 6px; }
.properties dd { margin: 0; font-size: 12px; color: #626773; overflow-wrap: anywhere; line-height: 1.7; }
.repo-path { font-size: 11px !important; }
.agent-initial { display: inline-grid; width: 19px; height: 19px; place-items: center; background: #edeef2; color: #777e8c; border-radius: 4px; font-size: 10px; margin-right: 7px; }
.property-actions { display: grid; justify-items: start; gap: 3px; border-top: 1px solid var(--line); margin-top: 24px; padding-top: 13px; }
.property-actions button { padding: 5px 0; border: 0; background: transparent; color: #868b96; font-size: 11px; }
.property-actions button:hover { color: var(--accent); }
.project-options { margin: 16px 0 0; }
.project-options summary { font-size: 11px; color: #aaadb5; }
.project-options button { margin-top: 10px; font-size: 11px; }
.property-footnote { color: #a7abb4; font-size: 10px; line-height: 1.9; margin-top: 28px; }
.activity-list { list-style: none; padding: 0; margin: 0; }
.activity-list li { position: relative; display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; align-items: baseline; gap: 11px; padding: 10px 0; font-size: 11px; color: #9397a1; }
.activity-list li > div { overflow-wrap: anywhere; }
.activity-dot { width: 4px; height: 4px; border-radius: 50%; background: #c7cbd3; }
.activity-list time { white-space: nowrap; color: #b1b4bd; font-size: 10px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 18px; }
.section-head h2 { margin-bottom: 5px; }
.section-head button { font-size: 12px; }
.hint { font-size: 11px; color: #969aa5; line-height: 1.8; margin: 0; }
.memory { padding: 19px 0; border-bottom: 1px solid var(--line); }
.memory:last-child { border: 0; }
.memory .detail { margin: 10px 0 8px; }
.record-meta { display: inline-flex; gap: 12px; align-items: center; font-size: 10px; color: #999da7; }
.record-meta time { font-variant-numeric: tabular-nums; }
.tag { display: inline-block; background: #f1f2f5; padding: 2px 5px; border-radius: 3px; font-size: 10px; color: #7a808d; }
.memory-source { font-size: 11px; color: #a0a5b0; overflow-wrap: anywhere; }
.memory.stale { opacity: .6; }
summary { cursor: pointer; }
.run { border-bottom: 1px solid var(--line); }
.run summary { display: flex; align-items: center; justify-content: space-between; padding: 17px 0; font-size: 12px; list-style: none; gap: 10px; }
.run summary::-webkit-details-marker { display: none; }
.run summary > span:first-child:before { content: '›'; display: inline-block; margin-right: 10px; color: #a1a6b1; transition: transform .1s; }
.run[open] summary > span:first-child:before { transform: rotate(90deg); }
.run-content { padding: 0 0 18px 18px; }
.field-label { font-size: 11px; color: #969ba6; margin: 18px 0 6px; }
.record-footnote { color: #b1b5bd; margin-top: 16px; font-size: 10px; }
dialog { border: 1px solid #dedfe5; border-radius: 9px; width: min(650px, 94vw); max-height: 90vh; padding: 25px; color: var(--text); box-shadow: 0 16px 60px #171c2e22; }
dialog::backdrop { background: #1c202b55; }
.dialog-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.dialog-heading h2 { margin: 0; font-size: 15px; }
.close { border: 0; background: transparent; color: #9398a3; font-size: 21px; line-height: 1; padding: 2px 5px; }
form { display: grid; gap: 17px; }
label { display: grid; gap: 7px; font-size: 12px; color: #6f7480; }
input, textarea, select { width: 100%; border: 1px solid #dfe2e9; border-radius: 5px; padding: 8px 10px; outline: none; background: #fff; color: #424855; }
input:focus, textarea:focus, select:focus { border-color: #869acd; box-shadow: 0 0 0 2px #869acd12; }
input::placeholder, textarea::placeholder { color: #b0b4be; }
textarea { resize: vertical; min-height: 78px; line-height: 1.7; }
.two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.pack-preview { font: 11px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: #f8f9fb; padding: 17px; border: 1px solid var(--line); border-radius: 4px; max-height: 52vh; overflow: auto; margin: 15px 0; }
.danger { color: #a16363; }
.error { color: #b15a50; font-size: 12px; line-height: 1.7; }
.import { border-bottom: 1px solid var(--line); padding-bottom: 16px; font-size: 11px; color: #9196a2; }
.import input { border: 0; padding: 4px 0; font-size: 11px; }
.note { padding: 11px 13px; background: #f6f7fa; border-left: 2px solid #c6cddc; font-size: 12px; color: #818896; line-height: 1.8; margin: 0; }
#toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 10; background: #30343e; color: #fff; border: 1px solid #454955; border-radius: 6px; padding: 10px 17px; display: none; font-size: 12px; box-shadow: 0 4px 20px #0002; }
@media (max-width: 1200px) {
  .table-head, .task-row { grid-template-columns: minmax(150px, 1fr) 108px 105px 16px; }
  .agent-column { display: none; }
  .project-layout { grid-template-columns: minmax(0, 1fr) 190px; gap: 25px; }
  .properties { padding-left: 20px; }
  .action-strip { align-items: flex-start; flex-direction: column; gap: 13px; }
}
@media (max-width: 900px) {
  :root { --sidebar: 186px; }
  #view { padding: 26px 24px 45px; }
  header { padding: 0 24px; }
  .brand { font-size: 13px; gap: 7px; }
  .project-layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .properties { border-left: 0; border-top: 1px solid var(--line); padding: 22px 0 0; margin-top: 12px; }
  .properties dl { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; align-items: baseline; }
  .properties dt { margin: 0; }
  .properties h2 { margin-bottom: 18px; }
  .property-actions { display: flex; flex-wrap: wrap; gap: 6px 20px; }
  .property-footnote { margin-top: 16px; }
  .table-head, .task-row { grid-template-columns: minmax(130px, 1fr) 103px 16px; gap: 10px; }
  .date-column { display: none; }
}
@media (max-width: 600px) {
  .sidebar { position: static; width: 100%; padding: 14px 18px; border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; align-items: center; gap: 15px; }
  .brand { margin: 0 auto 0 0; }
  .nav-home { font-size: 11px; padding: 5px; }
  .nav-home > span:first-child, .sidebar .nav-label > span, nav, footer { display: none; }
  .nav-label { margin: 0; }
  .icon-button { width: 25px; }
  main { margin-left: 0; }
  header { padding: 0 20px; height: 45px; }
  #view { padding: 23px 20px 40px; }
  h1, .title-line h1 { font-size: 20px; }
  .page-heading { margin-bottom: 24px; }
  .title-line { flex-direction: column; gap: 10px; }
  .list-toolbar { flex-direction: column; align-items: stretch; gap: 14px; }
  .search { max-width: none; }
  .task-row { min-height: 76px; padding: 12px 3px; }
  .table-head { padding: 0 3px; }
  .task-name strong { font-size: 12px; }
  .task-repo { font-size: 10px; }
  .activity-list li { grid-template-columns: 5px minmax(0, 1fr); gap: 8px; }
  .activity-list time { grid-column: 2; }
  .two-cols { grid-template-columns: 1fr; }
  .record-meta { gap: 5px; }
  .run summary { align-items: flex-start; }
  .run summary > .record-meta { flex-direction: column; align-items: flex-end; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
.bundle-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 20px 0; }
.bundle-pickers input { font-size: 11px; padding: 7px 0; border: 0; }
.bundle-selection-head, .bundle-meta { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: #8c929e; margin: 12px 0; }
.bundle-file-list { max-height: 220px; overflow: auto; border-top: 1px solid var(--line); }
.bundle-file-list label { display: flex; flex-direction: row; align-items: center; gap: 9px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 11px; }
.bundle-file-list input, .bundle-confirm input { width: 13px; height: 13px; flex-shrink: 0; accent-color: #414755; }
.bundle-file-list label > span { overflow-wrap: anywhere; }
.bundle-file-list small { color: #9299a6; margin-left: auto; white-space: nowrap; }
.bundle-excluded { color: #969daa; margin: 12px 0 18px; font-size: 11px; }
.bundle-excluded > div { display: grid; grid-template-columns: minmax(0, 1fr) 1fr; gap: 12px; padding: 6px 0; }
.bundle-excluded code { overflow-wrap: anywhere; }
.bundle-confirm { display: flex; align-items: baseline; flex-wrap: wrap; gap: 7px; margin: 18px 0; font-size: 11px; }
.bundle-confirm code { overflow-wrap: anywhere; }
.bundle-manifest { max-height: 180px; overflow: auto; margin: 18px 0; }
.bundle-manifest > div { display: flex; justify-content: space-between; gap: 15px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 11px; color: #727d8d; }
.bundle-manifest > div > span { overflow-wrap: anywhere; }
.bundle-manifest code { color: #a0a7b3; }
.bundle-task-preview { font-size: 11px; color: #8a94a3; }
@media(max-width:600px) { .bundle-pickers { grid-template-columns: 1fr; gap: 10px; } }

```

### review-bundle.mjs

```
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

```

### review-snapshot.mjs

```
import { createHash } from 'node:crypto';
import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './public/review-policy.js';

export function extractReviewFiles(text) {
  const lines = text.split('\n');
  let manifest = null, inSources = false, manifests = 0, sourceSections = 0;
  const sources = new Map();
  function block(start) {
    const match = lines[start].match(/^(`{3,})(\w*)$/);
    if (!match) throw Error('Expected fenced review content');
    const end = lines.indexOf(match[1], start + 1);
    if (end < 0) throw Error('Unclosed review content');
    return { text: lines.slice(start + 1, end).join('\n'), end };
  }
  function nextBlock(start) {
    while (start < lines.length && !/^`{3,}/.test(lines[start])) start++;
    if (start === lines.length) throw Error('Missing review content');
    return { ...block(start), start };
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '## 全部输入文件清单') {
      manifests++;
      const data = nextBlock(i + 1); manifest = JSON.parse(data.text); i = data.end;
    } else if (lines[i] === '## 源码快照') {
      sourceSections++; inSources = true;
    } else if (inSources && lines[i].startsWith('### ')) {
      const path = lines[i].slice(4);
      if (sources.has(path.toLowerCase())) throw Error('Duplicate source path');
      const data = nextBlock(i + 1);
      sources.set(path.toLowerCase(), { path, content: data.text }); i = data.end;
    } else if (lines[i].startsWith('## ')) {
      inSources = false;
    } else if (/^`{3,}/.test(lines[i])) {
      i = block(i).end;
    }
  }
  if (manifests !== 1 || sourceSections !== 1 || !Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES || sources.size !== manifest.length) throw Error('Invalid review manifest');
  let total = 0;
  const seen = new Set();
  return manifest.map(entry => {
    if (!entry || fileIssue(entry.path) || typeof entry.sha256 !== 'string') throw Error('Forbidden review path');
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate manifest path'); seen.add(key);
    const source = sources.get(key);
    if (!source || source.path !== entry.path) throw Error('Missing source text');
    const bytes = Buffer.from(source.content, 'utf8'); total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || bytes.length !== entry.bytes || bytes.includes(0)) throw Error('Invalid review source size');
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Review checksum mismatch: ${entry.path}`);
    return { path: entry.path, content: source.content };
  });
}

```

### scripts/isolated-check.mjs

```
// Run only the supplied review snapshot. Never mount a repository or the Docker socket.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractReviewFiles } from '../review-snapshot.mjs';
const image = 'node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';
const bundlePath = process.argv[2];
if (!bundlePath) { console.error('Usage: node scripts/isolated-check.mjs path/to/review-copy.md'); process.exit(1); }
const input = readFileSync(bundlePath);
if (input.length > 3_000_000) throw Error('Review bundle is too large');
const files = extractReviewFiles(input.toString('utf8'));
let endpoint = process.env.DOCKER_HOST;
if (!endpoint) {
  const context = spawnSync('docker', ['context', 'inspect'], { encoding: 'utf8', timeout: 15_000 });
  if (context.status !== 0) throw Error('Local Docker context unavailable');
  endpoint = JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host;
}
if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) throw Error('Only a local Unix-socket Docker daemon is allowed');
const docker = (args, options) => spawnSync('docker', ['--host', endpoint, ...args], options);
const check = docker(['image', 'inspect', image], { encoding: 'utf8', timeout: 15_000 });
if (check.status !== 0) throw Error('Pinned Docker image unavailable. No host execution fallback. See README.');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'agentsummary-isolated-')));
const source = join(scratch, 'source'); mkdirSync(source, { mode: 0o755 });
try {
  for (const file of files) {
    const path = join(source, file.path); mkdirSync(join(path, '..'), { recursive: true, mode: 0o755 });
    writeFileSync(path, file.content, { mode: 0o444, flag: 'wx' });
  }
  const results = [];
  function run(label, command) {
    const name = 'agentsummary-review-' + randomUUID();
    try {
      const result = docker(['run', '--rm', '--name', name, '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--cpus=1', '--user=1000:1000', '--mount', `type=bind,src=${source},dst=/review,readonly`, '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=134217728,uid=1000,gid=1000', '--workdir=/review', '--env=TMPDIR=/tmp', '--env=AGENTSUMMARY_DATA_DIR=/tmp/agentsummary-data', '--env=npm_config_cache=/tmp/npm-cache', image, ...command], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1_000_000 });
      const ok = result.status === 0 && !result.error;
      results.push({ label, ok, exitCode: result.status, output: (result.stdout || '') + (result.stderr || ''), error: result.error?.message });
      console.log(`=== ${label}: ${ok ? 'PASS' : 'FAIL'} ===\n${results.at(-1).output}`);
      if (!ok) throw Error(`${label} failed. No host execution fallback.`);
    } finally {
      // Only this invocation's randomly named container can be removed.
      docker(['rm', '-f', name], { stdio: 'ignore', timeout: 15_000 });
    }
  }
  const hostDataPath = fileURLToPath(new URL('../data/projects.json', import.meta.url));
  const probe = `
    const fs = require('node:fs'), net = require('node:net');
    const denied = action => { try { action(); return false; } catch { return true; } };
    const checks = {
      sourceReadable: fs.readFileSync('/review/package.json', 'utf8').length > 0,
      sourceWriteDenied: denied(() => fs.writeFileSync('/review/package.json', 'tamper')),
      rootWriteDenied: denied(() => fs.writeFileSync('/outside-review', 'tamper')),
      hostDataUnreadable: denied(() => fs.readFileSync(${JSON.stringify(hostDataPath)})),
      dockerSocketAbsent: !fs.existsSync('/var/run/docker.sock'),
    };
    const socket = net.connect({host:'1.1.1.1', port:443});
    const timer = setTimeout(() => { socket.destroy(); checks.externalNetworkDenied = true; finish(); }, 1000);
    function finish() { console.log(JSON.stringify(checks)); if (Object.values(checks).some(v => !v)) process.exitCode = 1; }
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); checks.externalNetworkDenied = false; finish(); });
    socket.on('error', () => { clearTimeout(timer); checks.externalNetworkDenied = true; finish(); });
  `;
  run('isolation-boundaries', ['node', '-e', probe]);
  run('syntax-check', ['npm', 'run', 'check']);
  run('test-suite', ['npm', 'test']);
  console.log(JSON.stringify({ image, files: files.length, network: 'none', snapshot: 'read-only', hostRepositoryMounted: false, externalDesktopAgentConfined: false, checks: results.map(({label,ok,exitCode}) => ({label,ok,exitCode})) }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }

```

### server.mjs

```
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { createProject, act, taskPack, delivery, ValidationError } from './domain.mjs';
import { buildReviewBundle } from './review-bundle.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = process.env.AGENTSUMMARY_DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, 'projects.json');
let projects;
try { projects = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(projects)) throw new Error('Invalid database'); }
catch (e) { if (e.code === 'ENOENT') projects = []; else throw e; }
function save(next) { writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); renameSync(file + '.tmp', file); projects = next; }
const publicFiles = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/review-policy.js': 'review-policy.js', '/review-export.js': 'review-export.js' };
const server = http.createServer(async (req, res) => {
  const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    const host = req.headers.host;
    if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) return send(403, { error: '仅允许本机访问' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: '请求来源不允许' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'GET' && publicFiles[path]) {
      const name = publicFiles[path]; res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)] + '; charset=utf-8');
      return res.end(readFileSync(join(root, 'public', name)));
    }
    if (req.method === 'GET' && path === '/api/projects') return send(200, projects);
    const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(pack|delivery|review-bundle))?$/);
    if (req.method === 'GET' && match && match[2] !== 'review-bundle') {
      const p = projects.find(x => x.id === match[1]); if (!p) return send(404, { error: '项目不存在' });
      return send(200, match[2] ? { text: match[2] === 'pack' ? taskPack(p) : delivery(p) } : p);
    }
    if (req.method === 'DELETE' && match && !match[2]) { save(projects.filter(p => p.id !== match[1])); return send(200, { ok: true }); }
    if (req.method === 'POST' && (path === '/api/projects' || (match && (!match[2] || match[2] === 'review-bundle')))) {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 JSON 数据' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) return send(413, { error: '内容过大，请控制在 2 MB 内' }); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'JSON 格式无效' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: '需要 JSON 对象' });
      if (match?.[2] === 'review-bundle') {
        const project = projects.find(p => p.id === match[1]);
        if (!project) return send(404, { error: '项目不存在' });
        return send(200, buildReviewBundle(project, input));
      }
      const next = structuredClone(projects); let p;
      if (!match) { p = createProject(input); next.unshift(p); }
      else { p = next.find(x => x.id === match[1]); if (!p) return send(404, { error: '项目不存在' }); act(p, input.action, input); }
      save(next); return send(200, p);
    }
    send(404, { error: '未找到该资源' });
  } catch (e) { if (!(e instanceof ValidationError)) console.error(e); send(e instanceof ValidationError ? 400 : 500, { error: e instanceof ValidationError ? e.message : '保存失败，请查看服务日志；原数据未被覆盖' }); }
});
server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log(`AgentSummary → http://127.0.0.1:${server.address().port}`));

```

### test/domain.test.mjs

```
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, act, taskPack, delivery } from '../domain.mjs';
const project = () => createProject({ title: '登录校验', goal: '拒绝无效输入', repo: '/repo', baseline: 'abc123', scope: 'login', criteria: '非法输入拒绝\n正常登录通过', implementer: 'Codex', reviewer: 'Independent reviewer' });
const result = { summary: '增加校验', artifact: 'diff --git a/login b/login', version: 'def456', evidence: 'login:12', tests: 'node --test: 4 passed; 未跑 E2E', issues: '未验证浏览器兼容性', next: '审查代码' };
const review = { verdict: 'pass', reviewedVersion: 'def456', source: 'Reviewer independent session', criteriaEvidence: '两项验收通过，测试日志见附件', findings: '无阻断问题；E2E 未验证' };
function implemented(p) { act(p, 'dispatch'); act(p, 'result', result); }
test('full handoff, independent review and explicit user acceptance', () => {
 const p = project(); assert.match(taskPack(p), /abc123/); implemented(p); assert.equal(p.stage, 'review'); assert.match(taskPack(p), /def456/);
 assert.throws(() => act(p, 'accept', { note: 'done' })); act(p, 'dispatch'); act(p, 'review', review); assert.equal(p.status, 'awaiting'); assert.match(delivery(p), /待用户验收/);
 act(p, 'accept', { note: '已检查代码和测试' }); assert.equal(p.status, 'accepted'); assert.match(delivery(p), /用户已验收/); assert.throws(() => act(p, 'dispatch'));
});
test('missing evidence cannot advance implementation', () => { const p = project(); act(p, 'dispatch'); assert.throws(() => act(p, 'result', { ...result, tests: '' }), /验证/); assert.equal(p.runs.length, 0); assert.equal(p.stage, 'implement'); });
test('review of a different version is rejected', () => { const p = project(); implemented(p); act(p, 'dispatch'); assert.throws(() => act(p, 'review', { ...review, reviewedVersion: 'old' }), /版本/); assert.equal(p.reviews.length, 0); });
test('review rejection preserves previous records and starts new implementation', () => { const p = project(); implemented(p); act(p, 'dispatch'); act(p, 'review', { ...review, verdict: 'rework', findings: '阻断：缺少空值测试' }); assert.equal(p.cycle, 2); assert.equal(p.status, 'rework'); assert.equal(p.runs.length, 1); assert.match(taskPack(p), /缺少空值测试/); assert.throws(() => delivery(p)); implemented(p); assert.equal(p.runs.length, 2); });
test('requirement revision invalidates old evidence and memory', () => { const p = project(); act(p, 'memory', { kind: '事实', text: '旧结论', evidence: 'file:1' }); assert.match(taskPack(p), /旧结论/); implemented(p); act(p, 'revise', { goal: '新目标', criteria: '新验收', baseline: 'new' }); assert.equal(p.revision, 2); assert.equal(p.runs[0].stale, true); assert.equal(p.memories[0].state, '待复核'); assert.doesNotMatch(taskPack(p), /旧结论/); assert.throws(() => act(p, 'review', review)); });
test('blocking and resuming preserves the current step', () => { const p = project(); act(p, 'dispatch'); act(p, 'block', { reason: '缺少权限；获得访问后解除' }); assert.throws(() => act(p, 'result', result), /解除/); act(p, 'resume'); assert.equal(p.status, 'running'); act(p, 'result', result); });
test('user rejection opens a new cycle and is included in next handoff', () => { const p = project(); implemented(p); act(p, 'dispatch'); act(p, 'review', review); act(p, 'reject', { reason: '需要补测中文输入' }); assert.equal(p.stage, 'implement'); assert.match(taskPack(p), /补测中文输入/); assert.throws(() => act(p, 'accept', { note: 'x' })); });
test('cancellation preserves audit and prevents further execution', () => { const p = project(); act(p, 'cancel'); assert.equal(p.history.length, 2); assert.throws(() => act(p, 'dispatch')); });
test('rework handoff includes actual prior change and preserves dispatched input', () => { const p = project(); implemented(p); act(p, 'dispatch'); act(p, 'review', { ...review, verdict: 'rework', findings: 'missing null test' }); assert.match(taskPack(p), /diff --git/); assert.match(taskPack(p), /def456/); assert.match(p.dispatches[0].input, /拒绝无效输入/); });
test('new requirements retain history without importing obsolete review instructions', () => { const p = project(); implemented(p); act(p, 'dispatch'); act(p, 'review', { ...review, verdict: 'rework', findings: 'OBSOLETE FINDING' }); act(p, 'revise', { goal: 'different goal', criteria: 'different criteria', baseline: 'new' }); assert.equal(p.requirements[0].goal, '拒绝无效输入'); assert.doesNotMatch(taskPack(p), /OBSOLETE FINDING/); });
test('new revision clears previous acceptance', () => { const p = project(); implemented(p); act(p, 'dispatch'); act(p, 'review', review); act(p, 'accept', { note: 'OLD APPROVAL' }); act(p, 'revise', { goal: 'new', criteria: 'new', baseline: 'new' }); implemented(p); act(p, 'dispatch'); act(p, 'review', review); assert.doesNotMatch(delivery(p), /OLD APPROVAL/); });
test('memory records the evidence version explicitly', () => { const p = project(); implemented(p); act(p, 'memory', { kind: '事实', text: 'new fact', evidence: 'log', version: 'def456' }); assert.equal(p.memories[0].version, 'def456'); });

```

### test/review-bundle.test.mjs

``````
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, act } from '../domain.mjs';
import { buildReviewBundle } from '../review-bundle.mjs';
import { fileIssue } from '../public/review-policy.js';
function project() {
 const p = createProject({ title: 'Review', goal: 'fix unicode', repo: '/private/real-project', baseline: 'before', scope: 'server', constraints: 'no data access', criteria: 'tests pass', implementer: 'Codex', reviewer: 'WorkBuddy' });
 act(p, 'dispatch');
 act(p, 'result', { summary: 'fixed', artifact: 'diff --git a/server.mjs b/server.mjs', version: 'version-1', evidence: '/private/real-project/trials/evidence.log', tests: 'all passed', issues: 'none', next: 'review' });
 return p;
}
const input = files => ({ files, confirmVersion: 'version-1' });
test('bundle covers all selected bytes with hashes and contains no repo path or session history', () => {
 const p = project(); p.memories.push({ text: 'PRIVATE-MEMORY', state: '有效' });
 const source = 'console.log("中文 🧪");\r\n';
 const bundle = buildReviewBundle(p, input([{ path: 'server.mjs', content: source }]));
 assert.equal(bundle.manifest[0].sha256, createHash('sha256').update(source).digest('hex'));
 assert.ok(bundle.text.includes(source));
 assert.ok(bundle.text.includes(p.criteria));
 assert.ok(bundle.text.includes('diff --git'));
 assert.ok(!bundle.text.includes(p.repo));
 assert.ok(!bundle.text.includes('PRIVATE-MEMORY'));
 assert.equal(bundle.boundary, 'materials-only');
 assert.equal(p.status, 'ready');
});
test('filesystem escapes, hidden paths, data and credential files are rejected', () => {
 for (const path of ['../server.mjs', '/etc/passwd', 'C:/test.js', 'src/../data/projects.json', 'src\\test.js', '.env', '.env.local', '.aws/config', 'data/anything.js', 'DATA/anything.js', 'src/.ssh/id_rsa', 'config/credentials.json', 'api-token.json', 'secret.key', 'projects.json', 'node_modules/pkg/index.js', 'trials/workbuddy-001/project.json']) {
  assert.ok(fileIssue(path), path);
  assert.throws(() => buildReviewBundle(project(), input([{ path, content: 'not read from disk' }])), undefined, path);
 }
});
test('unselected files cannot enter a bundle and an arbitrary path never causes a disk read', () => {
 const bundle = buildReviewBundle(project(), input([{ path: 'source.mjs', content: 'provided bytes only' }]));
 assert.deepEqual(bundle.manifest.map(f => f.path), ['source.mjs']);
 assert.ok(bundle.text.includes('provided bytes only'));
});
test('reject invalid payloads, duplicate paths, binary contents and oversized selections', () => {
 const p = project();
 for (const files of [null, [], [{ path: 'x.js', content: 12 }], [{ path: 'x.js', content: '\0' }], [{ path: 'x.js', content: '\uD800' }], [{ path: 'x.js', content: 'x'.repeat(300001) }], [{ path: 'x.js', content: 'a' }, { path: 'X.js', content: 'b' }], Array.from({length:81},(_,i)=>({path:i+'.js',content:''})), Array.from({length:4},(_,i)=>({path:i+'.js',content:'x'.repeat(260000)}))]) {
  assert.throws(() => buildReviewBundle(p, input(files)));
 }
});
test('bundle identity changes with input bytes, task or review version; input order is irrelevant', () => {
 const p = project();
 const a = [{path:'a.js',content:'a'}, {path:'b.js',content:'b'}];
 const first = buildReviewBundle(p, input(a));
 assert.equal(buildReviewBundle(p, input([...a].reverse())).bundleId, first.bundleId);
 assert.notEqual(buildReviewBundle(p, input([{path:'a.js',content:'changed'}])).bundleId, first.bundleId);
 p.criteria = 'new condition'; assert.notEqual(buildReviewBundle(p, input(a)).bundleId, first.bundleId);
});
test('cannot export without current implementation or explicit version confirmation', () => {
 const p = project(); assert.throws(() => buildReviewBundle(p, {files:[{path:'a.js',content:'a'}]}), /确认/);
 p.runs[0].stale = true; assert.throws(() => buildReviewBundle(p, input([{path:'a.js',content:'a'}])), /实现/);
});
test('source fence injection cannot break out of the exported code block', () => {
 const content = '```\n# injected heading\n````';
 const bundle = buildReviewBundle(project(), input([{path:'a.md',content}]));
 assert.ok(bundle.text.includes('`````\n' + content + '\n`````'));
});

``````

### test/review-snapshot.test.mjs

`````
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewBundle } from '../review-bundle.mjs';
import { extractReviewFiles } from '../review-snapshot.mjs';
const project = { id:'test', revision:1, cycle:1, stage:'review', status:'ready', repo:'/private/repo', title:'review', goal:'review source', scope:'test', constraints:'none', criteria:'pass', runs:[{revision:1,cycle:1,version:'v1',artifact:'diff',summary:'changed',tests:'passed',issues:'none'}] };
function bundle(files) { return buildReviewBundle(project, {files,confirmVersion:'v1'}).text; }
test('extract exact UTF-8 text including CRLF, empty files and embedded Markdown headings', () => {
 const files=[{path:'empty.js',content:''},{path:'source.mjs',content:'// 中文 🧪\r\n```\n## 源码快照\n````\n'}];
 const actual=extractReviewFiles(bundle(files)); assert.deepEqual(actual, files);
});
test('reject tampered source content and inconsistent manifest before extracting files', () => {
 const text=bundle([{path:'source.mjs',content:'trusted bytes'}]);
 assert.throws(()=>extractReviewFiles(text.replace('trusted bytes','tampered bytes')), /size|checksum/);
 assert.throws(()=>extractReviewFiles(text.replaceAll('source.mjs','../data.json')), /Forbidden/);
 assert.throws(()=>extractReviewFiles(text.replace('"bytes": 13','"bytes": 1')), /size/);
});
test('reject incomplete bundles and duplicate structural sections', () => {
 assert.throws(()=>extractReviewFiles('not a review bundle'));
 const text=bundle([{path:'source.mjs',content:'console.log(1)'}]);
 assert.throws(()=>extractReviewFiles(text+'\n## 源码快照\n'));
 assert.throws(()=>extractReviewFiles(text.replace('### source.mjs','### missing.mjs')), /Missing/);
});

`````

### test/server.test.mjs

```
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const input = { title: 'HTTP integration fixture', goal: 'reject invalid input', repo: '/test/repo', baseline: 'abc', scope: 'login', criteria: 'tests pass', implementer: 'A', reviewer: 'B' };
async function start(dir) {
 const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', AGENTSUMMARY_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
 const url = await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => { child.kill(); reject(Error('server startup timed out')); }, 5000); child.stdout.on('data', chunk => { output += chunk; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', code => { clearTimeout(timer); reject(Error(`server exited ${code}`)); }); });
 return { child, url };
}
async function stop(child) { if (child.exitCode !== null) return; await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); }
test('HTTP validation, persistence across restart, exports and cross-origin isolation', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'agentsummary-test-')); let service;
 try {
  service = await start(dir);
  const request = (path, body) => fetch(service.url + '/api/projects' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  assert.equal((await request('', {})).status, 400);
  let response = await request('', input); assert.equal(response.status, 200); const p = await response.json();
  assert.equal((await request('/' + p.id, { action: 'accept', note: 'premature' })).status, 400);
  assert.equal((await request('/' + p.id)).status, 200);
  assert.match((await (await request('/' + p.id + '/pack')).json()).text, /reject invalid input/);
  assert.equal((await request('/' + p.id + '/delivery')).status, 400);
  const badOrigin = await fetch(service.url + '/api/projects', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(badOrigin.status, 403);
  const badHost = await new Promise((resolve, reject) => { http.get(service.url + '/api/projects', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); }); assert.equal(badHost, 403);
  await stop(service.child); service = await start(dir);
  const restored = await (await request('/' + p.id)).json(); assert.equal(restored.title, input.title); assert.equal(restored.history.length, 1);
  await request('/' + p.id, { action: 'dispatch' });
  assert.equal((await request('/' + p.id, { action: 'result', summary: 'missing materials' })).status, 400);
  const unchanged = await (await request('/' + p.id)).json(); assert.equal(unchanged.status, 'running'); assert.equal(unchanged.runs.length, 0);
  assert.equal((await fetch(service.url + '/../../domain.mjs')).status, 404);
  for (const path of ['/review-policy.js', '/review-export.js']) assert.equal((await fetch(service.url + path)).status, 200);
  await request('/' + p.id, { action: 'result', summary: 'fixed', artifact: 'actual diff', version: 'bundle-v1', evidence: 'log', tests: 'passed', issues: 'none', next: 'review' });
  const bundleEndpoint = '/' + p.id + '/review-bundle';
  assert.equal((await request(bundleEndpoint, { files: [{ path: 'data/projects.json', content: 'FORBIDDEN' }], confirmVersion: 'bundle-v1' })).status, 400);
  assert.equal((await request(bundleEndpoint, { files: [{ path: 'server.mjs', content: 'hello' }] })).status, 400);
  const bundleResponse = await request(bundleEndpoint, { files: [{ path: 'server.mjs', content: 'selected source' }], confirmVersion: 'bundle-v1' });
  assert.equal(bundleResponse.status, 200);
  const bundle = await bundleResponse.json();
  assert.deepEqual(bundle.manifest.map(f => f.path), ['server.mjs']);
  assert.ok(bundle.text.includes('selected source'));
  const afterExport = await (await request('/' + p.id)).json();
  assert.equal(afterExport.stage, 'review'); assert.equal(afterExport.status, 'ready');
  assert.ok(!JSON.stringify(afterExport).includes('selected source'));
  await stop(service.child); service = await start(dir);
  const afterRestart = await (await request('/' + p.id)).json();
  assert.ok(!JSON.stringify(afterRestart).includes('selected source'));
 } finally { if (service) await stop(service.child); rmSync(dir, { recursive: true, force: true }); }
});

test('UTF-8 characters split across request chunks survive saving and handoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentsummary-utf8-'));
  let service;
  try {
    service = await start(dir);
    const title = '修复中文标题与 emoji 🧪';
    const payload = Buffer.from(JSON.stringify({ ...input, title }));
    // Split inside both a three-byte Chinese character and a four-byte emoji.
    const chineseSplit = payload.indexOf(Buffer.from('修')) + 1;
    const emojiSplit = payload.indexOf(Buffer.from('🧪')) + 2;
    const response = await new Promise((resolve, reject) => {
      const request = http.request(service.url + '/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, result => {
        const chunks = [];
        result.on('data', chunk => chunks.push(chunk));
        result.on('error', reject);
        result.on('end', () => resolve({ status: result.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      request.on('error', reject);
      request.flushHeaders();
      request.write(payload.subarray(0, chineseSplit));
      // Separate network writes so the server receives partial UTF-8 sequences.
      setTimeout(() => {
        request.write(payload.subarray(chineseSplit, emojiSplit));
        setTimeout(() => request.end(payload.subarray(emojiSplit)), 30);
      }, 30);
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.title, title);
    await stop(service.child);
    service = await start(dir);
    const restored = await (await fetch(service.url + '/api/projects/' + response.data.id)).json();
    assert.equal(restored.title, title);
    const pack = await (await fetch(service.url + '/api/projects/' + response.data.id + '/pack')).json();
    assert.ok(pack.text.includes(title));
  } finally {
    if (service) await stop(service.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

```

## 返回格式
返回合法 JSON。不要声称执行了未运行的验证，不替用户验收，也不操作工作台。
```json
{
  "verdict": "pass 或 rework",
  "reviewedVersion": "isolation-9a4a96da427b",
  "source": "执行端及可确认的会话说明",
  "criteriaEvidence": "逐项判断与证据；不能执行的验证须明确说明",
  "findings": "阻断问题、非阻断建议、未验证事项"
}
```
