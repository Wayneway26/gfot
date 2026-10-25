# Account and allowance panel

Source: user request, 2026-10-26. Baseline: h2 74f2577.

- Add a persistent sidebar button opening an account/usage panel, with a clear close action and access to existing account management.
- Show saved credential state, expiry and available historical verification separately from actual model access. Do not expose tokens.
- Imported Codex accounts can manually query existing allowance windows: remaining percent, reported duration, reset and checked time. Opening the panel does not query accounts or invoke a model.
- Unknown/missing allowance is not zero. Expired reset times and cached snapshots must be explicit. Failure keeps the previous snapshot and shows the error; refresh remains retryable and deduplicated.
- Other native Agent and API balances are explicitly unsupported. Installation/connection detection must not be called proof of login.
- Keep task state, Agent switching, approvals and Harness² intact. Verify safe rendering, account snapshot semantics and source/packaged Electron with synthetic quota transport.
