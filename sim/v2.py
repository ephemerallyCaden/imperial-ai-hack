"""P2 v2 experiments: follower rule + calibration variants, scored with P1's own code (eval/forecast_baselines.py).

  python sim/v2.py fits [--rule follow|frozen]   error cubes (sim/fits/v2_cubes_{rule}.npz) + sim/fits/whad_fits_{rule}.json
  python sim/v2.py gate VARIANT [VARIANT ...]    -> eval/forecasts/whad/{fold}/{VARIANT}{,_raw}_{cut}h.json
  Needs scipy (P1's eval code), e.g. /tmp/p2venv/bin/python. WORKERS processes at most.

Everything follows P1: series = rows with wound_frac <= 0.70, time since the series' first frame, cut-offs 1.9/3.8/5.7/9.5 h,
folds / pools / skips / conformal = eval/forecast_baselines (load, splits, forecast_file, called unchanged).
Fit: grid (Tm x bias) cost = wound_frac MSE on series frames t <= cut (simulated from the series' first frame).
Forecast: start = observed mask (manual) or synthetic band (auto) at the last frame <= cut, rescaled to the observed area there,
50 members, one simulator seed each, to H_SIM h; member median = point forecast for P1's conformal.
Variants (member construction):
  boot      50 bootstrap resamples of the observed frames, each minimised off-grid (as sim_ensemble)
  shrink    empirical-Bayes posterior: own likelihood exp(-n cost / 2 sigma^2) x mixture prior = mean of the normalised
            likelihood surfaces of the fold's pool series of OTHER wounds at the SAME cut (so only data <= cut enters any
            prediction); 50 draws from the grid posterior with uniform jitter inside the cell
  fixbias   bias fixed to the mixture prior's mean bias (same prior set), Tm by bootstrap along that bias column
"""
import sys, os, json, zlib
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "eval"))
import numpy as np

WORKERS = 6
CUTS = [1.9, 3.8, 5.7, 9.5]
GRIDS = {"follow": np.geomspace(0.05, 500.0, 41), "frozen": np.geomspace(0.05, 5.0, 21)}  # same log step (10^0.1)
BIAS = np.linspace(0.25, 0.9, 6)
SEEDS, N_MEM, H_SIM, T_CLOSE, SIGMA = 3, 50, 40.0, 19.0, 0.01  # SIGMA: a-priori per-frame wound_frac noise (shrink)
RULE = {"follow": "follow", "frozen": "free"}  # sim/cellsim.py Params.rule (Agent 4, 3dd4fcf)
VARIANTS = {"sim_follow": ("follow", "boot"), "sim_follow_shrink": ("follow", "shrink"),
            "sim_follow_fixbias": ("follow", "fixbias"), "sim_frozen_shrink": ("frozen", "shrink")}
AUTO_REASON = "sim start state = synthetic vertical band with the observed area (no auto mask on disk)"


def series_rows():
    """P1's series S plus, per series, absolute frames and wound_frac of the same rows, and its source."""
    import forecast_baselines as FB, forecast as F
    S = FB.load("whad")
    cur = F.load_curves()
    cur = cur[cur.wound_frac <= 0.70]
    rows = {}
    for k, s in S.items():
        c = cur[cur.position == k].sort_values("t_hours")
        assert np.allclose(c.t_hours.values - c.t_hours.values[0], s["t"]), k
        rows[k] = (c.frame.values.astype(int), c.wound_frac.values)
    return S, rows


def lattice(k, source, frame_abs, wf_abs):
    from cellsim import SITE_UM
    from start_state import load_png_mask, mask_to_lattice
    import forecast as F
    if source == "manual":
        return mask_to_lattice(*load_png_mask(k, int(frame_abs)), SITE_UM)
    return F.band_start(float(wf_abs), zlib.crc32(k.encode()))


def cube(args):
    """err[i, j, f]: squared error per (Tm, bias, series frame t <= max cut), mean over SEEDS."""
    k, rule, source, t, frames, wf = args
    from cellsim import Params, simulate
    keep = t <= max(CUTS) + 1e-9
    t, wf = t[keep], wf[keep]
    occ0 = lattice(k, source, frames[0], wf[0])
    g = GRIDS[rule]
    err = np.zeros((len(g), len(BIAS), len(t)))
    idx = np.round(t).astype(int)
    for i, Tm in enumerate(g):
        for j, b in enumerate(BIAS):
            for s in range(SEEDS):
                r = simulate(occ0, Params(Tm=Tm, bias=b, rule=RULE[rule]), float(t[-1]), seed=s)
                err[i, j] += (r["wound_frac"][idx] - wf) ** 2 / SEEDS
    return k, err


