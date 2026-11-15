"""Calibrated baseline forecasts on WHAD and WHiM-BC, written in the forecast contract (contracts/forecast.schema.json).

Splits (design.md 5.5, R15): the calibration pool for a test series never contains the same physical wound.
  whad   loo_all     every series; pool = all other wounds (manual + auto-segmented)
         loo_manual  manual-mask series only; pool = other manual-mask wounds
         CC_to_C61   test C61 series; pool = CC series only (held-out condition)
  whimbc loo         every well; pool = all other wells
         Monolayer_to_Sphere  test Sphere wells; pool = Monolayer wells only (held-out condition)
Each WHAD part (I, II) is its own series (gap between parts unknown); time = hours since the series' first frame.

Uncertainty (all leave-one-wound-out / split conformal):
  area band   pool residual trajectories (observed - forecast) added to the test forecast -> ensemble -> conformal quantiles
  t50 / t90   ratio conformal: pool ratios true/predicted time; pool series that never got there count as "never" (inf)
Usage: python eval/forecast_baselines.py   -> eval/forecasts/<dataset>/<split>/<model>_<cut>h.json
"""
import json, os
import numpy as np, pandas as pd
from baselines import BASELINES
from score import event_time

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
OUT = os.path.join(HERE, "forecasts")
LEVEL = 0.90
MODELS = ["lvcf", "linear", "edge_speed", "logistic", "gompertz"]
EVENTS = [(0.5, "t50"), (0.1, "t90")]
STALL_KEEP = 0.9  # stall = area at the horizon still >= 90% of the area at the cut-off


def q_levels(m, level=LEVEL):
    a = (1 - level) / 2
    return max(0.0, np.floor((m + 1) * a) / m), min(1.0, np.ceil((m + 1) * (1 - a)) / m)


# exp1_partII_NC_P3 was built from two imaging positions spliced together (fixed in data/build_whad_auto.py);
# P2's simulator fits and gate files used the spliced curve, so it is excluded from evaluation for every model.
EXCLUDE = {"exp1_partII_NC_P3"}


def load(dataset):
    if dataset == "whad":
        man = pd.read_csv(f"{PROC}/whad_curves.csv").assign(qc="ok")
        auto = pd.read_csv(f"{PROC}/whad_auto_curves.csv")
        auto["wound"] = auto["wound"]  # already exp-prefixed, e.g. exp2_pos1021
        man["wound"] = "exp1_" + man["wound"]
        df = pd.concat([man, auto], ignore_index=True)
        df = df[df.wound_frac <= 0.70]  # segmentation sanity; <1% late in a series is real closure
        key = "position"
    elif dataset == "whimbc":
        df = pd.read_csv(f"{PROC}/whimbc_curves.csv").assign(source="manual", position=lambda d: d.wound)
        key = "position"
    elif dataset == "embryo":  # secondary: minutes -> hours; area_norm already relative to frame 0
        df = pd.read_csv(f"{PROC}/embryo_curves.csv")
        df = df.assign(position=df.wound_id, wound=df.wound_id, condition=df.group, source="manual",
                       t_hours=df.t_min / 60, wound_frac=df.area_norm)
        key = "position"
    else:  # zaritsky, secondary
        df = pd.read_csv(f"{PROC}/zaritsky_curves.csv")
        df = df.assign(position=df.wound_id, wound=df.wound_id, condition=df.cell_line + "_" + df.condition,
                       source="manual", t_hours=df.t_min / 60, wound_frac=df.area_norm)
        key = "position"
    series = {}
    for sid, g in df.groupby(key):
        if sid in EXCLUDE:
            continue
        g = g.sort_values("t_hours")
        t = g.t_hours.to_numpy(float); a = g.wound_frac.to_numpy(float)
        if len(t) < 5 or a[0] <= 0.01:
            continue
        series[sid] = dict(id=sid, wound=str(g.wound.iloc[0]), cond=str(g.condition.iloc[0]), source=str(g.source.iloc[0]),
                           part=str(g["part"].iloc[0]) if "part" in g else "", t=t - t[0], a=a / a[0])
    return series


def splits(dataset, S):
    if dataset == "whad":
        man = {k for k, s in S.items() if s["source"] == "manual"}
        cond = lambda c: {k for k in S if S[k]["cond"] == c}
        out = {"loo_all": (set(S), set(S)), "loo_manual": (man, man),
               "CC_to_C61": (cond("C61"), cond("CC")),  # pre-registered held-out condition test (R15)
               # v4 (R28): calibrate on every non-C61 condition; C61 is still never in the pool
               "rest_to_C61": (cond("C61"), set(S) - cond("C61"))}
        for c in ("CC", "N61", "NC"):  # leave-one-condition-out among KNOWN conditions -> condition-shift inflation
            out[f"lco_{c}"] = (cond(c), set(S) - cond(c) - cond("C61"))
        return out
    if dataset in ("embryo", "zaritsky"):
        return {"loo": (set(S), set(S))}
    return {"loo": (set(S), set(S)),
            "Monolayer_to_Sphere": ({k for k in S if S[k]["cond"] == "Sphere"}, {k for k in S if S[k]["cond"] == "Monolayer"})}


