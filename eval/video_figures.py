"""1920x1080 figures for the video's validation + scorecard segment (eval/figures/video/). Numbers come from the same
forecast files and scorecard as docs/results.md. Palette: dataviz reference (validated); observed solid, forecast dashed.

  1_forecast.png   held-out wound, first 3.8 h observed, forecast median + 90% band (truth hidden)
  2_reveal.png     same, with what actually happened revealed
  3_scorecard.png  quantile score at 3.8 h on unseen wounds, with the pre-set gate line
  4_calibration.png  share of the future inside the 90% band: unseen wounds vs a new cell type
  5_failure.png    the hardest held-out wound
Usage: python eval/video_figures.py   (after eval/score_forecasts.py eval/forecasts)
"""
import json, os
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import score_forecasts as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/figures/video"
WOUND, CUT = "exp1_partII_CC_P2", 3.8
SURF, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
BLUE, ORANGE, AQUA, GREEN, VIOLET, BAND, RED = "#2a78d6", "#eb6834", "#1baf7a", "#008300", "#6250d6", "#b7d3f6", "#d03b3b"
plt.rcParams.update({
    "font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 22, "text.color": INK, "axes.labelcolor": INK2,
    "axes.edgecolor": AXIS, "xtick.color": MUTED, "ytick.color": MUTED, "axes.facecolor": SURF, "figure.facecolor": SURF,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 1, "axes.spines.top": False, "axes.spines.right": False,
    "lines.linewidth": 3.5, "lines.markersize": 12, "axes.titlesize": 30, "axes.labelsize": 22})


def fig(title, sub):
    f = plt.figure(figsize=(19.2, 10.8), dpi=100)
    f.text(0.06, 0.92, title, fontsize=36, fontweight="bold")
    f.text(0.06, 0.875, sub, fontsize=20, color=INK2)
    return f, f.add_axes([0.08, 0.12, 0.86, 0.68])


def wound_panels():
    doc = json.load(open(f"{HERE}/forecasts/whad/loo_all/edge_speed_{CUT:g}h.json"))
    f = next(x for x in doc["forecasts"] if x["wound_id"] == WOUND)
    t, a = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"])
    ft = np.array(f["t_hours"]); lo, med, hi = (np.array(f[k]) for k in ("area_q05", "area_q50", "area_q95"))
    fut = t > CUT
    inside = int(((a[fut] >= np.interp(t[fut], ft, lo)) & (a[fut] <= np.interp(t[fut], ft, hi))).sum())
    for name, reveal in (("1_forecast", False), ("2_reveal", True)):
        title = ("Forecast for a wound the model has never seen" if not reveal
                 else f"What actually happened: inside the band at {inside} of {fut.sum()} later frames")
        F, ax = fig(title, "WHAD MCF10A control wound, forecast made after 3.8 h of a 19 h time-lapse. "
                           "Calibrated on the other 26 wounds only.")
        ax.fill_between(ft, lo, hi, color=BAND, lw=0, label="90% band")
        ax.plot(ft, med, color=BLUE, ls=(0, (6, 3)), label="forecast (median)")
        ax.plot(t[~fut], a[~fut], color=INK, marker="o", mec=SURF, mew=2, label="observed before the forecast")
        if reveal:
            ax.plot(np.r_[t[~fut][-1:], t[fut]], np.r_[a[~fut][-1:], a[fut]], color=ORANGE, zorder=2)
            ax.plot(t[fut], a[fut], color=ORANGE, marker="o", mec=SURF, mew=2, label="what actually happened", zorder=3)
        ax.axvline(CUT, color=MUTED, lw=2)
        ax.text(CUT + 0.15, 1.06, "forecast made here", fontsize=20, color=MUTED)
        ax.set_xlim(0, 19.3); ax.set_ylim(0, 1.12)
        ax.set_xlabel("hours since the scratch"); ax.set_ylabel("wound area (1 = start)")
        ax.legend(frameon=False, loc="upper right", fontsize=20)
        F.savefig(f"{OUT}/{name}.png"); plt.close(F)


