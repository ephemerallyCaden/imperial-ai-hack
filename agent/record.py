"""Record real-model agent runs for the demo (#82) in one command, then check every file is clean.

  python -m agent.record --out agent/runs/practice      # practice runs (git-ignored)
  python -m agent.record --out agent/runs                # final re-record on the submission account

Uses whatever STITCH_PROVIDER / STITCH_MODEL are set (e.g. claude_cli, or anthropic with a personal key).
Records: a few held-out WHAD wounds chosen to show different outcomes (the first with both approval branches),
plus a real-frame upload through data/upload.py for the video (R13), with a protocol paragraph so Intake runs.
Fails if any file contains a username, home path, account id, ARN, key or session id."""
import argparse
import json
import os
import re
import sys
import time

from agent import config, run

SAMPLES = os.path.join(config.REPO, "web", "data", "samples")
# Methods paragraph for the video upload, so the run shows Intake (design.md 9b). Written by us to match the sample
# frames (WHAD MCF10A, saved at half resolution: 0.908 um/px); Intake should agree with the given interval and scale.
VIDEO_PROTOCOL = ("MCF10A cells were grown to confluence in 24-well plates and treated with mitomycin C (10 ug/ml) for "
                  "2 h to block proliferation. A scratch wound was made in each monolayer with a 200 ul pipette tip and "
                  "the wells were washed twice with medium. Phase-contrast images were taken every hour for 19 h on an "
                  "inverted microscope with a 10x objective; the pixel size of the analysed images was 0.908 um.")
VIDEO_UPLOAD = {"frames": [os.path.join(SAMPLES, f"sample_frame{k}.png") for k in (1, 2, 3)],
                "interval_h": 1.0, "scale": 0.908, "name": "video_upload", "held_out_wound": "exp1_pos2033",
                "protocol_text": VIDEO_PROTOCOL}
WOUNDS = ["exp1_partII_C61_P1", "exp1_partI_C61_P1", "exp1_partII_C61_P2", "exp1_partII_CC_P2"]  # stop early, stall, stop later, imaged to end


def leaks(text):
    """Strings that must never appear in a committed run file. The home path and $USER are matched literally
    (re.escape: a Windows home such as C:\\Users\\x is not a pattern); $USER only as a whole word."""
    pats = [r"/home/", r"/Users/", r"\b\d{12}\b", "arn:" + "aws", "sk-" + "ant-", r"session_id", "isen" + "gard",
            r"@amazon\."]
    hits = [p for p in pats if re.search(p, text, re.I)]
    home = os.path.expanduser("~")
    # run logs are JSON, so a Windows home (C:\\Users\\x) appears with doubled backslashes: check both forms
    forms = {home, json.dumps(home)[1:-1], home.replace("\\", "/")} if home and home not in ("~", os.sep) else set()
    if any(f and re.search(re.escape(f), text, re.I) for f in forms):
        hits.append("home folder")
    user = os.environ.get("USER") or os.environ.get("USERNAME") or ""
    if user and re.search(r"(?<![A-Za-z0-9_])" + re.escape(user) + r"(?![A-Za-z0-9_])", text):
        hits.append("username")
    return hits


def check_clean(path):
    with open(path) as fh:
        return leaks(fh.read())


def write_index(runs_dir):
    """agent/runs[/practice]/index.json: the list of run logs the web app plays back (a static server can't list dirs)."""
    runs = []
    for f in sorted(os.listdir(runs_dir)):
        if not f.endswith(".jsonl"):
            continue
        with open(os.path.join(runs_dir, f)) as fh:
            recs = [json.loads(l) for l in fh if l.strip()]
        start = next((r for r in recs if r.get("kind") == "run_start"), {})
        end = next((r for r in recs if r.get("kind") == "run_end"), {})
        rep = next((r for r in recs if r.get("kind") == "report"), {})
        runs.append({"file": f, "run_id": start.get("run_id", f[:-6]), "branch": f.endswith(".reject.jsonl"),
                     "wound_id": (start.get("wound") or {}).get("wound_id") if isinstance(start.get("wound"), dict) else None,
                     "kind": (start.get("wound") or {}).get("kind") if isinstance(start.get("wound"), dict) else None,
                     "stop_kind": end.get("stop_kind"), "stop_h": end.get("stop_h"),
                     "plate_hours_saved": end.get("plate_hours_saved"), "headline": rep.get("headline"),
                     "cost_usd": _cost(recs)})
    with open(os.path.join(runs_dir, "index.json"), "w") as fh:
        json.dump({"runs": runs}, fh, indent=1)
    return runs


def write_clean_index(runs_dir):
    """write_index, then the same leak check as the run logs on index.json. -> leak hits ([] when clean)."""
    write_index(runs_dir)
    return check_clean(os.path.join(runs_dir, "index.json"))


def _cost(recs):
    """Sum of model_call cost_usd (decisions, Intake and the Reporter); None when no call reported a cost."""
    costs = [r["cost_usd"] for r in recs if r.get("kind") == "model_call" and r.get("cost_usd") is not None]
    return round(sum(costs), 6) if costs else None


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
    bad = write_clean_index(a.out)
    if bad:
        dirty["index.json"] = bad
    cost = 0.0
    for f in os.listdir(a.out):
        if f.startswith(stamp) and f.endswith(".jsonl"):
            with open(os.path.join(a.out, f)) as fh:
                cost += _cost([json.loads(l) for l in fh if l.strip()]) or 0.0
    out = {"runs": [{k: s.get(k) for k in ("run_id", "stop_kind", "stop_h", "plate_hours_saved",
                                             "numbers_traced", "numbers_untraced")} for s in summary],
           "cost_usd": cost, "dirty": dirty}
    print(json.dumps(out, indent=1))
    return 1 if dirty else 0


if __name__ == "__main__":
    sys.exit(main())
