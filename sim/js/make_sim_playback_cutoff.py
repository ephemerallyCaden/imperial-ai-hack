"""Like-for-like sim playback for the NCA vs sim vs data panel: Agent 4's sim/make_playback.py, but starting from the
observed mask at the last frame <= cutoff (as the forecasts and make_nca_playback.mjs) instead of the fit's start frame.
Frozen rules (Agent 1's sim/cellsim.py), point fit fits[pos][cutoff], frame_dt 0.1 h, seed 0. Writes an npz with `meta`
for Agent 4's sim/export_playback.py (unchanged):
  python3 sim/js/make_sim_playback_cutoff.py <agent1 root> exp1_partII_C61_P2 3.8 /tmp/sim38.npz
  python3 <agent4>/sim/export_playback.py /tmp/sim38.npz whad_partII_C61_P2_sim38 --agents --fine 2 --outdir web/public/sim
"""
import csv, json, os, sys
import numpy as np

root, pos, cut, out = sys.argv[1:5]
sys.path.insert(0, os.path.join(root, "sim"))
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice

fit = json.load(open(os.path.join(root, "sim/fits/whad_fits.json")))["fits"][pos][cut]
rows = [r for r in csv.DictReader(open(os.path.join(root, "data/processed/whad_curves.csv"))) if r["position"] == pos]
t_obs = np.array([float(r["t_hours"]) for r in rows]); wf_obs = np.array([float(r["wound_frac"]) for r in rows])
last = [r for r in rows if float(r["t_hours"]) <= float(fit["t0"]) + 1e-9][-1]
f0, t_start = int(last["frame"]), float(last["t_hours"])
occ0 = mask_to_lattice(*load_png_mask(pos, f0), SITE_UM)
r = simulate(occ0, Params(Tm=fit["Tm"], bias=fit["bias"]), t_obs[-1] - t_start, frame_dt=0.1, seed=0)
r["t_hours"] = r["t_hours"] + t_start
r["meta"] = json.dumps(dict(position=pos, cutoff_hours=float(cut), start_frame=f0, t_start=t_start, Tm=fit["Tm"],
                            bias=fit["bias"], seed=0, fit="sim/fits/whad_fits.json fits[position][cutoff] (frames <= cutoff)",
                            start="observed mask at the last frame <= cutoff -> start_state.mask_to_lattice",
                            observed=dict(t_hours=t_obs.round(3).tolist(), wound_frac=wf_obs.round(5).tolist())))
np.savez_compressed(out, **r)
sim_at = np.interp(t_obs[t_obs > t_start], r["t_hours"], r["wound_frac"])
print(f"{pos} cut {cut}: start frame {f0} t {t_start} lattice wf {1 - occ0.mean():.4f} obs {float(last['wound_frac']):.4f}; "
      f"Tm {fit['Tm']:.3f} bias {fit['bias']:.3f}; {len(r['t_hours'])} frames; MAE after cut-off "
      f"{np.mean(np.abs(sim_at - wf_obs[t_obs > t_start])):.4f}")
