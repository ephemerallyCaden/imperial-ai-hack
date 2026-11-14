"""Sanity report (not the official scorer, that is P1's eval/): per forecast file, point-level 90% coverage of observed
area over all (wound, forecast time) pairs, median |q50 - observed|, mean band width.
python nca/quick_score.py nca/forecasts/whad [sim/forecasts/whad ...]"""
import glob, json, sys
import numpy as np

rows = []
for d in sys.argv[1:]:
    for fn in sorted(glob.glob(f"{d}/*.json")):
        doc = json.load(open(fn)); cov, err, wid = [], [], []
        for f in doc["forecasts"]:
            obs = dict(zip(f["observed"]["t_hours"], f["observed"]["area"]))
            for t, lo, mid, hi in zip(f["t_hours"], f["area_q05"], f["area_q50"], f["area_q95"]):
                if t in obs:
                    cov.append(lo <= obs[t] <= hi); err.append(abs(mid - obs[t])); wid.append(hi - lo)
        rows.append((doc["model"], doc["fold"], doc["cutoff_hours"], len(doc["forecasts"]), np.mean(cov), np.median(err), np.mean(wid)))
print(f"{'model':18s} {'fold':12s} {'t0':>4s} {'n':>3s} {'cov90':>6s} {'medAE':>6s} {'width':>6s}")
for r in sorted(rows, key=lambda r: (r[1], r[2], r[0])):
    print(f"{r[0]:18s} {r[1]:12s} {r[2]:4g} {r[3]:3d} {r[4]:6.2f} {r[5]:6.3f} {r[6]:6.3f}")
