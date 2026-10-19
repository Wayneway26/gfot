# gfot

**One project. Keep going.**

A local-first macOS workspace for AI coding tasks. Choose a folder, connect your API or a local model service, and work in one conversation—with tool approvals and a visible execution timeline.

**Status: macOS 0.3 preview · Apple silicon · unsigned build.**

![gfot macOS workspace](docs/desktop-preview.png)

[中文版本范围](docs/desktop-preview.md) · [Earlier manual-handoff specification](gfot-prd.md)

## What works

- Native macOS window and folder picker.
- Persistent project conversations, with interrupted runs marked on restart.
- Bundled OpenCode 1.19.3 execution engine: no separate Codex or OpenCode app required.
- HTTPS API connections and local OpenAI-compatible services, selectable between turns in the same task.
- Ollama / DeepSeek configuration presets, model discovery, and an opt-in inference + tool-result diagnostic.
- Streaming execution updates, one-time tool approvals, questions, and stop controls.
- Model access keys encrypted at rest with a master key protected by macOS safeStorage / Keychain.

## 开始使用 / Quick start

打开应用 → **模型连接** → **添加连接**。任选一条：

| 方式 | 需要准备什么 | 在 gfot 填什么 |
| --- | --- | --- |
| HTTPS API 直连 | 自己有权使用的 OpenAI Chat Completions 兼容 API Key | 服务的 Base URL、API Key、模型 ID；无需另装代理 |
| 本机 Ollama | 已运行的 Ollama，且已准备支持工具调用的模型 | 选择 Ollama 预设，读取模型列表；本地默认地址是 `http://127.0.0.1:11434/v1` |
| 本机代理 | 已运行的 CC Switch 或其他兼容代理 | 代理实际地址、模型 ID、可选访问密钥 |

1. 选择预设或填入自己的服务信息，点击 **读取模型列表**；不支持列表的服务可以手填模型 ID。
2. **保存连接**，点击 **验证可用性**。勾选确认后，应用最多发送两次固定诊断请求，检查推理、工具调用和工具结果回传；可能消耗模型用量，不读取项目文件。
3. **新建任务**，选择本地目录，描述目标。修改文件或执行命令时审核批准请求。
4. 在下一回合切换模型连接，继续同一个任务。

Credentials are entered in the app, not in a chat or committed configuration file. API keys are separate from ChatGPT / WorkBuddy / other agents' subscription login tokens. There is no bundled paid allowance. Neither subscription-token import nor automatic quota switching is implemented.

Only **OpenAI Chat Completions / function calling** compatible endpoints are supported in this release. An Anthropic-native or Responses-only endpoint needs a compatible gateway. HTTPS is required for remote direct connections; plaintext HTTP is restricted to loopback hosts. Model discovery alone does not prove inference or available allowance. Diagnostic success does not guarantee every coding tool or model works with OpenCode. Project code and messages may be sent to the selected service.

Presets follow the [Ollama compatibility docs](https://docs.ollama.com/api/openai-compatibility) and [DeepSeek API docs](https://api-docs.deepseek.com/). A preset does not mean a real account/model has been independently tested; model IDs are discovered from your service rather than permanently hard-coded.

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

Tool permissions are **not** an operating-system sandbox. Review edits and commands before approving them. Run untrusted projects in a separately restricted environment. gfot does not automatically approve tools, reset vendor quotas or extract subscription credentials.

## Harness² 在哪里？ / Architecture

**Harness² is not imported, invoked, or bundled in gfot 0.3.** It is a researched future integration, not the execution engine used by the current app. The current working path is:

```text
gfot macOS GUI
  → authenticated local task service
  → bundled OpenCode Agent Loop (tools, approvals, conversation)
  → HTTPS model API OR local compatible gateway / Ollama
  → selected model
```

| Component | Responsibility | Current status |
| --- | --- | --- |
| gfot | GUI, folder selection, task storage, model selection and approvals | Implemented |
| OpenCode | Inner execution loop, tool invocation and model conversation | Bundled and tested with synthetic models |
| Model API / local gateway | Authentication, inference and provider allowance | User configured; diagnostics available |
| Google Harness² | Propose–Probe–Compose refinement and persistent improvement lessons | Planned; no runtime integration |

[Google's Harness²](https://github.com/google-research/harness2) optimizes the harness around an executor. It does not supply this desktop GUI or transfer subscription allowances. Its own source contains the [recursion workflow](https://github.com/google-research/harness2/blob/main/harness2/core/recursion.py) and an [OpenCode substrate](https://github.com/google-research/harness2/blob/main/harness2/substrate/opencode.py).

The intended integration point is an **optional outer refinement mode**: propose harness changes → probe them in isolated copies with an explicit budget → compare execution evidence → let the user adopt a composed configuration → retain supported lessons. It would reuse OpenCode underneath. Those steps are **not implemented**; model switching today does not run Harness². The upstream benchmark commands are not suitable to silently run on a user's working folder: the upstream README states that its Codex executor disables the sandbox and network access is unrestricted.

## Current boundaries

Automatic quota detection/failover, OAuth account import, WorkBuddy execution, and Harness² recursive improvement are **not included in the desktop preview**. The earlier manual handoff workbench remains available with `npm start`; it is separate from desktop task storage.

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

Desktop data lives in the app's macOS Application Support directory. Model access keys are encrypted in `desktop.json`; the master key is stored in `vault-key.bin` protected by Electron safeStorage. Project conversations and execution records are local plaintext and may include code or tool input. They are not synced by gfot. Back up the entire directory with the app stopped. Tasks use separate OpenCode data directories; copying the application itself does not back up conversations.

## Roadmap

- [x] macOS desktop preview and local folder tasks
- [x] HTTPS API / local service profiles and tool approval loop
- [x] Model discovery and opt-in inference / tool-result checks
- [ ] Real-provider compatibility matrix
- [ ] Signed and notarized Mac release
- [ ] Quota-aware routing and account adapters
- [ ] Harness² improvement integration

## License

Apache-2.0 for gfot. Bundled dependencies retain their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
