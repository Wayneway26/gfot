# gfot

**One project. Keep going.**

A local-first macOS workspace for AI coding tasks. Choose a folder, connect a local model gateway, and work in one conversation—with tool approvals and a visible execution timeline.

**Status: macOS preview · Apple silicon · unsigned build.**

![gfot macOS workspace](docs/desktop-preview.png)

[中文版本范围](docs/desktop-preview.md) · [Earlier manual-handoff specification](gfot-prd.md)

## What works

- Native macOS window and folder picker.
- Persistent project conversations, with interrupted runs marked on restart.
- Bundled OpenCode 1.19.3 execution engine: no separate Codex or OpenCode app required.
- Multiple local OpenAI-compatible model connections, selectable between turns in the same task.
- Streaming execution updates, one-time tool approvals, questions, and stop controls.
- Local gateway keys encrypted at rest with a master key protected by macOS safeStorage / Keychain.

## What you need

A running local model gateway, such as CC Switch, with a model you are authorized to use. Save its actual base URL, model ID and optional local access key in **模型连接**. The application currently accepts loopback HTTP endpoints only.

The connection check queries the model list. It does **not** prove inference, subscription allowance or tool compatibility. A real task is required to verify your selected provider. Code and messages processed by your gateway may be sent to its upstream model service.

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

## Use

1. Configure **模型连接** with your local gateway's address and actual model ID.
2. Create a task and choose a local project directory.
3. Send a concrete goal. Review file-edit and command permission requests before approving them.
4. Inspect the actual changes and tests. Change model connections between turns; the execution engine and task remain the same.

Tool permissions are **not** an operating-system sandbox. Run untrusted projects in a separately restricted environment. gfot does not automatically approve tools, reset vendor quotas or extract subscription credentials.

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

Desktop data lives in the app's macOS Application Support directory. Gateway access keys are encrypted in `desktop.json`; the master key is stored in `vault-key.bin` protected by Electron safeStorage. Project conversations and execution records are local plaintext and may include code or tool input. They are not synced by gfot. Back up the entire directory with the app stopped. Tasks use separate OpenCode data directories; copying the application itself does not back up conversations.

## Roadmap

- [x] macOS desktop preview and local folder tasks
- [x] Local gateway profiles and tool approval loop
- [ ] Real-provider compatibility matrix
- [ ] Signed and notarized Mac release
- [ ] Quota-aware routing and account adapters
- [ ] Harness² improvement integration

## License

Apache-2.0 for gfot. Bundled dependencies retain their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
