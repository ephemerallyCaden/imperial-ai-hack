"""Simulate one real WHAD wound with its fitted Tm/bias and save an npz for export_playback.py (#29).

Usage: python3 sim/make_playback.py exp1_partII_C61_P2 out.npz [--t0 10] [--frame-dt 0.1] [--seed 0]
Start = the fit's start frame mask; runs to the last observed frame. Adds key `meta` (JSON string:
position, t0, Tm, bias, observed t_hours/wound_frac) which export_playback.py passes through.
"""
import argparse, csv, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice

ROOT = os.path.join(os.path.dirname(__file__), "..")
ap = argparse.ArgumentParser()
ap.add_argument("position"); ap.add_argument("out")
ap.add_argument("--t0", default="10")
ap.add_argument("--frame-dt", type=float, default=0.1)
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()

fit = json.load(open(os.path.join(ROOT, "sim/fits/whad_fits.json")))["fits"][a.position][a.t0]
obs = [r for r in csv.DictReader(open(os.path.join(ROOT, "data/processed/whad_curves.csv"))) if r["position"] == a.position]
t_obs = np.array([float(r["t_hours"]) for r in obs]); wf_obs = np.array([float(r["wound_frac"]) for r in obs])
f0 = fit["start_frame"]
t_start = float(next(r["t_hours"] for r in obs if int(r["frame"]) == f0))
occ0 = mask_to_lattice(*load_png_mask(a.position, f0), SITE_UM)
r = simulate(occ0, Params(Tm=fit["Tm"], bias=fit["bias"]), t_obs[-1] - t_start, frame_dt=a.frame_dt, seed=a.seed)
r["t_hours"] = r["t_hours"] + t_start
r["meta"] = json.dumps(dict(position=a.position, t0=int(a.t0), Tm=fit["Tm"], bias=fit["bias"], seed=a.seed,
                            observed=dict(t_hours=t_obs.round(3).tolist(), wound_frac=wf_obs.round(5).tolist())))
np.savez_compressed(a.out, **r)
sim_at_obs = np.interp(t_obs, r["t_hours"], r["wound_frac"])
print(f"{a.position} Tm {fit['Tm']:.3f} bias {fit['bias']:.3f} lattice {occ0.shape} frames {len(r['t_hours'])}")
print("t_h   obs    sim");
for t, o, s in zip(t_obs, wf_obs, sim_at_obs):
    print(f"{t:5.1f} {o:.3f} {s:.3f}")
print(f"RMSE full run {np.sqrt(np.mean((sim_at_obs - wf_obs) ** 2)):.4f}")
