"""#25/#26: ensemble forecasts on held-out WHAD wounds -> forecast JSON (contracts/forecast.schema.json).

python nca/forecast_whad.py --weights nca/weights.pt --fits sim/fits/whad_fits.json --out nca/forecasts [--sim]
Models (one file per model x fold x cut-off):
  nca_ensemble       50 stochastic NCA members, one per bootstrapped (Tm, bias) member of the sim fit (#23)
  nca_deterministic  no noise, point fit (Tm, bias)                                      (#26 ablation)
  sim_ensemble       the cell-agent simulator itself, same 50 members, one seed each     (#26, --sim)
Per held-out wound and cut-off t0 (frames t <= t0 observed; t0 in hours = frame index):
  params: fits[position][t0] from sim/calibrate.py (fitted on that wound's frames <= t0 only, so nothing leaks
          across folds); null fit (too few frames) -> the fold's training-set preset for the wound's condition.
  start:  the observed mask at t0 -> lattice (sim/start_state.py, SITE_UM) -> density grid (GRAIN) + reservoir R.
  area:   area_norm(t) = observed area_norm(t0) * wound(t) / wound(t0), forecast hourly from t0+1 to 19 h.
"""
import argparse, json, os, sys
import numpy as np, pandas as pd, torch
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "sim")); sys.path.insert(0, HERE)
from cellsim import Params, simulate, reservoir_mask, coarse_grain, SITE_UM, GRAIN
from start_state import load_png_mask, mask_to_lattice
from model import NCA, norm_params

T_END, LEVEL = 19.0, 0.9
FOLDS = {  # fold -> held-out predicate on (part, condition). design.md R15: fold A dropped (part II = same wounds)
    "loo": lambda p, c: True,                 # leave-one-wound-out: every wound, nothing from its own physical wound
    "B_CC_to_C61": lambda p, c: c == "C61",   # train CC, test C61
}


def start(position, frame):
    occ = mask_to_lattice(*load_png_mask(position, int(frame)), SITE_UM)
    p = Params()
    R = reservoir_mask(occ, p.edge).astype(np.uint8)
    return occ, coarse_grain(occ, GRAIN), coarse_grain(R, GRAIN)


def nca_rollout(net, rho, R, params, n, stochastic, seed):
    torch.manual_seed(seed)
    B = len(params)
    x = torch.tensor(rho)[None, None].repeat(B, 1, 1, 1); r = torch.tensor(R)[None, None].repeat(B, 1, 1, 1)
    p = torch.tensor([norm_params(*q) for q in params], dtype=torch.float32)
    with torch.no_grad():
        fr = net(x, p, n, R=r, stochastic=stochastic).numpy()
    return 1.0 - fr.mean((2, 3))  # wound fraction (B, n+1)


def _sim(args):
    occ, Tm, bias, n, seed = args
    return simulate(occ, Params(Tm=Tm, bias=bias), n, seed=seed, grain=GRAIN)["density"].mean((1, 2))


def sim_rollout(occ, params, n, seed, pool):
    dens = pool.map(_sim, [(occ, float(a), float(b), n, seed + i) for i, (a, b) in enumerate(params)])
    return 1.0 - np.stack(dens)


def event(obs_t, obs_a, t0, t_fc, A, thr):
    """Time area first <= thr. Observed by t0 -> exact. Else per member, linear interpolation; never -> censored."""
    hit = [t for t, a in zip(obs_t, obs_a) if t <= t0 and a <= thr]
    if hit:
        return dict(median=float(hit[0]), q05=float(hit[0]), q95=float(hit[0]), censored_prob=0.0)
    a0 = [a for t, a in zip(obs_t, obs_a) if t <= t0][-1]
    ts = []
    for m in A:
        tt, pt, pa = np.inf, t0, a0
        for t, a in zip(t_fc, m):
            if a <= thr:
                tt = pt + (t - pt) * (pa - thr) / max(pa - a, 1e-9); break
            pt, pa = t, a
        ts.append(tt)
    ts = np.array(ts)
    q = lambda p: None if np.isinf(v := np.quantile(ts, p)) else round(float(v), 3)
    return dict(median=q(0.5), q05=q(0.05), q95=q(0.95), censored_prob=float(np.isinf(ts).mean()))


def entry(row, obs_t, obs_a, t0, t_fc, A, T, keep_members):
    q05, q50, q95 = (np.maximum(np.quantile(A, p, axis=0), 0).round(4).tolist() for p in (0.05, 0.5, 0.95))
    done = any(t <= t0 and a <= 0.1 for t, a in zip(obs_t, obs_a))
    ti = [i for i, t in enumerate(t_fc) if t <= T]
    f = dict(wound_id=row.position, condition=row.condition, part=row.part, t_hours=t_fc,
             area_q05=q05, area_q50=q50, area_q95=q95,
             t50=event(obs_t, obs_a, t0, t_fc, A, 0.5), t90=event(obs_t, obs_a, t0, t_fc, A, 0.1),
             p_close_by_T=1.0 if done else (float((A[:, ti] <= 0.1).any(1).mean()) if ti else 0.0),
             p_stall=None, flags=[], segmentation_quality=dict(status="manual_mask", reasons=[]),
             observed=dict(t_hours=[float(t) for t in obs_t], area=[round(float(a), 4) for a in obs_a]))
    if f["t90"]["q95"] is None and 0.05 < f["t90"]["censored_prob"] < 1:
        f["flags"].append(dict(type="measure_again", reason="The 90% range for time to 90% closed is open-ended; another frame would narrow it."))
    if keep_members:
        f["members"] = A[:10].round(4).tolist()
    return f


