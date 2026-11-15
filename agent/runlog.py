"""Append-only run log (design.md 9b): one JSON line per agent step or tool call, in agent/runs/<run_id>.jsonl.
Inputs are stored as sha256 fingerprints (plus a short preview); outputs are stored in full so the Critic and the
UI can trace every number."""
import hashlib
import json
import os
import re
import time

from agent.config import RUNS_DIR


def fingerprint(obj):
    blob = json.dumps(obj, sort_keys=True, default=str).encode()
    return "sha256:" + hashlib.sha256(blob).hexdigest()


RUN_ID = re.compile(r"^[A-Za-z0-9._-]+$")


class RunLog:
    def __init__(self, run_id, runs_dir=RUNS_DIR):
        if not isinstance(run_id, str) or not RUN_ID.match(run_id) or ".." in run_id or run_id in (".",):
            raise ValueError(f"bad run_id {run_id!r}: letters, digits, '.', '_' or '-' only, no '..'")
        os.makedirs(runs_dir, exist_ok=True)
        self.run_id, self.path, self.seq = run_id, os.path.join(runs_dir, f"{run_id}.jsonl"), 0
        try:
            with open(self.path, "x"):  # atomic create: no exists-then-append race
                pass
        except FileExistsError:
            raise FileExistsError(f"run log exists (append-only, never overwrite): {self.path}") from None
        self.records = []

    def log(self, kind, **fields):
        """kind: run_start | tool_call | model_call | model_skipped | decision | critic | approval | human_review | warning | run_end."""
        rec = {"run_id": self.run_id, "seq": self.seq, "ts": round(time.time(), 3), "kind": kind, **fields}
        with open(self.path, "a") as f:
            f.write(json.dumps(rec, default=str) + "\n")
        self.records.append(rec); self.seq += 1
        return rec

    def tool_outputs(self):
        return [r["output"] for r in self.records if r["kind"] == "tool_call" and "output" in r]


def read(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]
