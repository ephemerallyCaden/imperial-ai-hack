"""Convert a cellsim npz (see docs/sim.md) to web/public/sim/<name>.json for P3.

Usage: python3 sim/export_playback.py run.npz name [--agents] [--stride N]
JSON: {name, H, W, grain, t_hours[F], wound_frac[F],
       density: {h, w, frames: [base64 uint8 h*w, density*255]},
       agents (optional, --agents): frames: [[flat index y*W+x of occupied sites]]}
"""
import argparse, base64, json, os
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("npz"); ap.add_argument("name")
ap.add_argument("--agents", action="store_true")
ap.add_argument("--stride", type=int, default=1)
ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "..", "web", "public", "sim"))
a = ap.parse_args()

d = np.load(a.npz, allow_pickle=True)
s = slice(None, None, a.stride)
occ, den = d["occ"][s], d["density"][s]
out = {
    "name": a.name, "H": int(occ.shape[1]), "W": int(occ.shape[2]), "grain": int(d["grain"]),
    "t_hours": [round(float(x), 3) for x in d["t_hours"][s]],
    "wound_frac": [round(float(x), 5) for x in d["wound_frac"][s]],
    "density": {"h": int(den.shape[1]), "w": int(den.shape[2]),
                "frames": [base64.b64encode(np.round(f * 255).astype(np.uint8).tobytes()).decode() for f in den]},
}
if a.agents:
    out["agents"] = {"frames": [np.flatnonzero(f).tolist() for f in occ]}
os.makedirs(a.outdir, exist_ok=True)
p = os.path.join(a.outdir, a.name + ".json")
json.dump(out, open(p, "w"), separators=(",", ":"))
print(p, os.path.getsize(p) // 1024, "KB")
