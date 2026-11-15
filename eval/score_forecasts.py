"""Score ANY folder of forecast-contract files (baselines or NCA) the same way. Truth = each forecast's `observed`.

Per series (future points only, t > cutoff):
  coverage   fraction of observed points inside [q05, q95]
  width      mean q95 - q05
  qscore     quantile score = mean over q in {0.05, 0.5, 0.95} of 2 * pinball loss; a CRPS approximation from the
             three quantiles the contract carries. Used for the gate so every model is scored identically.
  mae        |q50 - observed|
  t50/t90    in-range (q05 <= truth <= q95, open-ended q95 = inf) and |median - truth| when truth is observed after the cut-off
  brier      (P(90% closed by T) - outcome)^2 when the outcome is known
Aggregates: mean over series; CI = bootstrap over physical wounds (series of one wound resampled together);
coverage also gets a Wilson CI over pooled points (too narrow if points are correlated; shown for reference).

Usage: python eval/score_forecasts.py DIR [DIR ...]  [--gate MODEL]   -> prints table, writes eval/results/scorecard.csv
"""
import glob, json, os, sys
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
QS = (0.05, 0.5, 0.95)
RNG = np.random.default_rng(0)


def first_cross(t, a, level):
    i = np.nonzero(a <= level)[0]
    return float(t[i[0]]) if len(i) else None


def score_series(f, cut, T):
    o = f["observed"]; t = np.array(o["t_hours"]); a = np.array(o["area"])
    ft = np.array(f["t_hours"])
    m = (t > cut + 1e-9) & (t <= ft[-1] + 1e-9)
    if not m.any():
        return None
    y = a[m]
    q = {p: np.interp(t[m], ft, f[k]) for p, k in zip(QS, ("area_q05", "area_q50", "area_q95"))}
    pin = lambda p, qq: np.maximum(p * (y - qq), (p - 1) * (y - qq))
    r = {"wound": f.get("wound", f["wound_id"]), "n_pts": int(m.sum()),
         "inside": int(((y >= q[0.05]) & (y <= q[0.95])).sum()),
         "coverage": float(np.mean((y >= q[0.05]) & (y <= q[0.95]))), "width": float(np.mean(q[0.95] - q[0.05])),
         "qscore": float(np.mean([2 * pin(p, q[p]) for p in QS])), "mae": float(np.mean(np.abs(q[0.5] - y)))}
    for lvl, key in ((0.5, "t50"), (0.1, "t90")):
        if first_cross(t[t <= cut + 1e-9], a[t <= cut + 1e-9], lvl) is not None:
            continue  # already happened before the cut-off: not a forecast
        truth = first_cross(t, a, lvl)
        if truth is None:
            continue
        e = f[key]; lo = e["q05"] if e["q05"] is not None else -np.inf; hi = e["q95"] if e["q95"] is not None else np.inf
        r[key + "_in"] = float(lo <= truth <= hi)
        if e["median"] is not None:
            r[key + "_err"] = abs(e["median"] - truth)
    t90 = first_cross(t, a, 0.1)
    if t90 is not None:
        r["brier"] = (f["p_close_by_T"] - float(t90 <= T)) ** 2
    elif t[-1] >= T:
        r["brier"] = f["p_close_by_T"] ** 2
    return r


def boot(df, col, n=1000):
    d = df[["wound", col]].dropna()
    if d.empty:
        return np.nan, np.nan, np.nan
    groups = [g[col].to_numpy() for _, g in d.groupby("wound")]
    k = len(groups)
    stats = [np.concatenate([groups[i] for i in RNG.integers(0, k, k)]).mean() for _ in range(n)]
    return float(d[col].mean()), *np.percentile(stats, [2.5, 97.5])


def wilson(x, n, z=1.96):
    if n == 0:
        return np.nan, np.nan
    p = x / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


STATISTICAL = {"lvcf", "linear", "edge_speed", "logistic", "gompertz"}
FOLD_ALIAS = {("whad", "loo"): "loo_all", ("whad", "B_CC_to_C61"): "CC_to_C61"}
_WOUND = None


def physical_wound(dataset, wid):
    """WHAD position -> physical wound (part I and II of one wound share it), for files without a `wound` field."""
    global _WOUND
    if dataset != "whad":
        return wid
    if _WOUND is None:
        proc = os.path.join(HERE, "..", "data", "processed")
        m = pd.read_csv(f"{proc}/whad_curves.csv")[["position", "wound"]].drop_duplicates()
        a = pd.read_csv(f"{proc}/whad_auto_curves.csv")[["position", "wound"]].drop_duplicates()
        _WOUND = {**dict(zip(m.position, "exp1_" + m.wound)), **dict(zip(a.position, a.wound))}
    return _WOUND.get(wid, wid)


