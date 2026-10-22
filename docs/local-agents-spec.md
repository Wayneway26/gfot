# Local Agent integration scope

Source: user request on 2026-10-21 in this project conversation. Baseline: h2 50fce66.

The requested outcome is a usable desktop client that switches among installed OpenCode, WorkBuddy, WorkBuddy AI, 豆包工作 and 千问办公 within one project/task; also expose Harness² prompt optimization. The user explicitly rejected manual copy/paste or external-app handoff. Later authorization permits investigating local credential/proxy patterns similar to CC Switch. No API documentation or platform access has been supplied for 豆包/千问.

Acceptance:

1. Distinguish executor selection from model/account profile selection. Discover installed supported applications, reject arbitrary commands and unavailable adapters.
2. Local ACP executors create/resume their own sessions, stream output, forward single-use permission decisions, cancel safely and survive gfot restart through persisted IDs.
3. One task retains visible conversations, per-executor session state and editable shared notes; switching forwards bounded unsynchronized context with visible omission accounting. No claim of private reasoning or native chat database sharing.
4. Use the native Agent's login/configuration rather than extracting tokens into gfot. Handle authentication-required failures and offer explicit CLI login/cancel. Do not equate a handshake with successful inference.
5. Expose Harness² optimized system-prompt preview/copy and explicit adoption. Preserve probe approvals and source-copy behavior. State that optimization probes currently use bundled OpenCode and ACP adoption is prompt injection, not portable system-channel control.
6. All five automatic adapters are desired. 豆包/千问 remain unimplemented until an executable or authorized task interface can be validated; detection or opening a window must never count as successful execution. No manual fallback.
7. Verify process, API, persistence and native UI behavior using synthetic models; report real-provider checks separately. Keep the professional README focused on actual product capabilities.

Doubao validation update, 2026-10-22: the owner authorized restarting idle Doubao with a loopback debugging port. A pinned desktop CDP adapter now provides in-client turn execution with explicit native-turn authorization, temporary-project file read/write, own-session continuation and exact-run cancellation. Native interactive controls are not forwarded: waiting_input requests cancellation and reports failure. This partially meets item 6; it does not establish all five adapters or every Doubao workflow. The user's follow-up confirms that prompts, task management and switching belong in gfot, with each native Agent using its own account allowance.
