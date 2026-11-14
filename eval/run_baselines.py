"""Score the simple baselines on the processed curves.

Cut-offs are absolute times = frac x (median time-to-90%-closed of the dataset), NOT a fraction of each
series' own length: series length is tied to closure time (Zaritsky series end at closure), so a per-series
fraction would leak the answer.

Usage: python eval/run_baselines.py [embryo|zaritsky ...]
"""
import os, sys
import numpy as np, pandas as pd
from baselines import BASELINES, FALLBACKS
from score import boot_ci, crps_ensemble, event_time

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
FRACS = [0.1, 0.2, 0.3, 0.5]


def run(name):
    df = pd.read_csv(f"{PROC}/{name}_curves.csv")
    wounds = {w: (g.t_min.to_numpy(float), g.area_norm.to_numpy(float)) for w, g in df.groupby("wound_id")}
    t90_all = [event_time(t, a, 0.1) for t, a in wounds.values()]
    t_ref = float(np.median([x for x in t90_all if x is not None]))
    dt = float(np.median(np.diff(df[df.wound_id == df.wound_id.iloc[0]].t_min)))
    print(f"\n=== {name}: {len(wounds)} wounds, frame {dt:g} min, reach 90% closed: "
          f"{sum(x is not None for x in t90_all)}/{len(wounds)}, median time-to-90% {t_ref:g} min")

    summary, per = [], []
    for frac in FRACS:
        cut = frac * t_ref
        for bname, f in BASELINES.items():
            FALLBACKS.clear()
            rows = []
            for w, (t, a) in wounds.items():
                h = t <= cut + 1e-9
                if h.sum() < 2 or (~h).sum() == 0 or a[h][-1] <= 0.1:
                    continue  # too little history, nothing left to forecast, or already closed
                tf = t[~h]
                pred = f(t[h], a[h], tf)
                long_t = np.arange(t[h][-1] + dt, 5 * t_ref + dt, dt)  # look past series end for event times
                long_p = f(t[h], a[h], long_t)
                row = {"wound_id": w, "frac": frac, "baseline": bname,
                       "area_mae": float(np.abs(pred - a[~h]).mean()),
                       "crps": float(crps_ensemble(pred[None], a[~h]).mean())}
                for lvl, key in [(0.5, "t50"), (0.1, "t90")]:
                    true = event_time(t, a, lvl)
                    if true is None or true <= cut:
                        row[f"{key}_err"] = None  # censored or already happened: not scored
                        continue
                    p = event_time(long_t, long_p, lvl)
                    row[f"{key}_never"] = p is None
                    row[f"{key}_err"] = abs((p if p is not None else long_t[-1]) - true)
                rows.append(row)
            per += rows
            r = pd.DataFrame(rows)
            m, lo, hi = boot_ci(r.area_mae)
            s = {"frac": frac, "cutoff_min": round(cut, 1), "baseline": bname, "n": len(r),
                 "area_mae": m, "area_mae_lo": lo, "area_mae_hi": hi}
            for key in ["t50", "t90"]:
                e = r[f"{key}_err"].dropna() if f"{key}_err" in r else pd.Series(dtype=float)
                s[f"{key}_mae_min"], s[f"{key}_lo"], s[f"{key}_hi"] = boot_ci(e)
                s[f"{key}_n"] = len(e)
                s[f"{key}_never"] = int(r.get(f"{key}_never", pd.Series(dtype=bool)).fillna(False).sum())
            s["fit_fallbacks"] = sum(FALLBACKS.values())
            summary.append(s)

    S = pd.DataFrame(summary)
    P = pd.DataFrame(per)
    os.makedirs(f"{HERE}/results", exist_ok=True)
    S.to_csv(f"{HERE}/results/baselines_{name}_summary.csv", index=False)
    P.to_csv(f"{HERE}/results/baselines_{name}_per_wound.csv", index=False)

    for frac in FRACS:
        sub = S[S.frac == frac]
        print(f"\n-- cut-off {frac:.0%} of median t90 = {sub.cutoff_min.iloc[0]:g} min  (n wounds forecast: {sub.n.iloc[0]})")
        print(f"   {'baseline':11} {'area MAE [95% CI]':>24} {'t50 MAE min [CI] (n, never)':>34} {'t90 MAE min [CI] (n, never)':>34}  fallbacks")
        for _, s in sub.sort_values("area_mae").iterrows():
            print(f"   {s.baseline:11} {s.area_mae:8.3f} [{s.area_mae_lo:.3f},{s.area_mae_hi:.3f}]"
                  f"   {s.t50_mae_min:7.1f} [{s.t50_lo:6.1f},{s.t50_hi:6.1f}] ({s.t50_n:2d},{s.t50_never:2d})"
                  f"   {s.t90_mae_min:7.1f} [{s.t90_lo:6.1f},{s.t90_hi:6.1f}] ({s.t90_n:2d},{s.t90_never:2d})   {s.fit_fallbacks}")

    best = S[S.frac == 0.2].sort_values("area_mae").baseline.iloc[0]
    worst = P[(P.frac == 0.2) & (P.baseline == best)].nlargest(3, "area_mae")
    print(f"\n   worst wounds for best baseline at 20% ({best}): " +
          ", ".join(f"{w} (MAE {m:.2f})" for w, m in zip(worst.wound_id, worst.area_mae)))


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    for name in sys.argv[1:] or ["embryo", "zaritsky"]:
        if os.path.exists(f"{PROC}/{name}_curves.csv"):
            run(name)
        else:
            print(f"skip {name}: no processed curves")
