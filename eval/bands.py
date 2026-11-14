"""Calibrated forecasts around a point forecaster, all leave-one-wound-out (no wound's own outcome is used
for its own band or range).

Area band: every OTHER wound contributes its residual trajectory (observed - forecast, on a shared absolute
time grid after the cut-off). Added to the target's forecast this gives an ensemble of plausible futures;
the 90% band is its conformal quantiles. Beyond a wound's last frame its area is held at the last value.

Time-to-50%/90%-closed ranges and P(closed by T): ratio conformal. For other wounds, ratio = true time /
predicted time; the target's range is its predicted time x the conformal quantiles of those ratios.
(Tested first: reading times off the area ensemble gave calibrated but ~3x wider, often open-ended ranges.)

"Unsure" signal: disagreement between forecasters on time-to-90%. Its link to error is MEASURED here,
not assumed; on embryo data it is ~0, so it is not shipped as a flag.

Usage: python eval/bands.py [embryo|zaritsky ...]   -> eval/results/bands_*.csv, web/data/forecast_*.json
"""
import json, os, sys
import numpy as np, pandas as pd
from baselines import BASELINES
from score import boot_ci, crps_ensemble, event_time

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
WEB = os.path.join(HERE, "..", "web", "data")
LEVEL = 0.90
FRACS = [0.1, 0.2, 0.3, 0.5]
FORECASTERS = ["edge_speed", "logistic", "linear"]
EVENTS = [(0.5, "t50"), (0.1, "t90")]


def q_levels(m, level=LEVEL):
    """Finite-sample conformal quantile levels for m exchangeable scores."""
    a = (1 - level) / 2
    return max(0.0, np.floor((m + 1) * a) / m), min(1.0, np.ceil((m + 1) * (1 - a)) / m)


def predicted_time(f, t, a, G_long, level):
    x = event_time(G_long, f(t, a, G_long), level)
    return x if x is not None else G_long[-1]


def forecast_all(wounds, fname, cut, dt, t_ref):
    f = BASELINES[fname]
    G = np.arange(np.floor(cut / dt + 1e-9) * dt + dt, 5 * t_ref + dt / 2, dt)
    G_long = np.arange(G[0], 30 * t_ref, dt)
    base = {}
    for w, (t, a) in wounds.items():
        h = t <= cut + 1e-9
        if h.sum() < 2 or (~h).sum() == 0 or a[h][-1] <= 0.1:
            continue  # too little history, nothing to forecast, or already closed
        pred = f(t[h], a[h], G)
        b = {"t": t, "a": a, "h": h, "pred": pred, "res": np.interp(G, t, a) - pred}
        for lvl, key in EVENTS:
            b[key + "_pred"] = predicted_time(f, t[h], a[h], G_long, lvl)
            tt = event_time(t, a, lvl)
            b[key + "_true"] = tt if tt is not None and tt > cut else None  # None: censored or already passed
        tp = [predicted_time(BASELINES[g], t[h], a[h], G_long, 0.1) for g in FORECASTERS]
        b["spread"] = (max(tp) - min(tp)) / np.median(tp)
        base[w] = b
    out = {}
    for w, b in base.items():
        others = [o for k, o in base.items() if k != w]
        R = np.stack([o["res"] for o in others])
        E = np.clip(b["pred"][None, :] + R, 0, None)
        lq, hq = q_levels(len(R))
        lo, med, hi = np.quantile(E, [lq, 0.5, hq], axis=0, method="inverted_cdf")
        o = dict(b, G=G, E=E, lo=lo, med=med, hi=hi)
        h = b["h"]
        for lvl, key in EVENTS:
            seen = event_time(b["t"][h], b["a"][h], lvl)
            if seen is not None:  # already happened before the cut-off: report it, no forecast
                o[key], o[key + "_samples"] = np.array([seen] * 3), np.array([seen])
                continue
            ratios = np.array([x[key + "_true"] / x[key + "_pred"] for x in others if x[key + "_true"] is not None])
            rl, rh = q_levels(len(ratios))
            samples = np.maximum(b[key + "_pred"] * ratios, cut)  # cannot happen before the cut-off
            o[key] = np.quantile(samples, [rl, 0.5, rh], method="inverted_cdf")
            o[key + "_samples"] = samples
        out[w] = o
    return out


def score(out, t_ref):
    rows = []
    for w, o in out.items():
        t, a, h = o["t"], o["a"], o["h"]
        tf, af = t[~h], a[~h]
        lo, hi = np.interp(tf, o["G"], o["lo"]), np.interp(tf, o["G"], o["hi"])
        Ef = np.stack([np.interp(tf, o["G"], e) for e in o["E"]])
        r = {"wound_id": w, "coverage": float(np.mean((af >= lo) & (af <= hi))), "width": float(np.mean(hi - lo)),
             "crps": float(crps_ensemble(Ef, af).mean()),
             "point_mae": float(np.abs(np.interp(tf, o["G"], o["pred"]) - af).mean()), "spread": o["spread"]}
        for _, key in EVENTS:
            tl, tm, th = o[key]
            r[key + "_relwidth"] = (th - tl) / tm
            if o[key + "_true"] is not None:
                r[key + "_in_range"] = bool(tl <= o[key + "_true"] <= th)
                r[key + "_relerr"] = abs(tm - o[key + "_true"]) / o[key + "_true"]
        # P(90% closed by T_ref): truth known if it closed, or if filming ran past T_ref without closing
        p = float(np.mean(o["t90_samples"] <= t_ref))
        t90_obs = event_time(t, a, 0.1)
        if t90_obs is not None:
            r["brier"] = (p - float(t90_obs <= t_ref)) ** 2
        elif t[-1] >= t_ref:
            r["brier"] = p ** 2
        rows.append(r)
    return pd.DataFrame(rows)


