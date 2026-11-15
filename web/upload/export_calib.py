"""Export what the in-browser upload (web/upload/forecast.js, issue #39) needs -> web/data/browser_calib.json.

  python -I web/upload/export_calib.py

The WHAD calibration pool (eval/forecast_baselines.py load("whad"): series t / normalised area), the stall flag
thresholds (eval/results/flag_thresholds.json) and the edge-speed condition-shift factors (eval/results/condition_shift.json).
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path[:0] = [os.path.join(ROOT, "data"), os.path.join(ROOT, "eval")]  # read-only imports
import forecast_baselines as FB  # noqa: E402
import upload  # noqa: E402

res = os.path.join(ROOT, "eval", "results")
S = FB.load("whad")
doc = {
    "source": "web/upload/export_calib.py from eval/forecast_baselines.py load('whad') and eval/results/",
    "level": FB.LEVEL, "stall_keep": FB.STALL_KEEP, "horizon_h": upload.HORIZON_H, "whad_um_per_px": upload.WHAD_UM_PER_PX,
    "calibrated_conditions": sorted(upload.CALIBRATED),
    "stall_threshold": {k: v["p_stall"] for k, v in json.load(open(f"{res}/flag_thresholds.json")).items()},
    "condition_shift_edge_speed": {k: v["lambda"] for k, v in json.load(open(f"{res}/condition_shift.json")).get("edge_speed", {}).items()},
    "series": [{"id": k, "wound": s["wound"], "t": [float(x) for x in s["t"]], "a": [float(x) for x in s["a"]]} for k, s in S.items()],
}
out = os.path.join(ROOT, "web", "data", "browser_calib.json")
json.dump(doc, open(out, "w"), separators=(",", ":"))
print(f"{len(S)} WHAD series -> {out} ({os.path.getsize(out) // 1024} KB)")
