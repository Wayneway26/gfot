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

The earlier explicitly authorized Codex-import diagnostic passed model discovery, Responses inference and function-result return with one real account. That diagnostic predates this Harness² integration. The initial Harness² validation used synthetic models, without real accounts or paid model calls. Model quality improvement, real-provider multi-stage optimization, browser OAuth, quota responses, real cross-account execution, other Agent runtimes and Harness² cross-task reflection/library were not verified in that initial validation.

Python 3.12/3.13 is an external requirement for optimization, not bundled. Snapshot copies and tool approvals are not an OS sandbox. Automated native file selection uses a simulated dialog, while preload/main IPC, file parsing and encrypted storage are real. Builds remain unsigned/unnotarized; Intel Mac is not validated.

Review fixes additionally cover the upstream context/ folder layout, identical system-prompt installation for probes/adoption, deletion-only changes and explicit oversized-evidence failure instead of trajectory truncation.

The final packaged app passed again after review fixes. Both Standards and Spec review axes completed targeted follow-up with no remaining findings. The synthetic native workflow report is in [h2-ui-check.json](h2-ui-check.json).

## Visual identity update — 2026-10-21

gfot 0.5.0-h2.2 applies the cobalt/cyan vector identity to the README, desktop UI and macOS icon. Syntax checks and the source Electron smoke passed. The packaged Electron smoke also passed, including real Harness²/OpenCode synthetic-model execution, model connection switching, SVG loading and an 840px-wide composer overflow check. Welcome, task, compact and settings layouts were inspected visually. The README screenshots are captures of the new client, not mockups.

[Packaged UI report](brand/ui-check.json). This visual update used no real account credentials or paid model calls. The earlier 83-test full-suite result above predates this styling patch; the full suite was not rerun for this patch.

## Local Agent adapters — 2026-10-21

gfot 0.6.0-h2.1: syntax checks passed, 95 automated tests passed with zero failures/skips. New tests cover ACP transport/permissions/cancellation/output limits, per-executor session restoration, shared task notes and native login cancellation. The source Electron workflow passed with a synthetic installed ACP Agent, real bundled OpenCode and real Harness²; it switches executors, approves a native tool request, preserves canonical messages and adopts an inspectable optimized prompt.

Real installed OpenCode 2.1.1 passed ACP initialization, session creation and a fixed no-project inference. WorkBuddy 5.8.3 and WorkBuddy AI 5.8.4 passed initialization/session creation; fixed inference reported authentication required, including after selecting their native config directories. These two real inference paths are not validated as usable until CLI login. No native credentials were extracted into gfot. 豆包/千问 remain unavailable for automatic execution. See [adapter details](local-agents.md).

## Doubao desktop adapter — 2026-10-22

gfot 0.6.0-h2.2: the final full suite passed **107 tests**, zero failures/skips. Eleven Doubao tests cover explicit native-turn grants, denied/stopped submissions, receipt checkpointing, unknown acceptance without replay, account changes, exact cancellation, late receipts, stalled CDP observers and vendored patch integrity. Backend coverage rejects switching away from unconfirmed native work.

The source and final packaged Electron workflows passed with a synthetic Doubao transport, real bundled OpenCode and real Harness². They exercise Agent switching, the visible native-turn authorization boundary, canonical task history and prompt adoption. The final packaged worker also connected to the installed OpenCode, WorkBuddy, WorkBuddy AI and Doubao interfaces without inference. See [UI report](local-agents-ui-check.json) and [packaged native checks](packaged-native-agent-check.json).

Separately, authorized live Doubao 2.32.5 diagnostics passed fixed inference, selected temporary-project file read/write, a two-turn adapter run with same-conversation continuation, and native waiting_input cancellation confirmed by exact run ID. No repository content or credentials were exported. These are narrow diagnostics, not a broad coding benchmark or proof that native interactive approval forwarding works. WorkBuddy inference still requires completing CLI login; Qianwen has no enabled execution adapter.

Standards and Spec reviews identified timeout and cancellation races; the final targeted follow-up confirmed the fixes, with regression tests. The macOS arm64 build remains unsigned/unnotarized.

## Dynamic task continuation — 2026-10-22

gfot 0.7.0-h2.1 passed syntax checks and **121 automated tests**, zero failures/skips. New coverage exercises canonical project notes, bounded shared checkpoints, visible tool results, large-history omission with the original goal retained, allowance errors, active-turn cancellation before target launch, global capacity reservations, unusable target accounts, shutdown during observation/body reads, unacknowledged native cancellation and interrupted restart recovery.

The source Electron workflow passed with synthetic Agent transports and real bundled OpenCode/Harness² using local synthetic models. It groups a project, edits shared project memory, encounters a native allowance signal, then switches and continues the same task with preserved identity/folder, tool evidence and visible context counts. The final packaged workflow also passed: [packaged UI report](dynamic-switch-ui-check.json), [Electron capture with synthetic services](dynamic-switching-preview.png).

