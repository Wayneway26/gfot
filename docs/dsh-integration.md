# dsh execution engine

gfot 0.11.0-h2.1 uses DeepSeek Harness 0.2.1-rc.2 for new desktop tasks. Its native loop executes tools, retains sessions and manages in-process subagents. gfot supplies the project/task UI, connection profiles, encrypted accounts, public progress, approvals and user-question responses.

## Request path

`gfot → dsh stdio SDK profile → selected model/API or local account proxy → dsh tools → gfot events`

The same profile types work with dsh: Chat Completions, Responses, Anthropic Messages, local model services and compatible proxies. A model/account change between turns restores the exact dsh session using the new route. Native session history stays on the machine; providers receive the context required by each request.

The existing native WorkBuddy, OpenCode and experimental Doubao adapters remain separate execution flows. They do not become model-only providers in this release. Qianwen still has no execution adapter. No additional provider tokens are extracted by the dsh integration.

## Runtime and persistence

`npm run runtime:dsh` installs the integrity-locked npm runtime and an official Node.js 26.4.0 macOS arm64 binary checked against a pinned SHA-256. The standalone Node is needed because dsh’s native loader does not support gfot’s Electron 44.9 runtime fingerprint. Both runtime and Node ship in the app; installed users do not need a separate Node installation.

Each task uses a separate `dsh/<task-id>` home below gfot’s application data. Generated patches contain provider URLs/model names and a credential environment reference, never the credential itself. Model keys are passed only to the executor environment; dsh scrubs credential-shaped variables from tool subprocesses. The runtime does not load the user’s native dsh home, and telemetry is disabled.

Existing OpenCode tasks retain their old executor and session IDs. Choose `dsh · 内置` to hand an existing task to dsh with gfot’s visible history/checkpoint; an OpenCode session is not silently interpreted as a dsh session.

## Tools and user interaction

A gfot Cordis plugin bridges host approvals, native structured questions and public streaming output. The pinned npm SDK server predates the upstream approval/question transport additions, so this bridge uses dsh’s existing extension points without replacing its loop. Approval cards show actual tool arguments and reasons; question details include submitted plans. Reasoning text is reduced to a thinking signal before crossing into gfot task state.

File mutations, commands and other non-read tools require host approval. External read/search paths are canonicalized, including symlink targets, and need approval for ordinary tasks. Harness² editors and probes deny external reads. Editors additionally deny all non-read tools with a monotonic guard. These are application-level controls; approved commands are not claimed to be completely confined by gfot.

The SDK has no per-prompt cancel method. Stop closes the task’s owned runtime and checks process-group termination before another executor starts. dsh disposes its tool jobs and descendants. External interactive shell/browser state is not restored on resume.

## Harness²

Google’s real sequential k=1 core remains integrated: four project-copy probes and three proposal/composition stages, bounded retries, inspectable evidence and explicit adoption. It still optimizes four instruction documents: system prompt, guardrails, task memory and tool guidance. dsh tasks run those stages through dsh; legacy OpenCode tasks use OpenCode. Adopted instructions are added to subsequent dsh system prompts.

Python 3.12/3.13 is needed only for optimization. Parallel recursion, automated cross-task reflection and automatic provider failover are not enabled.

## Compatibility

dsh is a developer preview; the version is deliberately pinned. Changes to native model/tool protocols require adapter regression tests. The presence of an API configuration does not prove a subscription can use it. Real account access and paid-provider compatibility must be validated independently of the synthetic-model checks.
