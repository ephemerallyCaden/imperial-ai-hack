"""NCA v2 (follower rule) version of P1's nca/forecast_realft.py: identical except the defaults (follower fits
sim/fits/whad_fits_follow.json, weights nca/v2/weights_real_fold{k}.pt, model nca_follow_realft) and two asserts:
every fold model's config is the follower rule and the fits file's rule is "follow". Copied (P1's file untouched).
python nca/v2/forecast_realft_follow.py   -> eval/forecasts/whad/{split}/nca_follow_realft[_raw]_{cut}h.json

P1's original docstring:
Out-of-fold gate forecasts (#64): nca/forecast_gate.py with wound-level cross-validated fine-tuned NCA weights.

python nca/forecast_realft.py [--weights-pattern nca/weights_real_fold{k}.pt] [--model nca_realft] [--out eval/forecasts]
python nca/forecast_realft.py --weights-pattern nca/weights_realplus_fold{k}.pt --model nca_realplus
  -> {out}/whad/{split}/{model}_{cut}h.json and {model}_raw_{cut}h.json
Fold of a series = zlib.crc32(physical wound id) % 4 (wound as in eval/forecast_baselines.load); the series is rolled
out with weights_pattern.format(k=fold), the model fine-tuned WITHOUT that fold, so no series is forecast by a net that
trained on its own physical wound. Everything else is forecast_gate.py (imported): P1 series, splits, cut-offs, grids,
T = 19 h, start states, Agent 1 fits on frames <= cut (fallback: other wounds' fits), 50 stochastic members.
  <model>      median of the 50 members + P1 leave-one-wound-out conformal (forecast_baselines.forecast_file)
  <model>_raw  the raw 50-member quantiles, no calibration (as nca_ensemble_raw)
"""
import argparse, json, os, sys, zlib
import numpy as np

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, HERE)
from forecast_gate import FB, BASELINES, ROOT, H_LONG, N_MEM, raw_frames, start_lattice, fit_lookup  # noqa: E402  (also sets sys.path for eval/, sim/)
from api import load, lattice_to_state, rollout  # noqa: E402

N_FOLDS = 4


def fold_of(wound):
    return zlib.crc32(wound.encode()) % N_FOLDS


