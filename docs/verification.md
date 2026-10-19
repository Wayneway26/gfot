# macOS preview verification

Date: 2026-10-20. Host: macOS, Apple silicon. gfot 0.2.0.

- `npm run check`: passed.
- `npm test`: 55 passed, zero failed or skipped.
- Native Electron UI smoke: passed.
- Packaged app.asar + packaged OpenCode binary UI smoke: passed.
- Final `.app` launched and created its own 0600 state and Keychain-protected vault files.

The UI smoke used real OpenCode processes with a **synthetic localhost model**, selecting Alpha then Beta in one conversation. It verified a sandboxed renderer, the folder-picker IPC bridge, settings dialog, preserved connection selection after adding a profile, and two completed model turns.

The integration suite separately verified an approved temporary file write, tool-result return to the model, restored session continuity after service restart, and model selection reaching the local gateway. Lifecycle tests verified cleanup of a TERM-resistant process and cleanup after its supervising service disappeared. Redaction tests covered quoted/backslash secrets, short keys that overlap protocol IDs, and credentials split across streaming deltas.

Two independent review axes were completed: implementation quality and scoped product behavior. Identified lifecycle, redaction and form-selection defects were fixed and covered by regression checks.

Not validated: real upstream provider subscriptions, OAuth import, quota querying, automatic failover, Intel Mac, Apple signing/notarization, WorkBuddy execution, or Harness² integration. Native folder selection is wired through Electron dialog; automated UI smoke checks bridge availability, not manual OS dialog interaction.