def _vertex(cm, c0, cp):
    d = cm - 2 * c0 + cp
    return 0.0 if d <= 0 else float(np.clip(0.5 * (cm - cp) / d, -0.5, 0.5))


TIE_TOL = 0.02  # near-ties: cost within 2% of the minimum (flat surfaces, e.g. bias with 2 frames)


def refine(cost, g):
    """Off-grid minimum. Near-ties are broken by the median tied Tm row, then the median tied bias in that row (not the
    first grid index, which piled flat-bias fits onto the 0.25 floor); then a parabolic vertex per axis inside the cell."""
    tied = cost <= cost.min() * (1 + TIE_TOL) + 1e-12
    rows = np.nonzero(tied.any(1))[0]
    i = int(rows[len(rows) // 2])
    cols = np.nonzero(tied[i])[0]
    j = int(cols[len(cols) // 2])
    di = _vertex(cost[i - 1, j], cost[i, j], cost[i + 1, j]) if 0 < i < len(g) - 1 else 0.0
    dj = _vertex(cost[i, j - 1], cost[i, j], cost[i, j + 1]) if 0 < j < len(BIAS) - 1 and cost.shape[1] > 1 else 0.0
    lt = np.log(g)
    return float(np.exp(lt[i] + di * (lt[1] - lt[0]))), float(BIAS[j] + dj * (BIAS[1] - BIAS[0])), i, j


def n_obs(t, cut):
    return int((t <= cut + 1e-9).sum())


def boot_fit(err, n, g, rng):
    """Point fit + N_MEM bootstrap members on frames 0..n-1 (frame 0 = start state)."""
    e = err[:, :, :n]
    Tm, bias, i, j = refine(e[:, :, 1:].mean(-1), g)
    mem = [list(refine(e[:, :, rng.integers(1, n, n - 1)].mean(-1), g)[:2]) for _ in range(N_MEM)]
    return dict(Tm=Tm, bias=bias, rmse=float(np.sqrt(e[i, j, 1:].mean())), n_obs=n,
                at_grid_edge=bool(i in (0, len(g) - 1)), members=mem)


def loglik(err, n):
    """Log-likelihood surface on the grid: -(n - 1) * MSE / (2 SIGMA^2) over frames 1..n-1."""
    return -(n - 1) * err[:, :, 1:n].mean(-1) / (2 * SIGMA ** 2)


def norm_post(lp):
    p = np.exp(lp - lp.max())
    return p / p.sum()


def prior_mix(cubes, S, prior_ids, cut):
    """Mixture prior: mean of the normalised likelihood surfaces of prior_ids at the same cut."""
    ps = [norm_post(loglik(cubes[c], n_obs(S[c]["t"], cut))) for c in prior_ids if n_obs(S[c]["t"], cut) >= 2]
    assert ps, "empty prior"
    return np.mean(ps, 0), len(ps)


def members(kind, k, cut, cubes, S, g, prior_ids, rng):
    n = n_obs(S[k]["t"], cut)
    err = cubes[k]
    if kind == "boot":
        return boot_fit(err, n, g, rng)["members"]
    pri, _ = prior_mix(cubes, S, prior_ids, cut)
    if kind == "shrink":
        post = norm_post(loglik(err, n) + np.log(pri + 1e-300))
        cells = rng.choice(post.size, N_MEM, p=post.ravel())
        i, j = np.unravel_index(cells, post.shape)
        lt, step_t, step_b = np.log(g), np.log(g[1] / g[0]), BIAS[1] - BIAS[0]
        Tm = np.exp(np.clip(lt[i] + rng.uniform(-0.5, 0.5, N_MEM) * step_t, lt[0], lt[-1]))
        b = np.clip(BIAS[j] + rng.uniform(-0.5, 0.5, N_MEM) * step_b, BIAS[0], BIAS[-1])
        return [[float(x), float(y)] for x, y in zip(Tm, b)]
    if kind == "fixbias":
        jb = int(np.argmin(np.abs(BIAS - (pri.sum(0) * BIAS).sum())))
        col = err[:, jb:jb + 1, :n]
        mem = []
        for _ in range(N_MEM):
            Tm, _, _, _ = refine(col[:, :, rng.integers(1, n, n - 1)].mean(-1), g)
            mem.append([Tm, float(BIAS[jb])])
        return mem
    raise ValueError(kind)


def run_ens(args):
    """Simulate one member set from the cut-off start; returns (start time, trajectories)."""
    key, k, source, t, a, frames, wf, cut, mem, rule = args
    from cellsim import Params, simulate
    ic = n_obs(t, cut) - 1
    ts, a0 = float(t[ic]), float(a[ic])
    occ = lattice(k, source, frames[ic], wf[ic])
    tr = []
    for i, (Tm, b) in enumerate(mem):
        r = simulate(occ, Params(Tm=Tm, bias=b, rule=RULE[rule]), H_SIM - ts, seed=1000 + i)
        tr.append(a0 * r["wound_frac"] / r["wound_frac"][0])
    return key, (ts, np.array(tr))


def load_cubes(rule):
    z = np.load(os.path.join(HERE, "fits", f"v2_cubes_{rule}.npz"))
    return {k: z[k] for k in z.files}


def cmd_fits(rule, reuse_cubes=False):
    S, rows = series_rows()
    if reuse_cubes:
        cubes = load_cubes(rule)
    else:
        jobs = [(k, rule, S[k]["source"], S[k]["t"], *rows[k]) for k in sorted(S)]
        with ProcessPoolExecutor(WORKERS) as ex:
            cubes = dict(ex.map(cube, jobs))
        np.savez_compressed(os.path.join(HERE, "fits", f"v2_cubes_{rule}.npz"), **cubes)
    g = GRIDS[rule]
    fits = {}
    for k in sorted(S):
        rng = np.random.default_rng(zlib.crc32(k.encode()))
        fits[k] = {}
        for cut in CUTS:
            n = n_obs(S[k]["t"], cut)
            f = boot_fit(cubes[k], n, g, rng) if n >= 2 else None
            if f:
                f.update(t0=cut, start_frame=int(rows[k][0][0]))
            fits[k][f"{cut:g}"] = f
    out = dict(params=dict(rule=rule, Tm_grid=g.tolist(), bias_grid=BIAS.tolist(), cutoffs=CUTS, seeds=SEEDS, tie_tol=TIE_TOL,
                           n_boot=N_MEM, time="series (hours since the series' first frame), rows wound_frac <= 0.70",
                           note="sim/v2.py; manual + auto positions in one file"), fits=fits, presets={})
    dt = {}  # draw-tool presets: part II medians at cut 9.5 h per condition (display only, never scored)
    for cond in ("CC", "C61"):
        ps = [k for k in fits if S[k]["part"] == "II" and S[k]["cond"] == cond and fits[k].get("9.5")]
        tm, b = [fits[k]["9.5"]["Tm"] for k in ps], [fits[k]["9.5"]["bias"] for k in ps]
        q = lambda v: [float(x) for x in np.quantile(v, [0.25, 0.75])]
        dt[cond] = dict(Tm=float(np.median(tm)), bias=float(np.median(b)), Tm_iqr=q(tm), bias_iqr=q(b), part="II",
                        n=len(ps), n_manual=sum(S[k]["source"] == "manual" for k in ps), rule=RULE[rule])
    dt["label"] = f"simulation, preset parameters (WHAD part II fits, {RULE[rule]} rule)"
    out["presets"]["draw_tool"] = dt
    path = os.path.join(HERE, "fits", f"whad_fits_{rule}.json")
    json.dump(out, open(path, "w"), indent=1)
    tm = np.array([f["Tm"] for v in fits.values() for f in v.values() if f])
    edge = np.mean([f["at_grid_edge"] for v in fits.values() for f in v.values() if f])
    print(f"wrote {os.path.relpath(path)}: {len(fits)} series; fitted Tm {tm.min():.3g}-{tm.max():.3g} h "
          f"(median {np.median(tm):.3g}); at Tm grid edge {edge:.0%}")


def cmd_gate(variants):
    import forecast_baselines as FB
    import forecast as F
    S, rows = series_rows()
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
    splits = FB.splits("whad", S)
    rd = lambda v: [round(float(x), 4) for x in v]
    for model in variants:
        rule, kind = VARIANTS[model]
        cubes, g = load_cubes(rule), GRIDS[rule]
        need = {}  # (fold, k, cut) -> member set; dedupe identical sets across folds
        for split, (test, pool) in splits.items():
            for cut in CUTS:
                for k in sorted(test | pool):
                    t, a = S[k]["t"], S[k]["a"]
                    h = t <= cut + 1e-9
                    if h.sum() < 2 or (~h).sum() == 0 or a[h][-1] <= 0.1:  # P1's prepare() skips these
                        continue
                    prior = [c for c in pool if S[c]["wound"] != S[k]["wound"]]
                    assert set(prior) <= pool and all(S[c]["wound"] != S[k]["wound"] for c in prior)  # both parts excluded
                    if split == "CC_to_C61":
                        assert all(S[c]["cond"] == "CC" for c in prior), "CC_to_C61 prior must be CC (training) only"
                    if split == "loo_manual":
                        assert all(S[c]["source"] == "manual" for c in prior)
                    rng = np.random.default_rng(zlib.crc32(f"{k}|{cut:g}|{split}".encode()))
                    need[(split, k, cut)] = members(kind, k, cut, cubes, S, g, prior, rng)
        uniq = {}
        for (split, k, cut), mem in need.items():
            uniq.setdefault((k, cut, json.dumps(np.round(mem, 6).tolist())), mem)
        jobs = [(key, key[0], S[key[0]]["source"], S[key[0]]["t"], S[key[0]]["a"], *rows[key[0]], key[1], mem, rule)
                for key, mem in uniq.items()]
        with ProcessPoolExecutor(WORKERS) as ex:
            sims = dict(ex.map(run_ens, jobs))
        print(f"{model}: {len(need)} (fold, series, cut) member sets, {len(sims)} simulated", flush=True)
        for split, (test, pool) in splits.items():
            pred = {}
            for (sp, k, cut), mem in need.items():
                if sp != split:
                    continue
                ts, tr = sims[(k, cut, json.dumps(np.round(mem, 6).tolist()))]
                h = S[k]["t"] <= cut + 1e-9
                pred[S[k]["t"][h].tobytes() + S[k]["a"][h].tobytes()] = (ts, tr)

            def point(t_h, a_h, grid, pred=pred):
                ts, tr = pred[np.asarray(t_h, float).tobytes() + np.asarray(a_h, float).tobytes()]
                return np.interp(grid, ts + np.arange(tr.shape[1]), np.median(tr, 0))

            FB.BASELINES[model] = point
            for cut in CUTS:
                G = G_all[G_all > cut + 1e-9]
                G_long = np.arange(G[0], 20 * G_all[-1], 0.25)
                doc = FB.forecast_file("whad", split, model, cut, S, test, pool, G, G_long, T_CLOSE)
                doc["notes"] = (f"P2 v2 {model} (sim/v2.py: rule={rule}, members={kind}), member median calibrated with P1's "
                                "leave-one-wound-out conformal (eval/forecast_baselines.forecast_file); start = cut-off mask")
                raw = dict(doc, model=model + "_raw", forecasts=[], notes=f"raw {model} ensemble, no calibration (sim/v2.py)")
                for fc in doc["forecasts"]:
                    k = fc["wound_id"]
                    if S[k]["source"] != "manual":
                        fc["segmentation_quality"]["reasons"] = [AUTO_REASON]
                    t, a = S[k]["t"], S[k]["a"]
                    h = t <= cut + 1e-9
                    ts, tr = pred[t[h].tobytes() + a[h].tobytes()]
                    grid = np.array(fc["t_hours"])
                    A = np.array([np.interp(grid, ts + np.arange(tr.shape[1]), m) for m in tr])
                    mts = np.concatenate([[ts], grid]); mas = [np.concatenate([[a[h][-1]], m]) for m in A]
                    t50, _ = F.event(t[h], a[h], mts, mas, 0.5)
                    t90, t90s = F.event(t[h], a[h], mts, mas, 0.1)
                    q = np.quantile(A, [0.05, 0.5, 0.95], axis=0)
                    raw["forecasts"].append(dict(fc, area_q05=rd(q[0]), area_q50=rd(q[1]), area_q95=rd(q[2]), t50=t50,
                                                 t90=t90, p_close_by_T=round(float(np.mean(t90s <= T_CLOSE)), 3),
                                                 members=[rd(m) for m in A[:5]]))
                d = os.path.join(HERE, "..", "eval", "forecasts", "whad", split)
                os.makedirs(d, exist_ok=True)
                for m, x in ((model, doc), (model + "_raw", raw)):
                    json.dump(x, open(os.path.join(d, f"{m}_{cut:g}h.json"), "w"))
        print(f"{model}: gate files written", flush=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "fits":
        cmd_fits(a[a.index("--rule") + 1] if "--rule" in a else "follow", reuse_cubes="--reuse-cubes" in a)
    elif a[0] == "gate":
        cmd_gate(a[1:])
