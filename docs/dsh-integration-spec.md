# dsh integration acceptance criteria

Baseline: `9ecf722` on h2. User requests dsh as the unified execution engine, retaining Google Harness² prompt optimization and core refinement behavior. Credential/proxy expansion for additional Agents is later work and must not be claimed complete.

- Ship a pinned real dsh runtime with gfot. New desktop tasks default to dsh; existing OpenCode tasks and histories remain usable without silently reinterpreting native session IDs.
- Use gfot account/API/local-proxy profiles for dsh. Switching supported model/account connections retains the exact native dsh session and project, with durable history across process restarts.
- Forward public streaming text and thinking signals, native tool state, approvals, questions (including plan detail) and subagent activity into the existing UI. Private reasoning text does not enter gfot task messages.
- File mutations and commands require host approval. Rejection/cancellation fail closed. Harness² editors cannot gain mutation permissions through approval. Stop closes the owned runtime and checks process-group exit before handoff.
- Retain real Google Harness² sequential k=1, four isolated probes and three proposal/composition stages, explicit adoption, and the four bounded instruction documents. Run these through dsh for dsh tasks. Adopted instructions reach subsequent ordinary turns.
- Keep upstream runtime configuration and credentials isolated from user's native dsh/Agent homes; secrets stay outside persisted patches, renderer state and logs. No real credentials or paid calls are required for verification.
- Verify real dsh with local deterministic models: approval/write/rejection, native user question, cancellation, exact-session resume/model change, Codex-account proxy paths, and source/final packaged Electron flows. Package all required runtime dependencies; document limitations honestly.
