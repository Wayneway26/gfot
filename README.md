<div align="center">

<img src="docs/readme-hero.svg" alt="gfot — One project. Keep going." width="100%" />

**One project. Your choice of models.**<br />
A desktop workspace for AI coding tasks.

**English** · [简体中文](README.zh-CN.md)

![Preview](https://img.shields.io/badge/status-preview-2862F5?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20silicon-172A4A?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-526887?style=flat-square)](LICENSE)

[Features](#features) · [Quick start](#quick-start) · [Harness²](#harness²) · [Documentation](#documentation)

</div>

<br />

![gfot desktop](docs/desktop-preview.png)

## About gfot

gfot brings local projects, task conversations and model connections into one macOS client. Open a folder, choose a connection and work with AI. Switch models or accounts between turns while continuing the same task and conversation.

Built with Electron and Node.js, gfot integrates OpenCode's headless execution service for the Agent Loop and tools. It manages the desktop interface, task records, model connections and approval controls.

## Features

| | |
| --- | --- |
| **Projects and conversations** | Work in a local folder with saved task history and execution records. |
| **Model choice** | Connect a local Codex login, compatible HTTPS APIs or local model services. |
| **Task continuity** | Change model or account connections between turns in the same session. |
| **Visible execution** | Follow streaming responses, tool requests and execution events. |
| **Approval controls** | Review file changes, commands and access outside the project before approving them. |
| **Local credential storage** | Encrypt account credentials and API keys with a master key protected by macOS Keychain. |

### Model connections

- **Codex login import** — select an existing `auth.json` to create a local encrypted credential copy.
- **Compatible APIs** — configure Chat Completions, Responses or Anthropic endpoints.
- **Local services and proxies** — connect Ollama or a compatible local route, including routes configured in CC Switch.

Connection switching uses the bundled OpenCode executor. Codex import is experimental; provider compatibility and account limits still apply. [Account and connection details](docs/accounts.md).

## Quick start

Requires **an Apple silicon Mac, Node.js 22.12+ and npm**.

```sh
git clone --branch h2 https://github.com/Wayneway26/gfot.git
cd gfot
npm ci
node node_modules/electron/install.js
npm run desktop
```

1. Open **Agent 选择** and add a model connection.
2. Create a task and choose a local project folder.
3. Describe the work, follow execution and review requested operations.
4. To switch connections, finish or stop the current turn, select another connection and continue.

Build a macOS application with `npm run dist:mac`. The `.app` and ZIP are written to `dist/`. Current builds are unsigned and have not been Apple-notarized.

## Harness²

The `h2` branch integrates Google's Harness² for optional task-level execution configuration refinement. It probes independent project copies, proposes instruction changes and composes a configuration from execution evidence. Review the results and explicitly adopt a configuration for later turns in that task.

![Harness² task panel — synthetic-model demonstration](docs/harness2-preview.png)

Harness² requires **Python 3.12 or 3.13** and makes multiple model calls. Probe changes are not automatically merged into the original project. Ordinary tasks run through OpenCode without Python. [How the integration works](docs/h2-integration.md).

## Documentation

[Desktop guide](docs/desktop-preview.md) · [Accounts and proxies](docs/accounts.md) · [Harness² integration](docs/h2-integration.md) · [Test reports](docs/verification.md)

Task conversations and execution records are stored locally; connected model services receive the context needed for inference. Tool approvals are application controls, not an operating-system sandbox.

## Contributing

[Issues](https://github.com/Wayneway26/gfot/issues) and pull requests are welcome. Include the app version, connection type and a redacted error when reporting a problem. Keep credentials and private conversation logs out of reports.

## Acknowledgments

Built with [Electron](https://github.com/electron/electron), [OpenCode](https://github.com/anomalyco/opencode) and [Google Harness²](https://github.com/google-research/harness2). Connection management design draws on [CC Switch](https://github.com/farion1231/cc-switch).

Licensed under [Apache-2.0](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
