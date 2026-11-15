"""Simulate one real WHAD wound with its fitted Tm/bias and save an npz for export_playback.py (#29).

Usage: python3 sim/make_playback.py exp1_partII_C61_P2 out.npz [--t0 KEY] [--rule free|follow] [--fits PATH]
                                    [--start fit|cutoff] [--frame-dt 0.1] [--seed 0]
--t0: key of fits[position] (default: the largest cut-off in the file). --fits: default sim/fits/whad_fits.json.
--start fit: the fit's start frame mask (video run / zoom view); --start cutoff: the observed mask at the last frame
<= the fit's t0 (like-for-like with the NCA forecast panel, as sim/js/make_sim_playback_cutoff.py). Runs to the last
observed frame. Adds key `meta` (JSON string: position, t0, rule, Tm, bias, fits file, start, observed curve), which
export_playback.py passes through.
"""
import argparse, csv, hashlib, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from cellsim import Params, simulate, SITE_UM, RULES
from start_state import load_png_mask, mask_to_lattice

ROOT = os.path.join(os.path.dirname(__file__), "..")
ap = argparse.ArgumentParser()
ap.add_argument("position"); ap.add_argument("out")
ap.add_argument("--t0", default=None)
ap.add_argument("--rule", default="free", choices=RULES)
ap.add_argument("--fits", default=os.path.join(ROOT, "sim/fits/whad_fits.json"))
ap.add_argument("--start", default="fit", choices=("fit", "cutoff"))
ap.add_argument("--frame-dt", type=float, default=0.1)
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()

fits = json.load(open(a.fits))["fits"][a.position]
t0 = a.t0 or max((k for k in fits if fits[k]), key=float)
fit = fits[t0]
obs = [r for r in csv.DictReader(open(os.path.join(ROOT, "data/processed/whad_curves.csv"))) if r["position"] == a.position]
t_obs = np.array([float(r["t_hours"]) for r in obs]); wf_obs = np.array([float(r["wound_frac"]) for r in obs])
if a.start == "fit":
    f0 = fit["start_frame"]
    t_start = float(next(r["t_hours"] for r in obs if int(r["frame"]) == f0))
else:
    last = [r for r in obs if float(r["t_hours"]) <= float(fit["t0"]) + 1e-9][-1]
    f0, t_start = int(last["frame"]), float(last["t_hours"])
occ0 = mask_to_lattice(*load_png_mask(a.position, f0), SITE_UM)
r = simulate(occ0, Params(Tm=fit["Tm"], bias=fit["bias"], rule=a.rule), t_obs[-1] - t_start, frame_dt=a.frame_dt, seed=a.seed)
r["t_hours"] = r["t_hours"] + t_start
r["meta"] = json.dumps(dict(position=a.position, t0=float(t0), rule=a.rule, Tm=fit["Tm"], bias=fit["bias"], seed=a.seed,
                            fits=dict(file=os.path.relpath(a.fits, ROOT),
                                      sha256_12=hashlib.sha256(open(a.fits, "rb").read()).hexdigest()[:12]),
                            start=dict(mode=a.start, frame=f0, t_hours=t_start),
                            observed=dict(t_hours=t_obs.round(3).tolist(), wound_frac=wf_obs.round(5).tolist())))
np.savez_compressed(a.out, **r)
k = t_obs >= t_start
sim_at_obs = np.interp(t_obs[k], r["t_hours"], r["wound_frac"])
print(f"{a.position} rule {a.rule} t0 {t0} Tm {fit['Tm']:.3f} bias {fit['bias']:.3f} start {a.start} frame {f0} "
      f"lattice {occ0.shape} frames {len(r['t_hours'])}")
print("t_h   obs    sim")
for t, o, s in zip(t_obs[k], wf_obs[k], sim_at_obs):
    print(f"{t:5.1f} {o:.3f} {s:.3f}")
print(f"RMSE from start {np.sqrt(np.mean((sim_at_obs - wf_obs[k]) ** 2)):.4f}")
