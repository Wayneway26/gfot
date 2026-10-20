# gfot

**One project. Keep going.**

A local-first macOS workspace for AI coding tasks. Choose a folder, connect your API or a local model service, and work in one conversation—with tool approvals and a visible execution timeline.

**Status: macOS 0.4 preview · Apple silicon · unsigned build.**

![gfot macOS workspace](docs/desktop-preview.png)

[中文版本范围](docs/desktop-preview.md) · [Earlier manual-handoff specification](gfot-prd.md)

## What works

- Native macOS window and folder picker.
- Persistent project conversations, with interrupted runs marked on restart.
- Bundled OpenCode 1.19.3 execution engine: no separate Codex or OpenCode app required.
- Multiple encrypted ChatGPT / Codex account records, selectable between turns in one task.
- Explicit local Codex credential-file import, plus independent ChatGPT OAuth registration with PKCE and identity validation.
- A scoped localhost Responses proxy: subscription credentials remain in the account manager, not in the OpenCode process.
- HTTPS API connections and local Chat Completions / Responses / Anthropic services.
- Ollama / DeepSeek configuration presets, model discovery, and an opt-in inference + tool-result diagnostic.
- Streaming execution updates, one-time tool approvals, questions, and stop controls.
- Model access keys encrypted at rest with a master key protected by macOS safeStorage / Keychain.

## 开始使用 / Quick start

**订阅账号接入为实验功能：已通过一个真实 Codex 账号的模型目录、Responses 推理、工具调用与结果回传诊断；独立 ChatGPT 浏览器授权仍待真实验收。**

打开应用 → **模型连接**，选择一种方式：

| 方式 | 如何添加 | 续期 / 查询 |
| --- | --- | --- |
| ChatGPT 独立登录 | 点击 **Continue with ChatGPT**，在系统浏览器中授权 gfot | 独立注册、加密保存和串行刷新；权限以授权页实际授予为准 |
| 已登录的本地 Codex | 点击 **导入 Codex 登录**，自行选择 `auth.json` | 只复制访问凭证；过期后重新导入；支持单独点击查询额度 |
| CC Switch 路由 | **添加 API / 代理**，填写 CC Switch 实际显示的地址和本地访问密钥 | 根据该路由选择 Chat Completions、Responses 或 Anthropic 协议；上游账号仍由 CC Switch 管理 |
| API Key / 本机模型 | 填 HTTPS API，或选择 Ollama 预设 | 使用自己有权使用的服务，不附送模型额度 |

1. 从所选账号 **读取模型目录**，再保存一个模型连接。目录成功不代表有推理权限或足够额度。
2. 点击 **验证可用性**，确认后发送最多两次固定诊断请求。检查推理与工具结果回传，不读取项目文件。Anthropic 连接目前通过实际任务验证。
3. **新建任务**，选择本地项目目录，描述目标。文件修改与命令执行需要审批。
4. 在回合之间选择另一个账号连接继续任务。遇到限额不会中途自动切换或重放已执行操作。

不要在聊天、截图或 Git 配置中粘贴 Token。原客户端文件不会被改写；导入时也不复制或轮换它的共享 refresh token，避免破坏原客户端登录。gfot 独立登录的刷新凭证属于自己的注册，更新时与访问凭证原子保存。

gfot 的会话历史属于 gfot，不导入 Codex 桌面端或 WorkBuddy 的聊天。接入 Codex 订阅模型后，工具与 Agent Loop 仍由内置 OpenCode 执行。

### 凭证、额度、推理是三件事

- **凭证导入成功**：只能说明文件可解析、访问凭证副本已在本机加密保存。
- **额度查询成功**：目前只覆盖本地 Codex 导入账号，依赖兼容接口；不代表某个模型可调用。空 / 未知不是零额度。
- **模型调用成功**：需要完整的 Responses 完成事件；工具回传还需另外通过诊断或实际任务。

独立 ChatGPT 登录依照 [OpenAI 的开源客户端注册流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)，使用公开 Responses API。独立授权与本地 Codex 导入是两条不同的认证路径，不能互换 Token 的接口地址。后者使用非官方 Codex 兼容接口，可能随上游变更失效。Codex 导入已完成单账号真实诊断，其他账号 / 模型兼容性和独立浏览器授权仍需验收。

同一个账号在不同应用中使用不会凭空产生新额度。账号切换仅使用用户已经拥有并获准使用的账号。五小时 / Weekly 等限制仍由上游服务决定；gfot 不重置这些限制。