def score_file(path):
    doc = json.load(open(path))
    doc["fold"] = FOLD_ALIAS.get((doc["dataset"], doc["fold"]), doc["fold"])
    for f in doc["forecasts"]:
        f.setdefault("wound", physical_wound(doc["dataset"], f["wound_id"]))
    from forecast_baselines import EXCLUDE
    rows = [r for f in doc["forecasts"] if f["wound_id"] not in EXCLUDE
            and (r := score_series(f, doc["cutoff_hours"], doc["p_close_by_T_hours"]))]
    df = pd.DataFrame(rows)
    s = {"dataset": doc["dataset"], "split": doc["fold"], "cutoff_h": doc["cutoff_hours"], "model": doc["model"],
         "n_series": len(df), "n_wounds": df.wound.nunique() if len(df) else 0}
    if df.empty:
        return s
    s["coverage"], s["cov_lo"], s["cov_hi"] = boot(df, "coverage")
    s["cov_wilson_lo"], s["cov_wilson_hi"] = wilson(df.inside.sum(), df.n_pts.sum())
    for c in ("width", "qscore", "mae", "brier"):
        s[c] = boot(df, c)[0] if c in df else np.nan
    s["qscore_lo"], s["qscore_hi"] = boot(df, "qscore")[1:]
    for k in ("t50", "t90"):
        s[k + "_in"] = df[k + "_in"].mean() if k + "_in" in df else np.nan
        s[k + "_n"] = int(df[k + "_in"].notna().sum()) if k + "_in" in df else 0
        s[k + "_err_h"] = df[k + "_err"].mean() if k + "_err" in df else np.nan
    return s


def gate(S, model):
    """Design.md 5.3: passable if qscore within 10% of the best baseline AND coverage in [0.85, 0.95]."""
    print(f"\nGATE for '{model}' (qscore within 10% of best baseline AND coverage 0.85-0.95):")
    for (ds, sp, cut), g in S.groupby(["dataset", "split", "cutoff_h"]):
        m = g[g.model == model]
        b = g[g.model.isin(STATISTICAL)]  # only the statistical baselines count (not sim / other NCA variants)
        if m.empty or b.empty:
            continue
        best = b.loc[b.qscore.idxmin()]
        mq, mc = m.qscore.iloc[0], m.coverage.iloc[0]
        ok = mq <= 1.10 * best.qscore and 0.85 <= mc <= 0.95
        print(f"  {ds:7} {sp:20} {cut:4g} h: {model} qscore {mq:.4f} cov {mc:.2f} | best baseline {best.model} "
              f"{best.qscore:.4f} -> {'PASS' if ok else 'FAIL'}")


def main(args):
    gate_model = None
    if "--gate" in args:
        i = args.index("--gate"); gate_model = args[i + 1]; args = args[:i] + args[i + 2:]
    files = [p for d in args for p in sorted(glob.glob(os.path.join(d, "**", "*.json"), recursive=True))]
    S = pd.DataFrame([score_file(p) for p in files])
    os.makedirs(f"{HERE}/results", exist_ok=True)
    S.to_csv(f"{HERE}/results/scorecard.csv", index=False)
    for (ds, sp, cut), g in S.groupby(["dataset", "split", "cutoff_h"]):
        g = g.sort_values("qscore")
        print(f"\n{ds} | {sp} | cut-off {cut:g} h | {int(g.n_series.max())} series, {int(g.n_wounds.max())} wounds")
        print(f"  {'model':12} {'qscore [95% CI]':>24} {'cov [wound CI]':>22} {'width':>6} {'MAE':>6} "
              f"{'t50 in (n) err h':>18} {'t90 in (n) err h':>18} {'Brier':>6}")
        for _, s in g.iterrows():
            print(f"  {s.model:12} {s.qscore:.4f} [{s.qscore_lo:.4f},{s.qscore_hi:.4f}] {s.coverage:5.2f} [{s.cov_lo:.2f},{s.cov_hi:.2f}]"
                  f" {s.width:6.3f} {s.mae:6.3f}  {s.t50_in:4.2f} ({s.t50_n:2d}) {s.t50_err_h:5.1f}"
                  f"  {s.t90_in:4.2f} ({s.t90_n:2d}) {s.t90_err_h:5.1f} {s.brier:6.3f}")
    if gate_model:
        gate(S, gate_model)


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    main(sys.argv[1:])
