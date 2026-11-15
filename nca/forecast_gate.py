"""Gate forecasts (#25/#26): NCA on P1's WHAD series, splits, cut-offs and conformal calibration.

python nca/forecast_gate.py [--fits sim/fits/whad_fits.json] [--self-fit]  -> eval/forecasts/whad/{split}/{model}_{cut}h.json
v2 (follower rule): python nca/forecast_gate.py --weights nca/v2/weights.pt --name nca_follow --no-det --fits <follower fits>
Series, splits (loo_all, loo_manual, CC_to_C61), cut-offs (1.9/3.8/5.7/9.5 h), forecast grid, T = 19 h and the
calibration all come from P1's eval/forecast_baselines.py (imported, not reimplemented). The NCA only supplies the
point trajectory that P1's leave-one-wound-out conformal step wraps, exactly as for the statistical baselines:
  nca_ensemble       median of 50 stochastic NCA members (one per bootstrapped (Tm, bias) fit) + P1 conformal
  nca_deterministic  noise-free NCA at the point fit + P1 conformal                                (#26 ablation)
  nca_ensemble_raw   the raw 50-member NCA quantiles, no calibration (shows how under-dispersed it is)
Per series and cut-off: start = observed mask at the last frame with t <= cut (series time); auto-segmented series
use Agent 1's synthetic band with the observed area (sim/forecast.py). Params = that series' own fit on frames
<= cut (Agent 1's fits, or --self-fit: grid fit through the NCA itself); no own fit -> fits of other physical wounds.
"""
import argparse, json, os, sys, zlib
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path[:0] = [os.path.join(ROOT, "eval"), os.path.join(ROOT, "sim"), HERE]
import forecast_baselines as FB  # noqa: E402  (P1)
from baselines import BASELINES  # noqa: E402
from cellsim import SITE_UM  # noqa: E402
from start_state import load_png_mask, mask_to_lattice  # noqa: E402
from api import load, lattice_to_state, rollout  # noqa: E402

H_LONG = 100  # hours of NCA rollout for the event-time (t50/t90) extrapolation
N_MEM = 50


def raw_frames():
    man = pd.read_csv(f"{FB.PROC}/whad_curves.csv")
    auto = pd.read_csv(f"{FB.PROC}/whad_auto_curves.csv")
    df = pd.concat([man, auto], ignore_index=True)
    df = df[df.wound_frac <= 0.70]  # same filter as FB.load
    return {p: g.sort_values("t_hours") for p, g in df.groupby("position")}


def start_lattice(pos, g, i):
    if g.source.iloc[0] == "manual":
        return mask_to_lattice(*load_png_mask(pos, int(g.frame.iloc[i])), SITE_UM)
    from forecast import band_start  # Agent 1, sim/forecast.py
    return band_start(float(g.wound_frac.iloc[i]), zlib.crc32(pos.encode()))


def self_fit(net, occ0, t_obs, a_obs, rng, nboot=N_MEM):
    """Grid fit of (Tm, bias) through the NCA from the first frame on frames <= cut; residual bootstrap."""
    c = net.cfg
    TG = np.geomspace(c["tm_min"], c["tm_max"], 21); BG = np.linspace(c["bias_min"], c["bias_max"], 6)
    grid = np.array([(x, y) for x in TG for y in BG])
    rho, R = lattice_to_state(occ0)
    n = int(round(t_obs[-1]))
    wf = rollout(net, rho, R, grid, n, stochastic=False)
    pred = (wf / wf[:, :1])[:, np.round(t_obs).astype(int)]
    best = int(((pred - a_obs) ** 2).sum(1).argmin()); res = a_obs - pred[best]
    boot = [grid[int(((pred - (pred[best] + rng.choice(res, len(res)))) ** 2).sum(1).argmin())] for _ in range(nboot)]
    return grid[best], np.array(boot)


