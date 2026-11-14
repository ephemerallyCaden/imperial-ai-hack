"""Scorecard figures from eval/forecasts (run eval/score_forecasts.py first for scorecard.csv).

  calibration.png   coverage of the 90% band vs history seen, held-out wounds vs held-out condition, per dataset
  error_vs_history.png  quantile score (CRPS approx.) vs history seen, one line per forecaster, WHAD leave-one-wound-out
  reliability.png   nominal quantile vs fraction of observations below it (calibrated = on the diagonal)
  worst_wounds.png  the 3 hardest WHAD wounds + 1 typical: observed (solid), forecast median (dashed), 90% band
Table view of every number: eval/results/scorecard.csv.
Palette: dataviz reference palette, light mode, validated (scripts/validate_palette.js): slots 1-4 pass; aqua and yellow
are below 3:1 contrast, so every line is direct-labelled.
"""
import glob, json, os
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
FC = f"{HERE}/forecasts"
OUT = f"{HERE}/figures"
SURF, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]
BAND = "#b7d3f6"  # blue ramp step 150
plt.rcParams.update({
    "font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 10, "text.color": INK, "axes.labelcolor": INK2,
    "axes.edgecolor": AXIS, "xtick.color": MUTED, "ytick.color": MUTED, "axes.facecolor": SURF, "figure.facecolor": SURF,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False,
    "lines.linewidth": 1.6, "lines.markersize": 6, "savefig.dpi": 200, "savefig.bbox": "tight"})


def label_end(ax, x, y, text, color, dy=0):
    ax.annotate(text, (x, y), xytext=(6, dy), textcoords="offset points", va="center", fontsize=9, color=INK2)
    ax.plot([x], [y], "o", color=color, ms=6, mec=SURF, mew=1.5, zorder=4)


def calibration(S):
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), sharey=True)
    panels = [("whad", [("loo_all", "held-out wounds (28)"), ("CC_to_C61", "held-out condition: CC to C61")], 19.0, "WHAD MCF10A"),
              ("whimbc", [("loo", "held-out wells (24)"), ("Monolayer_to_Sphere", "held-out condition: ordinary to stem-cell")], 27.0, "WHiM-BC MCF-7")]
    for ax, (ds, splits, span, title) in zip(axes, panels):
        ax.axhline(0.90, color=MUTED, lw=1, ls=(0, (4, 3)), zorder=1)
        if ds == "whimbc":
            ax.text(0.98, 0.885, "target 90%", transform=ax.get_yaxis_transform(), fontsize=8.5, color=MUTED, va="top", ha="right")
        for i, (sp, lab) in enumerate(splits):
            g = S[(S.dataset == ds) & (S.split == sp) & (S.model == "edge_speed")].sort_values("cutoff_h")
            x = g.cutoff_h.to_numpy()
            ax.fill_between(x, g.cov_lo, g.cov_hi, color=SLOTS[i], alpha=0.12, lw=0)
            ax.plot(x, g.coverage, color=SLOTS[i], marker="o", mec=SURF, mew=1.5,
                    label=["held-out wounds / wells", "held-out condition"][i])
            label_end(ax, x[-1], g.coverage.iloc[-1], lab, SLOTS[i], dy=-9 if i else 9)
        ax.set_title(title, loc="left", fontsize=10.5, color=INK, fontweight="bold")
        ax.set_xlabel("history seen before forecasting (hours)")
        ax.set_xlim(0, ax.get_xlim()[1] * 1.9)
    axes[0].legend(frameon=False, fontsize=9, loc="lower left")
    axes[0].set_ylabel("share of future points inside the 90% band")
    axes[0].set_ylim(0, 1.02)
    fig.suptitle("Bands are calibrated on unseen wounds of the same cell type, not across cell types",
                 x=0.06, ha="left", fontsize=11.5, fontweight="bold")
    fig.text(0.06, -0.04, "Forecaster: edge-speed baseline + leave-one-wound-out conformal. Shaded: 95% CI, bootstrap over wounds.",
             fontsize=8.5, color=MUTED)
    fig.savefig(f"{OUT}/calibration.png"); plt.close(fig)


def error_vs_history(S):
    g = S[(S.dataset == "whad") & (S.split == "loo_all")]
    names = {"edge_speed": "edge speed", "linear": "linear", "logistic": "logistic", "gompertz": "Gompertz", "lvcf": "no change (persistence)"}
    fig, ax = plt.subplots(figsize=(7, 4))
    ends = []
    for i, m in enumerate(["edge_speed", "linear", "logistic", "gompertz", "lvcf"]):
        d = g[g.model == m].sort_values("cutoff_h")
        ax.plot(d.cutoff_h, d.qscore, color=SLOTS[i], marker="o", mec=SURF, mew=1.5, label=names[m])
        ends.append((d.qscore.iloc[-1], names[m], SLOTS[i], d.cutoff_h.iloc[-1]))
    ends.sort()
    ys = [e[0] for e in ends]; gap = 0.0042
    for k in range(1, len(ys)):  # push labels apart, upwards, keeping order
        ys[k] = max(ys[k], ys[k - 1] + gap)
    shift = (np.mean([e[0] for e in ends]) - np.mean(ys)) / 2
    for (y, n, c, x), ly in zip(ends, ys):
        ax.annotate(n, (x, y), xytext=(x + 0.35, ly + shift), textcoords="data", va="center", fontsize=9, color=INK2,
                    arrowprops=dict(arrowstyle="-", color=GRID, lw=0.8, shrinkA=0, shrinkB=3))
    ax.set_xlim(0, 13.5); ax.set_ylim(0, None)
    ax.set_xlabel("history seen before forecasting (hours, of a 19 h series)")
    ax.set_ylabel("quantile score (CRPS approx.), lower is better")
    ax.set_title("More history, better forecasts; simple edge-speed is the one to beat", loc="left", fontsize=11.5, fontweight="bold")
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    fig.text(0.125, -0.03, "WHAD MCF10A, leave-one-wound-out, 56 series from 28 wounds.", fontsize=8.5, color=MUTED)
    fig.savefig(f"{OUT}/error_vs_history.png"); plt.close(fig)


