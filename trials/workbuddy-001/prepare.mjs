import { readFileSync, writeFileSync } from 'node:fs';
const root = '/Users/wayne/AgentSummary';
const dir = root + '/trials/workbuddy-001';
const manifest = JSON.parse(readFileSync(dir + '/manifest.json', 'utf8'));
const endpoint = 'http://127.0.0.1:4317/api/projects';
async function post(path, body) {
  const response = await fetch(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
}
const project = await post('', {
  title: '修复中文请求分块乱码 · Codex / WorkBuddy',
  goal: '保证 HTTP 请求中跨数据块的中文和 emoji 在保存、重启恢复与交接包中保持完整。以此任务验证 Codex 实现到 WorkBuddy 审查的真实交接。',
  repo: root,
  baseline: 'before 快照：trials/workbuddy-001/before/server.mjs 与 server.test.mjs.txt',
  scope: '仅修改 server.mjs 请求体解码及 test/server.test.mjs 回归测试；变更见 trials/workbuddy-001/changes.diff。',
  constraints: '保持 2 MB 按字节限制、JSON 错误处理和既有接口行为。WorkBuddy 独立审查，不修改源码，不自动验收。',
  criteria: '中文三字节字符、emoji 四字节字符跨请求块时，保存值与原值一致\n重启后恢复的标题与原值一致，交接包包含原始标题\n新增回归测试在修复前失败、修复后通过\n全部既有测试与语法检查通过；代码保留按字节的 2 MB 请求上限',
  implementer: 'Codex', reviewer: 'WorkBuddy',
});
await post('/' + project.id, { action: 'dispatch' });
const implemented = await post('/' + project.id, {
  action: 'result',
  summary: '复现跨块 UTF-8 数据损坏；收集 Buffer 后一次解码，再解析 JSON，补充真实 HTTP 分块、重启与交接包回归测试。',
  artifact: readFileSync(dir + '/changes.diff', 'utf8'),
  version: manifest.version,
  evidence: `修复前后完整快照位于 ${dir}/before 和 after；sha256 见 manifest.json；实际失败输出 red-test.log，修复后 green-test.log 与 check.log。`,
  tests: 'node --test --test-name-pattern=UTF-8 test/server.test.mjs：修复前 0/1，中文和 emoji 损坏；npm test：修复后 14/14；npm run check：通过。测试是真实本地 HTTP 请求，使用独立临时目录。',
  issues: '跨块测试通过分时写入请求制造数据块，尚未在其他操作系统和 Node 版本运行；性能与任意损坏 UTF-8 字节流未覆盖。WorkBuddy 尚未完成审查。',
  next: 'WorkBuddy 核对变更、版本摘要、测试覆盖与接口边界；输出 review.json；有阻断问题返回返工，否则交用户最终验收。',
});
const pack = await (await fetch(endpoint + '/' + project.id + '/pack')).json();
writeFileSync(dir + '/review-task.md', pack.text + `\n## 审查操作\n先读取 ${dir}/manifest.json 并核对 sha256，再检查 changes.diff 与当前源码。可执行 npm run check 和 npm test；测试会启动仅本机临时服务，不要假称已运行。\n只审查此改动，不修改源码或自动调用工作台 API。不要安装依赖，不访问无关目录，不发送到其他服务。\n将中文审查说明保存为 ${dir}/workbuddy-review.md，将有效 JSON 保存为 ${dir}/workbuddy-review.json。JSON 字段必须与上方约定一致，其中 reviewedVersion 必须原样为 ${manifest.version}，verdict 只能是 pass 或 rework。source 写明 WorkBuddy 与实际会话/模型（能确认时）。无法验证之处明确注明。\n`);
writeFileSync(dir + '/project.json', JSON.stringify({ projectId: project.id, version: manifest.version, preparedAt: new Date().toISOString(), stage: implemented.stage, baselineMetrics: '尚无对照基线，不能宣称节省比例', reviewer: 'WorkBuddy' }, null, 2));
console.log(JSON.stringify({ id: project.id, version: manifest.version, stage: implemented.stage, reviewTask: dir + '/review-task.md' }));
