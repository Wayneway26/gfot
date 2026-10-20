# h2 branch verification

Date: 2026-10-20. Host: macOS / Apple silicon. gfot 0.5.0-h2.1.

- Syntax checks: passed.
- Full automated suite: 83 passed, zero failures or skips.
- Source Electron UI smoke: passed with real upstream Harness² and real OpenCode, using a synthetic local model.
- Packaged UI smoke: passed. Python loads from independent app resources; real Harness² + real OpenCode complete optimization, explicit adoption and a subsequent normal turn with synthetic local models.

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

Review fixes additionally cover the upstream context/ folder layout, identical system-prompt installation for probes/adoption, deletion-only changes and explicit oversized-evidence failure instead of trajectory truncation.

The final packaged app passed again after review fixes. Both Standards and Spec review axes completed targeted follow-up with no remaining findings. The synthetic native workflow report is in [h2-ui-check.json](h2-ui-check.json).

## Visual identity update — 2026-10-21

gfot 0.5.0-h2.2 applies the cobalt/cyan vector identity to the README, desktop UI and macOS icon. Syntax checks and the source Electron smoke passed. The packaged Electron smoke also passed, including real Harness²/OpenCode synthetic-model execution, model connection switching, SVG loading and an 840px-wide composer overflow check. Welcome, task, compact and settings layouts were inspected visually. The README screenshots are captures of the new client, not mockups.

[Packaged UI report](brand/ui-check.json). This visual update used no real account credentials or paid model calls. The earlier 83-test full-suite result above predates this styling patch; the full suite was not rerun for this patch.
