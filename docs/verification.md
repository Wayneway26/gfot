# h2 branch verification

Date: 2026-10-20. Host: macOS / Apple silicon. gfot 0.5.0-h2.1.

- Syntax checks: passed.
- Full automated suite: 82 passed, zero failures or skips.
- Source Electron UI smoke: passed with real upstream Harness² and real OpenCode, using a synthetic local model.
- Packaged UI smoke: pending final validation.

## Harness² coverage

- Real pinned core.recursion.run_sequential(k=1), not a mock coordinator: R=4 probes and P=3 proposal/composition stages.
- Independent project snapshots; hidden/credential paths, dependency trees and symlinks filtered, file/byte limits enforced.
- Explicit optimization consent, tool approval forwarding, stale-adoption rejection, persistent per-task adoption and clear.
- Read-only proposal permissions; adopted prompts do not replace normal tool approval policy.
- Cancellation stops current executor and coordinator; failed proposal sessions remain visible as upstream fallbacks and cannot be adopted as successful refinement.
- All vendored upstream Python files match recorded hashes.
- Native UI exercises optimization, evidence panel, explicit adoption and a subsequent normal turn. The adopted prompt reaches the real model request; the original fixture stays unchanged.

## Existing coverage retained

Existing tests exercise authenticated desktop APIs, encrypted/redacted credentials, OAuth/PKCE/OIDC, refresh/logout races, scoped Responses proxy grants, quotas without automatic replay, tool-result round trips, restart continuity, process-group cleanup, legacy MCP review and handoff. Real OpenCode file-write tests use a synthetic service and approve changes to temporary files.

## Real-provider scope

The earlier explicitly authorized Codex-import diagnostic passed model discovery, Responses inference and function-result return with one real account. That diagnostic predates this Harness² integration. No real account or paid model was used for this branch's tests. Model quality improvement, real-provider multi-stage optimization, browser OAuth, quota responses, real cross-account execution, other Agent runtimes and Harness² cross-task reflection/library are not verified.

Python 3.12/3.13 is an external requirement for optimization, not bundled. Snapshot copies and tool approvals are not an OS sandbox. Automated native file selection uses a simulated dialog, while preload/main IPC, file parsing and encrypted storage are real. Builds remain unsigned/unnotarized; Intel Mac is not validated.