def resolve(p):
    return p if os.path.isabs(p) or os.path.exists(p) else os.path.join(ROOT, p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fits", nargs="+", default=[os.path.join(ROOT, "sim/fits/whad_fits_follow.json")])
    ap.add_argument("--weights-pattern", default="nca/v2/weights_real_fold{k}.pt", help="fold weights, {k} = fold 0..3")
    ap.add_argument("--model", default="nca_follow_realft")
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "forecasts"))
    a = ap.parse_args()
    import warnings; warnings.filterwarnings("ignore")
    import torch; torch.set_num_threads(4)
    wpath = {k: resolve(a.weights_pattern.format(k=k)) for k in range(N_FOLDS)}
    missing = [p for p in wpath.values() if not os.path.exists(p)]
    if missing:
        sys.exit(f"missing fold weights: {missing}")
    nets = {k: load(p) for k, p in wpath.items()}
    for k, n in nets.items():
        assert n.cfg.get("follow") and n.cfg.get("division") == 1.0, f"fold {k}: {wpath[k]} is not a follower-rule v2 model ({n.cfg})"
    fits = {}
    for fn in a.fits:
        fj = json.load(open(fn))
        assert fj.get("params", {}).get("rule") == "follow", f"{fn}: not follower-rule fits"
        fits.update(fj["fits"])
    S = FB.load("whad")
    Z = np.load(os.path.join(ROOT, "data", "processed", "nca_real_whad.npz"), allow_pickle=False)
    zi = {str(sid): i for i, sid in enumerate(Z["ids"])}  # start states from the real masks used in fine-tuning
    fold = {k: fold_of(s["wound"]) for k, s in S.items()}
    by_fold = {j: sorted({S[k]["wound"] for k in S if fold[k] == j}) for j in range(N_FOLDS)}
    rel = lambda p: os.path.relpath(p, ROOT).replace("\\", "/") if os.path.abspath(p).startswith(os.path.abspath(ROOT)) else p
    fold_note = ("folds = crc32(wound) % 4; series rolled out with the weights of their own fold (trained without it): "
                 + "; ".join(f"fold {j} -> {rel(wpath[j])}: {', '.join(by_fold[j])}" for j in range(N_FOLDS)))
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))
    T = 19.0
    for cut in [1.9, 3.8, 5.7, 9.5]:
        G = G_all[G_all > cut + 1e-9]
        G_long = np.arange(G[0], 20 * G_all[-1], 0.25)
        traj, own = {}, {}
        rng = np.random.default_rng(int(cut * 10))
        for k, s in S.items():  # pass 1: own fits
            f = fit_lookup(fits, k, cut)
            if f:
                own[k] = (np.array([f["Tm"], f["bias"]]), np.array(f["members"]))
        for k, s in S.items():  # pass 2: rollouts with the out-of-fold net
            h = s["t"] <= cut + 1e-9
            if not h.any():
                continue
            if k in own:
                mem = own[k][1]
            else:  # no own fit: other physical wounds' fits (never the same wound)
                v = np.array([own[c][0] for c in own if S[c]["wound"] != s["wound"]])
                mem = v[rng.integers(len(v), size=N_MEM)]
            i = int(np.nonzero(h)[0][-1])
            ts, a0 = float(s["t"][i]), float(s["a"][i])
            Rz = Z[f"{zi[k]}__R"]
            rho, R = Z[f"{zi[k]}__density"][i], (Rz[i] if Rz.ndim == 3 else Rz)
            n = int(np.ceil(H_LONG - ts))
            wf = rollout(nets[fold[k]], rho, R, mem[np.arange(N_MEM) % len(mem)], n, stochastic=True, seed=zlib.crc32(f"{k}{cut}".encode()))
            traj[k] = dict(grid=ts + np.arange(n + 1), A=a0 * wf / wf[:, :1], src="fit" if k in own else "preset")
        fp = {S[k]["a"][S[k]["t"] <= cut + 1e-9].round(8).tobytes(): k for k in traj}

        def f_median(t_h, a_h, Gq):
            tr = traj[fp[np.asarray(a_h).round(8).tobytes()]]
            return np.interp(Gq, tr["grid"], np.median(tr["A"], 0))
        BASELINES[a.model] = f_median
        for split, (test, pool) in FB.splits("whad", S).items():
            test = {k for k in test if k in traj}; pool = {k for k in pool if k in traj}
            d = f"{a.out}/whad/{split}"; os.makedirs(d, exist_ok=True)
            doc = FB.forecast_file("whad", split, a.model, cut, S, test, pool, G, G_long, T)
            n_pre = sum(traj[f["wound_id"]]["src"] == "preset" for f in doc["forecasts"])
            doc["notes"] = (f"P2 NCA v2 (follower rule) fine-tuned on real wounds, out-of-fold (median of 50 stochastic members) + P1 "
                            f"leave-one-wound-out conformal (eval/forecast_baselines.py); params: Agent 1 FOLLOWER sim fits on frames "
                            f"<= cut-off; start = observed mask at the last frame <= cut-off (auto: synthetic band); "
                            f"{n_pre} series used other wounds' fits; {fold_note}")
            json.dump(doc, open(f"{d}/{a.model}_{cut:g}h.json", "w"))
            # raw ensemble on the same series and grid, no calibration (as forecast_gate's nca_ensemble_raw)
            raw = json.loads(json.dumps(doc))
            raw["model"] = f"{a.model}_raw"
            raw["notes"] = f"P2 NCA v2 (follower rule) fine-tuned, out-of-fold, raw 50-member quantiles, NO calibration; {fold_note}"
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
            json.dump(raw, open(f"{d}/{a.model}_raw_{cut:g}h.json", "w"))
            print(f"cut {cut:g} {split}: {len(doc['forecasts'])} series", flush=True)


if __name__ == "__main__":
    main()
