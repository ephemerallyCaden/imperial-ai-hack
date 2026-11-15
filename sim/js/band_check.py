"""Build a real-WHAD band check case: start lattice from the mask at the cut-off frame, the wound's fitted
Tm/bias (+ bootstrap members) from frames up to the cut-off, and the observed curve after it.
python3 sim/js/band_check.py <dir with sim/start_state.py + sim/fits/> <position> <cutoff> out.json [fits file, default whad_fits.json]
then: node sim/js/band_check.mjs nca/weights.json out.json"""
import csv, json, os, sys
root, pos, cut, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
fits_name = sys.argv[5] if len(sys.argv) > 5 else "whad_fits.json"  # v2 follower: whad_fits_follow.json
sys.path.insert(0, os.path.join(root, "sim"))
from start_state import load_png_mask, mask_to_lattice

fits_path = os.path.join(root, "sim/fits", fits_name); fits_doc = json.load(open(fits_path))
fit = fits_doc["fits"][pos][cut]
rows = [r for r in csv.DictReader(open(os.path.join(root, "data/processed/whad_curves.csv"))) if r["position"] == pos]
# start = last observed frame with t <= cut-off (cut-off keys are hours, e.g. "3.8"), as sim/forecast.py and nca/forecast_whad.py
last = [r for r in rows if float(r["t_hours"]) <= float(fit["t0"]) + 1e-9][-1]
f0, t_cut = int(last["frame"]), float(last["t_hours"])
wound, um = load_png_mask(pos, f0)
occ = mask_to_lattice(wound, um)
obs = [[float(r["t_hours"]) - t_cut, float(r["wound_frac"])] for r in rows if int(r["frame"]) >= f0]
obs_all = dict(t_hours=[float(r["t_hours"]) for r in rows], wound_frac=[float(r["wound_frac"]) for r in rows])
import hashlib
fits_info = dict(file=os.path.join('sim/fits', fits_name), sha256_12=hashlib.sha256(open(fits_path, 'rb').read()).hexdigest()[:12],
                 rule=fits_doc.get('params', {}).get('rule', 'free'))
json.dump(dict(position=pos, cutoff=float(cut), fits=fits_info, frame=f0, t_start=t_cut, observed_all=obs_all, fit_t0=fit['t0'], h=int(occ.shape[0]), w=int(occ.shape[1]), occ=occ.ravel().tolist(),
               Tm=fit["Tm"], bias=fit["bias"], params=fit.get("members"), observed=obs), open(out, "w"))
print(pos, "cut", cut, "frame", f0, "t %.1f h" % t_cut, "obs wf %.4f" % float(last["wound_frac"]), occ.shape, "lattice wf %.4f mask wf %.4f" % (1 - occ.mean(), wound.mean()),
      "Tm %.3f bias %.2f" % (fit["Tm"], fit["bias"]), len(obs), "observed points")
