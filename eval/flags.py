"""Flags (design.md 4.1, 5.5): stall, out-of-band, measure-again. Thresholds tuned leave-one-wound-out
(a wound's own outcome never sets its threshold); precision / recall reported per cut-off.

  stall          signal p_stall (ensemble share closing < 10% more after the cut-off); truth: area at the last frame
                 >= 90% of the area at the cut-off
  out_of_band    rule fixed in advance (no tuning): the next 2 observed frames after the cut-off are both outside the
                 90% band; truth ("forecast off-track"): |median - observed| > 0.2 at the last frame
  measure_again  candidate signals: band width at the horizon, history-fit RMSE, stall ambiguity min(p, 1-p);
                 truth as for out_of_band. AUC shown for every candidate; the flag uses the best one (chosen on these
                 data, so its AUC is optimistic: stated in the output)
Usage: python eval/flags.py   -> eval/results/flags.csv, eval/results/flag_thresholds.json; fills flags[] in web/data
"""
import glob, json, os
import numpy as np, pandas as pd
from baselines import edge_speed

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f"{HERE}/forecasts/whad/loo_all"
BAD = 0.2


def signals(path):
    doc = json.load(open(path)); cut = doc["cutoff_hours"]; rows = []
    for f in doc["forecasts"]:
        t = np.array(f["observed"]["t_hours"]); a = np.array(f["observed"]["area"]); ft = np.array(f["t_hours"])
        h = t <= cut + 1e-9; fut = (t > cut + 1e-9) & (t <= ft[-1] + 1e-9)
        lo, med, hi = (np.interp(t[fut], ft, f[k]) for k in ("area_q05", "area_q50", "area_q95"))
        y = a[fut]
        out = (y < lo) | (y > hi)
        fit = edge_speed(t[h], a[h], t[h])
        p = f["p_stall"]
        rows.append({"wound": f.get("wound", f["wound_id"]), "id": f["wound_id"], "cut": cut,
                     "stall_true": bool(a[-1] >= 0.9 * a[h][-1]), "p_stall": p,
                     "off_track": bool(abs(med[-1] - y[-1]) > BAD) if len(y) else False,
                     "oob_flag": bool(len(out) >= 2 and out[0] and out[1]),
                     "width_h": float(hi[-1] - lo[-1]) if len(y) else np.nan,
                     "fit_rmse": float(np.sqrt(np.mean((fit - a[h]) ** 2))), "ambiguity": min(p, 1 - p)})
    return pd.DataFrame(rows)


def auc(score, label):
    s, l = np.asarray(score, float), np.asarray(label, bool)
    if l.all() or (~l).all():
        return np.nan
    r = pd.Series(s).rank().to_numpy()
    return (r[l].sum() - l.sum() * (l.sum() + 1) / 2) / (l.sum() * (~l).sum())


def best_threshold(score, label):
    best, bt = -1, np.inf
    for th in np.unique(score):
        pred = score >= th
        tp = (pred & label).sum(); f1 = 2 * tp / max(pred.sum() + label.sum(), 1)
        if f1 > best:
            best, bt = f1, th
    return bt


def loo_flags(df, sig, truth):
    flag = np.zeros(len(df), bool)
    for w in df.wound.unique():
        tr, te = df.wound != w, df.wound == w
        th = best_threshold(df.loc[tr, sig].to_numpy(), df.loc[tr, truth].to_numpy())
        flag[te.to_numpy()] = df.loc[te, sig].to_numpy() >= th
    return flag


def prf(flag, truth):
    tp = int((flag & truth).sum())
    return dict(n=len(truth), positives=int(truth.sum()), flagged=int(flag.sum()),
                precision=tp / flag.sum() if flag.sum() else np.nan, recall=tp / truth.sum() if truth.sum() else np.nan)


def main():
    rows, thresholds = [], {}
    for path in sorted(glob.glob(f"{SRC}/edge_speed_*h.json"), key=lambda p: float(p.split("_")[-1][:-6])):
        df = signals(path); cut = df.cut.iloc[0]
        st = prf(loo_flags(df, "p_stall", "stall_true"), df.stall_true.to_numpy())
        rows.append(dict(cut_h=cut, flag="stall", signal="p_stall", auc=auc(df.p_stall, df.stall_true), **st))
        rows.append(dict(cut_h=cut, flag="out_of_band", signal="next 2 frames outside band", auc=np.nan,
                         **prf(df.oob_flag.to_numpy(), df.off_track.to_numpy())))
        aucs = {s: auc(df[s].fillna(0), df.off_track) for s in ("width_h", "fit_rmse", "ambiguity")}
        best = max(aucs, key=lambda s: -1 if np.isnan(aucs[s]) else aucs[s])
        rows.append(dict(cut_h=cut, flag="measure_again", signal=f"{best} (AUCs: " + ", ".join(f"{k} {v:.2f}" for k, v in aucs.items()) + ")",
                         auc=aucs[best], **prf(loo_flags(df.fillna(0), best, "off_track"), df.off_track.to_numpy())))
        thresholds[f"{cut:g}"] = {"p_stall": float(best_threshold(df.p_stall.to_numpy(), df.stall_true.to_numpy())),
                                  "measure_again_signal": best,
                                  "measure_again": float(best_threshold(df[best].fillna(0).to_numpy(), df.off_track.to_numpy()))}
    R = pd.DataFrame(rows)
    os.makedirs(f"{HERE}/results", exist_ok=True)
    R.to_csv(f"{HERE}/results/flags.csv", index=False)
    json.dump(thresholds, open(f"{HERE}/results/flag_thresholds.json", "w"), indent=1)
    print("WHAD leave-one-wound-out, edge-speed forecasts. Thresholds tuned on the other wounds.")
    for _, r in R.iterrows():
        print(f"  cut {r.cut_h:4g} h  {r.flag:13} n={r.n:2d} true={r.positives:2d} flagged={r.flagged:2d}  "
              f"precision {r.precision:4.2f}  recall {r.recall:4.2f}  AUC {r.auc:4.2f}  [{r.signal}]")
    print("  measure_again: signal chosen on these data, so its AUC is optimistic.")
    # viewer file: stall flags with the deployment threshold (tuned on all WHAD wounds)
    src, dst = f"{SRC}/edge_speed_4h.json", os.path.join(HERE, "..", "web", "data", "forecast_whad_edge_speed_4h.json")
    doc = json.load(open(src)); th = thresholds["4"]["p_stall"]
    for f in doc["forecasts"]:
        if f["p_stall"] is not None and f["p_stall"] >= th:
            f["flags"].append({"type": "stall", "reason": f"{100 * f['p_stall']:.0f}% of plausible futures close less than 10% more "
                               f"(threshold {th:.2f}, tuned leave-one-wound-out on WHAD)."})
    json.dump(doc, open(dst, "w"))
    print(f"  viewer file: {sum(bool(f['flags']) for f in doc['forecasts'])}/{len(doc['forecasts'])} series flagged stall -> {os.path.relpath(dst)}")


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    main()
