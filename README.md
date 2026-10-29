<div align="center">

<img src="docs/readme-hero.svg" alt="gfot" width="100%" />

**A desktop client for local AI coding tasks.**

Local Agent execution, shared task context and your own accounts.

**English** · [简体中文](README.zh-CN.md)

![Preview](https://img.shields.io/badge/status-preview-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[Overview](#overview) · [Accounts](#accounts-and-services) · [Harness²](#harness²) · [Installation](#installation)

</div>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/desktop-preview-dark.png" />
  <img src="docs/desktop-preview.png" alt="gfot desktop client" />
</picture>

## Overview

gfot is a desktop client for managing AI coding tasks in local projects. Keep project folders, conversations, execution history and account connections together, and switch executors with a saved task checkpoint while keeping the same project folder and conversation.

- **Project-based tasks.** Select a local folder and keep conversations and execution records with the task.
- **Local Agent execution.** Use bundled DeepSeek Harness (dsh) as the default execution engine. OpenCode remains available for existing tasks, alongside installed OpenCode, WorkBuddy or WorkBuddy AI CLIs through ACP. An experimental native Doubao desktop adapter is also available. Each local executor uses its own authentication and quota.
- **Claude Agent.** Select a compatible local Claude Code executable and an Anthropic API connection. Approve tool operations, answer questions and resume the native session in gfot. See [setup and supported version](docs/claude-integration.md).
- **Your own accounts.** Connect an existing Codex login, API, local model service or compatible proxy to dsh. Change the model or account between turns while retaining the same dsh session. Open Accounts & usage to inspect credential status and supported allowance windows.
- **Switch and continue.** Retain per-Agent sessions and hand over project memory, task history, tool results and workspace state to continue the same task.
- **Readable execution.** Follow thinking signals, tool activity and approval requests as they happen. Progress stays collapsed; answers render with headings, lists and copyable code.
- **Harness refinement.** Evaluate instruction configurations on project copies with Harness² and adopt a result for subsequent turns.

Light, dark and system appearance are available from the sidebar. Your preference is saved locally.

## Accounts and services

| Connection | Configuration |
| --- | --- |
| **Codex local login** | Import a selected `auth.json` file. Access credentials are copied into encrypted local storage. |
| **OpenCode API credentials** | Import an API-key entry from a selected legacy `auth.json`, then confirm its endpoint, protocol and model. |
| **Model APIs** | Configure an endpoint and API key using Chat Completions, Responses or Anthropic protocols. |
| **Local models** | Connect Ollama or another compatible service on the local machine. |
| **Local proxies** | Connect a compatible proxy endpoint, including routes configured in CC Switch. |

Built-in execution routes model requests through a local proxy; upstream credentials stay in the host and the executor receives a temporary access key. OpenCode imports use the underlying provider’s allowance. Doubao and WorkBuddy currently use native execution adapters; their subscription model endpoints and Qoder model access are not yet integrated.

Codex credential import is experimental. Connections use your existing service access and account allowance. See [accounts and authentication](docs/accounts.md) for compatibility details.

## Harness²

The `h2` branch integrates Google Harness² for task-level instruction refinement:

1. Run a baseline and candidate configurations in separate project copies.
2. Compose an instruction configuration from the execution evidence.
3. Review and adopt the result for later turns in the same task, or keep the current configuration.

![Harness² refinement panel with synthetic-model responses](docs/harness2-preview.png)

Optimization requires **Python 3.12 or 3.13** and performs multiple model calls. Probe changes are not automatically merged into the original project. See the [Harness² integration](docs/h2-integration.md) for execution limits and configuration scope.

## Installation

Requires **macOS on Apple silicon, Node.js 22.12+ and npm**. Python is optional for ordinary tasks.

```sh
git clone --branch h2 https://github.com/Wayneway26/gfot.git
cd gfot
npm ci
node node_modules/electron/install.js
npm run runtime:dsh
npm run runtime:claude
npm run desktop
```

### Usage

1. Open **Agent 选择** to check a local Agent, sign into its CLI, or configure a model connection for the bundled dsh engine.
2. Create a task, select a project folder and enter your instructions.
3. Review tool requests during execution. To switch connections, finish or stop the current turn and select another executor or connection.

### Build

```sh
npm run dist:mac
```

The `.app` and ZIP are written to `dist/`. Preview builds are unsigned and have not been Apple-notarized.

## Architecture

| Component | Responsibility |
| --- | --- |
| **gfot · Electron / Node.js** | Desktop interface, task persistence, account management, local proxy and approval handling. |
| **DeepSeek Harness · dsh** | Default Agent Loop, native tools, sessions, subagents and host interaction over stdio JSON-RPC. |
| **Claude Agent SDK · native Claude Code** | Optional local execution loop, tools and session, with gfot approvals and an isolated configuration. |
| **Other execution adapters · HTTP / ACP** | Existing OpenCode sessions and installed native Agent CLIs. |
| **Harness² · Python adapter** | Optional probe, proposal and composition workflow for task-level instruction configurations. |

The execution selector switches the Agent runtime; the model selector configures the selected bundled engine. dsh model/account changes retain its native session; selecting a native external Agent uses that Agent’s execution flow. Doubao desktop has an experimental native adapter with per-turn authorization; native interactive confirmations are not yet supported. 千问办公 remains detection-only. [Adapter support and validation](docs/local-agents.md) · [Switching and continuation](docs/dynamic-switching.md).

Credentials are encrypted locally with a master key protected by macOS Keychain. Conversations and execution records are stored locally; configured providers receive the context needed for model requests. Tool approvals are application controls, not an OS sandbox.

## Documentation

[dsh engine](docs/dsh-integration.md) · [Claude Agent](docs/claude-integration.md) · [Local Agents](docs/local-agents.md) · [Desktop guide](docs/desktop-preview.md) · [Accounts and proxies](docs/accounts.md) · [Model-source routing](docs/model-routing.md) · [Harness² integration](docs/h2-integration.md) · [Verification](docs/verification.md)

## Contributing

Submit bugs and compatibility reports through [GitHub Issues](https://github.com/Wayneway26/gfot/issues). Include the app version, connection type and a redacted error. Do not include credentials or private conversation logs. Pull requests are welcome.

## Acknowledgments

[Electron](https://github.com/electron/electron) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [OpenCode](https://github.com/anomalyco/opencode) · [Google Harness²](https://github.com/google-research/harness2) · [CC Switch](https://github.com/farion1231/cc-switch)

## License

[Apache-2.0](LICENSE). Dependency licenses are listed in [third-party notices](THIRD_PARTY_NOTICES.md).
