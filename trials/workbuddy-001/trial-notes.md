# Codex to WorkBuddy: first real trial

## Initial preparation (before file authorization)

- Task: fix Chinese and emoji corruption across HTTP request chunks.
- Workbench project: 46936f1a-9a38-422e-99d5-6b7c34aa001f.
- Version: utf8-fc451ae0938f (SHA256 snapshot, not a Git commit).
- Implementation complete. red-test.log proves failure before the fix; green-test.log records 14/14 passing after; check.log records syntax checks.
- review-task.md is exported from the workbench with the actual diff, acceptance criteria and return format.
- WorkBuddy independent session prepared. Automatic approval rejected entering the review prompt because specific local file transmission was not explicitly authorized.
- No task was sent. No WorkBuddy review exists yet. Workbench remains review / ready.

## Observed integration

- Entry: installed WorkBuddy.app, development mode, native UI.
- Planned transfer: native UI prompt referencing the local review pack. This is not an implemented product connector.
- Blocker: explicit authorization for WorkBuddy processing specific source files, potentially via its model service.
- Still unknown: whether context is sufficient, whether additional questions are needed, and whether valid review JSON is returned.

## Measurement limits

No baseline coordination time exists. Do not claim time saved or successful cross-agent completion. This trial has reached implementation and handoff preparation, not reviewer execution.

## Next steps

1. After explicit file authorization, submit the review pack to WorkBuddy.
2. Validate its reviewedVersion against manifest.json, then import the original review output.
3. Rework if blockers exist; otherwise await the human user's acceptance.

## Authorized dispatch update

- User explicitly approved the named file scope.
- Review task sent through WorkBuddy.app in an independent development session at 2026-10-16T08:26:56.308Z.
- Workbench synchronized to review / running.
- WorkBuddy visibly read the task pack and manifest, verified SHA256 for both changed files, and began inspecting source and test evidence.
- Reviewer output is still pending. Earlier blocked status above is a historical record, not current status.

## Review output quality and scope incident

- WorkBuddy produced pass/no-blocker Markdown and JSON. Original output retained in review-before-correction.md/json before importing.
- Coordinator found a transcription error: f09fa7aa / the original regression test is emoji 🧪, but parts of the report said 🧵. Model identity was also asserted beyond what the UI confirmed (Space-Bunny).
- WorkBuddy then displayed a grep/stat command targeting data/projects.json for a contamination check, outside the explicit allowed-file list. Coordinator stopped the run. No command result was visible before cancellation; we cannot establish from the observed UI whether any contents were already read. Do not claim that no access occurred.
- Coordinator sent one corrective follow-up: no more probes or data access; only correct the two authorized report files, remove unsupported model identity, qualify timing-test advice, and disclose the scope incident.
- Product implication: instructions alone are not an enforceable file boundary. Future external execution should use an isolated review copy or an actual access-control mechanism. The present trial demonstrates a supervised handoff, not an unsupervised safe connector.
