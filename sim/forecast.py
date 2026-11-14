"""Simulator-ensemble forecasts for held-out WHAD wounds (#26: the sim_ensemble scorecard rows; 00:00 gate fallback).

  python3 sim/forecast.py   -> sim/fits/whad_auto_fits.json + sim/forecasts/whad/sim_ensemble_{fold}_t{cutoff}.json

Folds (R15): "loo" = leave-one-wound-out over every WHAD MCF10A position (16 manual + 44 auto); both parts of a physical
wound are held out together. "B_CC_to_C61" = train CC, test every C61 position.
Per test position and cut-off: 50 members = the wound's own bootstrap (Tm, bias) fits on frames <= cutoff (sim/fits/*.json),
each run with its own simulator seed from the first-frame start state to the horizon (19 h). Fallback when fewer than 2 frames
are observed by the cut-off: the fold's preset (median fit over TRAINING wounds only: loo = all other physical wounds of the
same condition; B = CC wounds). Positions with no frame at or before the cut-off are skipped.
Start state: manual positions = their own first-frame mask; auto positions = a synthetic vertical band with the observed
first-frame area (no auto masks on disk), tagged in segmentation_quality.reasons.
"""
import sys, os, json, zlib
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
import calibrate
from cellsim import Params, simulate, SITE_UM
from start_state import load_png_mask, mask_to_lattice

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "processed")
OUT_DIR = os.path.join(HERE, "forecasts", "whad")
AUTO_FITS = os.path.join(HERE, "fits", "whad_auto_fits.json")
CUTOFFS, HORIZON, T_CLOSE, LEVEL, N_MEMBERS = calibrate.CUTOFFS, 19, 12, 0.9, 50
LATTICE = (32, 44)  # a WHAD field at SITE_UM = 20 (same as mask_to_lattice on a 1440 x 1920 mask)
FOLDS = {
    "loo": dict(test=lambda m: True, train=lambda m, test_m: m["wound"] != test_m["wound"], same_condition=True),
    "B_CC_to_C61": dict(test=lambda m: m["condition"] == "C61", train=lambda m, test_m: m["condition"] == "CC",
                        same_condition=False),
}
AUTO_REASONS = ["auto-segmented (data/segment.py)",
                "sim start state is a synthetic vertical band with the observed first-frame area (no mask on disk)"]


def load_curves():
    m = pd.read_csv(os.path.join(DATA, "whad_curves.csv"))
    m["qc"] = "ok"
    m["wound"] = "exp1_" + m["wound"]  # manual wounds are all exp1; auto ids already carry the experiment
    a = pd.read_csv(os.path.join(DATA, "whad_auto_curves.csv"))
    return pd.concat([m, a[m.columns]], ignore_index=True).sort_values(["position", "frame"])


def band_start(wf0, seed):
    """Vertical wound band with a ragged edge, exactly round(wf0 * n_sites) empty sites."""
    H, W = LATTICE
    x = np.tile(np.arange(W), (H, 1))
    score = -np.abs(x - (W - 1) / 2) + 0.75 * np.random.default_rng(seed).random((H, W))
    occ = np.ones(H * W, np.uint8)
    occ[np.argsort(-score.ravel(), kind="stable")[: int(round(wf0 * H * W))]] = 0
    return occ.reshape(H, W)


def start_state(c, source):
    if source == "manual":
        return mask_to_lattice(*load_png_mask(c.position.iloc[0], int(c.frame.iloc[0])), SITE_UM)
    return band_start(c.wound_frac.iloc[0], zlib.crc32(c.position.iloc[0].encode()))


def fit_auto(args):
    pos, c = args
    fit_df = c[c.qc == "ok"]
    fr, err = calibrate.error_cube(pos, fit_df, max(CUTOFFS), occ0=start_state(c, "auto"))
    rng = np.random.default_rng(zlib.crc32(pos.encode()))
    return pos, {str(t0): calibrate.fit_from_cube(fr, err, t0, rng) for t0 in CUTOFFS}


def crossing(ts, a, thr):
    """First time area <= thr, linear interpolation between samples; inf if never."""
    for i in range(len(a)):
        if a[i] <= thr:
            if i == 0:
                return float(ts[0])
            return float(ts[i - 1] + (ts[i] - ts[i - 1]) * (a[i - 1] - thr) / (a[i - 1] - a[i]))
    return np.inf


def event(obs_t, obs_a, member_ts, member_as, thr):
    t_obs = crossing(obs_t, obs_a, thr)
    if np.isfinite(t_obs):
        return dict(median=t_obs, q05=t_obs, q95=t_obs, censored_prob=0.0), np.full(len(member_as), t_obs)
    times = np.array([crossing(member_ts, a, thr) for a in member_as])
    cens = float(np.mean(~np.isfinite(times)))
    q = [np.quantile(times, x) for x in (0.05, 0.5, 0.95)]
    r = lambda v: None if not np.isfinite(v) else round(float(v), 3)
    return dict(median=r(q[1]) if cens <= 0.5 else None, q05=r(q[0]), q95=r(q[2]), censored_prob=round(cens, 4)), times


