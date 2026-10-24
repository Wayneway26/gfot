# Preserve streamed public output when executor history contains no text

Status: fixed locally; GitHub publication pending authenticated access.
Baseline: h2 86abbaf.

## Problem

A successful turn with public streamed output and an empty or non-text history clears the draft without saving an assistant message. The answer disappears from the UI and the next Agent cannot receive it.

## Acceptance

- Prefer canonical history when it contains public assistant text.
- Otherwise retain already-redacted public progress and the final streamed draft as separate messages.
- An executor error must not label partial output as a completed answer.
- Keep checkpoints, persisted task history and continuation context consistent, without duplicate output or reasoning content.

Regression: desktop/test/execution-reliability.test.mjs.
