"""Start state for an Assay 3D NCA playback of one WHAD wound (no raw data needed): frame 0 of the tracked
data/processed/nca_real_whad.npz (16x22 coarse density + reservoir fraction R, from the wound's manual mask) and the
follow-rule point fit sim/fits/whad_fits_follow.json fits[wound]["1.9"] (frames <= 1.9 h only, the first check of
every recorded run, so no later frame shapes the field).
  python3 -I sim/js/assay_nca_case.py <wound id> case.json [cutoff=1.9]
then: node sim/js/make_nca_playback.mjs web/public/sim/nca_v2_weights.json case.json \
        web/public/sim/nca_follow_<wound id>.json 0 web/public/sim/nca_v2_weights.config.json"""
import hashlib, json, os, sys

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
NPZ, FITS = "data/processed/nca_real_whad.npz", "sim/fits/whad_fits_follow.json"
wound, out = sys.argv[1], sys.argv[2]
cut = sys.argv[3] if len(sys.argv) > 3 else "1.9"

d = np.load(os.path.join(ROOT, NPZ))
i = list(d["ids"]).index(wound)
rho, R, t = d[f"{i}__density"][0], d[f"{i}__R"][0], float(d[f"{i}__t"][0])
fits_path = os.path.join(ROOT, FITS)
fits_doc = json.load(open(fits_path))
assert fits_doc["params"]["rule"] == "follow", "v2 weights need the follow-rule fits"
fit = fits_doc["fits"][wound][cut]
fits_info = dict(file=FITS, sha256_12=hashlib.sha256(open(fits_path, "rb").read()).hexdigest()[:12], rule="follow")
json.dump(dict(position=wound, cutoff=float(cut), fits=fits_info, frame=0, t_start=t, h=int(rho.shape[0]), w=int(rho.shape[1]),
               rho=[round(float(v), 6) for v in rho.ravel()], R=[round(float(v), 6) for v in R.ravel()],
               Tm=fit["Tm"], bias=fit["bias"], until_healed=True, start_source=f"{NPZ} series {wound} frame 0 (density, R)"),
          open(out, "w"))
print(wound, "cut", cut, "Tm %.3f bias %.3f" % (fit["Tm"], fit["bias"]), "wf0 %.4f" % (1 - rho.mean()), rho.shape)