A separate authorized native diagnostic used the actual installed OpenCode and Doubao, with fixed files in a new temporary project. OpenCode inspected the input and saved tool evidence; a switch-and-continue operation handed the same task/project to Doubao, which created the expected output file and passed a read-back check. No repository content or credentials were exported. See [native diagnostic](dynamic-native-diagnostic.json). This is not a real Codex-quota exhaustion or WorkBuddy-login validation.

The [two-axis review](dynamic-switching-review.md) identified and verified the lifecycle, preflight and evidence fixes. Builds remain unsigned macOS arm64 builds. Uniform native quota queries, automatic provider failover, private reasoning/cache migration and a Qianwen executor are not claimed.

## Execution feedback and readable responses — 2026-10-22

gfot 0.7.1-h2.1: 125 automated tests passed with zero failures or skips. Syntax checks passed. Source and packaged Electron workflows validate actual thought signals as status only, tool activity, approvals, frozen elapsed time, collapsed public progress, formatted final answers and native clipboard copy. Interrupted public segments survive restart without duplication. Standards and Spec reviews completed follow-up with no remaining findings.

[Packaged UI report](execution-ui-check.json) · [Interface capture](execution-answer.png) · [Acceptance criteria](execution-ui-spec.md). The UI workflows use synthetic providers and temporary projects; they do not validate additional paid-provider capabilities. Granular thinking and tool states appear only when the selected adapter reports them.

## Execution reliability — 2026-10-25

gfot 0.7.2-h2.1 fixes stale execution events, loss of streamed public answers when history contains no text, and an ACP process-group cleanup race. Each fix has a [local issue record](issues/README.md). These records are not published GitHub Issues.

The final full suite passed 129 tests, with zero failures or skips. Syntax checks and source Electron smoke passed. The final packaged Electron smoke also passed using synthetic services, including Agent switching, shared project/task memory, approvals and Harness² refinement. No real account or paid-provider calls were added. [Packaged report](reliability-ui-check.json) · [Two-axis review](reliability-review.md).

## Account usage panel — 2026-10-26

gfot 0.8.0-h2.1 adds a sidebar Accounts & usage panel. Imported Codex accounts can manually refresh the existing allowance windows; other native Agent and API balances are explicitly unsupported. Saved credentials, historical inference verification and available allowance snapshots are shown separately.

133 automated tests passed, with zero failures/skips, and syntax checks passed. Source and final packaged Electron workflows passed, including the new panel, explicit refresh, retained snapshot after failure, no query on open and account-management navigation. Quota transport in Electron was simulated; a separate account-manager test verifies the existing query/cache behavior with synthetic responses. No real provider allowance or paid-model calls were made. [Packaged report](account-usage-ui-check.json) · [Review](account-usage-review.md) · [Usage](account-usage.md).

## Workspace design — 2026-10-26

gfot 0.9.0-h2.1 replaces accumulated styling with one neutral desktop design system: compact project navigation, smaller brand and task headers, a focused conversation column, a compact executor/model composer footer and consistent account/settings sheets. Home and real recent-task navigation retain existing conversations.

134 automated tests passed with no failures/skips. Syntax checks and source/final packaged Electron workflows passed using synthetic services. Actual welcome, task, thinking/tool state, quota, Harness² and 840×600 layouts were inspected. A review finding about recent-task ordering was fixed and independently verified. [Packaged UI report](workspace-design-ui-check.json) · [Two-axis review](workspace-design-review.md). No real provider calls were made for this UI change.

## Relay brand adoption — 2026-10-26

gfot 0.9.1-h2.1 adopts the approved charcoal/blue Relay g in the client, README header and native macOS icon. One canonical SVG supplies every derived export while preserving the approved viewBox and clip geometry. Updated UI screenshots are real Electron captures with synthetic task/provider data.

Syntax checks, asset generation and source/final packaged Electron workflows passed. Source and packaged routes serve the exact approved mark. Independent SVG/PNG pixel-bound checks, all ten native icon sizes and bundled ICNS byte equality passed. [Packaged UI report](relay-brand-ui-check.json) · [Review](relay-brand-review.md). This asset-focused patch did not rerun the full unit suite; the previous 134-test result belongs to 0.9.0. No real provider calls were made.

## Light and dark appearance — 2026-10-26

gfot 0.10.0-h2.1 adds sidebar light, dark and system choices, a native atomic preference store independent of the local server port, semantic colors throughout the client and a derived dark logo variant. Changes retain task history and unsent drafts.

139 automated tests passed with zero failures/skips. Syntax checks and source/final packaged Electron workflows passed, including persisted selection after reload, system changes, dark settings/usage panels and preserved task drafts/history. Independent Standards and Spec reviews reported no remaining findings. UI services were synthetic; no real provider calls were made. Builds remain unsigned/unnotarized. [Packaged report](appearance-ui-check.json) · [Review](appearance-review.md) · [Usage](appearance.md).

