<div align="center">

<img src="docs/readme-hero.svg" alt="gfot — 一个项目，接着做下去。One project. Keep going." width="100%" />

**一个客户端，管理你的 AI 编程连接。**<br />
本地项目、任务对话、账号与模型连接，都在这里。

One desktop workspace for your AI coding connections.

[English](README.md) · **简体中文**

![Preview](https://img.shields.io/badge/preview-v0.4.0-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[开始使用](#开始使用) · [接入进度](#agent-接入进度) · [连接模型](#连接模型) · [运行原理](#运行原理) · [开发计划](#开发计划)

</div>

<br />

![gfot macOS 桌面预览](docs/desktop-preview.png)

## 一个客户端，接着做同一个任务

**gfot 是面向本地 AI Agent 生态的统一桌面工作区。** 用一个客户端管理项目、任务对话、账号与模型连接，在同一个任务中继续工作。当前内置 OpenCode 执行引擎，支持 Codex 凭证接入、兼容 API 和本地代理，并逐步扩展其他 Agent 的适配。

长期目标是为 WorkBuddy、Codex、千问办公、豆包工作、OpenCode、Trae 等工具提供统一的任务入口，逐步接入各自可用的授权、模型或执行接口。**适配会逐项完成，v0.4 尚不能直接启动和切换上述全部 Agent。** 下表列出实际接入进度。

执行循环使用内置的 **OpenCode**，模型和账号由你选择。运行桌面客户端无需另外安装 Codex 或 OpenCode；如果选择导入 Codex 凭证，则需要已有的 Codex 登录文件。

| 项目留在这里 | 模型由你选择 | 操作由你批准 |
| --- | --- | --- |
| 本地目录、持久化对话、可查看的执行记录。 | Codex 凭证导入、HTTPS API、CC Switch 路由与本机模型。 | 审批文件修改和命令，回答执行中的问题，随时停止。 |

> **预览版状态：** 目前面向 Apple silicon，安装包尚未签名。一个真实 Codex 导入账号已通过模型目录、Responses 推理及工具结果回传诊断。独立 ChatGPT 浏览器登录已实现，仍待真实账号验收。[查看验证记录 →](docs/verification.md)

## Agent 接入进度

| Agent / 工具 | gfot 目前接到了哪一层 | 验证与边界 |
| --- | --- | --- |
| **OpenCode** | 内置桌面执行引擎，负责工具、审批和会话。 | 已用真实进程配合合成模型验证文件修改审批与同一会话切换账号。 |
| **Codex** | 导入本地登录凭证，通过 gfot 本地代理调用模型。 | 一个真实账号通过目录、推理与工具回传诊断；不是控制 Codex 桌面端，也未运行完整 Codex Agent。 |
| **WorkBuddy** | 独立的旧工作台提供 MCP 桥接，处理审查副本、返回结果和任务检查点。 | HTTP / stdio 桥接测试通过；不是 WorkBuddy 凭证适配，也未接入桌面版执行链路。 |
| **千问办公** | 后续适配候选。 | 尚无适配器或验证，可用接口与授权方式需要进一步调查。 |
| **豆包工作** | 后续适配候选。 | 尚无适配器或验证，可用接口与授权方式需要进一步调查。 |
| **Trae** | 计划接入。 | 尚无凭证或执行适配器，尚未完成端到端验证。 |

**切换模型连接与切换完整 Agent 是两层能力。** 当前桌面版切换的是模型或账号连接，执行器始终为 OpenCode。要切换完整 Agent，还需分别适配它们的工具、权限、执行事件和任务交接；这一层尚未实现。

你可以另外配置兼容的 HTTPS API 或 CC Switch 地址，但这不意味着本机安装了某个 Agent 就能直接调用，也不意味着 WorkBuddy、千问办公、豆包工作或 Trae 已经通过代理接通。

## 开始使用

### 从源码运行

需要 **Apple silicon Mac、Node.js 22.12+ 和 npm**。

```sh
git clone https://github.com/Wayneway26/gfot.git
cd gfot
npm ci
node node_modules/electron/install.js
npm run desktop
```

### 创建第一个任务

1. 打开 **模型连接**，添加账号、API 或本机服务。
2. 读取模型目录并保存连接。可选的 **验证可用性** 会在你确认后发送最多两次固定诊断请求，不读取项目文件；Anthropic 连接目前需要通过实际任务验证执行。
3. 新建任务，选择本地目录，描述目标。确认需要的文件修改和命令后再批准。
4. 如需更换模型或账号，先结束或停止当前回合，再选择另一个连接继续。

### 构建 Mac 应用

```sh
npm run dist:mac
```

生成的 `.app` 和 ZIP 位于 `dist/`。当前构建尚未签名或通过 Apple 公证，也未验证 Intel Mac。

## 连接模型

| 连接方式 | 如何配置 | 当前范围 |
| --- | --- | --- |
| **本地 Codex 登录** | 点击 **导入 Codex 登录**，自行选择 `auth.json`。 | 加密保存访问凭证副本；可手动查询额度，过期后重新导入。已通过一个真实账号的推理和工具诊断。 |
| **独立 ChatGPT 登录** | 点击 **Continue with ChatGPT**，在浏览器中授权。 | 已实现独立客户端注册、PKCE、身份校验和串行刷新；真实浏览器授权仍待验收。 |
| **CC Switch 路由** | 点击 **添加 API / 代理**，填写 CC Switch 显示的实际地址和访问密钥。 | 按路由选择 Chat Completions、Responses 或 Anthropic 协议，上游账号由 CC Switch 管理。 |
| **HTTPS API / 本机模型** | 填入 API 地址和密钥，或选择 DeepSeek / Ollama 预设。 | 远程 API 使用 HTTPS，本机服务使用回环 HTTP；使用你自己的服务和额度。 |

**凭证导入、额度查询和模型推理是三项不同的检查。** 能读取 Token 或模型列表，不代表某个模型能执行任务。额度查询目前只覆盖本地 Codex 导入账号，未知用量不会被当作零额度。

Codex 导入使用可能变化的非官方兼容接口；独立 ChatGPT 登录使用另一条授权路径和公开 Responses API。两者的 Token 不能直接互换接口。[查看账号路由与验收边界](docs/accounts.md)。

同一个账号在 gfot 中使用不会增加额度，也不会重置五小时或 Weekly 限制。目前没有自动额度切换，gfot 不会把已执行的工具操作静默重放到另一个账号。

## 运行原理

```text
                         gfot macOS 工作区
                      目录 · 对话 · 模型选择 · 审批
                                   │
                           本地认证任务服务
                                   │
                         内置 OpenCode 执行循环
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
         gfot 账号与本地代理                    用户配置的模型服务
         ChatGPT / Codex 凭证                 HTTPS API · CC Switch · Ollama
```

- **gfot** 负责桌面界面、任务记录、连接选择和操作审批。
- **OpenCode** 负责 Agent Loop 和工具执行。选择 Codex 模型不会启动完整的 Codex Agent。
- **账号代理** 保管上游订阅凭证，只给执行进程分发绑定账号和模型的临时代理密钥。

### Harness² 用在哪里？

[Google Harness²](https://github.com/google-research/harness2) 计划作为执行器外层的**可选改进机制**。**v0.4 没有导入、调用或打包 Harness²。**

计划中的接入方式是：提出 harness 改动，在隔离副本中按明确预算探测，对比结果，再由用户决定是否采用。当前可运行的桌面执行循环是 OpenCode；切换模型不会运行 Harness²。

## 本地数据与权限

- 账号凭证和 API Key 在本机加密保存，主密钥由 macOS safeStorage / 钥匙串保护。
- 导入只读取你明确选中的凭证文件，不改写原文件，不复制其中的共享刷新凭证，也不在后台扫描其他 Agent 的凭证。
- 对话和执行记录以明文保存在本机，可能包含代码和工具输入。请求模型时，所连接的服务会收到执行所需上下文；“本地优先”不等于离线推理。
- 工具审批属于应用层控制，**不是操作系统沙箱**。不可信项目应放在另外受限的环境中执行。
- 备份时先关闭应用，再备份 gfot 的整个 macOS Application Support 目录。只复制 `.app` 不会备份对话。

## 验证记录

```sh
npm run check
npm test
# macOS 原生界面检查，模型服务为本地合成服务：
npm run test:ui
```

**本机 76 项自动测试通过**：覆盖真实 OpenCode 进程与合成模型的联调、批准后写临时文件、工具结果回传、同一会话切换账号、凭证加密与脱敏、刷新竞争和停止执行。

另经明确授权，使用**一个真实 Codex 导入账号**完成了固定诊断。没有发送项目文件，没有使用共享刷新凭证，原文件前后保持一致。真实跨账号执行、浏览器 OAuth 和其他上游模型仍待验证。

[测试报告](docs/verification.md) · [真实账号诊断](docs/account-diagnostic.json) · [账号实现说明](docs/accounts.md)

## 开发计划

- [x] macOS 桌面工作区、本地目录与持久化任务
- [x] 模型连接、流式工具执行与操作审批
- [x] Codex 凭证导入与本地 Responses 代理
- [x] 独立 ChatGPT OAuth 实现；真实浏览器授权待验收
- [x] 一个真实 Codex 账号的推理与工具诊断
- [ ] 更完整的真实供应方兼容性覆盖
- [ ] WorkBuddy、Claude Code、Gemini 和 Grok 原生凭证适配
- [ ] WorkBuddy、Codex、Trae 等完整 Agent 的执行适配
- [ ] 调查千问办公、豆包工作的接口与授权方式
- [ ] 结合额度与安全续接的路由机制
- [ ] macOS 签名与公证分发
- [ ] 可选的 Harness² 改进模式

桌面版不导入 Codex / WorkBuddy 的聊天记录，也不切换它们完整的执行引擎。早期的手工交接工作台仍可通过 `npm start` 运行，但使用独立的任务存储。[早期规格说明](gfot-prd.md)

## 参与贡献

欢迎提交问题、兼容性测试结果和聚焦的 Pull Request。报告连接问题时，请附上 gfot 版本、连接类型和脱敏后的错误。**不要上传凭证文件、Token 或未脱敏的对话日志。**

[报告问题](https://github.com/Wayneway26/gfot/issues) · [提出改进](https://github.com/Wayneway26/gfot/issues/new)

## 致谢与许可证

使用 [Electron](https://github.com/electron/electron) 与 [OpenCode](https://github.com/anomalyco/opencode) 构建。账号与代理模块的边界设计参考了 [CC Switch](https://github.com/farion1231/cc-switch)，没有复制其源码模块。

gfot 采用 [Apache-2.0](LICENSE) 许可证。依赖保留原有许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)。
