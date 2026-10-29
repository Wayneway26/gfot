# Issues

本目录保存本地 Issue 记录。编号 `001`–`007` 是仓库内的记录编号，不是 GitHub Issue 编号；Claude 执行器相关的四条需求已发布到 GitHub；#1 已在 0.13.0-h2.1 实现，#2–#4 待实现。

## Claude 执行器与跨模型接入 · 2026-10-29

目标：用户在 gfot 的统一界面中选择 Claude 执行器，使用自己的模型连接与账号，保留项目、任务和上下文。Claude Code 负责其原生执行循环，gfot 负责界面、记忆、账号路由、审批桥接与任务交接；现有 dsh 入口保留。

当前 0.12 的三协议代理是原生转发，不能据此宣称已经完成 Claude Code 所需的跨协议转换。

| 本地编号 | GitHub | Issue | 优先级 | 阻塞依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 004 | [#1](https://github.com/Wayneway26/gfot/issues/1) | [在 gfot 内使用 Claude Code 完成带审批的本地项目任务](004-claude-native-executor.md) | P1 | 无 | 0.13.0 已实现 |
| 005 | [#2](https://github.com/Wayneway26/gfot/issues/2) | [让 gfot 中的 Claude Code 使用 Codex 账号调用 GPT](005-claude-codex-model-routing.md) | P1 | #1 | 待实现 |
| 006 | [#3](https://github.com/Wayneway26/gfot/issues/3) | [让 gfot 中的 Claude Code 使用 OpenAI 兼容模型服务](006-claude-compatible-api-routing.md) | P2 | #1 | 待实现 |
| 007 | [#4](https://github.com/Wayneway26/gfot/issues/4) | [在同一 Claude 任务中切换账号和模型并继续执行](007-claude-session-model-switching.md) | P1 | #2 | 待实现 |

#1 已完成；#2、#3 可以独立推进；#2 验收后可开始 #4，#3 的连接随后加入切换验收。每条都包含用户可验证的完整路径及合成服务测试标准，不是单独的后端或 UI 层任务。

非 Claude 模型属于第三方兼容方案，Anthropic 官方不支持这一路由。豆包、Qoder 和 WorkBuddy 的订阅模型接口需单独验证，不因为完成这些 Issue 就自动可用。参考：[官方网关边界](https://code.claude.com/docs/en/llm-gateway)、[CC Switch 路由实现说明](https://github.com/farion1231/cc-switch/blob/main/docs/guides/claude-codex-routing-guide-en.md)。

已于 2026-10-30 发布至 [Wayneway26/gfot Issues](https://github.com/Wayneway26/gfot/issues)。四条均标记为 `enhancement`、`ready-for-agent`，正文记录阻塞依赖。实现状态与讨论以 GitHub 为准；本目录保留对应需求文档。

## 已修复的可靠性问题 · 2026-10-25

以下三条在 0.7.2-h2.1 修复，均有可复现的回归测试。它们也是本地记录，未发布为 GitHub Issues。

| 本地编号 | Issue | 修复 |
| --- | --- | --- |
| 001 | [Execution event isolation](001-execution-event-isolation.md) | 绑定执行实例，过滤旧执行和其他会话的事件。 |
| 002 | [Streamed answer preservation](002-preserve-streamed-answer.md) | 原生历史缺少文本时保留已收到的公开输出。 |
| 003 | [ACP process cleanup](003-await-acp-process-exit.md) | 等待自有进程组退出，继续独立核对原生回合停止状态。 |
