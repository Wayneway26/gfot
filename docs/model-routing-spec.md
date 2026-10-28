# Model-source routing

The user wants gfot to keep its project, task, context and execution loop while switching their own provider credentials, following CC Switch's separation of client and local proxy. Requested sources include Codex, Doubao, Qoder, OpenCode and WorkBuddy.

## This delivery

- Keep dsh as the default loop and retain Harness² instruction refinement. No Claude Code installation or login is introduced.
- Keep existing Codex account routing. Route non-account Chat Completions, Responses and Anthropic profiles through a supervised, loopback-only HTTP relay as well. Each normal/Harness² run receives a temporary, model-bound grant; upstream keys remain in the host. Revoke grants and abort requests on completion/stop. Do not replay failed requests automatically.
- Import a user-selected OpenCode legacy `auth.json` through native file selection. Preview provider names and support status only; never expose keys to the renderer. Support `type: api` / `key` entries; reject OAuth and command entries as generic API credentials. Modern OpenCode databases need a separate adapter and are not parsed here.
- Require the user to select a credential and explicitly confirm its service endpoint, protocol and model. Seal only the chosen API key using gfot's existing vault. Do not modify the original file or contact a provider during import. Preview tickets expire after five minutes and are discarded after import/cancel/close.
- Show all five requested sources, separating available model access from native Agent execution. Do not present Doubao, Qoder or WorkBuddy subscription tokens as model-ready. Preserve existing native Doubao and WorkBuddy execution. Detect Qoder installations without enabling an unverified executor.
- Verify import, request isolation, errors, streaming/tool payloads, stop/revocation and same-session model/key switching using synthetic accounts and actual dsh. Exercise the native import UI with synthetic files and inspect source/packaged builds.

## Boundaries

This delivery does not extract desktop cookies, decrypt third-party keychains, reverse-engineer subscription model endpoints, query unsupported quota APIs, or claim universal token interchangeability. Provider-specific inference access still requires a verified authentication and model protocol adapter. API keys imported from OpenCode use the underlying provider's quota, which is not automatically OpenCode subscription allowance.