def export(name, out, cut, fname, groups, t_ref):
    r4 = lambda x: [round(float(v), 4) for v in x]
    data = {"dataset": name, "cutoff_min": cut, "forecaster": fname, "level": LEVEL, "p_close_by_min": t_ref,
            "note": "area_obs normalised to frame 0; bands/ranges are leave-one-wound-out conformal", "wounds": []}
    for w, o in out.items():
        keep = o["G"] <= max(o["t"][-1] * 1.25, cut * 2)
        data["wounds"].append({
            "id": w, "group": groups.get(w, ""), "t_obs": r4(o["t"]), "area_obs": r4(o["a"]),
            "t_fc": r4(o["G"][keep]), "median": r4(o["med"][keep]), "lo": r4(o["lo"][keep]), "hi": r4(o["hi"][keep]),
            "t50_range": r4(o["t50"]), "t90_range": r4(o["t90"]),
            "p_close_by": round(float(np.mean(o["t90_samples"] <= t_ref)), 3),
        })
    os.makedirs(WEB, exist_ok=True)
    path = f"{WEB}/forecast_{name}_{int(round(cut))}min.json"
    json.dump(data, open(path, "w"))
    return path


def run(name):
    df = pd.read_csv(f"{PROC}/{name}_curves.csv")
    groups = df.groupby("wound_id")["group" if "group" in df else "condition"].first().to_dict()
    wounds = {w: (g.t_min.to_numpy(float), g.area_norm.to_numpy(float)) for w, g in df.groupby("wound_id")}
    t90s = [event_time(t, a, 0.1) for t, a in wounds.values()]
    t_ref = float(np.median([x for x in t90s if x is not None]))
    dt = float(np.median(np.concatenate([np.diff(t) for t, _ in wounds.values()])))
    print(f"\n=== {name}: {len(wounds)} wounds, target {LEVEL:.0%}. Brier = P(90% closed by {t_ref:g} min).")
    summary = []
    for frac in FRACS:
        cut = frac * t_ref
        print(f"\n-- cut-off {cut:g} min")
        print(f"   {'forecaster':11} {'n':>3} {'band coverage [95% CI]':>24} {'width':>6} {'CRPS':>6} {'ptMAE':>6}"
              f" {'t50 in-range (width)':>21} {'t90 in-range (width)':>21} {'Brier':>6} {'spread~err':>10}")
        for fname in FORECASTERS:
            out = forecast_all(wounds, fname, cut, dt, t_ref)
            r = score(out, t_ref)
            cov, cl, ch = boot_ci(r.coverage)
            s = {"frac": frac, "cutoff_min": cut, "forecaster": fname, "n": len(r), "coverage": cov,
                 "coverage_lo": cl, "coverage_hi": ch, "width": r.width.mean(), "crps": r.crps.mean(),
                 "point_mae": r.point_mae.mean(), "brier": r.brier.mean(), "brier_n": int(r.brier.notna().sum())}
            for _, key in EVENTS:
                s[key + "_in_range"] = r[key + "_in_range"].dropna().astype(float).mean() if key + "_in_range" in r else np.nan
                s[key + "_n"] = int(r[key + "_in_range"].notna().sum()) if key + "_in_range" in r else 0
                s[key + "_relwidth"] = r[key + "_relwidth"].median()
            s["spread_err_spearman"] = r.spread.corr(r.get("t90_relerr"), method="spearman") if "t90_relerr" in r else np.nan
            summary.append(s)
            print(f"   {fname:11} {s['n']:3d} {cov:9.3f} [{cl:.3f},{ch:.3f}] {s['width']:6.3f} {s['crps']:6.3f}"
                  f" {s['point_mae']:6.3f}   {s['t50_in_range']:5.2f} (x{s['t50_relwidth']:.2f}) n={s['t50_n']:2d}"
                  f"   {s['t90_in_range']:5.2f} (x{s['t90_relwidth']:.2f}) n={s['t90_n']:2d}"
                  f" {s['brier']:6.3f} {s['spread_err_spearman']:10.2f}")
            if fname == "edge_speed" and frac in (0.2, 0.3):
                print(f"      viewer export -> {os.path.relpath(export(name, out, cut, fname, groups, t_ref))}")
    os.makedirs(f"{HERE}/results", exist_ok=True)
    pd.DataFrame(summary).to_csv(f"{HERE}/results/bands_{name}_summary.csv", index=False)


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    for name in sys.argv[1:] or ["embryo", "zaritsky"]:
        run(name)
