# Local Agent execution

The desktop client has two execution paths:

- **Bundled OpenCode** uses gfot model/account profiles and the local HTTP/SSE adapter.
- **Local ACP Agents** run the installed application's CLI as a supervised child process. Authentication and the default model belong to that Agent. gfot does not copy its tokens or private chat database.

## Current adapters

| Agent | Discovery | Execution | Host validation, 2026-10-21 |
| --- | --- | --- | --- |
| OpenCode | `/Applications/OpenCode.app` or `~/Applications/OpenCode.app` | Bundled `opencode-cli acp` | Real ACP initialization, session creation and fixed inference passed on 2.1.1. |
| WorkBuddy | Installed app's `app.asar.unpacked/cli/bin/codebuddy` | `--serve --acp`, authenticated loopback HTTP sidecar | Protocol and session creation passed on 5.8.3. Fixed inference reported authentication required; CLI login is needed. |
| WorkBuddy AI | Same layout in WorkBuddy AI.app | Same ACP adapter, separate native config directory | Protocol and session creation passed on 5.8.4. Fixed inference reported authentication required; CLI login is needed. |
| 豆包工作 | Doubao.app | No verified local execution interface | Detected only; cannot select for execution. |
| 千问办公 | Qianwen.app | No verified local execution interface | Detected only; cannot select for execution. |

CLI paths and launch arguments are fixed in `desktop/local-agents.mjs`. Renderer requests use a known Agent ID, never a command string. Installed WorkBuddy builds use the lite-wb launcher and their own product configuration. CLI login may differ from desktop login; gfot provides an explicit browser login action, cancellation and status. Reauthorization uses the native CLI and may replace an existing CLI login. Tokens are not returned to gfot.

## Switching and shared context

Use **执行 Agent** in a task. Finish or stop the current turn before switching. Each task saves separate native session IDs for each executor. A return to an Agent resumes that Agent's own session when supported.

gfot retains the visible user/assistant conversation. On first use or return, it forwards messages not yet synchronized to the target executor, up to 60,000 characters, plus editable task notes (8,000 characters maximum). Earlier omitted messages are counted in the execution timeline. Update **任务记忆** for requirements that must remain available. This does not merge private reasoning or import another app's chat history.

Sessions can fail to resume after native data removal or an incompatible app update. gfot reports the failure rather than silently creating a replacement. A CLI that does not advertise loadSession receives a fresh session and visible-history continuation.

## Tools and process ownership

ACP text and tool notifications are normalized into gfot's execution timeline. Permission requests expose only allow-once/reject actions; no automatic always-allow grant is sent. Other client capabilities, including filesystem and terminal services, are not advertised. Native Agents still perform their own tools and apply their own configured policy. gfot is not an OS sandbox.

The supervisor owns the CLI and descendants that remain in its process group, and terminates that group if gfot's service disappears. Stop cancels pending ACP permissions, sends session/cancel, gives the current turn a bounded opportunity to acknowledge cancellation, then terminates the owned group. A pre-existing native background service is not owned or killed by gfot. Native tool cancellation outside the owned process group has not been validated; the adapter relies on the Agent's session/cancel implementation. Native stderr and non-protocol output are discarded, so native authentication logs and HTTP passwords are not persisted in gfot.

## Harness² prompt refinement

**提示词优化** runs the existing pinned Harness² Propose–Probe–Compose workflow using bundled OpenCode and a gfot model profile. It refines the system prompt, guardrails, task memory and tool guidance. Inspect and copy the resulting system prompt before explicit adoption.

Adopted instructions apply to subsequent normal turns in that task. For bundled OpenCode they use `agent.build.prompt`; for ACP Agents they are prepended as user-approved task instructions to the prompt. ACP does not provide a portable system-prompt replacement API. This integration does not claim identical system-level control across runtimes. Native ACP Agents are not yet used for the optimization probes themselves.

## 豆包 / 千问 investigation

Only fully automatic in-client execution is in scope. No manual copy/paste handoff is offered.

With the owner's authorization, a read-only inspection found encrypted Chromium session cookies in the two apps' local profiles. No cookie value was decrypted, printed, copied or sent upstream. 千问's downloaded Node/Python resources were also found, but do not establish an Agent execution API. A token reader alone cannot supply request signing, task/session semantics, SSE events or tool permissions.

The [豆包开放平台](https://open.doubao.com/) describes OpenAPI access under preview admission. 千问's published [MCP connector](https://docs.qwenwork.cn/features/connectors) is a tool connection into the Agent; its [BYOK interface](https://docs.qwenwork.cn/developer/integrations/overview) is called by QwenWork, not a personal desktop Agent control API. These findings do not prove no private interface exists. They are insufficient to enable an automatic adapter.

[CC Switch](https://github.com/farion1231/cc-switch) provides useful credential/profile/routing patterns; gfot does not assume its adapters support these two desktop subscriptions. A verified executable/authorized API and full protocol tests are required before enabling them.
