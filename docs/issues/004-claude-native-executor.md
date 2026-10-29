# 在 gfot 内使用 Claude Code 完成带审批的本地项目任务

状态：待实现；GitHub Issue 已发布。
GitHub：[#1](https://github.com/Wayneway26/gfot/issues/1)。
本地记录：004。
优先级：P1。
阻塞依赖：无，可立即开始。
基线：h2 / 26e51fd。

## 要解决的问题

用户希望在 gfot 的同一个项目和任务界面中使用 Claude Code 的工具、会话和执行循环。目前可选执行器包括 dsh、OpenCode 与原生 Agent 适配，尚无 Claude Code 执行入口。

## 交付行为

用户选择本地项目和 Claude 执行器、配置一个 Anthropic 原生 API 连接后，即可在 gfot 输入任务、查看进度、批准工具、回答问题并获得结果。执行由本机 Claude Code 承担，gfot 负责界面、账号路由与任务记录。保留 dsh 和现有执行器。

采用 TypeScript Claude Agent SDK 的正式接口控制本机运行时，不复制其闭源执行引擎。首版使用用户明确选定的已安装 Claude Code，不静默安装或改写其全局配置。SDK 展示名称遵循官方品牌要求，gfot 保留自身品牌。

## 验收标准

- [ ] 界面可检测、选择本机运行时；缺失、不可执行或版本不兼容时给出可操作提示，任务不会假启动。
- [ ] 使用 gfot 中配置的 Anthropic API 连接，通过随机、每轮有效的本地代理凭证认证；模型上游密钥不进入界面、命令参数或运行时环境。
- [ ] 运行时配置与会话数据由 gfot 隔离管理，不修改用户的全局 Claude 配置、首次启动状态或原会话。不自动读取原客户端的 claude.ai 登录凭证；正常 SDK/API 配置能完成模型认证。
- [ ] 用户可在同一窗口看到公开文本流、等待模型状态、工具名称与参数、成功或失败结果；私有推理内容不写入任务记录。
- [ ] 写文件、命令及项目外访问遵循宿主审批策略；显示实际操作参数，拒绝后不执行。使用 SDK 回调和必要的前置工具检查，验证不会被自动允许规则绕过。
- [ ] 原生用户问题能在 gfot 回答或取消。主任务和子 Agent 的完整事件按来源归属，不把子任务输出混入主任务，也不承诺 SDK 不提供的子任务逐字流。
- [ ] 停止执行可中断当前回合、取消待处理审批并等待自有进程退出；未确认停止时阻止交接。
- [ ] 退出并重开后可恢复该执行器的原会话；不可恢复时明确报错，不静默创建一个空会话。
- [ ] 用真实本机运行时与合成 Anthropic 服务验证“读取 → 申请写入 → 批准/拒绝 → 工具结果回传 → 后续对话”，并通过打包后的原生 UI 检查。

## 范围

本条先完成 Anthropic 原生协议的完整执行链路。跨协议的 GPT/其他模型接入分别由GitHub Issue [#2](https://github.com/Wayneway26/gfot/issues/2)、006 完成。SDK 的嵌入接口不等于取得 Claude Code 核心代码的开源授权；构建物的依赖、许可和分发方式必须准确记录。

## 参考

- [Agent SDK：执行引擎、会话、工具与品牌边界](https://platform.claude.com/docs/en/agent-sdk/overview)
- [工具审批与权限回调](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [流式输出及子任务事件边界](https://platform.claude.com/docs/en/agent-sdk/streaming-output)

## 验证记录

待实现。创建 Issue 不代表 Claude 执行器已经接通。真实账号诊断须由用户另行明确授权，自动回归只使用合成凭证和模型响应。
