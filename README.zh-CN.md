<div align="center">

<img src="docs/readme-hero.svg" alt="gfot — 一个项目，接着做下去。" width="100%" />

**同一个项目，自由选择模型。**<br />
面向 AI 编程任务的桌面工作区。

[English](README.md) · **简体中文**

![Preview](https://img.shields.io/badge/status-preview-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[功能](#功能) · [快速开始](#快速开始) · [Harness²](#harness²) · [文档](#文档)

</div>

<br />

![gfot 桌面客户端](docs/desktop-preview.png)

## 关于 gfot

gfot 将本地项目、任务对话与模型连接整合到一个 macOS 客户端。选择目录、连接模型，即可开始 AI 编程任务；在回合之间更换模型或账号，继续已有任务与对话。

gfot 基于 Electron 与 Node.js 构建，集成 OpenCode 无界面执行服务，提供 Agent Loop 与工具执行能力；由 gfot 统一管理桌面交互、任务记录、模型连接和操作审批。

## 功能

| | |
| --- | --- |
| **项目与对话** | 围绕本地目录开展任务，保存对话历史和执行记录。 |
| **模型选择** | 接入本地 Codex 登录、兼容 HTTPS API 或本机模型服务。 |
| **任务续接** | 在同一会话的回合之间切换模型或账号连接。 |
| **执行可见** | 查看流式回答、工具请求与执行事件。 |
| **操作审批** | 审批文件修改、命令执行和项目外目录访问。 |
| **凭证管理** | 账号凭证和 API Key 加密保存，主密钥由 macOS 钥匙串保护。 |

### 模型连接

- **Codex 登录导入**：选择已有的 `auth.json`，创建本机加密凭证副本。
- **兼容 API**：配置 Chat Completions、Responses 或 Anthropic 接口。
- **本机服务与代理**：连接 Ollama 或兼容本地路由，包括 CC Switch 配置的路由。

切换连接时，任务由内置 OpenCode 执行。Codex 导入为实验功能，模型服务的兼容性与账号额度限制仍然适用。[账号与连接说明](docs/accounts.md)。

## 快速开始

需要 **Apple silicon Mac、Node.js 22.12+ 和 npm**。

```sh
git clone --branch h2 https://github.com/Wayneway26/gfot.git
cd gfot
npm ci
node node_modules/electron/install.js
npm run desktop
```

1. 打开 **Agent 选择**，添加模型连接。
2. 新建任务，选择本地项目目录。
3. 描述目标，查看执行过程并审批所需操作。
4. 如需切换连接，结束或停止当前回合，选择其他连接继续。

运行 `npm run dist:mac` 可构建 macOS 应用，生成的 `.app` 和 ZIP 位于 `dist/`。当前构建尚未签名或通过 Apple 公证。

## Harness²

`h2` 分支集成 Google Harness²，提供可选的任务级执行配置优化。它在独立项目副本上进行探测，提出指令调整，并根据执行证据合成配置。查看结果并确认采用后，配置将用于本任务后续回合。

![Harness² 任务面板，使用合成模型演示](docs/harness2-preview.png)

此功能需要 **Python 3.12 或 3.13**，会进行多次模型调用。探测产生的修改不会自动合并回原项目。普通任务由 OpenCode 执行，无需 Python。[了解接入方式](docs/h2-integration.md)。

## 文档

[桌面版指南](docs/desktop-preview.md) · [账号与代理](docs/accounts.md) · [Harness² 接入](docs/h2-integration.md) · [测试报告](docs/verification.md)

任务对话和执行记录保存在本机；模型推理所需的上下文会发送给所连接的服务。工具审批属于应用层控制，不是操作系统沙箱。

## 参与贡献

欢迎提交 [Issue](https://github.com/Wayneway26/gfot/issues) 或 Pull Request。报告问题时，请附上应用版本、连接类型与脱敏后的错误信息，避免上传凭证和私密对话记录。

## 致谢

使用 [Electron](https://github.com/electron/electron)、[OpenCode](https://github.com/anomalyco/opencode) 与 [Google Harness²](https://github.com/google-research/harness2) 构建，连接管理设计参考 [CC Switch](https://github.com/farion1231/cc-switch)。

采用 [Apache-2.0](LICENSE) 许可证，依赖许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。
