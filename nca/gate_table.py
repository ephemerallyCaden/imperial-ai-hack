"""Gate table vs the best STATISTICAL baseline (as P1's score_forecasts.py gate, which uses STATISTICAL), on the
3 pre-registered R15 folds only (loo_all, loo_manual, CC_to_C61) x 4 cut-offs, so pass counts are out of 12.
python eval/score_forecasts.py DIR... && python nca/gate_table.py eval/results/scorecard.csv nca_follow nca_ensemble ..."""
import sys
import pandas as pd

B = ["lvcf", "linear", "edge_speed", "logistic", "gompertz"]
SPLITS = ["loo_all", "loo_manual", "CC_to_C61"]  # R15; not the v4 lco_* / rest_* calibration splits
S = pd.read_csv(sys.argv[1]); models = sys.argv[2:]
S = S[(S.dataset == "whad") & S.split.isin(SPLITS)]
print(f"{'split':11s} {'cut':>4s} | " + " | ".join(f"{m:>22s}" for m in models) + " | best statistical")
for (sp, cut), g in S.groupby(["split", "cutoff_h"]):
    b = g[g.model.isin(B)]; best = b.loc[b.qscore.idxmin()]
    cells = []
    for m in models:
        r = g[g.model == m]
        if r.empty:
            cells.append(f"{'-':>22s}"); continue
        r = r.iloc[0]; ok = r.qscore <= 1.1 * best.qscore and 0.85 <= r.coverage <= 0.95
        cells.append(f"{r.qscore:.4f} c{r.coverage:.2f} x{r.qscore / best.qscore:.2f} {'P' if ok else 'F'}")
    print(f"{sp:11s} {cut:4g} | " + " | ".join(cells) + f" | {best.model} {best.qscore:.4f} c{best.coverage:.2f}")
for m in models:
    n = 0; p = 0
    for (sp, cut), g in S.groupby(["split", "cutoff_h"]):
        b = g[g.model.isin(B)]; r = g[g.model == m]
        if r.empty or b.empty: continue
        best = b.qscore.min(); r = r.iloc[0]; n += 1; p += r.qscore <= 1.1 * best and 0.85 <= r.coverage <= 0.95
    print(f"{m}: passes {p}/{n}")
