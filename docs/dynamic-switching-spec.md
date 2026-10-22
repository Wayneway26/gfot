# Dynamic Agent continuation

Source: project conversation, 2026-10-22. Baseline: h2 e2eb8b4.

The owner requires one gfot project and task to continue with another installed Agent's own account allowance when the current executor is limited or the owner chooses to switch. Prompts, output, folder and task identity remain in gfot. No manual copy/paste handoff. Unsupported executors must remain unavailable.

Acceptance:

1. Group tasks by canonical local project folder. Persist editable project notes shared by its tasks, separate from task notes. Migrate existing data without losing session IDs/history.
2. Persist bounded task checkpoints after normal completion, failure and stop: original goal, recent user requirements, partial output, tool input/result evidence and an observed working-tree filename/status list. Do not claim that an observed dirty file was changed by the last Agent, or that tool text proves final acceptance. Carry a bounded same-project task summary; never include another project's memory.
3. Offer explicit switch-and-continue in the task UI, including while running or after an allowance/rate-limit error. Before starting the target executor, cancel/settle the old turn and checkpoint. Retain task/folder/messages and per-executor sessions. A continuation is a new explicit instruction to verify remaining work, not replay of the old request.
4. Serialize switching, reject overlapping prompts/switches and refuse handing off unconfirmed native work. Preserve unknown native acceptance and existing permission boundaries. Missing target/model configuration is checked before stopping source work. A crash must never automatically replay a switch.
5. Detect allowance/rate-limit error signals for a clear continuation entry point. Do not promise uniform upstream quota queries or automatic retry/failover; the user selects the next executor.
6. The UI exposes project memory and the saved checkpoint, and states Agent-specific authorization. Harness² remains optional prompt refinement; it is not required for switching. Only verified adapters are selectable; WorkBuddy inference requires native CLI login and Doubao remains experimental.
7. Test source cancellation ordering, quota-to-other-Agent continuation, shared context, restarted state and native UI. Real-provider validation is limited to explicit prior authorization; synthetic tests must be identified.
