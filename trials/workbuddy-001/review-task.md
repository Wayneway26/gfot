# 修复中文请求分块乱码 · Codex / WorkBuddy · 审查任务包

需求 v1 / 第 1 轮

## 目标
保证 HTTP 请求中跨数据块的中文和 emoji 在保存、重启恢复与交接包中保持完整。以此任务验证 Codex 实现到 WorkBuddy 审查的真实交接。

## 仓库与版本
仓库：/Users/wayne/AgentSummary
基准：before 快照：trials/workbuddy-001/before/server.mjs 与 server.test.mjs.txt
请确认本地路径可访问；无法访问时请要求提供文件或 diff，勿假设已读取。

## 范围与约束
仅修改 server.mjs 请求体解码及 test/server.test.mjs 回归测试；变更见 trials/workbuddy-001/changes.diff。
保持 2 MB 按字节限制、JSON 错误处理和既有接口行为。WorkBuddy 独立审查，不修改源码，不自动验收。

## 原始验收条件
中文三字节字符、emoji 四字节字符跨请求块时，保存值与原值一致
重启后恢复的标题与原值一致，交接包包含原始标题
新增回归测试在修复前失败、修复后通过
全部既有测试与语法检查通过；代码保留按字节的 2 MB 请求上限

## 当前有效记忆
无。待复核结论不能作为已确认事实。

## 实现交接
{
  "id": "c5b0526a-3f8f-4a1c-b3e6-ff84e4499ca6",
  "at": "2026-10-16T08:22:24.352Z",
  "revision": 1,
  "cycle": 1,
  "stale": false,
  "summary": "复现跨块 UTF-8 数据损坏；收集 Buffer 后一次解码，再解析 JSON，补充真实 HTTP 分块、重启与交接包回归测试。",
  "artifact": "--- a/server.mjs\n+++ b/server.mjs\n@@ -34,9 +34,9 @@\n     if (req.method === 'DELETE' && match && !match[2]) { save(projects.filter(p => p.id !== match[1])); return send(200, { ok: true }); }\n     if (req.method === 'POST' && (path === '/api/projects' || (match && !match[2]))) {\n       if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 JSON 数据' });\n-      let body = '', bytes = 0;\n-      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) return send(413, { error: '内容过大，请控制在 2 MB 内' }); body += chunk; }\n-      let input; try { input = JSON.parse(body); } catch { return send(400, { error: 'JSON 格式无效' }); }\n+      const chunks = []; let bytes = 0;\n+      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) return send(413, { error: '内容过大，请控制在 2 MB 内' }); chunks.push(chunk); }\n+      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'JSON 格式无效' }); }\n       if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: '需要 JSON 对象' });\n       const next = structuredClone(projects); let p;\n       if (!match) { p = createProject(input); next.unshift(p); }\n--- a/test/server.test.mjs\n+++ b/test/server.test.mjs\n@@ -33,3 +33,46 @@\n   assert.equal((await fetch(service.url + '/../../domain.mjs')).status, 404);\n  } finally { if (service) await stop(service.child); rmSync(dir, { recursive: true, force: true }); }\n });\n+\n+test('UTF-8 characters split across request chunks survive saving and handoff', async () => {\n+  const dir = mkdtempSync(join(tmpdir(), 'agentsummary-utf8-'));\n+  let service;\n+  try {\n+    service = await start(dir);\n+    const title = '修复中文标题与 emoji 🧪';\n+    const payload = Buffer.from(JSON.stringify({ ...input, title }));\n+    // Split inside both a three-byte Chinese character and a four-byte emoji.\n+    const chineseSplit = payload.indexOf(Buffer.from('修')) + 1;\n+    const emojiSplit = payload.indexOf(Buffer.from('🧪')) + 2;\n+    const response = await new Promise((resolve, reject) => {\n+      const request = http.request(service.url + '/api/projects', {\n+        method: 'POST',\n+        headers: { 'content-type': 'application/json' },\n+      }, result => {\n+        const chunks = [];\n+        result.on('data', chunk => chunks.push(chunk));\n+        result.on('error', reject);\n+        result.on('end', () => resolve({ status: result.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));\n+      });\n+      request.on('error', reject);\n+      request.flushHeaders();\n+      request.write(payload.subarray(0, chineseSplit));\n+      // Separate network writes so the server receives partial UTF-8 sequences.\n+      setTimeout(() => {\n+        request.write(payload.subarray(chineseSplit, emojiSplit));\n+        setTimeout(() => request.end(payload.subarray(emojiSplit)), 30);\n+      }, 30);\n+    });\n+    assert.equal(response.status, 200);\n+    assert.equal(response.data.title, title);\n+    await stop(service.child);\n+    service = await start(dir);\n+    const restored = await (await fetch(service.url + '/api/projects/' + response.data.id)).json();\n+    assert.equal(restored.title, title);\n+    const pack = await (await fetch(service.url + '/api/projects/' + response.data.id + '/pack')).json();\n+    assert.ok(pack.text.includes(title));\n+  } finally {\n+    if (service) await stop(service.child);\n+    rmSync(dir, { recursive: true, force: true });\n+  }\n+});",
  "version": "utf8-fc451ae0938f",
  "evidence": "修复前后完整快照位于 /Users/wayne/AgentSummary/trials/workbuddy-001/before 和 after；sha256 见 manifest.json；实际失败输出 red-test.log，修复后 green-test.log 与 check.log。",
  "tests": "node --test --test-name-pattern=UTF-8 test/server.test.mjs：修复前 0/1，中文和 emoji 损坏；npm test：修复后 14/14；npm run check：通过。测试是真实本地 HTTP 请求，使用独立临时目录。",
  "issues": "跨块测试通过分时写入请求制造数据块，尚未在其他操作系统和 Node 版本运行；性能与任意损坏 UTF-8 字节流未覆盖。WorkBuddy 尚未完成审查。",
  "next": "WorkBuddy 核对变更、版本摘要、测试覆盖与接口边界；输出 review.json；有阻断问题返回返工，否则交用户最终验收。",
  "raw": ""
}

