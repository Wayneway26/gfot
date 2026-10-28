# Model sources and local routing

gfot separates the execution engine from the model account. Its default dsh runtime owns the task loop, tools and session. A local proxy owns upstream credentials. Switching a model/account between turns keeps the dsh session, project files and visible task history. Harness² continues to refine task instructions through the same relay.

```text
gfot task → dsh → temporary loopback credential → gfot proxy → selected provider
             ↑                                                ↓
             └──────────── model output / tool calls ──────────┘
```

## Source support

| Source | Models for the shared dsh runtime | Native Agent execution |
| --- | --- | --- |
| Codex | Selected access-credential import; existing subscription route is experimental | Not required for the model route |
| OpenCode | Selected legacy `auth.json` API-key entries; endpoint, protocol and model explicitly confirmed | Existing local ACP adapter |
| Doubao | Subscription model route not verified | Existing experimental desktop adapter |
| Qoder | Subscription model route not verified | Installation detection only |
| WorkBuddy / WorkBuddy AI | Subscription model route not verified | Existing CLI / ACP adapters |

OpenCode is a client with multiple providers, not a single interchangeable model token. Imported API keys consume the underlying provider's allowance. OAuth entries cannot be treated as API keys. Recent OpenCode versions store credentials in SQLite; this JSON importer does not read that database or claim to support those versions' storage.

## Import an OpenCode API connection

1. Open **Agent 与账号 → 导入 OpenCode API Key**.
2. Select the legacy `auth.json` you authorize gfot to read. Its usual path is `~/.local/share/opencode/auth.json`; custom data directories may differ.
3. Choose an API-key entry. Unsupported OAuth/command entries are labelled without exposing their values.
4. Enter the key's actual service endpoint, protocol and model, and confirm the destination. No endpoint is inferred from an untrusted credential file.
5. Save, optionally run **验证可用性**, then select the connection in a dsh task.

Selection and import do not contact the model service. A later diagnostic or task consumes the selected provider's usage. Preview tickets expire after five minutes. Only the chosen key is sealed in gfot's local vault. The source file is not modified, refreshed or copied wholesale. Signing out or changing keys in OpenCode does not automatically update the imported copy; clear or replace it through gfot's connection editor.

## Relay boundaries

The proxy accepts Chat Completions, Responses and Anthropic Messages routes. dsh speaks these protocols natively; the relay preserves protocol payloads and streaming tool calls rather than translating one provider's proprietary account token into another token.

Each run gets a random, model-bound credential on `127.0.0.1`. The relay checks host, origin, authorization, method, path, model and request size. It builds upstream authentication itself, rejects redirects, strips incoming client headers, sanitizes errors, and revokes in-flight requests when the run ends. Upstream account credentials stay out of the renderer and the executor environment. This separation does not isolate malicious project tools from everything the macOS user can access; gfot is not an OS sandbox.

Quota querying remains provider-specific. Unknown usage is not reported as a zero balance. Authentication or quota failures do not cause automatic task replay.

## References

- [OpenCode provider credentials and endpoint configuration](https://dev.opencode.ai/docs/providers)
- [OpenCode v2 credential storage](https://dev.opencode.ai/v2/docs/cli/providers)
- [CC Switch routing architecture](https://github.com/farion1231/cc-switch/blob/main/docs/guides/claude-codex-routing-guide-en.md)
- [Qoder custom models](https://docs.qoder.com/qoder/custom-models): importing external models into Qoder does not establish an export API for Qoder subscription allowance.
