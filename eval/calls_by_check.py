"""When does the stop-early policy make its call? Counts per check for the shipped forecaster (same policy and data as
eval/scheduler.py: P(90% closed by 19 h) <= 0.1 or >= 0.9 at a check -> call and stop; held-out WHAD series).
Usage: python eval/calls_by_check.py -> eval/results/calls_by_check.csv (read by the Ops Overview)."""
import os, sys
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)   # works under python -I too
import scheduler as S  # noqa: E402
MODEL, LO, HI = "nca_realft3", 0.1, 0.9

d = S.simulate(S.load(MODEL), LO, HI)
rows = [{"check_h": c, "called": int(((d.stop_h == c) & d.called).sum()),
         "right": int(((d.stop_h == c) & d.called & (d.correct == True)).sum())} for c in S.CHECKS]  # noqa: E712
rows.append({"check_h": "none", "called": int((~d.called).sum()), "right": ""})
out = pd.DataFrame(rows).assign(model=MODEL, n_series=len(d))
out.to_csv(f"{HERE}/results/calls_by_check.csv", index=False)
print(out.to_string(index=False))
