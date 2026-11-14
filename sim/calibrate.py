"""Fit Tm and bias per wound from frames up to t0 (#23). Division is off (WHAD, mitomycin).

Per position: grid over (Tm, bias); cost = mean squared error of simulated vs observed wound_frac on the observed
frames up to t0 (mean over seeds); start state = first annotated frame's mask. One simulated trajectory per grid
point serves every cut-off (the start state does not depend on t0). Bootstrap over observed frames gives a spread of
(Tm, bias) members. Presets = median fit per condition over a fold's TRAINING positions only.

  python3 sim/calibrate.py <position> [t0]   one fit + curve printout
  python3 sim/calibrate.py --all             all positions x cut-offs -> sim/fits/whad_fits.json + range check
  python3 sim/calibrate.py --draw-presets    add draw-tool presets to an existing whad_fits.json
"""
import sys, os, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice

HERE = os.path.dirname(os.path.abspath(__file__))
CURVES = os.path.join(HERE, "..", "data", "processed", "whad_curves.csv")
OUT = os.path.join(HERE, "fits", "whad_fits.json")
TM_GRID = np.geomspace(0.05, 5.0, 21)  # floor = dt; uniform in log Tm (refine() relies on it)
BIAS_GRID = np.linspace(0.25, 0.9, 6)  # uniform (refine() relies on it)
CUTOFFS = [2, 4, 6, 10]  # t0 frame = 10/20/30/50% of 20 hourly frames, same for every position (team-plan P1-5)
SEEDS, N_BOOT = 3, 50
FOLDS = {  # name: (train filter, test filter) on (part, condition); fold A dropped in R15 (part II = same wounds)
    "B_CC_to_C61": (lambda p, c: c == "CC", lambda p, c: c == "C61"),
}


def curve(df, position):
    c = df[df.position == position].sort_values("frame")
    return c.frame.values.astype(int), c.wound_frac.values


def error_cube(position, df, t_max, occ0=None):
    """Squared error per (Tm, bias, observed frame <= t_max), mean over seeds. occ0: start lattice at the first
    frame in df (default: that frame's manual mask)."""
    fr, wf = curve(df, position)
    keep = fr <= t_max
    fr, wf = fr[keep], wf[keep]
    if occ0 is None:
        occ0 = mask_to_lattice(*load_png_mask(position, int(fr[0])), SITE_UM)
    err = np.zeros((len(TM_GRID), len(BIAS_GRID), len(fr)))
    for i, Tm in enumerate(TM_GRID):
        for j, b in enumerate(BIAS_GRID):
            for s in range(SEEDS):
                r = simulate(occ0, Params(Tm=Tm, bias=b), fr[-1] - fr[0], seed=s)
                err[i, j] += (r["wound_frac"][fr - fr[0]] - wf) ** 2 / SEEDS
    return fr, err


def _vertex(cm, c0, cp):
    """Offset (in grid steps, within +-0.5) of the parabola vertex through three neighbouring costs; 0 if not convex."""
    d = cm - 2 * c0 + cp
    return 0.0 if d <= 0 else float(np.clip(0.5 * (cm - cp) / d, -0.5, 0.5))


def refine(cost):
    """Off-grid minimum of a (Tm, bias) cost grid: grid argmin, then a parabolic vertex along each axis (log Tm, bias),
    kept inside the argmin's cell. Returns (Tm, bias, i, j)."""
    i, j = np.unravel_index(cost.argmin(), cost.shape)
    di = _vertex(cost[i - 1, j], cost[i, j], cost[i + 1, j]) if 0 < i < len(TM_GRID) - 1 else 0.0
    dj = _vertex(cost[i, j - 1], cost[i, j], cost[i, j + 1]) if 0 < j < len(BIAS_GRID) - 1 else 0.0
    lt = np.log(TM_GRID)
    return float(np.exp(lt[i] + di * (lt[1] - lt[0]))), float(BIAS_GRID[j] + dj * (BIAS_GRID[1] - BIAS_GRID[0])), i, j


def fit_from_cube(fr, err, t0, rng):
    """Fit on frames <= t0 only. Members = N_BOOT bootstrap resamples of the observed frames, each minimised off-grid."""
    n = int((fr <= t0).sum())
    if n < 2:
        return None
    e = err[:, :, :n]
    cost = e[:, :, 1:].mean(-1)  # frame 0 is the start state (error ~0)
    Tm, bias, i, j = refine(cost)
    members = []
    for _ in range(N_BOOT):
        bt, bb, _, _ = refine(e[:, :, rng.integers(1, n, n - 1)].mean(-1))
        members.append([bt, bb])
    return dict(t0=t0, start_frame=int(fr[0]), n_obs=n, Tm=Tm, bias=bias,
                rmse=float(np.sqrt(cost[i, j])), at_grid_edge=bool(i in (0, len(TM_GRID) - 1)), members=members)


