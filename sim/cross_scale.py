"""Cross-scale check (P2-12, #31): lattice front speed vs the Fisher-KPP speed c = 2 sqrt(D r), division on.

Continuum limit of sim/cellsim.py ("free" rule, bias 0, dens_exp 0), derived from the code:
  D = 0.375 a^2 / Tm   a = SITE_UM. A move goes to a uniform empty Moore neighbour; at low density all 8 are empty, and the
                       x-step is -1/0/+1 with prob 3/8, 2/8, 3/8, so var_x = 0.75 a^2 per move, D = var_x / (2 Tm).
  r = 1 / Td           a division attempt fires with prob dt/Td per step (independent of the move draw), so at the
                       leading edge (empty neighbours) N grows at rate 1/Td. Fisher fronts are pulled, so only these
                       low-density rates enter c = 2 sqrt(D r).
Runs: a half-plane sheet (left reservoir band refilled) invading an empty strip, H = 40 rows. Front x = rightmost column
whose row-mean occupancy (3-column running mean) is >= 0.5. Speed = least-squares slope over the second half of the run.
Main series: bias 0, dens_exp 0 (the regime the formula is for). Second series at Td = 20 h: the shipped rule settings
(bias 7/9, dens_exp 0.5), still predicted with the bias-free D, to show how far they sit from Fisher.
Jin et al. 2016 (PC-3, division on): observed front speed from data/processed/jin_profiles.npz (optional; build with
data/build_curves.py), the 50% crossing of each side's t=0 plateau, slope while the gap is open; predicted c from the
profile fits in eval/results/jin_identifiability.csv. Same data both ways, so this is a consistency check, not a test.
Usage: python -I sim/cross_scale.py  -> eval/results/cross_scale_front_speed.csv, eval/figures/cross_scale_front_speed.png
"""
import os, sys, time
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from cellsim import Params, SITE_UM, simulate  # noqa: E402

H, X0 = 40, 30          # rows; initial sheet occupies columns [0, X0)
TMS = [0.1, 0.3, 1.0, 3.0]
TDS = [10.0, 20.0, 40.0]
SEEDS = [0, 1, 2]
JIN_SRC = f"{ROOT}/data/processed/jin_profiles.npz"
JIN_FIT = f"{ROOT}/eval/results/jin_identifiability.csv"


def predicted(Tm, Td):
    D = 0.375 * SITE_UM ** 2 / Tm
    r = 1.0 / Td
    return D, r, 2 * np.sqrt(D * r)


def front_x(occ):
    """(F,H,W) -> (F,) front position in sites: rightmost column with smoothed row-mean occupancy >= 0.5."""
    u = occ.mean(1)
    k = np.ones(3) / 3
    u = np.stack([np.convolve(f, k, mode="same") for f in u])
    above = u >= 0.5
    return np.where(above.any(1), above.shape[1] - 1 - np.argmax(above[:, ::-1], 1), 0).astype(float)


def run(Tm, Td, bias, dens_exp, seed):
    c_sites = predicted(Tm, Td)[2] / SITE_UM
    hours = 8 * Td
    W = X0 + int((1.5 if bias == 0 else 5) * c_sites * hours) + 40  # wound bias adds drift
    occ0 = np.zeros((H, W), np.uint8)
    occ0[:, :X0] = 1
    p = Params(Tm=Tm, Td=Td, bias=bias, dens_exp=dens_exp, rule="free")
    r = simulate(occ0, p, hours, frame_dt=1.0, seed=seed)
    x, t = front_x(r["occ"]), r["t_hours"]
    late = t >= hours / 2
    slope = np.polyfit(t[late], x[late], 1)[0] * SITE_UM
    assert x[-1] < W - 10, "front reached the far edge"
    return slope


