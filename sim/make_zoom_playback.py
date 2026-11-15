"""Synthetic larger field for the zoom view (#29), npz for export_playback.py. Only meaningful under rule "follow"
(closure speed does not depend on the field size there; under "free" a big field barely closes, docs/decisions.md).

Usage: python3 sim/make_zoom_playback.py out.npz [--size 120x168] [--width 12] [--condition CC] [--fits PATH]
                                         [--rule follow] [--hours 19] [--frame-dt 0.5] [--seed 0]
Start: a wavy horizontal scratch (`--width` sites, about 20 um each) across the field. Params: the fits file's
presets.draw_tool[condition] (median over all WHAD positions at the largest cut-off; draw tool / display only, never
scored). Adds `meta` (synthetic start, preset, rule, fits sha) for export_playback.py.
"""
import argparse, hashlib, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from cellsim import Params, simulate, RULES

ROOT = os.path.join(os.path.dirname(__file__), "..")
ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--size", default="120x168")
ap.add_argument("--width", type=float, default=12)
ap.add_argument("--condition", default="CC")
ap.add_argument("--fits", default=os.path.join(ROOT, "sim/fits/whad_fits.json"))
ap.add_argument("--rule", default="follow", choices=RULES)
ap.add_argument("--hours", type=float, default=19)
ap.add_argument("--frame-dt", type=float, default=0.5)
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()

H, W = map(int, a.size.lower().split("x"))
x = np.arange(W)
c = H / 2 + 2 * np.sin(2 * np.pi * x / W * 2) + np.sin(2 * np.pi * x / W * 7 + 1)
hw = a.width / 2 + 1.2 * np.sin(2 * np.pi * x / W * 5 + 2)
occ0 = (~((np.arange(H)[:, None] >= c - hw) & (np.arange(H)[:, None] < c + hw))).astype(np.uint8)
pr = json.load(open(a.fits))["presets"]["draw_tool"][a.condition]
r = simulate(occ0, Params(Tm=pr["Tm"], bias=pr["bias"], rule=a.rule), a.hours, frame_dt=a.frame_dt, seed=a.seed)
r["meta"] = json.dumps(dict(synthetic=dict(size=[H, W], scratch_width_sites=a.width, shape="wavy horizontal band"),
                            rule=a.rule, condition=a.condition, Tm=pr["Tm"], bias=pr["bias"], seed=a.seed,
                            preset="presets.draw_tool (display only, not scored)",
                            fits=dict(file=os.path.relpath(a.fits, ROOT),
                                      sha256_12=hashlib.sha256(open(a.fits, "rb").read()).hexdigest()[:12])))
np.savez_compressed(a.out, **r)
wf = r["wound_frac"]
print(f"zoom {H}x{W} ({H * W} sites) rule {a.rule} {a.condition} Tm {pr['Tm']:.3f} bias {pr['bias']:.3f}: "
      f"area_norm every 2 h {np.round(wf[::max(1, round(2 / a.frame_dt))] / wf[0], 2)}")