def prepare(S, ids, f, cut, G, G_long):
    base = {}
    for k in ids:
        s = S[k]; t, a = s["t"], s["a"]; h = t <= cut + 1e-9
        if h.sum() < 2 or ((~h).sum() == 0 and not s.get("no_truth")) or a[h][-1] <= 0.1:
            continue  # uploads (no_truth) have no future frames but still get a forecast
        pred = f(t[h], a[h], G)
        b = dict(pred=pred, res=np.interp(G, t, a) - pred)
        for lvl, key in EVENTS:
            seen = event_time(t[h], a[h], lvl)
            x = event_time(G_long, f(t[h], a[h], G_long), lvl)
            b[key + "_pred"] = x if x is not None else np.inf
            tt = event_time(t, a, lvl)
            b[key + "_seen"] = seen
            b[key + "_true"] = None if seen is not None else (tt if tt is not None else np.inf)  # inf = never in series
        base[k] = b
    return base


def forecast_file(dataset, split, model, cut, S, test, pool, G, G_long, T):
    f = BASELINES[model]
    base = prepare(S, test | pool, f, cut, G, G_long)
    out = []
    for k in sorted(test):
        if k not in base:
            continue
        s, b = S[k], base[k]
        others = [base[c] for c in pool if c in base and S[c]["wound"] != s["wound"]]
        if len(others) < 3:
            continue
        R = np.stack([o["res"] for o in others])
        E = np.clip(b["pred"][None, :] + R, 0, None)
        lq, hq = q_levels(len(R))
        keep = G <= (G[-1] if s.get("no_truth") else s["t"][-1]) + 1e-9
        lo, med, hi = np.quantile(E, [lq, 0.5, hq], axis=0, method="inverted_cdf")
        ev = {}
        for lvl, key in EVENTS:
            if b[key + "_seen"] is not None:
                v = round(float(b[key + "_seen"]), 2)
                ev[key] = {"median": v, "q05": v, "q95": v, "censored_prob": 0.0}
                ev[key + "_samples"] = np.array([b[key + "_seen"]])
                continue
            r = np.array([o[key + "_true"] / o[key + "_pred"] if np.isfinite(o[key + "_pred"]) else np.inf
                          for o in others if o[key + "_true"] is not None])
            samp = np.maximum(b[key + "_pred"] * r, cut) if len(r) else np.array([np.inf])
            ql, qh = q_levels(len(samp))
            q = np.quantile(samp, [ql, 0.5, qh], method="inverted_cdf")
            fin = lambda x: round(float(x), 2) if np.isfinite(x) and x <= G_long[-1] else None
            ev[key] = {"median": fin(q[1]), "q05": fin(q[0]), "q95": fin(q[2]),
                       "censored_prob": round(float(np.mean(samp > G[keep][-1])), 3)}
            ev[key + "_samples"] = samp
        a_cut = s["a"][s["t"] <= cut + 1e-9][-1]
        p_stall = float(np.mean(E[:, keep][:, -1] >= STALL_KEEP * a_cut))  # members closing < 10% more after the cut-off
        order = np.argsort(E[:, keep][:, -1])
        pick = order[np.linspace(0, len(order) - 1, min(5, len(order))).astype(int)]
        r4 = lambda x: [round(float(v), 4) for v in x]
        out.append({
            "wound_id": k, "wound": s["wound"], "condition": s["cond"], "part": s["part"],
            "t_hours": r4(G[keep]), "area_q05": r4(lo[keep]), "area_q50": r4(med[keep]), "area_q95": r4(hi[keep]),
            "t50": ev["t50"], "t90": ev["t90"],
            "p_close_by_T": round(float(np.mean(ev["t90_samples"] <= T)), 3), "p_stall": round(p_stall, 3), "flags": [],
            "segmentation_quality": {"status": "manual_mask" if s["source"] == "manual" else "ok", "reasons": []},
            "observed": {"t_hours": r4(s["t"]), "area": r4(s["a"])},
            "members": [r4(E[i, keep]) for i in pick],
        })
    return {"version": "1.0", "model": model, "dataset": dataset, "fold": split, "cutoff_hours": cut, "level": LEVEL,
            "p_close_by_T_hours": T, "notes": "statistical baseline + leave-one-wound-out conformal (eval/forecast_baselines.py)",
            "forecasts": out}


def main():
    import warnings
    warnings.filterwarnings("ignore")
    import sys
    cfg = {"whad": dict(cuts=[1.9, 3.8, 5.7, 9.5], T=19.0), "whimbc": dict(cuts=[3.0, 6.0, 9.0], T=24.0),
           # secondary sets: cut-offs = 10/20/30/50% of the median time to 90% closed (embryo 66 min, Zaritsky 754 min)
           "embryo": dict(cuts=[0.11, 0.22, 0.33, 0.55], T=1.1), "zaritsky": dict(cuts=[1.26, 2.51, 3.77, 6.28], T=12.6)}
    if len(sys.argv) > 1:
        cfg = {k: v for k, v in cfg.items() if k in sys.argv[1:]}
    for dataset, c in cfg.items():
        S = load(dataset)
        G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
        print(f"{dataset}: {len(S)} series, {len({s['wound'] for s in S.values()})} wounds")
        for split, (test, pool) in splits(dataset, S).items():
            for cut in c["cuts"]:
                G = G_all[G_all > cut + 1e-9]
                G_long = np.arange(G[0], 20 * G_all[-1], min(0.25, float(np.min(np.diff(G_all)))))
                for model in MODELS:
                    doc = forecast_file(dataset, split, model, cut, S, test, pool, G, G_long, c["T"])
                    d = f"{OUT}/{dataset}/{split}"
                    os.makedirs(d, exist_ok=True)
                    json.dump(doc, open(f"{d}/{model}_{cut:g}h.json", "w"))
                print(f"  {split:20} cut {cut:4g} h: {len(doc['forecasts'])} test series x {len(MODELS)} models")


if __name__ == "__main__":
    main()