def single_cell_D(Tm=0.5, hours=20, n=40, L=101):
    """Check of the D derivation: MSD of one isolated cell (no division) = 4 D t. Returns measured D in um^2/h."""
    sq = []
    for s in range(n):
        occ0 = np.zeros((L, L), np.uint8)
        occ0[L // 2, L // 2] = 1
        r = simulate(occ0, Params(Tm=Tm, Td=None, bias=0.0, dens_exp=0.0, rule="free"), hours, frame_dt=hours, seed=s)
        y, x = np.argwhere(r["occ"][-1])[0]
        sq.append((y - L // 2) ** 2 + (x - L // 2) ** 2)
    return np.mean(sq) * SITE_UM ** 2 / (4 * hours), np.std(sq) / np.sqrt(n) * SITE_UM ** 2 / (4 * hours)


def jin_observed():
    """Per density: mean front speed (um/h) over both sides and replicates, from the 50%-of-plateau crossing."""
    if not os.path.exists(JIN_SRC):
        return {}
    z = np.load(JIN_SRC)
    out = {}
    for d in [10000, 12000, 14000, 16000, 18000, 20000]:
        x, t = z[f"dens_{d}__x"].ravel(), z[f"dens_{d}__t"].ravel()
        dx = x[1] - x[0]
        speeds = []
        for i in (1, 2, 3):
            U = z[f"dens_{d}__U{i}"].T  # (times, x)
            for side in (0, 1):
                V = U if side == 0 else U[:, ::-1]
                thr = 0.5 * V[0, :5].mean()
                # front = first position from the outside where the profile drops below the threshold
                pos = np.array([x[0] + dx * np.argmax(v < thr) if (v < thr).any() else np.nan for v in V])
                gap = np.array([(v < thr).any() for v in V])
                # times while the gap is open and this side's front (measured from its own edge) is short of the middle
                ok = gap & (pos < x[len(x) // 2])
                if ok.sum() >= 2:
                    speeds.append(np.polyfit(t[ok], pos[ok], 1)[0])
        out[d] = (float(np.mean(speeds)), float(np.std(speeds)), len(speeds))
    return out


def main():
    t0 = time.time()
    rows = []
    Dm, Dse = single_cell_D()
    Dp = predicted(0.5, 1.0)[0]
    print(f"single-cell check (Tm 0.5 h, 40 cells, 20 h): D measured {Dm:.0f} +- {Dse:.0f} (s.e.), predicted {Dp:.0f} um^2/h")
    rows.append(dict(source="sim", series="single_cell_D", label="MSD/4t, Tm=0.5", Tm_h=0.5, bias=0.0, dens_exp=0.0,
                     D_um2_per_h=Dp, D_meas_um2_per_h=Dm, D_meas_se=Dse, n=40, ratio=Dm / Dp))
    jobs = [(Tm, Td, 0.0, 0.0, "fisher") for Tm in TMS for Td in TDS] + [(Tm, 20.0, 7 / 9, 0.5, "shipped") for Tm in TMS]
    for Tm, Td, bias, de, series in jobs:
        D, r, c = predicted(Tm, Td)
        sp = [run(Tm, Td, bias, de, s) for s in SEEDS]
        rows.append(dict(source="sim", series=series, label=f"Tm={Tm:g} Td={Td:g}", Tm_h=Tm, Td_h=Td, bias=bias,
                         dens_exp=de, D_um2_per_h=D, r_per_h=r, front_width_sites=np.sqrt(D / r) / SITE_UM,
                         c_pred_um_per_h=c, c_meas_um_per_h=np.mean(sp), c_meas_sd=np.std(sp), n=len(sp),
                         ratio=np.mean(sp) / c))
        print(f"{series:8s} Tm {Tm:4g} Td {Td:4g}: pred {c:6.2f}  meas {np.mean(sp):6.2f} um/h  ratio {rows[-1]['ratio']:.2f}",
              flush=True)
    jo = jin_observed()
    if jo and os.path.exists(JIN_FIT):
        fit = pd.read_csv(JIN_FIT)
        for _, f in fit[fit.fit == "profiles"].iterrows():
            m, sd, n = jo[int(f.density)]
            c = 2 * np.sqrt(f.D_best * f.r_best)
            rows.append(dict(source="jin2016", series="jin", label=f"{int(f.density)} cells/well", D_um2_per_h=f.D_best,
                             r_per_h=f.r_best, front_width_sites=np.sqrt(f.D_best / f.r_best) / SITE_UM,
                             c_pred_um_per_h=c, c_meas_um_per_h=m, c_meas_sd=sd, n=n, ratio=m / c))
            print(f"jin {int(f.density)}: pred {c:6.2f}  meas {m:6.2f} +- {sd:.2f} um/h (n {n})  ratio {m / c:.2f}")
    else:
        print("jin: data/processed/jin_profiles.npz not found, sim only")
    df = pd.DataFrame(rows)
    os.makedirs(f"{ROOT}/eval/results", exist_ok=True)
    df.to_csv(f"{ROOT}/eval/results/cross_scale_front_speed.csv", index=False, float_format="%.4g")
    plot(df)
    print(f"done in {time.time() - t0:.0f}s")


def plot(df):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    SURF, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
    SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]
    plt.rcParams.update({
        "font.family": ["DejaVu Sans"], "font.size": 10, "text.color": INK, "axes.labelcolor": INK2,
        "axes.edgecolor": AXIS, "xtick.color": MUTED, "ytick.color": MUTED, "axes.facecolor": SURF,
        "figure.facecolor": SURF, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
        "axes.spines.top": False, "axes.spines.right": False, "savefig.dpi": 200, "savefig.bbox": "tight"})
    df = df[df.series.isin(["fisher", "shipped", "jin"])]
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(11, 4.8), gridspec_kw=dict(width_ratios=[1.15, 1]))
    hi = 1.15 * max(df.c_pred_um_per_h.max(), df.c_meas_um_per_h.max())
    lo = 0.85 * min(df.c_pred_um_per_h.min(), df.c_meas_um_per_h.min())
    ax.plot([lo, hi], [lo, hi], color=MUTED, lw=1, ls="--")
    ax.text(hi, hi, "measured = 2 sqrt(D r) ", color=MUTED, ha="right", va="top", fontsize=8)
    names = {"fisher": "sim, bias 0, dens_exp 0", "shipped": "sim, shipped rules (bias 7/9, dens_exp 0.5), Td 20 h",
             "jin": "Jin 2016 PC-3 (D, r from profile fit; +-1 sd)"}
    marks = {"fisher": "o", "shipped": "s", "jin": "D"}
    for i, (s, g) in enumerate(df.groupby("series", sort=False)):
        ax.errorbar(g.c_pred_um_per_h, g.c_meas_um_per_h, yerr=g.c_meas_sd, fmt=marks[s], color=SLOTS[i], ms=6,
                    capsize=2, lw=1, label=names[s])
        bx.plot(g.front_width_sites, g.ratio, marks[s], color=SLOTS[i], ms=6)
    ticks = [t for t in (2, 3, 5, 10, 20, 30, 50) if lo <= t <= hi]
    ax.set_xscale("log"); ax.set_yscale("log")
    ax.set_xlim(lo, hi); ax.set_ylim(lo, hi)
    ax.set_xticks(ticks, [str(t) for t in ticks]); ax.set_yticks(ticks, [str(t) for t in ticks])
    ax.minorticks_off()
    ax.set_xlabel("predicted Fisher-KPP speed 2 sqrt(D r)  (um/h)")
    ax.set_ylabel("measured front speed  (um/h)")
    ax.set_title("Front speed vs 2 sqrt(D r)", loc="left", fontsize=11)
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    bx.axhline(1, color=MUTED, lw=1, ls="--")
    bx.set_xscale("log")
    bx.set_xticks([1, 2, 5, 10], ["1", "2", "5", "10"]); bx.minorticks_off()
    bx.set_xlabel("front width sqrt(D / r)  (lattice sites of 20 um)")
    bx.set_ylabel("measured / predicted speed")
    bx.set_title("Ratio vs front width (continuum limit = wide fronts)", loc="left", fontsize=11)
    os.makedirs(f"{ROOT}/eval/figures", exist_ok=True)
    fig.savefig(f"{ROOT}/eval/figures/cross_scale_front_speed.png")


if __name__ == "__main__":
    main()
