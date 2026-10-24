# Reliability issues — 2026-10-25

All three reports have reproducible regression coverage and are fixed in 0.7.2-h2.1. They are local issue records, not published GitHub Issues; this environment has no authenticated GitHub issue client.

| Report | Fix |
| --- | --- |
| [001 · Execution event isolation](001-execution-event-isolation.md) | Bind callbacks to their execution and filter foreign session events. |
| [002 · Streamed answer preservation](002-preserve-streamed-answer.md) | Preserve public output when canonical history has no text. |
| [003 · ACP process cleanup](003-await-acp-process-exit.md) | Wait for owned process-group exit; retain native completion confirmation. |
