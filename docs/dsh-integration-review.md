# dsh integration review

Baseline: `9ecf722` on h2. Scope and acceptance criteria: [integration spec](dsh-integration-spec.md).

## Standards

Independent initial and final reviews reported zero remaining actionable findings. Runtime versions and dependency integrity are pinned, secrets stay outside generated patches and the renderer, and credential-shaped environment variables are scrubbed from tool subprocesses. Canonical external-path checks account for symlink targets and the agent’s effective directory. A monotonic guard preserves Harness² denials.

The reviewer independently exercised a real approved dsh bash tool running a fixed `sleep 60` fixture. The shell PID existed before stopping, stop returned confirmed, the PID was gone afterward, and the pending turn rejected. No real provider was used.

## Spec

Two initial findings were fixed: approval cards hid operation arguments behind the project-path display; default dsh reads could escape the selected project/snapshot without approval. Cards now show escaped paths, arguments and native reason. Canonical external reads/searches require approval for normal tasks and are denied for Harness² probes/editors. Question details include plan text.

Independent follow-up reran all three real dsh regression tests with no failures or skips. Both findings were verified resolved, with zero remaining Spec findings. Approved commands remain application-controlled and are not described as completely confined.

## Acceptance evidence

The parent runs syntax/full-suite checks plus source and final packaged Electron workflows separately. See [verification log](verification.md) for the final results and the distinction between synthetic model transport and actual runtime/tool execution.
