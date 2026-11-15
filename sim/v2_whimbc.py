"""P2 v2 EXTERNAL check on WHiM-BC (never used for any choice). Everything frozen from sim/v2.py at a611525.

  python sim/v2_whimbc.py cubes                 -> sim/fits/v2_whimbc_cubes_{follow,frozen}.npz
  python sim/v2_whimbc.py gate [MODEL ...]      -> eval/forecasts/whimbc/{split}/{model}{,_raw}_{cut}h.json
  Needs scipy (P1's eval code), e.g. /tmp/p2venv/bin/python. Run under nice; WORKERS processes at most.

P1's pipeline unchanged: eval/forecast_baselines load("whimbc"), splits() (loo, Monolayer_to_Sphere), prepare() skips,
forecast_file() conformal; cut-offs 3/6/9 h and T = 24 h as P1's main(). sim/v2.py functions reused unchanged:
cube (fit cost, frames <= max cut), boot_fit / refine (TIE_TOL), members (shrink: SIGMA, prior_mix over the fold's pool
minus the test well), run_ens (start at the last frame <= cut, rescaled to the observed area there, 50 members, H_SIM).
Grids, bias grid, seeds, SIGMA, TIE_TOL, H_SIM: v2's module constants, untouched.
Models: sim_ensemble = (free rule, bootstrap members) [WHAD's sim_ensemble analogue], sim_follow = (follow, bootstrap),
sim_frozen_shrink = (free, shrink), sim_follow_shrink = (follow, shrink).
"""
import sys, os, json, zlib
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "eval"))
import numpy as np
import v2

WORKERS = 4
CUTS, T_CLOSE = [3.0, 6.0, 9.0], 24.0  # P1's main() for whimbc
MODELS = {"sim_ensemble": ("frozen", "boot"), "sim_follow": ("follow", "boot"),
          "sim_frozen_shrink": ("frozen", "shrink"), "sim_follow_shrink": ("follow", "shrink")}
SOURCE = "band"  # v2.lattice: any source other than "manual" -> forecast.band_start(observed wound_frac, crc32(id))
CAVEATS = ("(1) pixel scale unknown; synthetic band start on the WHAD 32x44 lattice; absolute Tm not comparable with WHAD. "
           "(2) free-rule rows (sim_ensemble, sim_frozen_shrink) transfer less cleanly (their shape depends on field size "
           "in sites). (3) settings frozen from a611525 (sim/v2.py), no WHiM-BC tuning.")
REASON = ("WHiM-BC: no masks or pixel scale on disk; sim start = synthetic vertical band with the observed wound/image "
          "fraction on the WHAD 32x44 lattice")
cube_path = lambda rule: os.path.join(HERE, "fits", f"v2_whimbc_cubes_{rule}.npz")


def series_rows():
    """P1's WHiM-BC series S, plus per series the absolute frames and wound/image fraction of the same rows."""
    import forecast_baselines as FB, pandas as pd
    S = FB.load("whimbc")
    cur = pd.read_csv(os.path.join(HERE, "..", "data", "processed", "whimbc_curves.csv"))
    rows = {}
    for k, s in S.items():
        c = cur[cur.wound == k].sort_values("t_hours")
        assert np.allclose(c.t_hours.values - c.t_hours.values[0], s["t"]), k
        assert np.allclose(c.wound_frac.values / c.wound_frac.values[0], s["a"]), k
        rows[k] = (c.frame.values.astype(int), c.wound_frac.values)
    return S, rows


def cmd_cubes():
    assert max(CUTS) <= max(v2.CUTS)  # v2.cube keeps frames t <= max(v2.CUTS) = 9.5 h, which covers 9 h
    S, rows = series_rows()
    for rule in ("follow", "frozen"):
        jobs = [(k, rule, SOURCE, S[k]["t"], *rows[k]) for k in sorted(S)]
        with ProcessPoolExecutor(WORKERS) as ex:
            cubes = dict(ex.map(v2.cube, jobs))
        np.savez_compressed(cube_path(rule), **cubes)
        print(f"{rule}: {len(cubes)} cubes -> {os.path.relpath(cube_path(rule))}", flush=True)


