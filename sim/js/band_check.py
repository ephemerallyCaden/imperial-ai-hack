"""Build a real-WHAD band check case: start lattice from the mask at the cut-off frame, the wound's fitted
Tm/bias (+ bootstrap members) from frames up to the cut-off, and the observed curve after it.
python3 sim/js/band_check.py <dir with sim/start_state.py + sim/fits/whad_fits.json> <position> <cutoff> out.json
then: node sim/js/band_check.mjs nca/weights.json out.json"""
import csv, json, os, sys
root, pos, cut, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, os.path.join(root, "sim"))
from start_state import load_png_mask, mask_to_lattice

fit = json.load(open(os.path.join(root, "sim/fits/whad_fits.json")))["fits"][pos][cut]
f0 = fit["start_frame"] + fit["t0"]
wound, um = load_png_mask(pos, f0)
occ = mask_to_lattice(wound, um)
rows = [r for r in csv.DictReader(open(os.path.join(root, "data/processed/whad_curves.csv"))) if r["position"] == pos]
t_cut = next(float(r["t_hours"]) for r in rows if int(r["frame"]) == f0)
obs = [[float(r["t_hours"]) - t_cut, float(r["wound_frac"])] for r in rows if int(r["frame"]) >= f0]
json.dump(dict(position=pos, cutoff=int(cut), frame=f0, h=int(occ.shape[0]), w=int(occ.shape[1]), occ=occ.ravel().tolist(),
               Tm=fit["Tm"], bias=fit["bias"], params=fit.get("members"), observed=obs), open(out, "w"))
print(pos, "cut", cut, "frame", f0, occ.shape, "lattice wf %.4f mask wf %.4f" % (1 - occ.mean(), wound.mean()),
      "Tm %.3f bias %.2f" % (fit["Tm"], fit["bias"]), len(obs), "observed points")
