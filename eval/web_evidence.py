"""web/ops/evidence.json for the Ops "Forecast evidence" tab (web/ops/evidence.js). Same sources as docs/results.md:
eval/results/{scorecard,flags,schedule_widths}.csv and the out-of-fold NCA v3 forecast file for the failure case.
Usage: python eval/web_evidence.py   (after eval/score_forecasts.py, flags.py, scheduler.py)
"""
import json, os
import numpy as np, pandas as pd
import score_forecasts as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "ops", "evidence.json")
SHIPPED, CUTS, HORIZON = "nca_realft3", [1.9, 3.8, 5.7, 9.5], 19.0
STATISTICAL = ["edge_speed", "linear", "logistic", "gompertz", "lvcf"]
LABEL = {"nca_realft3": "NCA, real frames (shipped)", "edge_speed": "Edge speed", "linear": "Linear",
         "logistic": "Logistic", "gompertz": "Gompertz", "lvcf": "Typical-wound curve",
         "nca_ensemble": "NCA, simulator only", "sim_ensemble": "Cell-agent simulator"}
KIND = {**{m: "statistical" for m in STATISTICAL}, "nca_realft3": "shipped", "nca_ensemble": "model", "sim_ensemble": "model"}
r4 = lambda x: round(float(x), 4)


def row(g, m):
    r = g.loc[m]
    return {"model": m, "label": LABEL[m], "kind": KIND[m], "qscore": r4(r.qscore), "q_lo": r4(r.qscore_lo),
            "q_hi": r4(r.qscore_hi), "coverage": r4(r.coverage), "cov_lo": r4(r.cov_lo), "cov_hi": r4(r.cov_hi)}


def scorecard(S):
    out = {}
    for c in CUTS:
        g = S[(S.dataset == "whad") & (S.split == "loo_all") & (S.cutoff_h.round(2) == c)].set_index("model")
        best = g.loc[STATISTICAL, "qscore"].idxmin()
        gate = 1.1 * g.loc[best, "qscore"]
        rows = [row(g, m) for m in LABEL]
        for r in rows:
            if r["kind"] != "statistical":
                r["passable"] = bool(r["qscore"] <= gate and 0.85 <= r["coverage"] <= 0.95)
        out[f"{c:g}"] = {"best_statistical": best, "gate": r4(gate), "rows": sorted(rows, key=lambda r: r["qscore"])}
    return out


def by_cutoff(S):
    g = S[(S.dataset == "whad") & (S.split == "loo_all")]
    return [{"model": m, "label": LABEL[m], "kind": KIND[m],
             "points": [{"cut": c, **{k: r4(v) for k, v in g[(g.model == m) & (g.cutoff_h.round(2) == c)]
                                      .iloc[0][["qscore", "qscore_lo", "qscore_hi"]].items()}} for c in CUTS]}
            for m in ("nca_realft3", "edge_speed", "nca_ensemble")]


def reliability(S):
    def get(ds, sp, c, models):
        g = S[(S.dataset == ds) & (S.split == sp) & (S.cutoff_h.round(2) == c) & S.model.isin(models)]
        return g.loc[g.qscore.idxmin()]
    rows = [("whad", "loo_all", 3.8, [SHIPPED], "Unseen wounds, same cells", "WHAD MCF10A, 28 wounds"),
            ("whad", "CC_to_C61", 3.8, [SHIPPED], "Unseen condition (pre-registered)", "calibrated on control, tested on CYR61 knockdown"),
            ("whad", "rest_to_C61", 3.8, [SHIPPED], "Unseen condition, wider calibration", "calibrated on all other conditions, tested on CYR61 knockdown"),
            ("whimbc", "loo", 6.0, STATISTICAL, "Unseen wells, same cells", "WHiM-BC MCF-7, 24 wells"),
            ("whimbc", "Monolayer_to_Sphere", 6.0, STATISTICAL, "New cell type", "calibrated on ordinary MCF-7, tested on stem-cell-enriched")]
    out = []
    for ds, sp, c, models, lab, detail in rows:
        r = get(ds, sp, c, models)
        out.append({"label": lab, "detail": detail, "model": r.model, "model_label": LABEL.get(r.model, r.model),
                    "cut": c, "coverage": r4(r.coverage), "cov_lo": r4(r.cov_lo), "cov_hi": r4(r.cov_hi),
                    "n_wounds": int(r.n_wounds)})
    return out


def narrowing():
    W = pd.read_csv(f"{HERE}/results/schedule_widths.csv")
    return [{"model": m, "label": LABEL[m], "kind": KIND[m],
             "points": [{"cut": float(c), "width": r4(w)} for c, w in W[W.model == m][["check_h", "mean_band_width"]].values]}
            for m in ("nca_realft3", "edge_speed")]


def stall():
    F = pd.read_csv(f"{HERE}/results/flags.csv").query("flag == 'stall'")
    return [{"cut": float(r.cut_h), "auc": round(float(r.auc), 2), "precision": round(float(r.precision), 2),
             "recall": round(float(r.recall), 2), "n": int(r.n), "positives": int(r.positives), "flagged": int(r.flagged)}
            for r in F.itertuples()]


def failure(cut=3.8):
    doc = json.load(open(f"{HERE}/forecasts/whad/loo_all/{SHIPPED}_{cut:g}h.json"))
    scores = [(sf.score_series(f, cut, HORIZON) or {}).get("qscore", -1) for f in doc["forecasts"]]
    f = doc["forecasts"][int(np.argmax(scores))]
    t, a = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"])
    return {"wound_id": f["wound_id"], "cut": cut, "qscore": r4(max(scores)),
            "median_qscore": r4(np.median([s for s in scores if s >= 0])),
            "observed": {"t_hours": [r4(x) for x in t], "area": [r4(x) for x in a]},
            "t_hours": f["t_hours"], "area_q05": f["area_q05"], "area_q50": f["area_q50"], "area_q95": f["area_q95"]}


if __name__ == "__main__":
    S = pd.read_csv(f"{HERE}/results/scorecard.csv")
    g = S[(S.dataset == "whad") & (S.split == "loo_all") & (S.model == SHIPPED) & (S.cutoff_h.round(2) == 3.8)].iloc[0]
    doc = {"generated_by": "eval/web_evidence.py", "same_sources_as": "docs/results.md", "shipped": SHIPPED,
           "horizon_h": HORIZON, "n_wounds": int(g.n_wounds), "n_series": int(g.n_series), "cutoffs": CUTS,
           "scorecard": scorecard(S), "by_cutoff": by_cutoff(S), "reliability": reliability(S),
           "narrowing": narrowing(), "stall": stall(), "failure": failure()}
    json.dump(doc, open(OUT, "w"), separators=(",", ":"))
    print("wrote", os.path.relpath(OUT), f"({os.path.getsize(OUT) / 1024:.1f} KB)")