逐项核对原始验收条件与实际变更；列出阻断问题、非阻断建议和未验证事项。审查版本必须为：utf8-fc451ae0938f。

## 结果传回
在工作台填写对应字段，或导入 JSON。不要声称执行了未运行的验证。
{
  "verdict": "pass 或 rework",
  "reviewedVersion": "utf8-fc451ae0938f",
  "source": "执行端 / 独立会话说明",
  "criteriaEvidence": "逐项验收与证据",
  "findings": "阻断问题、建议、未验证项；无则写无"
}

## 审查操作
先读取 /Users/wayne/AgentSummary/trials/workbuddy-001/manifest.json 并核对 sha256，再检查 changes.diff 与当前源码。可执行 npm run check 和 npm test；测试会启动仅本机临时服务，不要假称已运行。
只审查此改动，不修改源码或自动调用工作台 API。不要安装依赖，不访问无关目录，不发送到其他服务。
将中文审查说明保存为 /Users/wayne/AgentSummary/trials/workbuddy-001/workbuddy-review.md，将有效 JSON 保存为 /Users/wayne/AgentSummary/trials/workbuddy-001/workbuddy-review.json。JSON 字段必须与上方约定一致，其中 reviewedVersion 必须原样为 utf8-fc451ae0938f，verdict 只能是 pass 或 rework。source 写明 WorkBuddy 与实际会话/模型（能确认时）。无法验证之处明确注明。

## Allowed files
Only server.mjs, domain.mjs, package.json, test/ tests, public/app.js, and trials/workbuddy-001/ review materials. Do not read data/, secrets, environment configuration, unrelated projects. Tests use isolated temporary data. Only write workbuddy-review.md and workbuddy-review.json in the trial folder; do not modify product source.
