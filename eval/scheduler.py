"""Scheduler: "can I stop this plate early?" (simulation on held-out WHAD wounds; design.md 7 'plate-hours saved').

Policy (thresholds fixed in advance, not tuned): check at each cut-off (1.9, 3.8, 5.7, 9.5 h). If P(90% closed by 19 h)
>= HI, call "will close"; if <= LO, call "won't close"; either way stop imaging. Otherwise keep imaging; with no call by
9.5 h, image to the end (19 h). Truth: did the wound reach 90% closure by 19 h (WHAD series run 19 h, so always known).
Reports: share of wounds called early, accuracy of early calls, imaging hours saved per wound (vs imaging to 19 h),
and mean 90% band width at each check (how much one more check narrows the band).
Usage: python eval/scheduler.py   -> eval/results/scheduler.csv, eval/results/schedule_widths.csv
"""
import json, os
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f"{HERE}/forecasts/whad/loo_all"
CHECKS = [1.9, 3.8, 5.7, 9.5]
END = 19.0


def load(model):
    rows = {}
    for c in CHECKS:
        doc = json.load(open(f"{SRC}/{model}_{c:g}h.json"))
        for f in doc["forecasts"]:
            a = np.array(f["observed"]["area"]); t = np.array(f["observed"]["t_hours"])
            hit = np.nonzero(a <= 0.1)[0]
            closed = bool(len(hit) and t[hit[0]] <= END)
            w = float(np.mean(np.array(f["area_q95"]) - np.array(f["area_q05"])))
            rows.setdefault(f["wound_id"], {"closed": closed, "wound": f.get("wound", f["wound_id"])})[c] = (f["p_close_by_T"], w)
    return rows


def simulate(rows, lo, hi):
    out = []
    for wid, r in rows.items():
        stop, call = END, None
        for c in CHECKS:
            if c not in r:
                continue
            p = r[c][0]
            if p >= hi or p <= lo:
                stop, call = c, p >= hi
                break
        out.append({"id": wid, "stop_h": stop, "called": call is not None,
                    "correct": (call == r["closed"]) if call is not None else np.nan, "closed": r["closed"]})
    return pd.DataFrame(out)


def main():
    res, widths = [], []
    for model in ("edge_speed", "nca_ensemble"):
        if not os.path.exists(f"{SRC}/{model}_3.8h.json"):
            continue
        rows = load(model)
        for lo, hi in ((0.1, 0.9), (0.2, 0.8)):
            d = simulate(rows, lo, hi)
            called = d[d.called]
            res.append({"model": model, "thresholds": f"<= {lo} or >= {hi}", "n": len(d),
                        "base_rate_not_closed": float(1 - d.closed.mean()),
                        "calls_wont_close": int((called.correct.astype(bool) != called.closed.astype(bool)).sum()),
                        "calls_will_close": int((called.correct.astype(bool) == called.closed.astype(bool)).sum()),
                        "called_early": len(called), "share_called": len(called) / len(d),
                        "accuracy_of_calls": called.correct.mean() if len(called) else np.nan,
                        "wrong_calls": int((called.correct == 0).sum()),
                        "hours_saved_mean": float((END - d.stop_h).mean()),
                        "hours_saved_if_called": float((END - called.stop_h).mean()) if len(called) else 0.0,
                        "median_stop_h_if_called": float(called.stop_h.median()) if len(called) else np.nan})
        for c in CHECKS:
            ws = [r[c][1] for r in rows.values() if c in r]
            widths.append({"model": model, "check_h": c, "mean_band_width": float(np.mean(ws))})
    R, W = pd.DataFrame(res), pd.DataFrame(widths)
    R.to_csv(f"{HERE}/results/scheduler.csv", index=False)
    W.to_csv(f"{HERE}/results/schedule_widths.csv", index=False)
    print("Stop-early simulation, WHAD held-out wounds (leave-one-wound-out), outcome = 90% closed by 19 h")
    for _, r in R.iterrows():
        print(f"  {r.model:12} {r.thresholds:16} called early {r.called_early:2d}/{r.n} ({r.share_called:.0%}), "
              f"right {r.accuracy_of_calls:.0%} ({r.wrong_calls} wrong), median stop {r.median_stop_h_if_called:.1f} h, "
              f"imaging saved {r.hours_saved_mean:.1f} h per wound on average")
    print("  majority guess ('never closes by 19 h') is right "
          f"{R.base_rate_not_closed.iloc[0]:.0%} of the time; calls by direction (won't / will close): "
          + ", ".join(f"{r.model} {r.thresholds}: {r.calls_wont_close}/{r.calls_will_close}" for _, r in R.iterrows()))
    print("Mean 90% band width by check time:")
    for m, g in W.groupby("model"):
        print(f"  {m:12} " + "  ".join(f"{c:g} h: {w:.2f}" for c, w in zip(g.check_h, g.mean_band_width)))


if __name__ == "__main__":
    main()