def forecast_one(args):
    """All cut-offs for one test position. members_by_t0[t0] = list of [Tm, bias] (fit or fallback preset)."""
    pos, c, source, members_by_t0, cond, part = args
    occ0 = start_state(c, source)
    f0 = int(c.frame.iloc[0])
    obs_t_all, obs_a_all, qc_all = c.t_hours.values, c.area_norm.values, c.qc.values
    out = {}
    for t0, members in members_by_t0.items():
        seen = (obs_t_all <= t0) & (qc_all == "ok")
        grid = np.arange(t0 + 1, HORIZON + 1, dtype=float)
        trajs = []
        for i, (Tm, bias) in enumerate(members):
            r = simulate(occ0, Params(Tm=Tm, bias=bias), HORIZON - f0, seed=1000 + i)
            trajs.append(r["wound_frac"] / r["wound_frac"][0])
        trajs = np.array(trajs)[:, (grid - f0).astype(int)]
        # events: observed frames up to t0, then each member from the last observed area onward
        ot, oa = obs_t_all[seen], obs_a_all[seen]
        mts = np.concatenate([[ot[-1]], grid])
        mas = [np.concatenate([[oa[-1]], tr]) for tr in trajs]
        t50, _ = event(ot, oa, mts, mas, 0.5)
        t90, times90 = event(ot, oa, mts, mas, 0.1)
        q = np.quantile(trajs, [0.05, 0.5, 0.95], axis=0)
        n_fail = int(((obs_t_all <= t0) & (qc_all != "ok")).sum())
        sq = (dict(status="manual_mask", reasons=[]) if source == "manual" else
              dict(status="flagged" if n_fail else "ok",
                   reasons=AUTO_REASONS + ([f"{n_fail} frame(s) up to the cut-off failed segmentation QC"] if n_fail else [])))
        rd = lambda v: [round(float(x), 4) for x in v]
        out[str(t0)] = dict(
            wound_id=pos, condition=cond, part=part, t_hours=grid.tolist(),
            area_q05=rd(q[0]), area_q50=rd(q[1]), area_q95=rd(q[2]), t50=t50, t90=t90,
            p_close_by_T=round(float(np.mean(times90 <= T_CLOSE)), 4), p_stall=None, flags=[],
            segmentation_quality=sq,
            observed=dict(t_hours=obs_t_all.tolist(), area=rd(obs_a_all)),
            members=[rd(tr) for tr in trajs[:10]])
    return pos, out


def preset(fits, meta, t0, test_pos, fold):
    f = FOLDS[fold]
    tm = meta[test_pos]
    train = [p for p in fits if f["train"](meta[p], tm) and (not f["same_condition"] or meta[p]["condition"] == tm["condition"])]
    assert all(meta[p]["wound"] != tm["wound"] for p in train), "held-out wound in training set"
    xs = [fits[p][str(t0)] for p in train if fits[p].get(str(t0))]
    return [float(np.median([x["Tm"] for x in xs])), float(np.median([x["bias"] for x in xs]))], len(xs)


def main():
    df = load_curves()
    groups = {p: c for p, c in df.groupby("position")}
    meta = {p: dict(wound=c.wound.iloc[0], condition=c.condition.iloc[0], part=c.part.iloc[0], source=c.source.iloc[0])
            for p, c in groups.items()}
    fits = json.load(open(calibrate.OUT))["fits"]  # manual positions: same members Agent 2's NCA uses
    auto = [p for p in groups if meta[p]["source"] == "auto"]
    with ProcessPoolExecutor() as ex:
        auto_fits = dict(ex.map(fit_auto, [(p, groups[p]) for p in auto]))
    json.dump(dict(params=dict(note="auto positions; start = synthetic band, see sim/forecast.py; layout as whad_fits.json"),
                   fits=auto_fits), open(AUTO_FITS, "w"), indent=1)
    fits = {**fits, **auto_fits}
    print(f"fits: {len(fits)} positions ({len(auto_fits)} auto)", flush=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    for fold, f in FOLDS.items():
        jobs, n_fallback = [], 0
        for p in groups:
            if not f["test"](meta[p]):
                continue
            c = groups[p]
            mb = {}
            for t0 in CUTOFFS:
                if not ((c.t_hours <= t0) & (c.qc == "ok")).any():
                    continue  # nothing observed by the cut-off
                fit = fits[p].get(str(t0))
                if fit:
                    mb[t0] = fit["members"][:N_MEMBERS]
                else:
                    pr, _ = preset(fits, meta, t0, p, fold)
                    mb[t0] = [pr] * N_MEMBERS
                    n_fallback += 1
            jobs.append((p, c, meta[p]["source"], mb, meta[p]["condition"], meta[p]["part"]))
        with ProcessPoolExecutor() as ex:
            res = dict(ex.map(forecast_one, jobs))
        for t0 in CUTOFFS:
            fc = [res[p][str(t0)] for p in sorted(res) if str(t0) in res[p]]
            doc = dict(version="1.0", model="sim_ensemble", dataset="whad", fold=fold, cutoff_hours=t0, level=LEVEL,
                       p_close_by_T_hours=T_CLOSE,
                       notes=("Cell-agent simulator ensemble (sim/forecast.py, docs/sim.md). 50 members = per-wound bootstrap "
                              "(Tm, bias) fits on frames <= cutoff, one simulator seed each; fold preset (training wounds "
                              "only) when < 2 frames observed. Manual-mask-only subset: segmentation_quality.status == "
                              "'manual_mask'; auto-segmented wounds start from a synthetic band (see reasons)."),
                       forecasts=fc)
            path = os.path.join(OUT_DIR, f"sim_ensemble_{fold}_t{t0}.json")
            json.dump(doc, open(path, "w"))
            print(f"{fold} t0={t0}: {len(fc)} wounds -> {os.path.relpath(path)}", flush=True)
        print(f"{fold}: {n_fallback} (position, cut-off) pairs used the fold preset", flush=True)


if __name__ == "__main__":
    main()
