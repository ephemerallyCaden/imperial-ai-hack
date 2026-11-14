"""#25/#26: NCA ensemble forecasts on held-out WHAD wounds -> forecast JSON (contracts/forecast.schema.json).

python nca/forecast_whad.py --weights nca/weights.pt --out nca/forecasts            (needs data/processed/whad_masks/)
Writes one file per (model, fold, cut-off): nca_ensemble (50 stochastic members over bootstrapped params),
nca_deterministic (no noise, point params; band = 0 width, #26 ablation).

Per held-out wound, cut-off c (frames t <= c observed):
  1. params: fit (Tm, bias) to the observed area curve up to c by running the NCA from frame 0 over a grid
     (batched), then residual bootstrap -> 50 param samples. [Fallback until P2-4 (#23) presets/fits land;
     swap in sim fits via --fits FILE.json {position: {cutoff: [[Tm, bias], ...]}}.]
  2. start state: the observed mask at frame c, coarse-grained to the density grid (area-preserving block mean).
  3. roll the NCA forward to 19 h; area_norm(t) = observed area_norm(c) * wound_nca(t) / wound_nca(c).
Each test wound only uses its own frames <= c, so there is no leakage across folds; the fold only names the
held-out set (the train side is used by P1's conformal step, not here).
"""
import argparse, glob, json, math, os, sys
import numpy as np, pandas as pd, torch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
from model import NCA, norm_params

SITE_UM = 20.0   # one lattice site = one cell (docs/sim.md)
GRAIN = 4        # sites per density cell (docs/sim.md default)
FOLDS = {  # fold name -> held-out positions predicate
    "A_partI_to_partII": lambda r: r.part == "II",
    "A_partII_to_partI": lambda r: r.part == "I",
    "B_CC_to_C61": lambda r: r.condition == "C61",
}
TM_GRID = np.exp(np.linspace(np.log(0.03), np.log(0.5), 10))
BIAS_GRID = np.linspace(0.3, 0.95, 6)


def mask_to_density(mask, um_per_px):
    """mask (H,W) 1 = wound -> density grid (h,w), cell size GRAIN*SITE_UM um, area-preserving block mean."""
    b = GRAIN * SITE_UM / um_per_px  # mask px per density cell (non-integer)
    h, w = int(round(mask.shape[0] / b)), int(round(mask.shape[1] / b))
    ys = np.linspace(0, mask.shape[0], h + 1).round().astype(int); xs = np.linspace(0, mask.shape[1], w + 1).round().astype(int)
    cells = 1.0 - mask.astype(np.float32)
    return np.array([[cells[ys[i]:ys[i + 1], xs[j]:xs[j + 1]].mean() for j in range(w)] for i in range(h)], np.float32)


def wound(rho):  # (..., h, w) -> wound fraction
    return 1.0 - rho.mean((-2, -1))


def rollout(net, rho0, params, n, stochastic, seed=0):
    """rho0 (h,w); params (B,2) Tm,bias -> wound fraction (B, n+1) incl. frame 0 (after border reset)."""
    torch.manual_seed(seed)
    B = len(params)
    x = torch.tensor(rho0)[None, None].repeat(B, 1, 1, 1)
    p = torch.tensor([norm_params(*q) for q in params], dtype=torch.float32)
    e = net.edge; x[:, :, :e] = 1; x[:, :, -e:] = 1; x[:, :, :, :e] = 1; x[:, :, :, -e:] = 1
    with torch.no_grad():
        fr = net(x, p, n, stochastic=stochastic).numpy()
    return wound(fr), fr


def fit_params(net, rho_frame0, obs_area, c, nboot, rng):
    """Grid fit of (Tm, bias) on area_norm frames 0..c; residual bootstrap -> (nboot, 2)."""
    grid = np.array([(a, b) for a in TM_GRID for b in BIAS_GRID])
    wf, _ = rollout(net, rho_frame0, grid, c, stochastic=False)
    pred = wf / wf[:, :1]  # (G, c+1) area relative to frame 0
    obs = obs_area[: c + 1]
    sse = ((pred - obs) ** 2).sum(1); best = int(sse.argmin())
    res = obs - pred[best]
    out = []
    for _ in range(nboot):
        o = pred[best] + rng.choice(res[1:] if c >= 1 else res, size=c + 1, replace=True) * (np.arange(c + 1) > 0)
        out.append(grid[int(((pred - o) ** 2).sum(1).argmin())])
    return grid[best], np.array(out)


def event(t_obs, a_obs, c, t_fc, members, thr):
    """t when area first <= thr (closure >= 1-thr). Observed before c -> exact. Else from members (linear interp)."""
    hit = [t for t, a in zip(t_obs, a_obs) if t <= c and a <= thr]
    if hit:
        return dict(median=float(hit[0]), q05=float(hit[0]), q95=float(hit[0]), censored_prob=0.0)
    ts = []
    for m in members:
        tt = None
        prev_t, prev_a = c, a_obs[[i for i, t in enumerate(t_obs) if t <= c][-1]]
        for t, a in zip(t_fc, m):
            if a <= thr:
                tt = prev_t + (t - prev_t) * (prev_a - thr) / max(prev_a - a, 1e-9); break
            prev_t, prev_a = t, a
        ts.append(np.inf if tt is None else tt)
    ts = np.array(ts); cens = float(np.isinf(ts).mean())
    q = lambda p: (None if np.isinf(v := np.quantile(ts, p)) else float(v))
    return dict(median=q(0.5), q05=q(0.05), q95=q(0.95), censored_prob=cens)


