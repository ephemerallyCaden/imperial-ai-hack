"""PROTOTYPE frame strip: frozen vs follow agents + smoothed/outline. Usage: python3 sim/follower_strip.py <position> <Tm_frozen> <bias_frozen> <Tm_follow> <bias_follow> <out.png>"""
import sys, numpy as np, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice
sys.path.insert(0, os.environ.get("SMOOTH_VIEW_DIR", "../imperial-ai-hack-agent4/sim"))  # smooth_view.py lives on feature/p2-agent4
from smooth_view import fine_density, outline
pos, Tm_fz, b_fz, Tm_fo, b_fo, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
occ0 = mask_to_lattice(*load_png_mask(pos, 0), SITE_UM)
runs = {"frozen": simulate(occ0, Params(Tm=Tm_fz, bias=b_fz), 19, frame_dt=0.5, seed=0),
        "follow": simulate(occ0, Params(Tm=Tm_fo, bias=b_fo, follow=True), 19, frame_dt=0.5, seed=0)}
times = (0, 4, 8, 12, 16, 19)
fig, ax = plt.subplots(4, 6, figsize=(18, 10))
for j, x in enumerate(times):
    for r, name in enumerate(("frozen", "follow")):
        d = runs[name]; i = int(np.argmin(abs(d["t_hours"] - x)))
        ax[r, j].imshow(d["occ"][i], cmap="gray", vmin=0, vmax=1, interpolation="nearest", extent=(0, 44, 32, 0))
        ax[r, j].set_title(f"{name} t={x} h  wound {d['wound_frac'][i]:.3f}", fontsize=9)
        if name == "follow" or True:
            f = fine_density(d["occ"][i], 2, 2.5)[0]; lvl, lines = outline(f, float(d["wound_frac"][i]), 2)
            a_ = ax[2 + r, j]; a_.imshow(f, cmap="gray", vmin=0, vmax=1, interpolation="bilinear", extent=(0, 44, 32, 0))
            for ln in lines:
                xy = np.array(ln).reshape(-1, 2); a_.plot(xy[:, 0], xy[:, 1], "r-", lw=1.2)
for a_ in ax.ravel(): a_.set_xticks([]); a_.set_yticks([])
for r, lab in enumerate(("frozen agents", "follow agents", "frozen smoothed+outline", "follow smoothed+outline")): ax[r, 0].set_ylabel(lab)
fig.tight_layout(); fig.savefig(out, dpi=65); print(out)
