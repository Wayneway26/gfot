# Light and dark appearance

User request, 2026-10-26. Baseline: h2 111025c.

- Provide visible light, dark and follow-system controls with accessible names and selected states.
- Persist desktop preference across reloads, window recreation and app restarts independently of the ephemeral local HTTP port. Apply it before page paint and match the native window appearance.
- Cover welcome, sidebar, conversation, composer, approvals, code, execution details, settings, usage panels and native controls with semantic theme colors. Preserve blue brand identity and provide a legible dark-background logo variant.
- Follow system changes only in system mode. Invalid preferences fall back safely; failed saves keep the previous choice and report a retryable error.
- Theme changes must preserve active task state, history, unsent input, accounts and tools. No provider calls or changes to task execution are required.
- Verify persistence and controller behavior plus source and packaged Electron, including dark pages/sheets and compact layout.
