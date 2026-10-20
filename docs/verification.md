# macOS preview verification

Date: 2026-10-20. Host: macOS, Apple silicon. gfot 0.4.0.

- `npm run check`: passed.
- `npm test`: 76 passed, zero failed or skipped.
- Native Electron UI smoke: passed.
- Packaged app.asar + packaged OpenCode binary UI smoke: passed.
- Final `.app` launched and created its own 0600 state and Keychain-protected vault files.

The UI smoke used real OpenCode processes with a **synthetic localhost model**, selecting Alpha then Beta in one conversation. It verified a sandboxed renderer, the folder-picker IPC bridge, settings dialog, preserved connection selection after adding a profile, and two completed model turns.

The integration suite separately verified an approved temporary file write, tool-result return to the model, restored session continuity after service restart, and model selection reaching the local gateway. Lifecycle tests verified cleanup of a TERM-resistant process and cleanup after its supervising service disappeared. Redaction tests covered quoted/backslash secrets, short keys that overlap protocol IDs, and credentials split across streaming deltas.

Two independent review axes were completed: implementation quality and scoped product behavior. Identified lifecycle, redaction and form-selection defects were fixed and covered by regression checks.

One real Codex-import account passed model discovery, Responses inference and function-result round trip. Still not validated against real accounts: browser OAuth, quota responses, cross-account execution and the other models. Automatic failover, other Agent credential imports, WorkBuddy execution and Harness² integration are absent. Intel Mac and Apple signing/notarization are not validated. Native folder selection is wired through Electron dialog; automated UI smoke checks bridge availability, not manual OS dialog interaction.

## 0.3 connection setup

- Explicit HTTPS-direct profiles and encrypted user-entered API keys.
- Localhost-only plaintext HTTP; remote plaintext, embedded credentials and URL query tokens rejected.
- Unsaved model discovery does not persist its access key.
- Optional inference check requires an explicit consent flag; at most two fixed diagnostic requests, no project access.
- Verification invalidates after endpoint/model/key changes.
- Editing during an in-flight check cannot send its captured old key to a changed endpoint.
- Native UI smoke exercises model discovery through the setup form and verifies that no diagnostic starts before consent.

Real HTTPS provider compatibility is exercised with injected synthetic responses, not a paid account. The real OpenCode execution and UI smoke use a synthetic HTTP loopback server. No running Ollama server was present on this machine. A user must configure a real API key or running local model service before ordinary tasks can run.

Harness² runtime integration is absent; README now documents the current architecture and its proposed optional refinement layer.

## 0.4 account proxy

- Local Codex JSON import encrypts only the access credential; the original file and shared refresh credential are untouched.
- Separate ChatGPT OAuth implements dynamic registration, callback state, PKCE, signed OIDC identity checks and serialized credential rotation.
- Local proxy grants bind one account and model, expire with each turn and never disclose upstream credentials to OpenCode. Revoking a grant during upload prevents upstream execution.
- Logout invalidates local grants immediately; late refresh / logout results cannot overwrite a newer login.
- Two real OpenCode integration tests use synthetic accounts: local-import and managed-OAuth routes each approve a temporary file write, then switch accounts and continue the conversation.
- Native UI smoke exercises a simulated file selection through real main/preload import IPC and confirms that import alone starts no model call.
- Anthropic model discovery uses its native key/version headers.

All 76 automated tests pass. Real provider credentials were not used by these automated tests. A separate, explicitly authorized real Codex diagnostic passed; see accounts.md. The account UI labels the implementation experimental. See [accounts.md](accounts.md) for exact endpoints, implemented scope and pending real-account validation.
