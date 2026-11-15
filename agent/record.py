"""Record real-model agent runs for the demo (#82) in one command, then check every file is clean.

  python -m agent.record --out agent/runs/practice      # practice runs (git-ignored)
  python -m agent.record --out agent/runs                # final re-record on the submission account

Uses whatever STITCH_PROVIDER / STITCH_MODEL are set (e.g. claude_cli, or anthropic with a personal key).
Records: a few held-out WHAD wounds chosen to show different outcomes (the first with both approval branches),
plus a real-frame upload through data/upload.py for the video (R13). Fails if any file contains a username, home path,
account id, ARN, key or session id."""
import argparse
import json
import os
import re
import sys
import time

from agent import config, run

SAMPLES = os.path.join(config.REPO, "web", "data", "samples")
VIDEO_UPLOAD = {"frames": [os.path.join(SAMPLES, f"sample_frame{k}.png") for k in (1, 2, 3)],
                "interval_h": 1.0, "scale": 0.454, "name": "video_upload", "held_out_wound": "exp1_pos2033"}
WOUNDS = ["exp1_partII_C61_P1", "exp1_partI_C61_P1", "exp1_partII_C61_P2", "exp1_partII_CC_P2"]  # stop early, stall, stop later, imaged to end


def leaks(text):
    """Strings that must never appear in a committed run file."""
    pats = [r"/home/", r"/Users/", r"\b\d{12}\b", "arn:" + "aws", "sk-" + "ant-", r"session_id", "isen" + "gard",
            r"@amazon\.", os.path.expanduser("~"), os.environ.get("USER", "") or "\x00"]
    return [p for p in pats if p and re.search(re.escape(p) if p.startswith("/home/ANT") else p, text, re.I)]


def check_clean(path):
    bad = leaks(open(path).read())
    return bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--wounds", nargs="*", default=WOUNDS)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    summary = []
    for i, w in enumerate(a.wounds):
        try:   # the first wound stops early: record its approve and reject branches for the video
            summary.append(run.run_wound(f"{stamp}-{w}", w, runs_dir=a.out, record_both_branches=(i == 0)))
        except Exception as e:  # a missing wound should not stop the others
            print(f"skip {w}: {type(e).__name__}: {e}", file=sys.stderr)
    summary.append(run.run_wound(f"{stamp}-video-upload", dict(VIDEO_UPLOAD), runs_dir=a.out))
    dirty = {}
    for f in sorted(os.listdir(a.out)):
        if f.startswith(stamp) and f.endswith(".jsonl"):
            bad = check_clean(os.path.join(a.out, f))
            if bad:
                dirty[f] = bad
    out = {"runs": [{k: s.get(k) for k in ("run_id", "stop_kind", "stop_h", "plate_hours_saved",
                                             "numbers_traced", "numbers_untraced")} for s in summary],
           "cost_usd": sum(r.get("cost_usd") or 0 for f in os.listdir(a.out) if f.startswith(stamp)
                           for r in map(json.loads, open(os.path.join(a.out, f))) if r.get("kind") == "model_call"),
           "dirty": dirty}
    print(json.dumps(out, indent=1))
    return 1 if dirty else 0


if __name__ == "__main__":
    sys.exit(main())
