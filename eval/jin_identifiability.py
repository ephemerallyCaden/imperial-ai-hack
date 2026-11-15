"""Can migration (D) and proliferation (r) be told apart? Fisher-KPP fits to Jin et al. 2016 PC-3 scratch assays (#19).

Model: u_t = D u_xx + r u (1 - u/K), zero-flux boundaries, K = 1.7e-3 cells/um^2 (Jin et al. 2016), started from the
observed mean profile at t = 0. Evaluated on a log grid of (D, r) for each of the 6 initial densities, scored two ways:
  profiles   squared error of the full density profile at 12, 24, 36, 48 h (38 positions x 4 times)
  closure    squared error of the closure curve only (a wound-area-like summary of the same profiles, 4 numbers)
95% region: SSE <= SSE_min * (1 + p/(n-p) * F_0.95(p, n-p)), p = 2. Reports, per density, the best (D, r), the spread of
each inside the region, and the slope of log D vs log r inside the closure-only region (slope near -1 = only the front
speed c = 2 sqrt(D r) is identified, the design.md warning).
Usage: python eval/jin_identifiability.py  -> eval/results/jin_identifiability.csv, eval/figures/jin_identifiability.png
"""
import os
import numpy as np, pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "data", "processed", "jin_profiles.npz")
K = 1.7e-3
DENS = [10000, 12000, 14000, 16000, 18000, 20000]
LOGD = np.linspace(np.log(50), np.log(5000), 31)      # um^2/h
LOGR = np.linspace(np.log(0.004), np.log(0.2), 31)     # 1/h


def simulate(u0, Ds, rs, times, dx=50.0, dt=0.05):
    """Explicit finite differences for all (D, r) pairs at once. u0 (n,), Ds/rs (m,) -> (m, len(times), n)."""
    u = np.repeat(u0[None, :], len(Ds), 0).astype(np.float64)
    D, r = Ds[:, None], rs[:, None]
    out, t, k = [], 0.0, 0
    for target in times:
        while t < target - 1e-9:
            up = np.pad(u, ((0, 0), (1, 1)), mode="edge")  # zero flux
            u = u + dt * (D * (up[:, 2:] - 2 * u + up[:, :-2]) / dx ** 2 + r * u * (1 - u / K))
            t += dt
        out.append(u.copy())
    return np.stack(out, 1)


def closure(U, u0):
    """Closure-curve summary: mean over the initial gap of (1 - u / density of the intact edges), per time."""
    gap = u0 < 0.25 * np.median(u0[u0 > np.percentile(u0, 60)])
    edge = ~gap
    far = U[..., edge].mean(-1, keepdims=True)
    return np.clip(1 - U[..., gap] / far, 0, 1).mean(-1)


def region(sse, n, p=2):
    return sse <= sse.min() * (1 + p / (n - p) * stats.f.ppf(0.95, p, n - p))