def presets(fits, meta, train, t0, test=None):
    """Median (Tm, bias) per condition over training positions at cut-off t0 (asserts none is a test position)."""
    out = {}
    assert test is None or not any(train(*meta[p]) and test(*meta[p]) for p in meta), "train/test overlap"
    for cond in ("CC", "C61"):
        f = [fits[p][str(t0)] for p in fits if train(*meta[p]) and meta[p][1] == cond and fits[p].get(str(t0))]
        if f:
            out[cond] = dict(Tm=float(np.median([x["Tm"] for x in f])), bias=float(np.median([x["bias"] for x in f])), n=len(f))
    return out


def range_check(df, meta, train, preset, seeds=3, tol=0.0):
    """Fraction of frames where the preset's simulated area_norm lies inside the training wounds' observed
    [min, max] area_norm at that frame (simulated from each training wound's own start mask)."""
    tr = [p for p in meta if train(*meta[p]) and meta[p][1] in preset]
    obs = df[df.position.isin(tr)].pivot_table(index="frame", columns="position", values="area_norm")
    lo, hi = obs.min(1), obs.max(1)
    inside = total = 0
    for p in tr:
        fr, wf = curve(df, p)
        occ0 = mask_to_lattice(*load_png_mask(p, int(fr[0])), SITE_UM)
        pr = preset[meta[p][1]]
        for s in range(seeds):
            r = simulate(occ0, Params(Tm=pr["Tm"], bias=pr["bias"]), fr[-1] - fr[0], seed=100 + s)
            a = r["wound_frac"] / r["wound_frac"][0]
            frames = fr[0] + np.arange(len(a))
            ok = (a >= lo.loc[frames].values - tol) & (a <= hi.loc[frames].values + tol)
            inside += ok.sum(); total += len(ok)
    return inside / total


def add_draw_presets(out, meta, t0=10):
    """Draw-tool presets: median over ALL positions per condition at t0=10. Display only (label "simulation, preset
    parameters"); never used for held-out scoring, because they include every test wound."""
    pr = presets(out["fits"], meta, lambda p, c: True, t0)
    pr["note"] = "all positions, t0=10; draw tool only, not for scoring"
    out["presets"]["draw_tool"] = pr
    print("draw_tool", pr)


def _fit_position(args):
    p, df = args
    fr, err = error_cube(p, df, max(CUTOFFS))
    rng = np.random.default_rng(zlib.crc32(p.encode()))  # per position: independent of run order
    return p, {str(t0): fit_from_cube(fr, err, t0, rng) for t0 in CUTOFFS}


def run_all():
    from concurrent.futures import ProcessPoolExecutor
    df = pd.read_csv(CURVES)
    meta = df.drop_duplicates("position").set_index("position")[["part", "condition"]].apply(tuple, axis=1).to_dict()
    with ProcessPoolExecutor() as ex:
        fits = dict(ex.map(_fit_position, [(p, df) for p in sorted(meta)]))
    for p, fp in fits.items():
        print(p, {t0: (round(f["Tm"], 3), round(f["bias"], 2)) if f else None for t0, f in fp.items()}, flush=True)
    out = dict(params=dict(site_um=SITE_UM, seeds=SEEDS, n_boot=N_BOOT, dt=Params().dt, dens_exp=Params().dens_exp,
                           Tm_grid=TM_GRID.tolist(), bias_grid=BIAS_GRID.tolist(), cutoffs=CUTOFFS),
               fits=fits, presets={})
    for name, (train, test) in FOLDS.items():
        out["presets"][name] = {}
        for t0 in CUTOFFS:
            pr = presets(fits, meta, train, t0, test)
            pr["in_range_frac"] = float(range_check(df, meta, train, pr))
            out["presets"][name][str(t0)] = pr
            print(name, f"t0={t0}", pr, flush=True)
    add_draw_presets(out, meta)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--all"]:
        run_all()
    elif sys.argv[1:2] == ["--draw-presets"]:  # add draw-tool presets to an existing whad_fits.json without refitting
        df = pd.read_csv(CURVES)
        meta = df.drop_duplicates("position").set_index("position")[["part", "condition"]].apply(tuple, axis=1).to_dict()
        out = json.load(open(OUT))
        add_draw_presets(out, meta)
        json.dump(out, open(OUT, "w"), indent=1)
    else:
        df = pd.read_csv(CURVES)
        pos = sys.argv[1] if len(sys.argv) > 1 else "exp1_partII_C61_P1"
        t0 = int(sys.argv[2]) if len(sys.argv) > 2 else 6
        fr, err = error_cube(pos, df, t0)
        f = fit_from_cube(fr, err, t0, np.random.default_rng(0))
        m = np.array(f["members"])
        print(pos, f"t0={t0} Tm={f['Tm']:.3f} bias={f['bias']:.2f} rmse={f['rmse']:.4f} edge={f['at_grid_edge']}",
              "boot Tm q05/q50/q95:", np.round(np.quantile(m[:, 0], [.05, .5, .95]), 3))
        fr_all, wf = curve(df, pos)
        r = simulate(mask_to_lattice(*load_png_mask(pos, int(fr_all[0])), SITE_UM), Params(Tm=f["Tm"], bias=f["bias"]), fr_all[-1] - fr_all[0])
        print("obs", np.round(wf[::3], 3))
        print("sim", np.round(r["wound_frac"][fr_all - fr_all[0]][::3], 3))
