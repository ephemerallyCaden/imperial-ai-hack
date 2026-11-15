"""Intake step (#116, design 9b): protocol Methods text -> proposed upload settings, for a human to confirm.

  python -I data/adaption/intake.py --text-file protocol.txt --out web/data/intake/whad_protocol_intake.json \
      [--adapter data/adaption/best.tgz] [--frames-um-per-px 0.908] [--source "citation"]

Model: the #90 fine-tune (Qwen/Qwen3.5-2B + Adaption LoRA, GO on the real test set: mean field accuracy 80.4% vs 47.4%)
run locally through predict.py's loader (which renames Adaption's multimodal LoRA keys; without that the LoRA silently
does nothing). If no adapter is given or found, Claude is the fallback (needs Anthropic credentials). Same prompt as
training (prompt.py). Offline and cached (R10): the app reads the JSON and never runs a model.

The output PROPOSES settings; it never applies them. Each value is shown next to the source text and must be confirmed
or edited (R10 safeguard: 80% of real paragraphs still had at least one wrong field). Checks added by code:
  - pixel size: if the frames' own scale is known (--frames-um-per-px) and differs from the stated one, say so (WHAD
    states 0.454 um/px for full-resolution images; the app's sample frames are 2x downsampled exports at 0.908).
  - scope: in_scope false, or a cell line other than MCF10A, or no proliferation block -> "outside the validated scope".
"""
import argparse, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from prompt import build_prompt, finalize  # noqa: E402
from score import parse  # noqa: E402


def run_model(text, adapter):
    """-> (raw reply, model label). Local fine-tune via predict.py (one row), else Claude."""
    with tempfile.TemporaryDirectory() as d:
        src, out = os.path.join(d, "in.jsonl"), os.path.join(d, "out.jsonl")
        json.dump({"id": "intake", "paragraph": text}, open(src, "w"))
        if adapter:
            cmd = [sys.executable, "-I", os.path.join(HERE, "predict.py"), "hf", "--model", "Qwen/Qwen3.5-2B",
                   "--adapter", adapter, "--test", src, "--out", out]
            label = "Qwen3.5-2B + Adaption LoRA (run 695c8c20), local, greedy"
        else:
            cmd = [sys.executable, "-I", os.path.join(HERE, "predict.py"), "claude", "--test", src, "--out", out]
            label = "claude-opus-5-5 (fallback: no fine-tuned adapter available)"
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        return json.loads(open(out).readline())["completion"], label


WHAD_CONDITIONS = ("CC", "C61", "N61", "NC")   # sim/upload.py and data/upload.py condition_guard calibration set


def checks(f, frames_um):
    notes, scope = [], []
    if f.get("pixel_um") is not None and frames_um and abs(f["pixel_um"] - frames_um) / frames_um > 0.02:
        notes.append(f"Stated pixel size {f['pixel_um']} um/px differs from these frames ({frames_um} um/px): the frames "
                     f"may be resized exports. Confirm the scale of the images you upload.")
    c = f.get("condition")
    if c and c not in WHAD_CONDITIONS:
        notes.append(f"Condition '{c}' is not a WHAD calibration condition ({', '.join(WHAD_CONDITIONS)}): it is not passed "
                     f"to the simulator; the forecast treats the upload as an unknown condition (uncalibrated_condition flag).")
    if f.get("pixel_um") is None:
        notes.append("No pixel size stated (a magnification alone does not give one): enter it by hand.")
    if f.get("in_scope") is False:
        scope.append("not a 2D phase-contrast or bright-field scratch / insert assay")
    if f.get("cell_type") not in (None, "MCF10A"):
        scope.append(f"cell line {f['cell_type']} (validated on MCF10A only)")
    if f.get("proliferation_blocked") is False:
        scope.append("proliferation not blocked (the simulator has division off)")
    return notes, scope


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--adapter", default=os.environ.get("STITCH_INTAKE_ADAPTER") or
                    (os.path.join(HERE, "best.tgz") if os.path.exists(os.path.join(HERE, "best.tgz")) else None))
    ap.add_argument("--frames-um-per-px", type=float)
    ap.add_argument("--source", default="")
    a = ap.parse_args()
    text = open(a.text_file).read().strip()
    raw, label = run_model(text, a.adapter)
    p = parse(raw)
    fields = finalize(p) if isinstance(p, dict) and "in_scope" in p and p["in_scope"] is not None else (p or {})
    notes, scope = checks(fields, a.frames_um_per_px)
    doc = {
        "kind": "intake_proposal", "version": 1,
        "status": "proposed: confirm or edit each value before it is used",
        "model": label, "source": a.source, "source_text": text,
        "fields": fields, "raw_reply": raw,
        "proposed_upload_settings": {"interval_hours": fields.get("frame_interval_h"), "um_per_px": fields.get("pixel_um"),
                                     "condition": fields.get("condition") if fields.get("condition") in WHAD_CONDITIONS else None},
        "frames_um_per_px": a.frames_um_per_px,
        "notes": notes,
        "scope": {"in_validated_scope": not scope, "reasons": scope},
        "evaluation": "fine-tune on 30 real paragraphs: mean field accuracy 80.4% (base 47.4%), exact match 20% "
                      "(docs/adaption-results.md); review every value",
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(doc, open(a.out, "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: doc[k] for k in ("model", "fields", "notes", "scope")}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
