"""Condition-shift inflation for the 90% band (v4, design.md R28).

Rule fixed before looking at C61: for each model and cut-off, hold out each KNOWN condition (CC, N61, NC) in turn
(splits lco_<cond>: calibrated on the other known conditions, C61 never used), find the smallest factor lam that
widens the band around its median (lo' = med - lam (med - lo), hi' = med + lam (hi - med)) so the held-out condition's
future points reach 90% coverage; use lam = max over the three conditions, capped at 3. Then write split
rest_to_C61_infl = rest_to_C61 band widened by lam. Factors saved to eval/results/condition_shift.json (also used by
data/upload.py for uploads of an uncalibrated condition).
Usage: python eval/condition_shift.py   (after the lco_* and rest_to_C61 forecast files exist)
"""
import glob, json, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FC = f"{HERE}/forecasts/whad"
LAMS = np.round(np.arange(1.0, 3.001, 0.05), 2)
TARGET, CAP = 0.90, 3.0


def points(doc):
    cut = doc["cutoff_hours"]
    for f in doc["forecasts"]:
        t, a = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"]); ft = np.array(f["t_hours"])
        m = (t > cut + 1e-9) & (t <= ft[-1] + 1e-9)
        lo, med, hi = (np.interp(t[m], ft, f[k]) for k in ("area_q05", "area_q50", "area_q95"))
        yield a[m], lo, med, hi


def needed_lambda(doc):
    pts = list(points(doc))
    if not pts:
        return np.nan
    y, lo, med, hi = (np.concatenate(x) for x in zip(*pts))
    for lam in LAMS:
        if np.mean((y >= np.maximum(med - lam * (med - lo), 0)) & (y <= med + lam * (hi - med))) >= TARGET:
            return float(lam)
    return CAP


def widen(doc, lam):
    d = json.loads(json.dumps(doc))
    d["fold"] = "rest_to_C61_infl"
    d["notes"] = (d.get("notes", "") + f" | v4: band widened x{lam:g} around the median for an unseen condition "
                  f"(factor from leave-one-condition-out on CC/N61/NC, eval/condition_shift.py)").strip(" |")
    for f in d["forecasts"]:
        lo, med, hi = (np.array(f[k]) for k in ("area_q05", "area_q50", "area_q95"))
        f["area_q05"] = np.round(np.maximum(med - lam * (med - lo), 0), 4).tolist()
        f["area_q95"] = np.round(med + lam * (hi - med), 4).tolist()
        f["flags"] = f["flags"] + [{"type": "uncalibrated_condition",
                                    "reason": f"Condition not in the calibration set: band widened x{lam:g} (measured on known conditions)."}]
    return d


def main():
    factors = {}
    for path in sorted(glob.glob(f"{FC}/rest_to_C61/*.json")):
        name = os.path.basename(path)
        if "_raw_" in name:
            continue
        model, cut = re.match(r"(.+)_([0-9.]+)h\.json$", name).groups()
        lams = {}
        for c in ("CC", "N61", "NC"):
            p = f"{FC}/lco_{c}/{name}"
            if os.path.exists(p):
                lams[c] = needed_lambda(json.load(open(p)))
        if not lams:
            continue
        lam = float(min(max(v for v in lams.values() if np.isfinite(v)), CAP))
        factors.setdefault(model, {})[cut] = {"lambda": lam, "per_condition": lams}
        os.makedirs(f"{FC}/rest_to_C61_infl", exist_ok=True)
        json.dump(widen(json.load(open(path)), lam), open(f"{FC}/rest_to_C61_infl/{name}", "w"))
    os.makedirs(f"{HERE}/results", exist_ok=True)
    json.dump(factors, open(f"{HERE}/results/condition_shift.json", "w"), indent=1)
    for m, d in factors.items():
        print(f"  {m:14} " + "  ".join(f"{c} h: x{v['lambda']:.2f} ({', '.join(f'{k} {x:.2f}' for k, x in v['per_condition'].items())})"
                                        for c, v in sorted(d.items(), key=lambda kv: float(kv[0]))))


if __name__ == "__main__":
    main()
