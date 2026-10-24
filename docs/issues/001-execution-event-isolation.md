# Prevent stale execution events from contaminating task context

Status: fixed locally; GitHub publication pending authenticated access.
Baseline: h2 86abbaf.

## Problem

The event callback resolves the active runtime by task ID, without checking which execution created it. A callback retained by a previous runtime can write output, tool evidence or approval requests into a later turn, even when both rounds use the same native session. Session IDs nested inside message parts are not filtered.

## Acceptance

- Ignore callbacks from previous, cancelled or finalized runtimes.
- Filter both envelope and nested-part foreign session IDs for normal execution.
- Keep current runtime events and Harness² sequential probe sessions working.
- Reproduce the failure and verify the fix using synthetic engines, with no real model calls.

Regression: desktop/test/execution-reliability.test.mjs.
