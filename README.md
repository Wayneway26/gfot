<div align="center">

<img src="docs/readme-hero.svg" alt="gfot — One project. Keep going. 一个项目，接着做下去。" width="100%" />

**A local-first macOS workspace for AI coding.**<br />
Choose a folder. Connect your models. Continue the same task.

面向 AI 编程的本地 macOS 工作区。选一个目录，连接模型，把任务接着做下去。

[English](README.md) · [简体中文](README.zh-CN.md)

![Preview](https://img.shields.io/badge/preview-v0.4.0-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[Get started](#get-started) · [Connections](#connect-your-models) · [How it works](#how-it-works) · [Roadmap](#roadmap)

</div>

<br />

![gfot macOS desktop preview](docs/desktop-preview.png)

## Keep the task. Choose the model.

gfot brings your project folder, conversation, model connections and tool approvals into one desktop window. Switch connections between turns while continuing the same gfot task and its saved conversation.

The execution loop is bundled **OpenCode**. You choose the models and accounts it connects to; you do not need a separate Codex or OpenCode application to run the desktop client. Importing existing Codex credentials requires an existing Codex login file.

| Your workspace | Your connections | Your approval |
| --- | --- | --- |
| Local folders, persistent conversations and a visible execution timeline. | Codex credential import, HTTPS APIs, CC Switch routes and local models. | Review file edits and commands, answer questions, or stop a run. |

> **Preview status:** Apple silicon, unsigned build. One real Codex-import account passed model discovery, Responses inference and a tool-result round trip. Independent ChatGPT browser login is implemented but still awaits real-account validation. [Verification details →](docs/verification.md)

## Get started

### Run from source

Requires **macOS on Apple silicon, Node.js 22.12+ and npm**.

```sh
git clone https://github.com/Wayneway26/gfot.git
cd gfot
npm ci
node node_modules/electron/install.js
npm run desktop
```

### Start your first task

1. Open **模型连接** (Model connections) and add an account, API or local service.
2. Read the model directory and save a connection. The optional **验证可用性** check sends up to two fixed diagnostic requests after confirmation, without reading your project. Anthropic connections currently require an actual task to verify execution.
3. Create a task, choose a local folder and describe the work. Review requested edits and commands before approving them.
4. To change models or accounts, finish or stop the current turn, then select another connection and continue.

### Build a Mac application

```sh
npm run dist:mac
```

The `.app` and ZIP are written to `dist/`. Current builds are unsigned and have not been Apple-notarized; Intel Mac builds have not been validated.

## Connect your models

| Connection | Setup | Current scope |
| --- | --- | --- |
| **Local Codex login** | Choose **导入 Codex 登录**, then select your `auth.json`. | Encrypted access-token copy; manual quota query. Reimport when expired. One real account passed the inference and tool diagnostic. |
| **Independent ChatGPT login** | Choose **Continue with ChatGPT** and authorize in your browser. | Separate client registration, PKCE, identity validation and serialized refresh are implemented. Real browser authorization is still pending validation. |
| **CC Switch route** | Choose **添加 API / 代理** and enter the actual local endpoint and access key shown by CC Switch. | Select Chat Completions, Responses or Anthropic to match the route. CC Switch manages its upstream accounts. |
| **HTTPS API / local model** | Enter your API endpoint and key, or use a DeepSeek / Ollama preset. | HTTPS for remote APIs; loopback HTTP for local services. Uses your own service and allowance. |

**Credential import, quota lookup and successful inference are separate checks.** A readable token or model list does not prove that a model can run. Quota lookup currently covers only locally imported Codex accounts; unknown usage is not treated as zero.

Codex import uses an unofficial compatibility endpoint that may change. Independent ChatGPT login uses a separate authorization path and the public Responses API. Tokens from these paths cannot be used interchangeably. See [account routing and validation](docs/accounts.md).

Using an account in gfot does not create extra allowance or reset its five-hour / weekly limits. Automatic quota failover is not implemented; gfot does not silently replay tool operations through another account.

## How it works

```text
                         gfot macOS workspace
                   folder · conversation · approvals
                                   │
                      local authenticated task service
                                   │
                         bundled OpenCode loop
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
       gfot scoped account proxy            configured model endpoint
       ChatGPT / Codex credentials           HTTPS API · CC Switch · Ollama
```

- **gfot** owns the desktop UI, task records, connection selection and approvals.
- **OpenCode** runs the agent loop and tools. Selecting a Codex model does not launch the complete Codex agent.
- **The account proxy** keeps subscription credentials out of the execution process and gives it a temporary, account-and-model-bound proxy key.

### Where does Harness² fit?

[Google Harness²](https://github.com/google-research/harness2) is a planned **optional outer improvement layer** around the executor. **It is not imported, invoked or bundled in v0.4.**

The intended integration is to propose harness changes, probe them in isolated copies with an explicit budget, compare results and let the user adopt a configuration. The working desktop execution loop today is OpenCode; model switching does not run Harness².

## Local data and permissions

- Account credentials and API keys are encrypted at rest. The master key is protected by macOS safeStorage / Keychain.
- Import reads only the credential file you explicitly select. It does not modify that file, copy its shared refresh token or scan other Agent credentials in the background.
- Conversations and execution records remain local plaintext and can include code and tool inputs. Connected model providers receive the context needed for your requests; “local-first” does not mean offline inference.
- Tool approvals are application controls, **not an operating-system sandbox**. Run untrusted projects in a separately restricted environment.
- Back up the entire macOS Application Support directory for gfot while the app is stopped. Copying the `.app` does not back up conversations.

## Verification

```sh
npm run check
npm test
# Native macOS UI checks, using synthetic local models:
npm run test:ui
```

**76 automated tests passed locally**, including real OpenCode execution against synthetic model servers, approved temporary file writes, tool-result return, same-conversation account switching, credential encryption/redaction, refresh races and cancellation.

A separately authorized diagnostic passed with **one real Codex-import account**. It sent fixed diagnostic prompts, used no shared refresh credential and left the original file unchanged. Real cross-account execution, browser OAuth and other upstream models remain unverified.

[Test report](docs/verification.md) · [Real-account diagnostic](docs/account-diagnostic.json) · [Account implementation](docs/accounts.md)

## Roadmap

- [x] Native macOS workspace, local folders and persistent tasks
- [x] Model connections, streaming tools and approval controls
- [x] Codex credential import and scoped local Responses proxy
- [x] Independent ChatGPT OAuth implementation; real browser validation pending
- [x] One real Codex-account inference and tool diagnostic
- [ ] Broader real-provider compatibility coverage
- [ ] Native credential adapters for WorkBuddy, Claude Code, Gemini and Grok
- [ ] Quota-aware routing with safe task continuation
- [ ] Signed and notarized macOS distribution
- [ ] Optional Harness² improvement mode

The desktop client does not import Codex / WorkBuddy chat histories or switch their complete execution engines. The earlier manual handoff workbench is still available with `npm start`; it uses separate task storage. [Earlier specification](gfot-prd.md)

## Contributing

Bug reports, compatibility results and focused pull requests are welcome. When reporting a connection problem, include the gfot version, connection type and a redacted error. **Do not attach credential files, tokens or unredacted conversation logs.**

[Report an issue](https://github.com/Wayneway26/gfot/issues) · [Discuss an improvement](https://github.com/Wayneway26/gfot/issues/new)

## Acknowledgments and license

Built with [Electron](https://github.com/electron/electron) and [OpenCode](https://github.com/anomalyco/opencode). Account and proxy boundaries were informed by [CC Switch](https://github.com/farion1231/cc-switch); its source modules are not copied into gfot.

gfot is licensed under [Apache-2.0](LICENSE). Dependencies retain their original licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
