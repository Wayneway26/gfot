# Claude Agent in gfot

Select a local Claude Code runtime and an Anthropic API connection to use its execution loop, tools, foreground subagents and native sessions inside gfot. gfot supplies the interface, proxy, approvals and task records. dsh remains the default engine.

## Setup

1. Install the SDK adapter when running from source: `npm run runtime:claude`. Packaged builds already include it.
2. Open **Agent 选择 → Claude Agent · 本机 → 选择执行文件**. Select your installed Claude Code executable. The verified combination is **Claude Code 2.1.312 + Claude Agent SDK 0.3.312**; other versions are rejected with a version hint. gfot does not install, upgrade or bundle the native executable.
3. Add a model connection using the **Anthropic** protocol, a service URL, model ID and API key. An Anthropic-compatible service must implement the messages, streaming and tool features the runtime requires. gfot does not certify arbitrary third-party models by accepting their URL.
4. Create a task, choose a project folder, **Claude Agent · 本机** and that connection. Enter a task and review requests in the approval panel.

No claude.ai desktop login is required for this API route. gfot does not read the user's existing Claude login files. A normal API request uses the configured provider's allowance.

## Execution and permissions

```text
gfot task → Claude Agent SDK → selected local Claude Code
                                  │ temporary per-run key
                                  ↓
                            gfot loopback proxy → Anthropic API
                                  ↑
                    host approvals, questions and tool results
```

The host proxy retains the upstream key; the child receives a random, model-bound key that is revoked when execution ends. Its environment is built explicitly rather than copied from the host. The renderer receives redacted account state.

Each task gets an isolated HOME, Claude config directory and settings root. SDK settings sources are empty; project settings, hooks, skills, plugins, external MCP servers and project `CLAUDE.md` instructions are not automatically loaded. The runtime uses its normal SDK tool surface rather than bare mode, which disables required tools and hooks in the verified version.

The enabled tools are Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion, Agent and TodoWrite. Project reads are permitted; mutations, commands and project-external reads require host approval. A PreToolUse hook enforces decisions before native automatic permission rules. Tool requests show actual parameters. Approving a command authorizes that command's effects; these controls are not an OS sandbox.

Native questions can be answered or cancelled. Public text and tool status appear in the task. Private thinking deltas become activity indicators and are not copied into gfot's task records. The native runtime manages its own isolated session transcript. Foreground subagent events and completed text are labelled separately; gfot does not promise child token streaming that the SDK does not expose. Background tasks are disabled. A turn is capped at 32 native model/tool iterations; reaching the limit reports an error while preserving public progress.

## Continuation and stopping

The native session UUID is saved with the task. A later turn starts the runtime with that same session, including after restarting gfot. Missing native session data causes an explicit error; the adapter does not silently replace it with a new session. Keep the task's isolated `claude/` data with gfot's application data when backing up.

Stopping settles pending requests, interrupts the SDK and waits for the owned process group to exit. An unconfirmed stop blocks task handoff. Switching to another executor uses gfot's existing task checkpoint and shared context; it does not transfer the native runtime's private internal state.

## Compatibility boundary

This integration accepts **Anthropic-native API connections only**. It does not yet route Claude Code to a Codex/GPT account or a Chat Completions service. Those are [Issue #2](https://github.com/Wayneway26/gfot/issues/2) and [Issue #3](https://github.com/Wayneway26/gfot/issues/3). Harness² probe execution remains available through the existing built-in engines; an already adopted instruction configuration can be supplied to a Claude turn as system guidance.

The SDK is proprietary under its own terms. gfot redistributes the JavaScript adapter dependency with its original license and notices, and excludes optional native executable packages. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Validation

Automated tests run the real, explicitly selected native executable against a local synthetic Anthropic service. They cover reads, write approval and refusal, tool-result forwarding, questions and cancellation, external-read refusal, foreground subagents, exact session restoration, missing-session errors and stopping with a pending approval. A malicious project configuration fixture verifies that project auto-allow settings and startup hooks are not loaded.

```sh
GFOT_TEST_CLAUDE_BIN=/absolute/path/to/claude npm test
GFOT_TEST_CLAUDE_BIN=/absolute/path/to/claude \
  node_modules/.bin/electron desktop/test/claude-ui-smoke.cjs
```

Without `GFOT_TEST_CLAUDE_BIN`, native execution tests are explicitly skipped. CI installs a pinned test-only Linux runtime. Tests do not use real account credentials or paid models. The UI fixture simulates only the OS file selection; preload IPC, backend, proxy, SDK, native tools and project filesystem changes are real.

## References

[Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) · [TypeScript API](https://platform.claude.com/docs/en/agent-sdk/typescript) · [Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
