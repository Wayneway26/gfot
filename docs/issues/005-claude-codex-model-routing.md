# 让 gfot 中的 Claude Code 使用 Codex 账号调用 GPT

状态：待实现；本地 Issue，尚未发布到 GitHub。
优先级：P1。
阻塞依赖：本地 Issue 004「在 gfot 内使用 Claude Code 完成带审批的本地项目任务」。
基线：h2 / 26e51fd。

## 要解决的问题

当前 Codex 账号路由可供 dsh/OpenCode 使用，但它不是一个能把 Claude Code 请求转换为 GPT 请求的网关。已有 Anthropic 原生转发也没有执行 Messages 与 Responses 之间的转换。

## 交付行为

用户在 Claude 执行器中选择已导入的 Codex 账号和可用 GPT 模型。在 gfot 提交任务后，Claude Code 继续管理上下文、工具和执行循环；本地代理将其 Anthropic Messages 请求转换为 OpenAI Responses，使用所选 Codex 账号推理，再转换回 Claude Code 能接收的响应。

## 验收标准

- [ ] Claude 执行器的连接选择器可以选择现有 Codex 账号，并明确标记为第三方模型兼容模式。
- [ ] 复用既有账号模块获取有效访问凭证，固定发送到该账号适配器允许的服务地址；不向 Claude 子进程暴露上游凭证，不改写或轮换原客户端的共享刷新凭证。
- [ ] 以 gfot 自己的临时代理凭证连接，不要求提供 Claude 订阅额度；Codex 凭证失效或无模型权限时准确报错。
- [ ] 正确映射系统指令、对话、函数工具定义、工具调用 ID、工具结果和完成状态，支持多次工具调用与结果回传。
- [ ] 支持普通响应和 SSE；处理增量工具参数、取消、断流、错误事件与部分输出。流未完成时不得记为任务成功。
- [ ] 显式配置主模型及后台/子 Agent 模型角色映射。未配置的角色按用户可见规则回退或拒绝，不能误发 Claude 模型名，也不能偷偷切到其他付费服务。
- [ ] 上下文与输出预算遵循实际模型上限；不虚报模型身份、上下文容量或专有工具支持。不可转换的图片、文档、服务端工具或其他能力明确拒绝，不能静默删除输入。
- [ ] 401、403、429 与凭证过期在 gfot 中可区分展示；不因为失败自动重放可能已执行工具的回合。
- [ ] 使用真实 Claude 执行器与合成 Codex Responses 服务完成带审批的文件任务，验证工具结果再次进入 GPT 请求、调用账号正确、Claude 进程未得到真实上游密钥。
- [ ] 现有 dsh、OpenCode、Codex 代理及原生 Agent 的回归测试保持通过。

## 范围

本条消耗所选 ChatGPT/Codex 账号原有额度，不迁移或增加额度，不绕过其五小时或周限额；它也不运行 Codex 自己的执行循环。豆包、Qoder、WorkBuddy 的桌面登录不能直接套入本条，仍需分别验证模型接口。

非 Claude 模型路由是第三方兼容方案，Anthropic 官方不提供支持。产品说明应准确展示该边界，不宣称兼容全部 Claude 专有功能。

## 参考

- [CC Switch：Claude Code 到 GPT 的协议路由](https://github.com/farion1231/cc-switch/blob/main/docs/guides/claude-codex-routing-guide-en.md)
- [Anthropic 网关支持边界](https://code.claude.com/docs/en/llm-gateway)

## 验证记录

待实现。本条的真实账号诊断须另获明确授权；合成测试不等于所有 Codex 账号均可访问。
