"""NCA forecaster for uploads (design.md R28 follow-up): the real-data NCA v3 behind data/upload.py.

Same pipeline the gate validated (nca/forecast_realft.py), for one uploaded series:
  params   (Tm, bias) fitted on the uploaded frames with the original simulator rule (sim/calibrate.py: 21 x 6 grid x 3
           seeds + 50 bootstrap members); 1 frame -> prior = other WHAD wounds' 9.5 h fits
  model    3 seed models; members split round-robin. exclude_wound set (the demo sample) -> the fold models that never
           trained on that wound (nca/weights_real3_fold{k}_s{s}.pt); otherwise the all-wounds models (weights_real3_all_s{s}.pt)
  start    the last uploaded mask -> lattice -> coarse density + reservoir (as in training)
  band     leave-one-wound-out conformal with the NCA's own held-out residuals on WHAD (nca_realft3_raw files, nearest
           gate cut-off), aligned by hours since the forecast start; the uploaded wound's own series are never in the pool
Returns a forecast-contract doc (model nca_realft3) or raises; data/upload.py falls back to edge speed on any error.
"""
import json, os, sys, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path[:0] = [os.path.join(ROOT, "sim"), os.path.join(ROOT, "nca"), os.path.join(ROOT, "eval")]
UM_PER_PX = 0.454 * 4      # upload masks are at 1/4 of WHAD resolution
HORIZON, H_LONG, N_MEM = 19.0, 100, 50
GATE_CUTS = [1.9, 3.8, 5.7, 9.5]


def fit_params(occ0, t, wf, seed=0):
    """Original-rule simulator fit on the uploaded frames (needs >= 2 frames on whole hours)."""
    import calibrate as C
    from cellsim import Params, simulate
    fr = np.rint(np.asarray(t) - t[0]).astype(int)
    err = np.zeros((len(C.TM_GRID), len(C.BIAS_GRID), len(fr)))
    for i, Tm in enumerate(C.TM_GRID):
        for j, b in enumerate(C.BIAS_GRID):
            for s in range(C.SEEDS):
                r = simulate(occ0, Params(Tm=Tm, bias=b), int(fr[-1]), seed=s)
                err[i, j] += (r["wound_frac"][fr] - wf) ** 2 / C.SEEDS
    f = C._fit(fr.astype(float), err, float(fr[-1]), np.random.default_rng(seed), 0)
    return np.array(f["members"]), f"fit on {len(fr)} frames: Tm {f['Tm']:.2f} h, bias {f['bias']:.2f}"


def prior_params(exclude_wound, rng):
    fits = {**json.load(open(os.path.join(ROOT, "sim/fits/whad_fits.json")))["fits"],
            **json.load(open(os.path.join(ROOT, "sim/fits/whad_auto_fits.json")))["fits"]}
    import forecast_baselines as FB
    S = FB.load("whad")
    pool = [[f["9.5"]["Tm"], f["9.5"]["bias"]] for p, f in fits.items()
            if "9.5" in f and p in S and S[p]["wound"] != exclude_wound]
    return np.array(pool)[rng.integers(len(pool), size=N_MEM)], f"one frame: prior from {len(pool)} WHAD wounds' 9.5 h fits"


def nets_for(exclude_wound):
    from api import load
    if exclude_wound:
        k = zlib.crc32(exclude_wound.encode()) % 4
        paths = [os.path.join(ROOT, f"nca/weights_real3_fold{k}_s{s}.pt") for s in range(3)]
        which = f"fold {k} models (never trained on {exclude_wound})"
    else:
        paths = [os.path.join(ROOT, f"nca/weights_real3_all_s{s}.pt") for s in range(3)]
        which = "models trained on all WHAD wounds"
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        raise FileNotFoundError(f"NCA weights missing: {missing}")
    return [load(p) for p in paths], which


def pool_residuals(cut, exclude_wound):
    """Per WHAD series: (hours since its forecast start, observed - raw NCA median) from the out-of-fold gate files."""
    import forecast_baselines as FB
    c = min(GATE_CUTS, key=lambda x: abs(x - cut))
    doc = json.load(open(os.path.join(ROOT, f"eval/forecasts/whad/loo_all/nca_realft3_raw_{c:g}h.json")))
    out = []
    for f in doc["forecasts"]:
        if f.get("wound") == exclude_wound or f["wound_id"] in FB.EXCLUDE:
            continue
        ot, oa = np.array(f["observed"]["t_hours"]), np.array(f["observed"]["area"])
        start = ot[ot <= c + 1e-9][-1]
        ft, med = np.array(f["t_hours"]), np.array(f["area_q50"])
        out.append((ft - start, np.interp(ft, ot, oa) - med))
    return out, c


