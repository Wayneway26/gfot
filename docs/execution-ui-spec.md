# Execution feedback and readable responses

Source: user request, 2026-10-22. Baseline: h2 382672b.

The task view should communicate what the Agent is doing, like a clear chat execution flow: thinking/working feedback followed by readable results. The previous unformatted text stream did not distinguish intermediate updates from final output.

Acceptance:

1. Show lifecycle states from actual events: connecting, waiting, explicit thinking signals, tools, user approval, response generation, stopping, completion/error/interruption. Do not invent thinking content or a percentage. Display elapsed time and bounded tool activity; freeze time on completion/restart interruption.
2. Normalize ACP thought signals to status only. Preserve public progress and final responses separately. Handle OpenCode text-part boundaries without concatenating different messages or losing interrupted public output. Keep canonical visible task context compatible with switching.
3. Collapse intermediate updates by default, present the final answer with safe basic Markdown headings/lists/inline code/fenced code and native clipboard copy. Escape raw HTML; no executable link or image interpretation.
4. Keep existing completed messages stable while a live response updates. Do not force-scroll a user who has scrolled away. Retain expanded public process details where feasible.
5. Make low-level task details optional; normal chat remains primary. Existing approval controls, dynamic switching, project memory and Harness² optimization stay functional. Auto-open details when the user starts Harness² so adoption remains accessible.
6. Verify state transitions, thought-content exclusion, parser safety, final/progress separation and the real Electron source/packaged UI with synthetic providers. Real paid calls are not required for this UI change.
