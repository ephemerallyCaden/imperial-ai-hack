"""Convert a cellsim npz (see docs/sim.md) to web/public/sim/<name>.json for P3.

Usage: python3 sim/export_playback.py run.npz name [--agents] [--stride N]
JSON: {name, H, W, grain, t_hours[F], wound_frac[F],
       density: {h, w, frames: [base64 uint8 h*w row-major, round(density*255)]},
       meta (optional, from make_playback.py: position, Tm, bias, observed curve),
       agents (optional, --agents): {encoding: "packbits-msb", frames: [base64 of ceil(H*W/8) bytes]}}
Agents decoding: site i = y*W + x is occupied iff (bytes[i >> 3] >> (7 - (i & 7))) & 1.
The last frame is always included, whatever the stride.
"""
import argparse, base64, json, os
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("npz"); ap.add_argument("name")
ap.add_argument("--agents", action="store_true")
ap.add_argument("--stride", type=int, default=1)
ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "..", "web", "public", "sim"))
a = ap.parse_args()

b64 = lambda arr: base64.b64encode(arr.tobytes()).decode()
d = np.load(a.npz)
F = d["occ"].shape[0]
idx = list(range(0, F, a.stride))
if idx[-1] != F - 1:
    idx.append(F - 1)
occ, den = d["occ"][idx], d["density"][idx]
assert np.isfinite(den).all(), "density has NaN/inf"
assert den.min() >= -1e-6 and den.max() <= 1 + 1e-6, f"density outside [0,1]: {den.min()}..{den.max()}"
out = {
    "name": a.name, "H": int(occ.shape[1]), "W": int(occ.shape[2]), "grain": int(d["grain"]),
    "t_hours": [round(float(x), 3) for x in d["t_hours"][idx]],
    "wound_frac": [round(float(x), 5) for x in d["wound_frac"][idx]],
    "density": {"h": int(den.shape[1]), "w": int(den.shape[2]),
                "frames": [b64(np.round(np.clip(f, 0, 1) * 255).astype(np.uint8)) for f in den]},
}
if "meta" in d:
    out["meta"] = json.loads(str(d["meta"]))
if a.agents:
    out["agents"] = {"encoding": "packbits-msb", "frames": [b64(np.packbits(f.ravel() > 0)) for f in occ]}
os.makedirs(a.outdir, exist_ok=True)
p = os.path.join(a.outdir, a.name + ".json")
with open(p, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print(p, os.path.getsize(p) // 1024, "KB,", len(idx), "frames")
