# 让 gfot 中的 Claude Code 使用 OpenAI 兼容模型服务

状态：待实现；GitHub Issue 已发布。
GitHub：[#3](https://github.com/Wayneway26/gfot/issues/3)。
本地记录：006。
优先级：P2。
阻塞依赖：GitHub Issue [#1](https://github.com/Wayneway26/gfot/issues/1)「在 gfot 内使用 Claude Code 完成带审批的本地项目任务」。不依赖 005，可并行推进。
基线：h2 / 26e51fd。

## 要解决的问题

用户已有 DeepSeek 等服务的 API Key，或在 OpenCode 中保存了模型服务凭证，希望在 gfot 使用 Claude 执行器完成任务。当前三种原生协议转发只能供会说相应协议的执行器使用，不能直接满足 Claude Code 的跨协议请求。

## 交付行为

用户选择现有 HTTPS API、本地兼容服务或已导入的 OpenCode API Key 连接，Claude 执行器通过本地协议转换完成同一类带工具的项目任务。模型服务与执行器分别选择，密钥始终由 gfot 管理。

## 验收标准

- [ ] 在 Claude 执行器中选择一个 Chat Completions 连接，完成公开文本流、工具调用、宿主审批与工具结果回传的完整任务。
- [ ] 支持非流式与 SSE；正确处理并行工具、分片 JSON 参数、正常完成、错误及截断，不拼造成功响应。
- [ ] 复用已保存的连接和 OpenCode 旧版 API Key 导入，保留用户确认的地址、协议、模型、凭证来源及加密存储；不新增自动扫描私人凭证文件的行为。
- [ ] 模型角色映射、工具能力、上下文上限及不支持内容在界面中明确展示；无法表达的输入、思考签名、服务端工具等必须明确处理或拒绝，不能静默丢弃。
- [ ] 仅每轮临时代理凭证进入执行器；不透传用户 Cookie、额外认证头或上游响应中的敏感错误内容。所有真实服务请求使用明确配置的地址并拒绝重定向。
- [ ] 连接不支持工具调用时，在可用性检查或首次调用中明确失败；导入成功、模型列表可达和实际任务可执行分别展示。
- [ ] 界面准确说明 OpenCode 导入的是底层服务商 API Key，使用其服务商额度；不称为自动复用 OpenCode、豆包、Qoder 或 WorkBuddy 的订阅额度。
- [ ] 至少用两个不同连接的合成服务完成真实 Claude 执行器的工具任务，覆盖授权拒绝、429、断流和取消；打包版 UI 可配置并选择连接。

## 范围

与 005 共享可以复用的 Anthropic 入口、角色映射和错误/流处理约定，避免维护两套互相分叉的客户端实现。但本条可以独立验收，不要求 Codex 账号接入先完成。

非 Claude 模型接入使用第三方兼容模式，不承诺与 Claude 模型相同的效果或全部专有功能。新平台的订阅凭证接入应另开有服务接口证据的 Issue。

## 参考

- [Anthropic 网关支持边界](https://code.claude.com/docs/en/llm-gateway)
- [CC Switch 的协议转换和模型角色映射](https://github.com/farion1231/cc-switch/blob/main/docs/guides/claude-codex-routing-guide-en.md)

## 验证记录

待实现。自动验证使用合成账号与模型服务，不默认消耗用户的真实额度。