def fit_lookup(fits, pos, cut):
    f = fits.get(pos, {}) if fits else {}
    return f.get(f"{cut:g}") or f.get(str(cut))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fits", nargs="+", default=None, help="default by the model's sim rule: free -> whad_fits.json + whad_auto_fits.json, follow -> whad_fits_follow.json")
    ap.add_argument("--self-fit", action="store_true", help="fit (Tm, bias) through the NCA instead of Agent 1's fits")
    ap.add_argument("--weights", default=os.path.join(HERE, "weights.pt"))
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "forecasts"))
    ap.add_argument("--name", default="nca_ensemble", help="model name of the calibrated ensemble (v2: nca_follow); raw = <name>_raw")
    ap.add_argument("--no-det", action="store_true", help="skip the calibrated deterministic ablation")
    a = ap.parse_args()
    import warnings; warnings.filterwarnings("ignore")
    import torch; torch.set_num_threads(4)
    net = load(a.weights)
    fits = {}
    if not a.self_fit:
        rule = "follow" if net.cfg["follow"] else "free"
        a.fits = a.fits or ([os.path.join(ROOT, "sim/fits/whad_fits_follow.json")] if rule == "follow" else
                            [os.path.join(ROOT, "sim/fits/whad_fits.json"), os.path.join(ROOT, "sim/fits/whad_auto_fits.json")])
        for fn in a.fits:
            fj = json.load(open(fn))
            fr = fj.get("params", {}).get("rule", "free")
            assert fr == rule, f"{fn}: fits made with rule {fr!r}, model trained on {rule!r}"
            fits.update(fj["fits"])
    S = FB.load("whad"); RAW = raw_frames()
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
    T = 19.0
    for cut in [1.9, 3.8, 5.7, 9.5]:
        G = G_all[G_all > cut + 1e-9]
        G_long = np.arange(G[0], 20 * G_all[-1], 0.25)
        traj = {}  # series id -> dict(grid, A (members, n), det)
        own = {}
        rng = np.random.default_rng(int(cut * 10))
        for k, s in S.items():  # pass 1: own fits
            f = None if a.self_fit else fit_lookup(fits, k, cut)
            h = s["t"] <= cut + 1e-9
            if f:
                own[k] = (np.array([f["Tm"], f["bias"]]), np.array(f["members"]))
            elif a.self_fit and h.sum() >= 2:
                own[k] = self_fit(net, start_lattice(k, RAW[k], 0), s["t"][h], s["a"][h], rng)
        for k, s in S.items():  # pass 2: rollouts
            h = s["t"] <= cut + 1e-9
            if not h.any():
                continue
            if k in own:
                point, mem = own[k]
            else:  # no own fit: other physical wounds' fits (never the same wound)
                v = np.array([own[c][0] for c in own if S[c]["wound"] != s["wound"]])
                point = np.array([np.exp(np.median(np.log(v[:, 0]))), np.median(v[:, 1])])
                mem = v[rng.integers(len(v), size=N_MEM)]
            i = int(np.nonzero(h)[0][-1])
            ts, a0 = float(s["t"][i]), float(s["a"][i])
            rho, R = lattice_to_state(start_lattice(k, RAW[k], i))
            n = int(np.ceil(H_LONG - ts))
            wf = rollout(net, rho, R, mem[np.arange(N_MEM) % len(mem)], n, stochastic=True, seed=zlib.crc32(f"{k}{cut}".encode()))
            wd = rollout(net, rho, R, point[None], n, stochastic=False)
            traj[k] = dict(grid=ts + np.arange(n + 1), A=a0 * wf / wf[:, :1], det=(a0 * wd / wd[:, :1])[0],
                           src="fit" if k in own else "preset",
                           clip=int((mem[:, 0] > net.cfg["tm_max"]).sum()), nmem=len(mem))  # rollout() clips Tm to the trained range
        # fingerprint -> series, so P1's prepare() can call a plain f(t_obs, a_obs, G)
        fp = {S[k]["a"][S[k]["t"] <= cut + 1e-9].round(8).tobytes(): k for k in traj}
        def make(kind):
            def f(t_h, a_h, Gq):
                tr = traj[fp[np.asarray(a_h).round(8).tobytes()]]
                y = np.median(tr["A"], 0) if kind == "median" else tr["det"]
                return np.interp(Gq, tr["grid"], y)
            return f
        det_name = "nca_deterministic" if a.name == "nca_ensemble" else f"{a.name}_deterministic"  # v1 name kept
        BASELINES[a.name] = make("median"); BASELINES[det_name] = make("det")
        for split, (test, pool) in FB.splits("whad", S).items():
            test = {k for k in test if k in traj}; pool = {k for k in pool if k in traj}
            d = f"{a.out}/whad/{split}"; os.makedirs(d, exist_ok=True)
            for model in (a.name,) + (() if a.no_det else (det_name,)):
                doc = FB.forecast_file("whad", split, model, cut, S, test, pool, G, G_long, T)
                n_pre = sum(traj[f["wound_id"]]["src"] == "preset" for f in doc["forecasts"])
                n_clip = sum(traj[f["wound_id"]]["clip"] for f in doc["forecasts"]); n_mem = sum(traj[f["wound_id"]]["nmem"] for f in doc["forecasts"])
                n_ser_clip = sum(traj[f["wound_id"]]["clip"] > 0 for f in doc["forecasts"])
                doc["notes"] = (f"P2 NCA {net.cfg['version']}{' (follower rule)' if net.cfg['follow'] else ''} ({'median of 50 stochastic members' if model == a.name else 'deterministic, point fit'}) "
                                f"+ P1 leave-one-wound-out conformal (eval/forecast_baselines.py); params: "
                                f"{'NCA self-fit' if a.self_fit else 'Agent 1 sim fits'} on frames <= cut-off; "
                                f"start = observed mask at the last frame <= cut-off (auto: synthetic band); {n_pre} series used other wounds' fits; "
                                f"{n_clip} of {n_mem} fit members ({n_ser_clip} series) had Tm > {net.cfg['tm_max']:g} h and were clipped to it (trained range)")
                json.dump(doc, open(f"{d}/{model}_{cut:g}h.json", "w"))
                if model == a.name:
                    main_doc = doc
            # raw ensemble on the same series and grid, no calibration
            raw = json.loads(json.dumps(main_doc))
            raw["model"] = f"{a.name}_raw"
            raw["notes"] = f"P2 NCA {net.cfg['version']} raw 50-member quantiles, NO calibration (for comparison with the calibrated {a.name})"
            for f in raw["forecasts"]:
                tr = traj[f["wound_id"]]; tq = np.array(f["t_hours"])
                M = np.stack([np.interp(tq, tr["grid"], m) for m in tr["A"]])
                f["area_q05"], f["area_q50"], f["area_q95"] = (np.quantile(M, q, axis=0).round(4).tolist() for q in (0.05, 0.5, 0.95))
                f["members"] = M[:5].round(4).tolist()
                Ml = np.stack([np.interp(G_long, tr["grid"], m) for m in tr["A"]])
                ot, oa = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"])
                for lvl, key in FB.EVENTS:
                    if FB.event_time(ot[ot <= cut + 1e-9], oa[ot <= cut + 1e-9], lvl) is not None:
                        continue  # already observed before the cut-off: keep P1's exact value
                    et = np.array([FB.event_time(G_long, m, lvl) or np.inf for m in Ml])
                    q = np.quantile(np.where(np.isinf(et), 1e9, et), [0.05, 0.5, 0.95])
                    fin = lambda x: round(float(x), 2) if x < 1e8 else None
                    f[key] = {"median": fin(q[1]), "q05": fin(q[0]), "q95": fin(q[2]),
                              "censored_prob": round(float(np.mean(et > tq[-1])), 3)}
                et90 = np.array([FB.event_time(G_long, m, 0.1) or np.inf for m in Ml])
                f["p_close_by_T"] = round(float(np.mean(et90 <= T)), 3)
            json.dump(raw, open(f"{d}/{a.name}_raw_{cut:g}h.json", "w"))
            print(f"cut {cut:g} {split}: {len(main_doc['forecasts'])} series", flush=True)


if __name__ == "__main__":
    main()