def params_for(fits, fold, row, t0, pos):
    """The wound's own fit on frames <= t0; if null (too few frames) a preset from TRAINING wounds only:
    loo = median fit over other physical wounds with the same condition (all conditions if none); B = CC median."""
    f = fits["fits"].get(row.position, {}).get(str(t0))
    if f:
        return np.array([f["Tm"], f["bias"]]), np.array(f["members"]), "fit"
    def ok(r):
        return r.wound != row.wound and fits["fits"].get(r.position, {}).get(str(t0))
    train = [r for r in pos.itertuples() if ok(r) and (r.condition == "CC" if fold == "B_CC_to_C61" else r.condition == row.condition)]
    train = train or [r for r in pos.itertuples() if ok(r)]
    v = np.array([[fits["fits"][r.position][str(t0)]["Tm"], fits["fits"][r.position][str(t0)]["bias"]] for r in train])
    point = np.array([np.exp(np.median(np.log(v[:, 0]))), np.median(v[:, 1])])
    return point, v[np.random.default_rng(t0).integers(len(v), size=50)], "preset"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=os.path.join(HERE, "weights.pt"))
    ap.add_argument("--fits", default=os.path.join(ROOT, "sim/fits/whad_fits.json"))
    ap.add_argument("--curves", default=os.path.join(ROOT, "data/processed/whad_curves.csv"))
    ap.add_argument("--cutoffs", type=int, nargs="+", default=None, help="t0 frames; default = the fits file's cut-offs")
    ap.add_argument("--T", type=float, default=12.0, help="p_close_by_T horizon (hours)")
    ap.add_argument("--sim", action="store_true", help="also write sim_ensemble (slow: 50 sim runs per wound)")
    ap.add_argument("--out", default=os.path.join(HERE, "forecasts"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    net = NCA(); net.load_state_dict(torch.load(a.weights, map_location="cpu")); net.eval()
    fits = json.load(open(a.fits))
    cur = pd.read_csv(a.curves)
    pos = cur.groupby("position").first().reset_index()
    cutoffs = a.cutoffs or fits["params"]["cutoffs"]
    pool = Pool(8) if a.sim else None
    for fold, test in FOLDS.items():
        held = [r for r in pos.itertuples() if test(r.part, r.condition)]
        for t0 in cutoffs:
            out = {"nca_ensemble": [], "nca_deterministic": []} | ({"sim_ensemble": []} if a.sim else {})
            src = {}
            for k, r in enumerate(held):
                d = cur[cur.position == r.position].sort_values("t_hours")
                obs_t, obs_a = d.t_hours.tolist(), d.area_norm.tolist()
                if not any(t <= t0 for t in obs_t):  # wound's first annotated frame is after t0: nothing to forecast from
                    src[r.position] = "skipped"; continue
                ic = max(i for i, t in enumerate(obs_t) if t <= t0)
                occ, rho, R = start(r.position, d.frame.iloc[ic])
                t_fc = [float(t) for t in np.arange(int(obs_t[ic]) + 1, T_END + 1)]
                n = len(t_fc)
                point, mem, src[r.position] = params_for(fits, fold, r, t0, pos)
                scale = lambda wf: obs_a[ic] * wf[:, 1:] / wf[:, :1]
                seed = 7919 * k + t0
                out["nca_ensemble"].append(entry(r, obs_t, obs_a, t0, t_fc, scale(nca_rollout(net, rho, R, mem, n, True, seed)), a.T, True))
                out["nca_deterministic"].append(entry(r, obs_t, obs_a, t0, t_fc, scale(nca_rollout(net, rho, R, point[None], n, False, seed)), a.T, False))
                if a.sim:
                    out["sim_ensemble"].append(entry(r, obs_t, obs_a, t0, t_fc, scale(sim_rollout(occ, mem, n, seed, pool)), a.T, True))
            for model, fcs in out.items():
                note = {"nca_ensemble": "NCA emulator of the cell-agent sim, 50 members = bootstrapped (Tm, bias) fits x NCA noise",
                        "nca_deterministic": "NCA, no noise, point (Tm, bias) fit: ablation (band has zero width)",
                        "sim_ensemble": "cell-agent simulator, 50 bootstrapped (Tm, bias) members, one seed each"}[model]
                n_pre = sum(v == "preset" for v in src.values())
                skipped = [k for k, v in src.items() if v == "skipped"]
                doc = dict(version="1.0", model=model, dataset="whad", fold=fold, cutoff_hours=float(t0), level=LEVEL,
                           p_close_by_T_hours=a.T, notes=f"{note}; start = observed mask at t0; {n_pre} wound(s) have no own fit (< 2 frames) and use training-wound fits (preset; members = resampled training fits)"
                           + (f"; skipped (first frame after t0): {', '.join(skipped)}" if skipped else ""),
                           forecasts=fcs)
                fn = f"{a.out}/whad_{model}_{fold}_t{t0}.json"
                json.dump(doc, open(fn, "w"))
                print("wrote", fn, len(fcs), "wounds", flush=True)
