# h2 branch integration contract

Base: main 9b4e8ec. Harness² upstream pinned in desktop/vendor/harness2/UPSTREAM.json.

- Real upstream core.recursion.run_sequential(k=1), tree validation and ledger drive a user-triggered optimization workflow. Four probe executions plus three proposal stages; failed edits may retry, at most 10 executor sessions, with per-session and overall deadlines.
- Existing API/account routes and the selected bundled engine’s tool approvals remain in use. Proposals may edit only four always-on Markdown components. No generated scripts, plugins, permission changes or automatic code merge.
- Probe workspaces are independent bounded text snapshots, excluding hidden paths, symlinks, dependency/build/data directories and credential filenames. Original project stays untouched by gfot's snapshot/probe mechanism; tool approval is not an OS sandbox.
- A task exposes phases, candidate evidence, failure/fallback status and ledger. Adoption requires explicit user action, targets only a successful composed result and affects later normal turns in that task. The harness can be cleared.
- Python 3.12/3.13 required and checked. Minimal unmodified Apache-2.0 upstream sources ship with the app, with hashes. No benchmark launcher or external clone installation is required.
- Normal task execution remains available without Python. Missing Python disables optimization with a clear error.
- Automated coverage uses the real upstream Python core plus synthetic executors, and real dsh and OpenCode with synthetic local models. No real subscription calls are authorized by this integration work.
- This first integration does not implement k>1, parallel recursion, cross-task automatic reflection/library updates, automatic quota switching.

## Upstream source

See [UPSTREAM.json](../desktop/vendor/harness2/UPSTREAM.json) for the pinned commit and file hashes. Sources in that manifest are unmodified; desktop/h2-runner.py adapts the method to gfot. The backend keeps all account/API credentials in Node and gives the Python process no key, provider URL or account object. The model-facing executor process still receives its normal scoped connection credentials.

## Usage

1. Configure a model connection, create a task on a small project and click Harness² 优化.
2. Confirm the filtered source copy and up to ten executor sessions. Expected successful budget: R=4 probes, P=3 proposal/composition stages; retries count separately. Each session is limited to 16 agent steps / 3 minutes and the workflow to 15 minutes. These controls are not a dollar/token allowance.
3. Inspect candidate answers, trajectory excerpts and the four proposed Markdown files. Source code produced in probe copies is not promoted.
4. Explicitly adopt a successful configuration, then run the real task normally. Adoption is per task; it can be cleared.

First-run Python discovery checks PATH, common Homebrew/Miniconda locations and optional GFOT_PYTHON. The app reports missing Python and preserves ordinary execution. Desktop approvals are not an OS sandbox; an approved command can still access paths outside the snapshot. Snapshot filters are not a guarantee that source files contain no secrets. Upstream cost fields are not populated by this adapter and must not be interpreted as free usage.

Each proposal uses the upstream context/ wrapper layout. Probed and adopted harnesses are both installed as a dedicated dsh system-prompt section, or as OpenCode agent.build.prompt for legacy OpenCode tasks. Deletions enter evidence explicitly; combined rollout evidence above 1.5 MB fails that rollout rather than truncating events silently. UI trajectory/answer excerpts are bounded views of the complete successful rollout records.