def main():
    z = np.load(SRC)
    GD, GR = np.meshgrid(LOGD, LOGR, indexing="ij")
    Ds, rs = np.exp(GD.ravel()), np.exp(GR.ravel())
    rows, keep = [], {}
    for d in DENS:
        t = z[f"dens_{d}__t"].ravel()
        U = np.stack([z[f"dens_{d}__U{i}"] for i in (1, 2, 3)]).mean(0).T  # (times, x)
        u0, obs = U[0], U[1:]
        sim = simulate(u0, Ds, rs, t[1:])                                   # (m, 4, n)
        sse_p = ((sim - obs[None]) ** 2).sum((1, 2))
        c_obs, c_sim = closure(obs, u0), closure(sim, u0)
        sse_c = ((c_sim - c_obs[None]) ** 2).sum(1)
        for name, sse, n in (("profiles", sse_p, obs.size), ("closure", sse_c, len(c_obs))):
            reg = region(sse, n)
            i = int(sse.argmin())
            lD, lr = np.log(Ds[reg]), np.log(rs[reg])
            slope = np.polyfit(lr, lD, 1)[0] if reg.sum() > 3 and lr.std() > 0 else np.nan
            r2 = 1 - sse_p[i] / ((obs - obs.mean()) ** 2).sum() if name == "profiles" else np.nan
            rows.append({"density": d, "fit": name, "D_best": Ds[i], "r_best": rs[i], "c_best_um_per_h": 2 * np.sqrt(Ds[i] * rs[i]),
                         "D_min": Ds[reg].min(), "D_max": Ds[reg].max(), "r_min": rs[reg].min(), "r_max": rs[reg].max(),
                         "D_fold_range": Ds[reg].max() / Ds[reg].min(), "r_fold_range": rs[reg].max() / rs[reg].min(),
                         "slope_logD_vs_logr": slope, "grid_points_in_region": int(reg.sum()), "profile_R2": r2})
            keep[(d, name)] = (sse.reshape(GD.shape), reg.reshape(GD.shape), i)
    R = pd.DataFrame(rows)
    os.makedirs(f"{HERE}/results", exist_ok=True)
    R.to_csv(f"{HERE}/results/jin_identifiability.csv", index=False)
    print("Fisher-KPP on Jin 2016 PC-3 profiles (K = 1.7e-3 cells/um^2); 95% region over a 31x31 (D, r) grid")
    for _, r in R.iterrows():
        print(f"  {r.density:5d} {r.fit:8}  D {r.D_best:6.0f} um2/h [{r.D_min:5.0f}-{r.D_max:5.0f}, x{r.D_fold_range:5.1f}]  "
              f"r {r.r_best:.3f}/h [{r.r_min:.3f}-{r.r_max:.3f}, x{r.r_fold_range:5.1f}]  c {r.c_best_um_per_h:4.1f} um/h  "
              f"slope {r.slope_logD_vs_logr:5.2f}" + (f"  R2 {r.profile_R2:.2f}" if r.fit == "profiles" else ""))
    figure(keep, GD, GR)


def figure(keep, GD, GR, d=16000):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap
    ramp = ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb", "#fcfcfb"]  # dark = good fit
    cmap = LinearSegmentedColormap.from_list("blue", ramp)
    INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
    plt.rcParams.update({"font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 10, "text.color": INK,
                         "axes.labelcolor": INK2, "xtick.color": MUTED, "ytick.color": MUTED, "figure.facecolor": "#fcfcfb"})
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.4), sharey=True)
    for ax, name, title in zip(axes, ("profiles", "closure"), ("Full density profiles", "Closure curve only")):
        sse, reg, i = keep[(d, name)]
        ax.pcolormesh(np.exp(GR), np.exp(GD), np.log(sse / sse.min()), cmap=cmap, shading="auto", vmax=4)
        ax.contour(np.exp(GR), np.exp(GD), reg.astype(float), levels=[0.5], colors="#eb6834", linewidths=2)
        Db, rb = np.exp(GD.ravel()[i]), np.exp(GR.ravel()[i])
        rr = np.exp(np.linspace(GR.min(), GR.max(), 50))
        ax.plot(rr, Db * rb / rr, color=INK, ls=(0, (4, 3)), lw=1.2)  # constant front speed through the best fit
        ax.plot([rb], [Db], "o", color="#eb6834", mec="#fcfcfb", mew=1.5, ms=8)
        ax.set_xscale("log"); ax.set_yscale("log")
        ax.set_xlim(np.exp(GR.min()), np.exp(GR.max())); ax.set_ylim(np.exp(GD.min()), np.exp(GD.max()))
        ax.set_title(title, loc="left", fontweight="bold")
        ax.set_xlabel("proliferation rate r (1/h)")
    axes[0].set_ylabel("diffusivity D (um^2/h)")
    fig.suptitle("Movement and division separate only when the density profile is used", x=0.06, ha="left",
                 fontsize=12, fontweight="bold", y=1.02)
    fig.text(0.06, -0.06, f"Jin 2016 PC-3, {d} cells/well. Orange: 95% region; dashed: constant front speed c = 2 sqrt(D r) "
             "through the best fit. Darker = better fit.", fontsize=8.5, color=MUTED)
    os.makedirs(f"{HERE}/figures", exist_ok=True)
    fig.savefig(f"{HERE}/figures/jin_identifiability.png", dpi=200, bbox_inches="tight"); plt.close(fig)


if __name__ == "__main__":
    main()
