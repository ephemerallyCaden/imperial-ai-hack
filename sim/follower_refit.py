"""PROTOTYPE: refit every WHAD wound (16 manual + auto) with the frozen rules vs Params(rule="follow").

  python3 sim/follower_refit.py frozen|follow     -> sim/fits/follower_compare_<mode>.json
  python3 sim/follower_refit.py --table           per-wound + per-group tables from both JSONs
Reuses calibrate.error_cube (cost = wound_frac MSE, mean over seeds) and forecast.load_curves/start_state (auto
wounds start from the synthetic band, fitted on QC-ok frames, as forecast.fit_auto). Overrides are local and reach
the workers via fork: follow mode = Params(rule="follow") + TM_GRID geomspace(0.05, 50, 31) (same log spacing as
calibrate's 21-point grid). Per position and t0 in {4, 10} (frame index, as calibrate): grid fit on frames <= t0 ->
rmse_in, and the same fit's error on frames > t0 -> rmse_out (the forecast error); rmse_full = best fit on all frames.
"""
import functools, json, multiprocessing as mp, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import calibrate as cal, forecast as fc
from cellsim import Params

T0S = (4, 10)
HERE = os.path.dirname(os.path.abspath(__file__))
path = lambda m: os.path.join(HERE, "fits", f"follower_compare_{m}.json")


def setup(mode):
    if mode == "follow":
        cal.Params = fc.Params = functools.partial(Params, rule="follow")
        cal.TM_GRID = np.geomspace(0.05, 50.0, 31)


def cube(args):
    p, c = args
    return cal.error_cube(p, c[c.qc == "ok"], 99, occ0=fc.start_state(c, c.source.iloc[0]))


def metrics(fr, err):
    g = lambda k: dict(Tm=float(cal.TM_GRID[k[0]]), bias=float(cal.BIAS_GRID[k[1]]),
                       at_grid_edge=bool(k[0] in (0, len(cal.TM_GRID) - 1)))
    out = {}
    for t0 in T0S:
        n = int((fr <= t0).sum())
        if n < 2 or n >= len(fr):
            out[str(t0)] = None
            continue
        cin = err[:, :, 1:n].mean(-1)
        k = np.unravel_index(cin.argmin(), cin.shape)
        out[str(t0)] = dict(**g(k), rmse_in=float(np.sqrt(cin[k])), rmse_out=float(np.sqrt(err[k][n:].mean())))
    cf = err[:, :, 1:].mean(-1)
    k = np.unravel_index(cf.argmin(), cf.shape)
    out["full"] = dict(**g(k), rmse=float(np.sqrt(cf[k])))
    return out


def run(mode):
    mp.set_start_method("fork", force=True)
    setup(mode)
    from concurrent.futures import ProcessPoolExecutor
    groups = {p: c for p, c in fc.load_curves().groupby("position")}
    with ProcessPoolExecutor() as ex:
        cubes = list(ex.map(cube, groups.items()))
    res = {}
    for (p, c), (fr, err) in zip(groups.items(), cubes):
        res[p] = dict(source=c.source.iloc[0], part=c.part.iloc[0], condition=c.condition.iloc[0], **metrics(fr, err))
    json.dump(dict(mode=mode, Tm_grid=cal.TM_GRID.tolist(), bias_grid=cal.BIAS_GRID.tolist(), fits=res), open(path(mode), "w"), indent=1)
    print(f"{mode}: {len(res)} positions -> {path(mode)}")


def table():
    fz, fo = (json.load(open(path(m)))["fits"] for m in ("frozen", "follow"))
    print("Manual wounds, t0 = 10 (Tm*, bias, rmse_in, rmse_out) and full-19 h rmse; * = at grid edge")
    for p in sorted(p for p in fz if fz[p]["source"] == "manual"):
        r = lambda f: (f"{f['10']['Tm']:6.2f}{'*' if f['10']['at_grid_edge'] else ' '} {f['10']['bias']:.2f} "
                       f"{f['10']['rmse_in']:.3f} {f['10']['rmse_out']:.3f} | {f['full']['rmse']:.3f}") if f["10"] else "-"
        print(f"  {p:24s} frozen {r(fz[p])}   follow {r(fo[p])}")
    print("Groups: median (mean) rmse_out [rmse_in]; n")
    for src in ("manual", "auto"):
        for part in ("I", "II"):
            ps = [p for p in fz if fz[p]["source"] == src and fz[p]["part"] == part]
            for t0 in ("4", "10"):
                q = [p for p in ps if fz[p][t0] and fo[p][t0]]
                if not q:
                    continue
                s = lambda d, k: f"{np.median([d[p][t0][k] for p in q]):.4f} ({np.mean([d[p][t0][k] for p in q]):.4f})"
                print(f"  {src:6s} part {part:2s} t0 {t0:>2s}: frozen out {s(fz, 'rmse_out')} [in {s(fz, 'rmse_in')}]"
                      f"   follow out {s(fo, 'rmse_out')} [in {s(fo, 'rmse_in')}]   n {len(q)}")
            fl = [fz[p]["full"]["rmse"] for p in ps]; fo_ = [fo[p]["full"]["rmse"] for p in ps]
            if ps:
                print(f"  {src:6s} part {part:2s} full : frozen {np.median(fl):.4f}  follow {np.median(fo_):.4f}  n {len(ps)}")
    edge = [p for p in fo if fo[p]["10"] and fo[p]["10"]["at_grid_edge"]]
    print("follow fits at the grid edge (t0 = 10):", edge)


if __name__ == "__main__":
    table() if sys.argv[1] == "--table" else run(sys.argv[1])