## OLED black workspace — 2026-10-26

gfot 0.10.1-h2.1 changes the dark workspace canvas and native window background to `#000000`. Elevated sidebar, input and dialog surfaces retain their previous colors. Syntax checks and source/final packaged Electron smoke passed with synthetic services. Native assertions verify both the computed page background and Electron window color; three blank-workspace screenshot samples were RGB(0,0,0). The previous 139-test full-suite result belongs to 0.10.0; this color-only patch reran the native smoke rather than the full suite. [Packaged report](oled-ui-check.json).

## Neutral dark colors and brighter text — 2026-10-26

gfot 0.10.2-h2.1 replaces green-tinted dark surfaces and foregrounds with neutral grayscale. The workspace remains pure black; body text is `#e8e8e8`, primary text `#f5f5f5`, secondary text `#c2c2c2` and subtle text `#a8a8a8`. The derived dark logo and its generator use neutral white too. Semantic status colors remain intentional.

Syntax checks and source/final packaged Electron smoke passed using synthetic services, with actual computed neutral sidebar, bright foreground, dialog/input and native black window assertions. All four text levels exceed 4.5:1 against the tested primary dark surfaces; the lowest calculated ratio is 5.55:1. This color-only patch did not rerun the full unit suite. [Packaged report](neutral-dark-ui-check.json).

## dsh execution engine — 2026-10-27

gfot 0.11.0-h2.1 defaults new desktop tasks to pinned DeepSeek Harness 0.2.1-rc.2. It ships a SHA-256-verified standalone Node 26.4.0 because the upstream native loader rejects Electron 44.9’s runtime fingerprint. Existing OpenCode sessions keep their executor; native WorkBuddy/Doubao adapters retain their separate flows.

144 automated tests passed with zero failures/skips. Syntax checks and final source/packaged Electron workflows passed. These exercise actual dsh model/tool execution using local deterministic models, a native file write blocked until a visible approval with exact arguments, same-session model switching, and real Google Harness² four-probe/three-stage refinement plus explicit prompt adoption. dsh tests independently cover native questions, approval rejection, stop, immutable read-only editors, and absolute/symlink/search read boundaries. Both local-import and managed-login Codex proxy paths passed with actual dsh and synthetic accounts, including exact-session account switching and prior-history delivery. No real accounts or paid model calls were used.

Two-axis review fixed hidden operation details and unapproved external reads. Follow-up reported zero remaining findings; both reviewers independently reran the three dsh regression tests. A real temporary bash `sleep 60` process was independently confirmed gone after stop. These checks do not claim complete confinement of approved commands, arbitrary subscription-token compatibility or native shell-state restoration. The macOS arm64 package remains unsigned/unnotarized. [Packaged report](dsh-ui-check.json) · [Review](dsh-integration-review.md) · [Integration](dsh-integration.md) · [Runtime provenance](dsh-runtime-provenance.json).


## 2026-10-28 · 0.12 model-source routing

- `npm run check`: passed.
- `npm test`: 156 passed, 0 failed, 0 skipped. All provider credentials and model responses were synthetic.
- Real bundled dsh exercised Responses and Anthropic SDKs through gfot's local relay, approved a native file write, then changed imported API key/model while preserving the exact native session and prior task context. Chat Completions execution, approvals and Harness² also passed Electron UI checks.
- Protocol relay checks cover three formats, native Anthropic beta query/header handling, upstream root normalization, rejected browser origins, authentication/model/path checks, quota/auth errors without retries, and active-request revocation.
- Credential import checks cover a selected legacy OpenCode JSON file, secret-free preview, rejected OAuth/command entries, destination consent, encrypted storage, source preservation and expired/consumed tickets. Modern OpenCode SQLite storage is not supported by this importer.
- Deterministic streaming redaction regression covers a complete credential ending in its own prefix; overlapping short/temporary keys remain masked and approval IDs remain intact.
- Source Electron UI and final packaged-resource UI passed. Native file selection was simulated with synthetic files; production IPC, file parsing, sealing and renderer were real. Final report: [model-routing-ui-check.json](model-routing-ui-check.json).
- macOS arm64 zip built using installed Electron 44.9.0 (`npm run dist:mac -- --config.electronDist=/Users/wayne/gfot/node_modules/electron/dist`). No signing or public release was performed.
- Independent Standards and Spec reviews have no remaining findings. The Anthropic SDK routing issue and stale QA report issue were fixed before delivery; Standards also reviewed the deterministic redaction fix.
- No real account inference or paid quota was used in this delivery. Doubao/WorkBuddy native adapters remain separate execution paths; their subscription model endpoints and Qoder model access remain unverified.