def forecast(masks, t, a, wound_frac, exclude_wound=None):
    import forecast_baselines as FB
    from api import lattice_to_state, rollout
    from start_state import mask_to_lattice
    rng = np.random.default_rng(0)
    t, a = np.asarray(t, float), np.asarray(a, float)
    cut = float(t[-1])
    occs = [mask_to_lattice(m.astype(bool), UM_PER_PX) for m in masks]
    if len(masks) >= 2:
        mem, how = fit_params(occs[0], t, np.asarray(wound_frac, float))
    else:
        mem, how = prior_params(exclude_wound, rng)
    nets, which = nets_for(exclude_wound)
    rho, R = lattice_to_state(occs[-1])
    n = int(np.ceil(H_LONG - cut))
    M = mem[np.arange(N_MEM) % len(mem)]
    wf = np.concatenate([rollout(nets[j], rho, R, M[j::len(nets)], n, stochastic=True, seed=zlib.crc32(f"upload{j}".encode()))
                         for j in range(len(nets))])
    wf = wf[np.argsort(np.concatenate([np.arange(j, N_MEM, len(nets)) for j in range(len(nets))]))]
    grid = cut + np.arange(n + 1)
    A = a[-1] * wf / wf[:, :1]                      # area relative to the first uploaded frame
    G = np.arange(np.floor(cut) + 1, HORIZON + 1e-9, 1.0)
    pred = np.interp(G, grid, np.median(A, 0))
    pool, c = pool_residuals(cut, exclude_wound)
    Rz = np.stack([np.interp(G - cut, h, r) for h, r in pool])
    E = np.clip(pred[None, :] + Rz, 0, None)
    lq, hq = FB.q_levels(len(E))
    lo, med, hi = np.quantile(E, [lq, 0.5, hq], axis=0, method="inverted_cdf")
    ev = {}
    for lvl, key in FB.EVENTS:
        seen = FB.event_time(t, a, lvl)
        if seen is not None:
            ev[key] = {"median": float(seen), "q05": float(seen), "q95": float(seen), "censored_prob": 0.0}
            continue
        hit = E <= lvl
        times = np.where(hit.any(1), G[hit.argmax(1)], np.inf)
        q = np.quantile(times, [lq, 0.5, hq], method="inverted_cdf")
        fin = lambda x: round(float(x), 2) if np.isfinite(x) else None
        ev[key] = {"median": fin(q[1]), "q05": fin(q[0]), "q95": fin(q[2]), "censored_prob": round(float(np.mean(~np.isfinite(times))), 3)}
    hit90 = E <= 0.1
    r4 = lambda x: [round(float(v), 4) for v in x]
    f = {"wound_id": "upload", "t_hours": r4(G), "area_q05": r4(lo), "area_q50": r4(med), "area_q95": r4(hi),
         "t50": ev["t50"], "t90": ev["t90"],
         "p_close_by_T": round(float(np.mean(hit90.any(1))), 3),
         # one frame: no closure rate measured (prior params), so no stall estimate, as on the edge-speed path
         "p_stall": round(float(np.mean(E[:, -1] >= 0.9 * a[-1])), 3) if len(masks) >= 2 else None, "flags": [],
         "segmentation_quality": {"status": "ok", "reasons": []},
         "observed": {"t_hours": r4(t), "area": r4(a)},
         "members": [r4(np.interp(G, grid, m)) for m in A[:5]]}
    return {"version": "1.0", "model": "nca_realft3", "dataset": "upload", "fold": "upload_vs_whad", "cutoff_hours": cut,
            "level": FB.LEVEL, "p_close_by_T_hours": HORIZON,
            "notes": (f"NCA fine-tuned on real WHAD frames (v3, design.md R28), {which}; params: {how}; band: NCA's own "
                      f"out-of-fold residuals on {len(E)} WHAD series at the {c:g} h gate cut-off, aligned by hours since start"),
            "forecasts": [f]}
