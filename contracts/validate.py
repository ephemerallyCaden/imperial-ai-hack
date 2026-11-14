"""Validate forecast files against contracts/forecast.schema.json plus checks a schema can't express.

Usage: python contracts/validate.py FILE_OR_DIR [...]     (exit code 1 if any file fails)
"""
import glob, json, os, sys
import jsonschema

SCHEMA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "forecast.schema.json")))


def problems(doc):
    out = [f"schema: {e.json_path}: {e.message}" for e in jsonschema.Draft202012Validator(SCHEMA).iter_errors(doc)]
    if out:
        return out
    for f in doc["forecasts"]:
        w, t = f["wound_id"], f["t_hours"]
        n = len(t)
        for k in ("area_q05", "area_q50", "area_q95"):
            if len(f[k]) != n:
                out.append(f"{w}: {k} has {len(f[k])} values, t_hours has {n}")
        for m in f.get("members", []):
            if len(m) != n:
                out.append(f"{w}: a member has {len(m)} values, t_hours has {n}")
        if any(b <= a for a, b in zip(t, t[1:])):
            out.append(f"{w}: t_hours not increasing")
        if t and t[0] <= doc["cutoff_hours"]:
            out.append(f"{w}: forecast starts at {t[0]} h, not after the cut-off {doc['cutoff_hours']} h")
        if len(f["area_q05"]) == n == len(f["area_q95"]) == len(f["area_q50"]):
            if any(not (lo - 1e-9 <= mid <= hi + 1e-9) for lo, mid, hi in zip(f["area_q05"], f["area_q50"], f["area_q95"])):
                out.append(f"{w}: quantiles out of order (need q05 <= q50 <= q95)")
        o = f["observed"]
        if len(o["t_hours"]) != len(o["area"]):
            out.append(f"{w}: observed t_hours and area lengths differ")
        for key in ("t50", "t90"):
            e = f[key]
            vals = [v for v in (e["q05"], e["median"], e["q95"]) if v is not None]
            if vals != sorted(vals):
                out.append(f"{w}: {key} q05 <= median <= q95 violated")
    return out


if __name__ == "__main__":
    files = [p for a in sys.argv[1:] for p in (sorted(glob.glob(os.path.join(a, "*.json"))) if os.path.isdir(a) else [a])]
    bad = 0
    for p in files:
        errs = problems(json.load(open(p)))
        print(f"{'OK  ' if not errs else 'FAIL'} {p}" + "".join(f"\n     - {e}" for e in errs[:10]))
        bad += bool(errs)
    sys.exit(1 if bad else 0)