def frac_below(path):
    doc = json.load(open(path)); cut = doc["cutoff_hours"]; below = {0.05: [], 0.5: [], 0.95: []}
    for f in doc["forecasts"]:
        t = np.array(f["observed"]["t_hours"]); a = np.array(f["observed"]["area"]); ft = np.array(f["t_hours"])
        m = (t > cut) & (t <= ft[-1])
        for p, k in ((0.05, "area_q05"), (0.5, "area_q50"), (0.95, "area_q95")):
            below[p] += list(a[m] <= np.interp(t[m], ft, f[k]))
    return [np.mean(below[p]) for p in (0.05, 0.5, 0.95)]


def reliability():
    sets = [("whad/loo_all/edge_speed_3.8h.json", "WHAD held-out wounds"),
            ("whad/CC_to_C61/edge_speed_3.8h.json", "WHAD held-out condition"),
            ("whimbc/Monolayer_to_Sphere/edge_speed_6h.json", "WHiM-BC ordinary to stem-cell")]
    fig, ax = plt.subplots(figsize=(4.8, 4.6))
    ax.plot([0, 1], [0, 1], color=MUTED, lw=1, ls=(0, (4, 3)))
    ax.text(0.86, 0.80, "perfectly calibrated", rotation=45, fontsize=8.5, color=MUTED, ha="center", va="top")
    for i, (p, lab) in enumerate(sets):
        y = frac_below(f"{FC}/{p}")
        ax.plot([0.05, 0.5, 0.95], y, color=SLOTS[i], marker="o", mec=SURF, mew=1.5, label=lab)
    ax.legend(frameon=False, fontsize=8.5, loc="lower right")
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_aspect("equal")
    ax.set_xticks([0.05, 0.5, 0.95]); ax.set_xticklabels(["5%", "50%", "95%"])
    ax.set_xlabel("forecast quantile"); ax.set_ylabel("share of observations below it")
    ax.set_title("Quantile reliability", loc="left", fontsize=11.5, fontweight="bold")
    fig.text(0.13, -0.02, "Edge-speed + conformal; WHAD at 3.8 h, WHiM-BC at 6 h of history.", fontsize=8.5, color=MUTED)
    fig.savefig(f"{OUT}/reliability.png"); plt.close(fig)


def worst_wounds():
    path = f"{FC}/whad/loo_all/edge_speed_3.8h.json"
    doc = json.load(open(path)); cut = doc["cutoff_hours"]
    import score_forecasts as sf
    scored = [(sf.score_series(f, cut, doc["p_close_by_T_hours"]) or {}).get("qscore", np.nan) for f in doc["forecasts"]]
    order = np.argsort(scored)[::-1]
    picks = list(order[:3]) + [order[len(order) // 2]]
    titles = ["hardest", "2nd hardest", "3rd hardest", "typical (median)"]
    fig, axes = plt.subplots(1, 4, figsize=(13, 3.4), sharey=True)
    for ax, i, tt in zip(axes, picks, titles):
        f = doc["forecasts"][i]
        ft = np.array(f["t_hours"])
        ax.fill_between(ft, f["area_q05"], f["area_q95"], color=BAND, lw=0, label="90% band")
        ax.plot(ft, f["area_q50"], color=SLOTS[0], ls=(0, (5, 3)), label="forecast (median)")
        ax.plot(f["observed"]["t_hours"], f["observed"]["area"], color=INK, lw=1.6, label="observed")
        ax.axvline(cut, color=MUTED, lw=1)
        ax.text(cut, 1.13, " forecast made here", fontsize=8, color=MUTED, va="top")
        ax.set_title(f"{tt}: {f['wound_id'].replace('_', ' ')}", loc="left", fontsize=9.5, color=INK)
        ax.set_xlabel("hours")
        ax.set_ylim(0, 1.15)
    axes[0].set_ylabel("wound area (1 = start)")
    axes[0].legend(frameon=False, fontsize=8.5, loc="lower left")
    fig.suptitle("Where the forecast fails: wounds that stall or speed up after the cut-off", x=0.06, ha="left",
                 fontsize=11.5, fontweight="bold", y=1.04)
    fig.text(0.06, -0.06, f"WHAD, edge-speed + leave-one-wound-out conformal, {cut:g} h of history. Ranked by quantile score.",
             fontsize=8.5, color=MUTED)
    fig.savefig(f"{OUT}/worst_wounds.png"); plt.close(fig)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    S = pd.read_csv(f"{HERE}/results/scorecard.csv")
    calibration(S); error_vs_history(S); reliability(); worst_wounds()
    print("wrote", sorted(os.path.basename(p) for p in glob.glob(f"{OUT}/*.png")))