[详细实现与验收边界](docs/accounts.md)。Ollama / API 预设分别参考 [Ollama 文档](https://docs.ollama.com/api/openai-compatibility) 和 [DeepSeek 文档](https://api-docs.deepseek.com/)。

## Run from source

Requires macOS, Node.js 22.12+ and npm. On Apple silicon:

```sh
npm ci
node node_modules/electron/install.js
npm run desktop
```

## Build a Mac application

```sh
npm run dist:mac
```

Outputs an unsigned `.app` and a ZIP under `dist/`. This preview has not been Apple-notarized. Intel Mac builds have not been validated. Development uses the bundled platform engine; do not copy secrets or runtime data into the application bundle.

## Permissions

Tool permissions are **not** an operating-system sandbox. Review edits and commands before approving them. Run untrusted projects in a separately restricted environment. gfot does not automatically approve tools or reset vendor quotas. Credential-file reads require the explicit native import action; there is no background credential scan.

## Harness² 在哪里？ / Architecture

**Harness² is not imported, invoked, or bundled in gfot 0.4.** It is a researched future integration, not the execution engine used by the current app. The current working path is:

```text
gfot macOS GUI
  → authenticated local task service
  → bundled OpenCode Agent Loop (tools, approvals, conversation)
  → gfot scoped account proxy → selected ChatGPT / Codex subscription
    OR HTTPS model API / CC Switch route / Ollama → selected model
```

| Component | Responsibility | Current status |
| --- | --- | --- |
| gfot | GUI, folder selection, task storage, model selection and approvals | Implemented |
| OpenCode | Inner execution loop, tool invocation and model conversation | Bundled and tested with synthetic models |
| gfot account manager / proxy | Encrypted account records, owned-session renewal, temporary per-task proxy keys and Responses forwarding | Implemented; synthetic execution tests and one real Codex-account diagnostic passed; browser OAuth acceptance pending |
| External API / CC Switch gateway | Other model sources and their allowances | User configured; protocol-specific SDK |
| Google Harness² | Propose–Probe–Compose refinement and persistent improvement lessons | Planned; no runtime integration |

[Google's Harness²](https://github.com/google-research/harness2) optimizes the harness around an executor. It does not supply this desktop GUI or transfer subscription allowances. Its own source contains the [recursion workflow](https://github.com/google-research/harness2/blob/main/harness2/core/recursion.py) and an [OpenCode substrate](https://github.com/google-research/harness2/blob/main/harness2/substrate/opencode.py).

The intended integration point is an **optional outer refinement mode**: propose harness changes → probe them in isolated copies with an explicit budget → compare execution evidence → let the user adopt a composed configuration → retain supported lessons. It would reuse OpenCode underneath. Those steps are **not implemented**; model switching today does not run Harness². The upstream benchmark commands are not suitable to silently run on a user's working folder: the upstream README states that its Codex executor disables the sandbox and network access is unrestricted.

## Current boundaries

Automatic quota detection/failover, native Claude/Gemini/Grok/WorkBuddy credential import, WorkBuddy execution, and Harness² recursive improvement are **not included in the desktop preview**. The earlier manual handoff workbench remains available with `npm start`; it is separate from desktop task storage.

The desktop preview uses OpenCode as its inner execution loop. Harness² remains a planned optional improvement layer; its research benchmark launcher is not silently run on user projects. This release does not claim every upstream model has been tested.

## Verification

```sh
npm run check
npm test
# macOS native UI + synthetic model smoke test:
npm run test:ui
```

On macOS with the bundled engine installed, the suite runs a real OpenCode process against a synthetic local model server. It verifies an approval, a temporary file write, the tool-result round trip, and conversation completion. This smoke test uses no real provider account or paid inference. Other tests cover API authentication, key redaction/encryption, cancellation, model changes and interrupted-state recovery.

## Data

Desktop data lives in the app's macOS Application Support directory. Model access keys and account credential sets are encrypted in `desktop.json`; the master key is stored in `vault-key.bin` protected by Electron safeStorage. Project conversations and execution records are local plaintext and may include code or tool input. They are not synced by gfot. Back up the entire directory with the app stopped. Tasks use separate OpenCode data directories; copying the application itself does not back up conversations.

## Roadmap

- [x] macOS desktop preview and local folder tasks
- [x] HTTPS API / local service profiles and tool approval loop
- [x] Model discovery and opt-in inference / tool-result checks
- [ ] Real-provider compatibility matrix
- [ ] Signed and notarized Mac release
- [x] Codex access-token import, independent ChatGPT OAuth and scoped Responses account proxy (experimental)
- [ ] Real-account acceptance and broader credential adapters
- [ ] Automatic quota-aware routing
- [ ] Harness² improvement integration

## License

Apache-2.0 for gfot. Bundled dependencies retain their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
