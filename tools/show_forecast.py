"""Print a short, readable summary of a data/upload.py output file (for the video terminal shot).

Usage: python -I tools/show_forecast.py OUT/NAME.json
"""
import json
import sys

d = json.load(open(sys.argv[1]))
if d.get("refused"):
    print("REFUSED")
    for r in d["reasons"]:
        print("  reason:", r)
    sys.exit(0)
f = d["forecasts"][0]
fmt = lambda e: f"median after 19 h (90% range from {e['q05']} h)" if e["median"] is None else f"{e['median']:g} h (90% range {e['q05']} to {e['q95'] if e['q95'] is not None else 'after 19 h'})"
print("model:        ", d["model"])
print("frames seen:  ", ", ".join(f"{t:g} h = {a:.2f}" for t, a in zip(f["observed"]["t_hours"], f["observed"]["area"])), "(wound area vs first frame)")
print(f"at {f['t_hours'][-1]:g} h:      ", f"median {f['area_q50'][-1]:.2f}, 90% band {f['area_q05'][-1]:.2f} to {f['area_q95'][-1]:.2f}")
print("half closed:  ", fmt(f["t50"]))
print("90% closed:   ", fmt(f["t90"]))
print(f"P(90% closed by {d['p_close_by_T_hours']:g} h):", f["p_close_by_T"])
print("flags:        ", ", ".join(x["type"] for x in f["flags"]) or "none")
print("QC:           ", f["segmentation_quality"]["status"], *f["segmentation_quality"]["reasons"])
s = d["schedule"]
print("schedule:     ", s["action"], s.get("call") or f"next image at {s.get('next_image_hours')} h")
