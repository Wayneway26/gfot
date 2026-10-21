<div align="center">

<img src="docs/readme-hero.svg" alt="gfot" width="100%" />

**A desktop client for local AI coding tasks.**

Projects, Agent sessions and your own model accounts in one place.

**English** · [简体中文](README.zh-CN.md)

![Preview](https://img.shields.io/badge/status-preview-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[Overview](#overview) · [Accounts](#accounts-and-services) · [Harness²](#harness²) · [Installation](#installation)

</div>

<br />

![gfot desktop client](docs/desktop-preview.png)

## Overview

gfot is a desktop client for managing AI coding tasks in local projects. Keep project folders, conversations, execution history and account connections together, and continue a task with a different model or account between turns.

- **Project-based tasks.** Select a local folder and keep conversations and execution records with the task.
- **Your own accounts.** Import an existing Codex login or configure an API, local model service or compatible proxy.
- **Persistent sessions.** Switch model and account connections between turns without starting a new conversation.
- **Execution controls.** Follow streaming output and tool activity; approve file edits, commands and access outside the project.
- **Harness refinement.** Evaluate instruction configurations on project copies with Harness² and adopt a result for subsequent turns.

## Accounts and services

| Connection | Configuration |
| --- | --- |
| **Codex local login** | Import a selected `auth.json` file. Access credentials are copied into encrypted local storage. |
| **Model APIs** | Configure an endpoint and API key using Chat Completions, Responses or Anthropic protocols. |
| **Local models** | Connect Ollama or another compatible service on the local machine. |
| **Local proxies** | Connect a compatible proxy endpoint, including routes configured in CC Switch. |

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
npm run desktop
```

### Usage

1. Open **Agent 选择** and configure an account or service connection.
2. Create a task, select a project folder and enter your instructions.
3. Review tool requests during execution. To switch connections, finish or stop the current turn and select another connection.

### Build

```sh
npm run dist:mac
```

The `.app` and ZIP are written to `dist/`. Preview builds are unsigned and have not been Apple-notarized.

## Architecture

| Component | Responsibility |
| --- | --- |
| **gfot · Electron / Node.js** | Desktop interface, task persistence, account management, local proxy and approval handling. |
| **OpenCode · headless service** | Agent Loop, model requests, tool execution and session management. |
| **Harness² · Python adapter** | Optional probe, proposal and composition workflow for task-level instruction configurations. |

Changing a connection selects the model or account used by OpenCode. It does not switch to an installed Codex or WorkBuddy execution runtime.

Credentials are encrypted locally with a master key protected by macOS Keychain. Conversations and execution records are stored locally; configured providers receive the context needed for model requests. Tool approvals are application controls, not an OS sandbox.

## Documentation

[Desktop guide](docs/desktop-preview.md) · [Accounts and proxies](docs/accounts.md) · [Harness² integration](docs/h2-integration.md) · [Verification](docs/verification.md)

## Contributing

Submit bugs and compatibility reports through [GitHub Issues](https://github.com/Wayneway26/gfot/issues). Include the app version, connection type and a redacted error. Do not include credentials or private conversation logs. Pull requests are welcome.

## Acknowledgments

[Electron](https://github.com/electron/electron) · [OpenCode](https://github.com/anomalyco/opencode) · [Google Harness²](https://github.com/google-research/harness2) · [CC Switch](https://github.com/farion1231/cc-switch)

## License

[Apache-2.0](LICENSE). Dependency licenses are listed in [third-party notices](THIRD_PARTY_NOTICES.md).
