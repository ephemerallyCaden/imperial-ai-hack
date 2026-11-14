"""Python side of sim/js/parity.mjs: mean/sd wound_frac at 4/12/24 h on cellsim.straight_scratch over n seeds.
python3 sim/js/parity_ref.py [Tm] [seeds] [free|follow]   (run from the repo root)"""
import sys, time
sys.path.insert(0, "sim")
import numpy as np, cellsim as c
Tm = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
rule = sys.argv[3] if len(sys.argv) > 3 else "free"
t = time.time()
r = np.array([c.simulate(c.straight_scratch(), c.Params(Tm=Tm, rule="follow" if rule == "follow" else "free"), 24, seed=s)["wound_frac"][[4, 12, 24]]
              for s in range(n)])
print(f"PY  {rule} Tm={Tm} n={n} @4/12/24h:", " ".join(f"{m:.4f}±{d:.4f}" for m, d in zip(r.mean(0), r.std(0, ddof=1))),
      f"({(time.time() - t) / n * 1000:.0f} ms/run)")