def cmd_gate(models):
    import forecast_baselines as FB
    import forecast as F
    S, rows = series_rows()
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
    splits = FB.splits("whimbc", S)
    rd = lambda v: [round(float(x), 4) for x in v]
    for model in models:
        rule, kind = MODELS[model]
        z = np.load(cube_path(rule)); cubes = {k: z[k] for k in z.files}
        g = v2.GRIDS[rule]
        need = {}
        for split, (test, pool) in splits.items():
            for cut in CUTS:
                for k in sorted(test | pool):
                    t, a = S[k]["t"], S[k]["a"]
                    h = t <= cut + 1e-9
                    if h.sum() < 2 or (~h).sum() == 0 or a[h][-1] <= 0.1:  # P1's prepare() skips these
                        continue
                    prior = [c for c in pool if S[c]["wound"] != S[k]["wound"]]
                    if split == "Monolayer_to_Sphere":
                        assert all(S[c]["cond"] == "Monolayer" for c in prior), "prior must be Monolayer (training) only"
                    rng = np.random.default_rng(zlib.crc32(f"{k}|{cut:g}|{split}".encode()))
                    need[(split, k, cut)] = v2.members(kind, k, cut, cubes, S, g, prior, rng)
        uniq = {}
        for (split, k, cut), mem in need.items():
            uniq.setdefault((k, cut, json.dumps(np.round(mem, 6).tolist())), mem)
        jobs = [(key, key[0], SOURCE, S[key[0]]["t"], S[key[0]]["a"], *rows[key[0]], key[1], mem, rule)
                for key, mem in uniq.items()]
        with ProcessPoolExecutor(WORKERS) as ex:
            sims = dict(ex.map(v2.run_ens, jobs))
        print(f"{model}: {len(need)} (fold, series, cut) member sets, {len(sims)} simulated", flush=True)
        for split, (test, pool) in splits.items():
            pred = {}
            for (sp, k, cut), mem in need.items():
                if sp == split:
                    h = S[k]["t"] <= cut + 1e-9
                    pred[(cut, S[k]["t"][h].tobytes() + S[k]["a"][h].tobytes())] = sims[(k, cut, json.dumps(np.round(mem, 6).tolist()))]

            def point(t_h, a_h, grid, pred=pred, cut=None):
                ts, tr = pred[(cut, np.asarray(t_h, float).tobytes() + np.asarray(a_h, float).tobytes())]
                return np.interp(grid, ts + np.arange(tr.shape[1]), np.median(tr, 0))

            for cut in CUTS:
                FB.BASELINES[model] = lambda t_h, a_h, grid, cut=cut: point(t_h, a_h, grid, cut=cut)
                G = G_all[G_all > cut + 1e-9]
                G_long = np.arange(G[0], 20 * G_all[-1], min(0.25, float(np.min(np.diff(G_all)))))  # as P1's main()
                doc = FB.forecast_file("whimbc", split, model, cut, S, test, pool, G, G_long, T_CLOSE)
                doc["notes"] = (f"P2 v2 EXTERNAL check {model} (sim/v2_whimbc.py: rule={v2.RULE[rule]}, members={kind}), "
                                f"member median calibrated with P1's conformal (eval/forecast_baselines.forecast_file). {CAVEATS}")
                raw = dict(doc, model=model + "_raw", forecasts=[], notes=f"raw {model} ensemble, no calibration. {CAVEATS}")
                for fc in doc["forecasts"]:
                    k = fc["wound_id"]
                    fc["segmentation_quality"]["reasons"] = [REASON]
                    t, a = S[k]["t"], S[k]["a"]
                    h = t <= cut + 1e-9
                    ts, tr = pred[(cut, t[h].tobytes() + a[h].tobytes())]
                    grid = np.array(fc["t_hours"])
                    A = np.array([np.interp(grid, ts + np.arange(tr.shape[1]), m) for m in tr])
                    mts = np.concatenate([[ts], grid]); mas = [np.concatenate([[a[h][-1]], m]) for m in A]
                    t50, _ = F.event(t[h], a[h], mts, mas, 0.5)
                    t90, t90s = F.event(t[h], a[h], mts, mas, 0.1)
                    q = np.quantile(A, [0.05, 0.5, 0.95], axis=0)
                    raw["forecasts"].append(dict(fc, area_q05=rd(q[0]), area_q50=rd(q[1]), area_q95=rd(q[2]), t50=t50,
                                                 t90=t90, p_close_by_T=round(float(np.mean(t90s <= T_CLOSE)), 3),
                                                 members=[rd(m) for m in A[:5]]))
                d = os.path.join(HERE, "..", "eval", "forecasts", "whimbc", split)
                os.makedirs(d, exist_ok=True)
                for m, x in ((model, doc), (model + "_raw", raw)):
                    json.dump(x, open(os.path.join(d, f"{m}_{cut:g}h.json"), "w"))
        print(f"{model}: gate files written", flush=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "cubes":
        cmd_cubes()
    elif a[0] == "gate":
        cmd_gate(a[1:] or list(MODELS))
