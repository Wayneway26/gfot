# Workspace design review — 2026-10-26

Baseline: h2 de83e5c. [Acceptance criteria](workspace-design-spec.md).

## Standards

One P2 finding: the first recent-task view used creation order. Fixed by sorting a copy by valid last activity with a creation-time fallback. Regression coverage includes a resumed older task, invalid timestamps, empty input and unchanged storage order. Independent follow-up found no remaining issues. DOM IDs, safe label escaping and syntax were checked.

## Spec

No missing requirements or scope issues found. Memory tools remain available, executor/model selectors moved to the composer footer, real recent-task navigation preserves task history, and account/approval/Harness² flows remain accessible. Focus and reduced-motion styles are retained.

Summary: Standards 1 finding resolved, 0 remaining; Spec 0 findings. Actual window validation is recorded in verification.md.
