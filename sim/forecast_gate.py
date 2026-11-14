"""Gate files in P1's format: WHAD sim ensemble at P1's cut-offs and folds, raw and with P1's conformal calibration.

  python3 sim/forecast_gate.py
    -> eval/forecasts/whad/{loo_all,loo_manual,CC_to_C61}/sim_ensemble_{cut}h.json      (P1's leave-one-wound-out conformal)
       eval/forecasts/whad/{loo_all,loo_manual,CC_to_C61}/sim_ensemble_raw_{cut}h.json  (raw simulator ensemble)
Series, cut-offs, grid, skips, pools and calibration are P1's own code (eval/forecast_baselines.py load / splits /
forecast_file), called unchanged; the sim's member median is registered as the point forecaster.
Per series and cut: start = last series frame with t <= cut (manual: its mask; auto: synthetic band with that frame's
area), 50 members = fits[position][f"{cut:g}"].members (fitted on series frames t <= cut only, sim/fits/*.json), one
simulator run each to H_SIM h, area rescaled to the observed area at the start (same initialisation as the NCA).
"""
import sys, os, json, zlib
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "eval"))
import numpy as np
import forecast_baselines as FB
import calibrate, forecast as F
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice

H_SIM, T_CLOSE = 40.0, 19.0
OUT = os.path.join(HERE, "..", "eval", "forecasts", "whad")
AUTO_REASON = "sim start state = synthetic vertical band with the observed area (no auto mask on disk)"


def run_series(args):
    """All cut-offs for one series -> {cut: (start time, trajectories on start + arange)}."""
    k, s, frames_abs, wf_abs, source, members_by_cut = args
    out = {}
    for cut, members in members_by_cut.items():
        ic = np.nonzero(s["t"] <= cut + 1e-9)[0][-1]
        ts, a_start = float(s["t"][ic]), float(s["a"][ic])
        occ = (mask_to_lattice(*load_png_mask(k, int(frames_abs[ic])), SITE_UM) if source == "manual"
               else F.band_start(float(wf_abs[ic]), zlib.crc32(k.encode())))
        trajs = []
        for i, (Tm, bias) in enumerate(members):
            r = simulate(occ, Params(Tm=Tm, bias=bias), H_SIM - ts, seed=1000 + i)
            trajs.append(a_start * r["wound_frac"] / r["wound_frac"][0])
        out[cut] = (ts, np.array(trajs))
    return k, out


def main():
    S = FB.load("whad")
    cur = F.load_curves()
    cur = cur[cur.wound_frac <= 0.70]  # P1's filter, so rows line up with S
    fits = {**json.load(open(calibrate.OUT))["fits"], **json.load(open(F.AUTO_FITS))["fits"]}
    jobs = []
    for k, s in S.items():
        c = cur[cur.position == k].sort_values("t_hours")
        assert np.allclose(c.t_hours.values - c.t_hours.values[0], s["t"]), k
        mb = {}
        for cut in calibrate.CUTOFFS:
            h = s["t"] <= cut + 1e-9
            fit = fits[k].get(f"{cut:g}")
            if h.sum() < 2 or (~h).sum() == 0 or s["a"][h][-1] <= 0.1 or not fit:  # P1's prepare() skips these
                continue
            mb[cut] = fit["members"]
        jobs.append((k, s, c.frame.values, c.wound_frac.values, s["source"], mb))
    with ProcessPoolExecutor() as ex:
        sims = dict(ex.map(run_series, jobs))
    print(f"simulated {sum(len(v) for v in sims.values())} (series, cut) ensembles", flush=True)

    pred = {}  # P1's forecast_file calls f(t_obs, a_obs, grid); identify the series + cut by its observed arrays
    for k, by_cut in sims.items():
        for cut, (ts, tr) in by_cut.items():
            h = S[k]["t"] <= cut + 1e-9
            key = S[k]["t"][h].tobytes() + S[k]["a"][h].tobytes()
            assert key not in pred, f"ambiguous observed curve {k} {cut}"
            pred[key] = (ts + np.arange(tr.shape[1]), np.median(tr, 0))

    def sim_point(t_h, a_h, grid):
        times, med = pred[np.asarray(t_h, float).tobytes() + np.asarray(a_h, float).tobytes()]
        return np.interp(grid, times, med)  # held at the last simulated value beyond H_SIM

    FB.BASELINES["sim_ensemble"] = sim_point
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
    rd = lambda v: [round(float(x), 4) for x in v]
    for split, (test, pool) in FB.splits("whad", S).items():
        for cut in calibrate.CUTOFFS:
            G = G_all[G_all > cut + 1e-9]
            G_long = np.arange(G[0], 20 * G_all[-1], 0.25)
            doc = FB.forecast_file("whad", split, "sim_ensemble", cut, S, test, pool, G, G_long, T_CLOSE)
            doc["notes"] = ("cell-agent simulator ensemble (sim/forecast_gate.py): member median as the point forecast, "
                            "calibrated with P1's leave-one-wound-out conformal (eval/forecast_baselines.forecast_file); "
                            "start = observed mask at the last frame <= cut-off, rescaled to its observed area")
            raw = dict(doc, model="sim_ensemble_raw", forecasts=[],
                       notes="raw cell-agent simulator ensemble (50 members = bootstrap (Tm, bias) fits on frames <= cut-off "
                             "x simulator seeds), no calibration; same series, start and grid as sim_ensemble")
            for fc in doc["forecasts"]:
                k = fc["wound_id"]
                if S[k]["source"] != "manual":
                    fc["segmentation_quality"]["reasons"] = [AUTO_REASON]
                ts, tr = sims[k][cut]
                grid = np.array(fc["t_hours"])
                A = np.array([np.interp(grid, ts + np.arange(tr.shape[1]), m) for m in tr])
                s = S[k]; h = s["t"] <= cut + 1e-9
                ot, oa = s["t"][h], s["a"][h]
                mts = np.concatenate([[ts], grid]); a0 = float(s["a"][h][-1])
                mas = [np.concatenate([[a0], m]) for m in A]
                t50, _ = F.event(ot, oa, mts, mas, 0.5)
                t90, times90 = F.event(ot, oa, mts, mas, 0.1)
                q = np.quantile(A, [0.05, 0.5, 0.95], axis=0)
                raw["forecasts"].append(dict(fc, area_q05=rd(q[0]), area_q50=rd(q[1]), area_q95=rd(q[2]), t50=t50, t90=t90,
                                             p_close_by_T=round(float(np.mean(times90 <= T_CLOSE)), 3),
                                             members=[rd(m) for m in A[:5]]))
            d = os.path.join(OUT, split)
            os.makedirs(d, exist_ok=True)
            for m, x in (("sim_ensemble", doc), ("sim_ensemble_raw", raw)):
                json.dump(x, open(os.path.join(d, f"{m}_{cut:g}h.json"), "w"))
            print(f"{split:10s} cut {cut:4g} h: {len(doc['forecasts'])} series", flush=True)


if __name__ == "__main__":
    main()