def scorecard(S):
    g = S[(S.dataset == "whad") & (S.split == "loo_all") & (S.cutoff_h.round(2) == CUT)].set_index("model")
    rows = [("edge_speed", "Edge speed (2-parameter model)", BLUE), ("nca_realft", "NCA fine-tuned on real frames", VIOLET),
            ("nca_ensemble", "NCA trained on the simulator only", GREEN), ("lvcf", "Typical-wound curve", MUTED)]
    F, ax = fig("Trained on real frames, the NCA passes our pre-set gate",
                "Unseen WHAD wounds (27), forecast after 3.8 h. Quantile score: lower is better. All with the same calibration.")
    best = g.loc["edge_speed", "qscore"]
    ax.axvline(1.1 * best, color=RED, lw=2.5, ls=(0, (6, 3)))
    ax.text(1.1 * best + 0.0006, 3.45, "gate: within 10%\nof the best simple model", fontsize=18, color=RED, va="top")
    for i, (m, lab, c) in enumerate(rows):
        y = len(rows) - 1 - i; r = g.loc[m]
        ax.errorbar(r.qscore, y, xerr=[[r.qscore - r.qscore_lo], [r.qscore_hi - r.qscore]], fmt="o", color=c, ms=18,
                    mec=SURF, mew=3, elinewidth=3, capsize=6)
        ax.text(r.qscore_hi + 0.0012, y, f"{lab}   {r.qscore:.4f}   band holds {r.coverage:.0%}", va="center", fontsize=21, color=INK)
    ax.set_yticks([]); ax.set_ylim(-0.6, len(rows) - 0.4); ax.set_xlim(0, 0.135)
    ax.set_xlabel("quantile score (CRPS approximation), 95% CI over wounds")
    F.savefig(f"{OUT}/3_scorecard.png"); plt.close(F)


def calibration(S):
    rows = [("whad", "loo_all", 3.8, "Unseen wounds, same cells (WHAD MCF10A, 27)"),
            ("whad", "CC_to_C61", 3.8, "Unseen condition: control to CYR61 knockdown"),
            ("whimbc", "loo", 6.0, "Unseen wells, same cells (WHiM-BC MCF-7, 24)"),
            ("whimbc", "Monolayer_to_Sphere", 6.0, "New cell type: ordinary to stem-cell-enriched")]
    F, ax = fig("The 90% band is honest on new wounds, not on new cell types",
                "Share of each wound's future inside its 90% band (target 90%). Best statistical forecaster, ~20% of history seen.")
    ax.axvline(0.9, color=MUTED, lw=2.5, ls=(0, (6, 3)))
    ax.text(0.905, 3.5, "target 90%", fontsize=20, color=MUTED, va="center")
    for i, (ds, sp, cut, lab) in enumerate(rows):
        g = S[(S.dataset == ds) & (S.split == sp) & (S.cutoff_h.round(2) == cut) &
              S.model.isin(["lvcf", "linear", "edge_speed", "logistic", "gompertz"])]
        r = g.loc[g.qscore.idxmin()]; y = len(rows) - 1 - i
        c = RED if r.coverage < 0.8 else BLUE
        ax.errorbar(r.coverage, y, xerr=[[r.coverage - r.cov_lo], [r.cov_hi - r.coverage]], fmt="o", color=c, ms=18,
                    mec=SURF, mew=3, elinewidth=3, capsize=6)
        ax.text(0.02, y + 0.28, f"{lab}: {r.coverage:.0%}", fontsize=21, color=INK)
    ax.set_yticks([]); ax.set_ylim(-0.6, len(rows) - 0.2); ax.set_xlim(0, 1.02)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 0.9, 1]); ax.set_xticklabels(["0%", "25%", "50%", "75%", "90%", "100%"])
    ax.set_xlabel("share of future frames inside the 90% band (95% CI over wounds)")
    F.savefig(f"{OUT}/4_calibration.png"); plt.close(F)


def failure():
    doc = json.load(open(f"{HERE}/forecasts/whad/loo_all/edge_speed_{CUT:g}h.json"))
    scored = [(sf.score_series(f, CUT, 19.0) or {}).get("qscore", -1) for f in doc["forecasts"]]
    f = doc["forecasts"][int(np.argmax(scored))]
    t, a = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"]); ft = np.array(f["t_hours"])
    F, ax = fig("Where it fails: a wound that suddenly speeds up",
                f"Hardest unseen WHAD wound ({f['wound_id'].replace('_', ' ')}): slow for the first hours, then closes far "
                "faster than any forecast from its start.")
    ax.fill_between(ft, f["area_q05"], f["area_q95"], color=BAND, lw=0, label="90% band")
    ax.plot(ft, f["area_q50"], color=BLUE, ls=(0, (6, 3)), label="forecast (median)")
    ax.plot(t[t <= CUT], a[t <= CUT], color=INK, marker="o", mec=SURF, mew=2, label="observed before the forecast")
    ax.plot(t[t >= t[t <= CUT][-1]], a[t >= t[t <= CUT][-1]], color=ORANGE, zorder=2)
    ax.plot(t[t > CUT], a[t > CUT], color=ORANGE, marker="o", mec=SURF, mew=2, label="what actually happened", zorder=3)
    ax.axvline(CUT, color=MUTED, lw=2)
    ax.set_xlim(0, 19.3); ax.set_ylim(0, 1.12)
    ax.set_xlabel("hours since the scratch"); ax.set_ylabel("wound area (1 = start)")
    ax.legend(frameon=False, loc="upper right", fontsize=20)
    F.savefig(f"{OUT}/5_failure.png"); plt.close(F)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    S = pd.read_csv(f"{HERE}/results/scorecard.csv")
    wound_panels(); scorecard(S); calibration(S); failure()
    print("wrote", sorted(os.listdir(OUT)))
