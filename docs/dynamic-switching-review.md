# Dynamic switching review

Baseline: h2 e2eb8b4. Scope: desktop project/task context, switch lifecycle, native cancellation confirmation and UI. Source specification: [dynamic-switching-spec.md](dynamic-switching-spec.md).

## Standards

The independent review found shutdown races around workspace observation and request-body reads, missing global execution reservations during handoff, and incomplete local target-account checks. Fixes recheck closure after asynchronous boundaries, reserve execution capacity through old-executor cleanup, exclude native login/configuration mutations during handoff, and reject known unusable target credentials before source cancellation. Regression tests cover these cases.

The final follow-up found no remaining concrete issue in the reviewed fixes. ACP cancellation was also checked: terminating an owned process without a native turn response preserves an unconfirmed state, blocks handoff and requires explicit user confirmation after checking the native app.

## Spec

The independent review found incomplete target preflight and insufficient visibility into tool evidence and context omissions. Both were fixed. Saved tool details and actual prepared character/history/tool counts are visible. Required memory/current instructions are preserved; oversized combined prompts fail explicitly.

The final follow-up found no new important mismatch. Same task/folder, per-executor sessions, bounded project context, no replay after crashes and conditional handoff agree with the specification. WorkBuddy login and the experimental Doubao control boundary remain explicit; the product does not claim all installed Agents or all native interactive workflows are executable.

Standards: four issue categories corrected; no outstanding finding in final targeted follow-up. Spec: two issue categories corrected; no outstanding finding in final targeted follow-up. Independent reviews used synthetic services; the separate native OpenCode→Doubao diagnostic is recorded in [dynamic-native-diagnostic.json](dynamic-native-diagnostic.json).
