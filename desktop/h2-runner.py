"""gfot's JSONL adapter for the unmodified, pinned Harness² method core.

Python owns Propose–Probe–Compose. Node owns credentials, supervised executors,
and tool approvals. No model credential crosses this protocol.
"""
import contextlib
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

if sys.version_info[:2] not in ((3, 12), (3, 13)):
    raise SystemExit("Harness² requires Python 3.12 or 3.13")
sys.path.insert(0, str(Path(__file__).parent / "vendor" / "harness2"))
from harness2.core import tree as ht
from harness2.core.proposer import Reply, ProposerError
from harness2.core.recursion import run_sequential
from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec, RunView
from harness2.substrate.opencode import OPENCODE_SURFACE

SURFACE = OPENCODE_SURFACE
ALLOWED = set(SURFACE.always_on)
wire = sys.stdout


def emit(value):
    print(json.dumps(value, ensure_ascii=False), file=wire, flush=True)


def request(action, **values):
    emit({"type": "request", "action": action, **values})
    line = sys.stdin.readline(2_000_001)
    if not line or len(line) > 2_000_000:
        raise RuntimeError("gfot bridge disconnected")
    reply = json.loads(line)
    if not reply.get("ok"):
        raise RuntimeError(reply.get("error", "executor failed"))
    return reply


def validate(value):
    if not isinstance(value, dict) or set(value) != ALLOWED:
        raise ValueError("Only the four always-on Markdown files may be edited; return all four")
    if any(not isinstance(v, str) for v in value.values()):
        raise ValueError("Harness values must be text")
    ht.validate(SURFACE, value, allow_subagents=False)
    return value


class Adapter:
    def __init__(self, root, prompt, initial):
        self.root, self.prompt = root, prompt
        self.substrate = SimpleNamespace(surface=lambda: SURFACE)
        channel = ChannelSpec("opencode", "gfot/selected")
        self.spec = BenchSpec(
            name="gfot", runs_root=root, install_mode="workspace_config",
            prompts=BenchPrompts(work="complete a user's coding task in an isolated project copy"),
            channels={"proposer": channel, "selector": channel},
        )
        ht.write_tree(SURFACE, validate(initial), self.base_harness(), stubs=False)

    def tasks(self, split="all"): return ["task"]
    def domain_of(self, task_id): return "coding"
    def task_prompt(self, task_id): return self.prompt
    def task_files(self, task_id): return None
    def base_harness(self): return self.root / "base-harness"
    def validate_tree(self, value): validate(value)
    def score(self, run_dir, task_id): return None

    def execute(self, task_id, harness_dir, run_id, timeout=None):
        harness = ht.read_tree(SURFACE, harness_dir or self.base_harness())
        reply = request("execute", label=run_id, harness=validate(harness))
        dest = self.root / "evidence" / run_id
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "answer.txt").write_text(reply["answer"], encoding="utf-8")
        (dest / "trajectory.md").write_text(reply.get("trajectory", ""), encoding="utf-8")
        return dest

    def delivered(self, run_dir): return bool(self.deliverable_text(run_dir).strip())
    def trajectory(self, run_dir, obs_trunc): return (run_dir / "trajectory.md").read_text()
    def deliverable_text(self, run_dir): return (run_dir / "answer.txt").read_text()
    def deliverable_files(self, run_dir): return {"answer.txt": self.deliverable_text(run_dir)}


class Editor:
    def call(self, mission, context_dir, label, **kwargs):
        # The bridge starts a read-only OpenCode session over this evidence directory.
        # It returns JSON; Python validates it before materialising any changed tree.
        try:
            reply = request("propose", label=label, contextDir=str(context_dir), mission=mission)
        except RuntimeError as exc:
            raise ProposerError(str(exc), attempts=1) from exc
        value = validate(reply["harness"])
        dest = Path(context_dir) / "gfot-proposal"
        ht.write_tree(SURFACE, value, dest, stubs=False)
        return Reply(label=label, text="<notes>" + reply.get("notes", "") + "</notes>",
                     ok=True, attempts=1, workspace=dest)


def watch_parent(pid):
    while True:
        time.sleep(1)
        try: os.kill(pid, 0)
        except ProcessLookupError: os._exit(1)


def main():
    if "--check" in sys.argv:
        emit({"available": True, "python": sys.version.split()[0], "method": "run_sequential", "k": 1})
        return
    initial = json.loads(sys.stdin.readline(200_001))
    root = Path(initial["root"]).resolve()
    threading.Thread(target=watch_parent, args=(initial["parentPid"],), daemon=True).start()
    adapter = Adapter(root, initial["prompt"], initial["harness"])
    baseline = adapter.execute("task", adapter.base_harness(), "base")
    base = RunView("base", "base", baseline, True, adapter.delivered(baseline))
    # Keep upstream's diagnostic prints off the JSONL protocol.
    with contextlib.redirect_stdout(sys.stderr):
        result = run_sequential("task", 1, [base], adapter=adapter, prop=Editor(),
                                work_dir=root, run_id_of=lambda label: label,
                                base_tree=initial["harness"], propose_workers=1, rollout_workers=1)
    final = result.rollouts["c1"]
    emit({"type": "result", "method": result.to_dict(), "harness": result.trees["c1"],
          "costsKnown": False, "successful": final.ok and final.delivered and not result.fell_back,
          "answer": adapter.deliverable_text(final.run_dir) if final.ok else "",
          "candidates": [{"label": k, "ok": v.ok, "delivered": v.delivered,
                          "error": v.error,
                          "answerExcerpt": adapter.deliverable_text(v.run_dir)[:8000] if v.ok else "",
                          "trajectoryExcerpt": adapter.trajectory(v.run_dir, obs_trunc=50000)[:12000] if v.ok else ""}
                         for k, v in result.rollouts.items()]})


if __name__ == "__main__":
    try: main()
    except Exception:
        emit({"type": "failure", "error": "Harness² could not complete; inspect the task phase and executor events"})
        sys.exit(1)
