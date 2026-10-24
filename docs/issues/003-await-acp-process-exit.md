# Wait for owned ACP processes to exit before completing stop

Status: fixed locally; GitHub publication pending authenticated access.
Baseline: h2 86abbaf. Found by the full automated suite during the current reliability work.

## Problem

ACP stop sends SIGKILL and immediately returns. Signal delivery and process-group reaping are asynchronous. The existing real subprocess cancellation test reproduced a surviving group after stop returned, allowing cleanup and task-slot release to race with an owned local process.

## Acceptance

- After signalling, wait for the owned process group to disappear within a bounded deadline.
- If it remains, return unconfirmed so normal task handoff remains blocked.
- Native prompt acknowledgement must still be required independently of local process exit.
- Preserve idempotent stop and permission cleanup.

Regression: desktop/test/acp-engine.test.mjs. Uses a local synthetic ACP process, not a logged-in Agent.