def forecast_one(net, row, masks, t_mask, obs_t, obs_a, c, nmem, rng, deterministic, fits=None):
    um = float(masks["um_per_px"])
    m = masks["masks"]; ki = {float(t): i for i, t in enumerate(t_mask)}
    obs_c = [i for i, t in enumerate(obs_t) if t <= c]
    ic = obs_c[-1]; tc = obs_t[ic]
    rho0 = mask_to_density(m[ki[obs_t[0]]], um); rhoc = mask_to_density(m[ki[tc]], um)
    if fits is not None:
        boot = np.array(fits); point = boot.mean(0)
    else:
        point, boot = fit_params(net, rho0, np.array(obs_a), ic, nmem, rng)
    t_fc = [t for t in obs_t if t > c] or []
    T_END = 19.0
    t_fc = [float(t) for t in np.arange(math.floor(c) + 1, T_END + 1)]
    n = len(t_fc)
    if deterministic:
        wf, _ = rollout(net, rhoc, np.array([point]), n, stochastic=False)
    else:
        wf, _ = rollout(net, rhoc, boot, n, stochastic=True, seed=int(rng.integers(1 << 30)))
    A = obs_a[ic] * wf[:, 1:] / wf[:, :1]  # (B, n)
    q05, q50, q95 = (np.quantile(A, p, axis=0) for p in (0.05, 0.5, 0.95))
    return dict(
        wound_id=row.position, condition=row.condition, part=row.part, t_hours=t_fc,
        area_q05=np.maximum(q05, 0).round(4).tolist(), area_q50=np.maximum(q50, 0).round(4).tolist(),
        area_q95=np.maximum(q95, 0).round(4).tolist(),
        t50=event(obs_t, obs_a, c, t_fc, A, 0.5), t90=event(obs_t, obs_a, c, t_fc, A, 0.1),
        p_close_by_T=None,  # filled by caller (needs T)
        p_stall=None, flags=[], segmentation_quality=dict(status="manual_mask", reasons=[]),
        observed=dict(t_hours=[float(t) for t in obs_t], area=[round(float(a), 4) for a in obs_a]),
        members=A[:10].round(4).tolist() if not deterministic else [],
        fit=dict(Tm=float(point[0]), bias=float(point[1])), _A=A,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=os.path.join(HERE, "weights.pt"))
    ap.add_argument("--curves", default=os.path.join(ROOT, "data/processed/whad_curves.csv"))
    ap.add_argument("--masks", default=os.path.join(ROOT, "data/processed/whad_masks"))
    ap.add_argument("--cutoffs", type=float, nargs="+", default=[1, 3, 5, 9], help="hours (frames 0..c observed)")
    ap.add_argument("--T", type=float, default=12.0, help="p_close_by_T horizon (hours)")
    ap.add_argument("--members", type=int, default=50)
    ap.add_argument("--fits", default=None)
    ap.add_argument("--out", default=os.path.join(HERE, "forecasts"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    net = NCA(); net.load_state_dict(torch.load(a.weights, map_location="cpu")); net.eval()
    cur = pd.read_csv(a.curves)
    pos = cur.groupby("position").first().reset_index()
    fits = json.load(open(a.fits)) if a.fits else {}
    for fold, test in FOLDS.items():
        held = [r for r in pos.itertuples() if test(r)]
        for c in a.cutoffs:
            for model, det in (("nca_ensemble", False), ("nca_deterministic", True)):
                rng = np.random.default_rng(0)
                fcs = []
                for r in held:
                    d = cur[cur.position == r.position].sort_values("t_hours")
                    mk = np.load(f"{a.masks}/{r.position}.npz")
                    f = forecast_one(net, r, mk, mk["t_hours"], d.t_hours.tolist(), d.area_norm.tolist(), c, a.members, rng, det,
                                     fits.get(r.position, {}).get(str(c)))
                    A = f.pop("_A"); ti = [i for i, t in enumerate(f["t_hours"]) if t <= a.T]
                    done_obs = any(t <= c and x <= 0.1 for t, x in zip(f["observed"]["t_hours"], f["observed"]["area"]))
                    f["p_close_by_T"] = 1.0 if done_obs else float((A[:, ti] <= 0.1).any(1).mean()) if ti else 0.0
                    if f["t90"]["q95"] is None and f["t90"]["censored_prob"] > 0.05:
                        f["flags"].append(dict(type="measure_again", reason="The 90% range for time to 90% closed is open-ended; another frame would narrow it."))
                    if not f["members"]:
                        f.pop("members")
                    fcs.append(f)
                doc = dict(version="1.0", model=model, dataset="whad", fold=fold, cutoff_hours=c, level=0.9, p_close_by_T_hours=a.T,
                           notes="P2 NCA emulator of the cell-agent sim; params fitted per wound on frames <= cut-off (NCA grid + residual bootstrap)",
                           forecasts=fcs)
                fn = f"{a.out}/whad_{model}_{fold}_{c:g}h.json"
                json.dump(doc, open(fn, "w"))
                print("wrote", fn, len(fcs), "wounds")
