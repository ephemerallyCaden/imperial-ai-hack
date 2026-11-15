"""Upload glue (#45, design 4.4): wound masks + frame interval + pixel scale -> sim start state -> Tm/bias ->
simulator ensemble (+ NCA band when available) -> forecast JSON (contracts/forecast.schema.json).

Interface for P1's upload pipeline (#15; masks from data/segment.py):
  forecast_upload(masks, um_per_px, interval_h, condition=None, seg_quality=None, wound_id="upload", exclude_wound=None)
    masks: list of 2D bool arrays (True = wound), in time order, interval_h apart, first frame at t = 0 h.
    Returns {"sim_ensemble": doc, "nca_ensemble": doc or absent} or None when refused.
  CLI: python3 sim/upload.py --masks f0.png [f1.png ...] --um-per-px 1.816 --interval 1 [--condition CC]
       [--wound-value 255] [--seg-quality q.json] --out-dir DIR
       (PNG: pixels equal to --wound-value are wound; WHAD manual masks use 0, data/segment.py output saved as 255)
  Samples: python3 sim/upload.py --samples   -> sim/forecasts/upload/  (precomputed "try a sample", #39)
Rules:
  - Refused -> no forecast: seg_quality.status == "refused", missing scale, or any mask covering <1% or >70% of the field.
  - 1 frame -> members drawn from the fitted (Tm, bias) of WHAD wounds of that condition at t0 = 10 (an empirical prior, so a
    wider band), never including exclude_wound; noted in `band` and the notes (no flag: design R16, no measure-again flag
    until a signal passes).
  - 2+ frames -> fit Tm and bias on the observed areas (follower grid as sim/v2.py, frames interval_h apart) + 50 bootstrap members.
  - Rule: Params(rule="follow") (P2 v2, adopted for physical realism); prior and fits from sim/fits/whad_fits_follow.json.
  - Forecast grid hourly from the last frame to 19 h (the WHAD horizon the models were validated on).
  - Field size: fitted Tm depends on the field of view (vacancies leave through the border reservoir), so every upload is
    mapped onto the WHAD field extent (32 x 44 sites = 640 x 880 um): a window centred on the first frame's wound, padded with
    cells if the image is smaller. Uploads whose field differs from WHAD by more than 5% are flagged.
  - NCA band: Agent 2's nca/api.py nca_forecast (start = lattice of the LAST frame), from $NCA_DIR (default <repo>/nca), with the
    follower-trained weights $NCA_WEIGHTS (default $NCA_DIR/v2/weights.pt + weights.config.json, Agent 2); skipped if absent
    (never the free-rule weights).
"""
import sys, os, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import forecast as F, v2
from cellsim import Params, simulate, SITE_UM
from start_state import mask_to_lattice, area_error

NCA_DIR = os.environ.get("NCA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "nca"))
NCA_WEIGHTS = os.environ.get("NCA_WEIGHTS", os.path.join(NCA_DIR, "v2", "weights.pt"))  # needs v2/weights.config.json beside it
RULE = "follow"
FITS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fits", "whad_fits_follow.json")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "forecasts", "upload")
HORIZON, T_CLOSE, N_MEMBERS, PRIOR_T0 = 19, 19, 50, "9.5"
FIELD_UM = (F.LATTICE[0] * SITE_UM, F.LATTICE[1] * SITE_UM)  # 640 x 880 um, the WHAD field the fits are valid for


def refusal(masks, um_per_px, seg_quality):
    if (seg_quality or {}).get("status") == "refused":
        return "segmentation refused: " + "; ".join(seg_quality.get("reasons", []))
    if not um_per_px:
        return "missing pixel scale"
    for i, m in enumerate(masks):
        if not 0.01 <= m.mean() <= 0.70:
            return f"frame {i}: wound covers {m.mean():.1%} of the field (allowed 1-70%)"
    return None


def to_whad_field(masks, um_per_px):
    """Window (or pad with cells) every mask to the WHAD field extent, centred on the first frame's wound.
    Returns (masks, flag or None)."""
    H, W = masks[0].shape
    h, w = round(FIELD_UM[0] / um_per_px), round(FIELD_UM[1] / um_per_px)
    off = max(abs(H * um_per_px / FIELD_UM[0] - 1), abs(W * um_per_px / FIELD_UM[1] - 1))
    if off <= 0.05:
        return masks, None
    ys, xs = np.nonzero(masks[0])
    cy, cx = int(ys.mean()), int(xs.mean())
    y0 = min(max(cy - h // 2, 0), max(H - h, 0))
    x0 = min(max(cx - w // 2, 0), max(W - w, 0))
    out = []
    for m in masks:
        c = np.zeros((h, w), bool)  # pad = cells (not wound)
        crop = m[y0:y0 + h, x0:x0 + w]
        py, px = (h - crop.shape[0]) // 2, (w - crop.shape[1]) // 2
        c[py:py + crop.shape[0], px:px + crop.shape[1]] = crop
        out.append(c)
    note = (f"image field {H * um_per_px:.0f} x {W * um_per_px:.0f} um differs from the {FIELD_UM[0]:.0f} x {FIELD_UM[1]:.0f} um "
            "WHAD field the parameters were fitted on; forecast uses a window of that size around the wound")
    return out, note


def prior_members(condition, exclude_wound, rng):
    """(Tm, bias) of WHAD training wounds' fits at t0 = 10, same condition if known, sampled with replacement."""
    df = F.load_curves()
    meta = df.drop_duplicates("position").set_index("position")[["wound", "condition"]].to_dict("index")
    fits = json.load(open(FITS))["fits"]  # follower fits, manual + auto
    pool = [[fits[p][PRIOR_T0]["Tm"], fits[p][PRIOR_T0]["bias"]] for p in fits
            if fits[p].get(PRIOR_T0) and meta[p]["wound"] != exclude_wound
            and (condition is None or meta[p]["condition"] == condition)]
    assert pool, f"no training fits for condition {condition}"
    return [pool[i] for i in rng.integers(0, len(pool), N_MEMBERS)], len(pool)


def fit_members(occ0, wf, interval_h, rng):
    """Grid fit of (Tm, bias) on observed wound fractions wf (frames interval_h apart) + bootstrap members."""
    hours = (len(wf) - 1) * interval_h
    g = v2.GRIDS[RULE]
    err = np.zeros((len(g), len(v2.BIAS), len(wf)))
    for i, Tm in enumerate(g):
        for j, b in enumerate(v2.BIAS):
            for s in range(v2.SEEDS):
                r = simulate(occ0, Params(Tm=Tm, bias=b, rule=RULE), hours, frame_dt=interval_h, seed=s)
                err[i, j] += (r["wound_frac"] - wf) ** 2 / v2.SEEDS
    return v2.boot_fit(err, len(wf), g, rng)  # near-tie break + off-grid refine, as the WHAD follower fits


def build_doc(model, wound_id, condition, t_obs, a_obs, grid, trajs, seg_quality, flags, notes):
    """trajs: (members, len(grid)) area normalised to the first frame."""
    mts = np.concatenate([[t_obs[-1]], grid])
    mas = [np.concatenate([[a_obs[-1]], tr]) for tr in trajs]
    t50, _ = F.event(t_obs, a_obs, mts, mas, 0.5)
    t90, times90 = F.event(t_obs, a_obs, mts, mas, 0.1)
    q = np.quantile(trajs, [0.05, 0.5, 0.95], axis=0)
    rd = lambda v: [round(float(x), 4) for x in v]
    fc = dict(wound_id=wound_id, t_hours=grid.tolist(), area_q05=rd(q[0]), area_q50=rd(q[1]), area_q95=rd(q[2]),
              t50=t50, t90=t90, p_close_by_T=round(float(np.mean(times90 <= T_CLOSE)), 4), p_stall=None, flags=flags,
              segmentation_quality=seg_quality, observed=dict(t_hours=rd(t_obs), area=rd(a_obs)),
              members=[rd(tr) for tr in trajs[:10]])
    if condition:
        fc["condition"] = condition
    return dict(version="1.0", model=model, dataset="upload", fold="upload", cutoff_hours=float(t_obs[-1]), level=0.9,
                p_close_by_T_hours=T_CLOSE, notes=notes, forecasts=[fc])


def forecast_upload(masks, um_per_px, interval_h, condition=None, seg_quality=None, wound_id="upload", exclude_wound=None):
    why = refusal(masks, um_per_px, seg_quality)
    if why:
        print("refused:", why)
        return None
    seg_quality = dict(seg_quality or dict(status="ok", reasons=[]))
    rng = np.random.default_rng(zlib.crc32(wound_id.encode()))
    masks, field_note = to_whad_field(masks, um_per_px)
    if field_note:  # a quality note, as data/upload.py does for a scale mismatch (no flag: R16)
        seg_quality = dict(status="flagged" if seg_quality.get("status") in (None, "ok") else seg_quality["status"],
                           reasons=list(seg_quality.get("reasons", [])) + [field_note])
    flags = []
    occ0 = mask_to_lattice(masks[0], um_per_px, SITE_UM)
    lat_err = area_error(occ0, masks[0])
    assert lat_err < 0.02, f"lattice area error {lat_err:.2%}"
    wf = np.array([m.mean() for m in masks])
    t_obs = np.arange(len(masks)) * float(interval_h)
    a_obs = wf / wf[0]
    if len(masks) == 1:
        members, n_pool = prior_members(condition, exclude_wound, rng)
        how = (f"single frame: parameters drawn from the training-population prior ({N_MEMBERS} draws from the fitted parameters "
               f"of {n_pool} WHAD wounds, {condition or 'all conditions'}); band not conformal-calibrated")
    else:
        fit = fit_members(occ0, wf, interval_h, rng)
        members = fit["members"]
        how = f"fit on {len(masks)} frames: Tm {fit['Tm']:.2f} h, bias {fit['bias']:.2f}, rmse {fit['rmse']:.4f}"
    grid = np.arange(np.floor(t_obs[-1]) + 1, HORIZON + 1, dtype=float)
    # forecast start = LAST uploaded frame, rescaled to its observed area (same initialisation as the NCA band)
    occ_last = mask_to_lattice(masks[-1], um_per_px, SITE_UM)
    t_last, a_last = float(t_obs[-1]), float(a_obs[-1])
    trajs = []
    for i, (Tm, bias) in enumerate(members):
        r = simulate(occ_last, Params(Tm=Tm, bias=bias, rule=RULE), HORIZON - t_last, seed=1000 + i)  # hourly from t_last
        a = a_last * r["wound_frac"] / r["wound_frac"][0]
        trajs.append(np.interp(grid, t_last + np.arange(len(a)), a))
    notes = (f"Upload forecast (sim/upload.py). Lattice {occ0.shape} at {SITE_UM:g} um/site, area error {lat_err:.2%}. "
             f"Rule: {RULE}. Parameters: {how}. Forecast starts from the last frame's mask, rescaled to its observed area.")
    out = {"sim_ensemble": build_doc("sim_ensemble", wound_id, condition, t_obs, a_obs, grid, np.array(trajs),
                                     seg_quality, flags, notes)}
    w_up, fold_up = nca_weights_for(exclude_wound or wound_id, is_whad=exclude_wound is not None)
    nca = nca_band(occ_last, members, t_obs, a_obs, grid, w_up)
    if nca is not None:
        which = (f"real-WHAD fold model {os.path.basename(w_up)} (fold {fold_up}, trained without this wound)" if fold_up is not None
                 else f"v2 base weights {os.path.basename(w_up)}")
        out["nca_ensemble"] = build_doc("nca_ensemble", wound_id, condition, t_obs, a_obs, grid, nca, seg_quality, flags,
                                        notes + f" NCA band from the same members: {which}, weights sha256 {sha12(w_up)}.")
    # 90% band = P1's leave-one-wound-out conformal, as data/upload.py and the gate; the raw ensemble stays as raw_band
    if len(masks) >= 2:
        S, jobs = pool_jobs(float(t_obs[-1]), exclude_wound)
        for model, tr in (("sim_ensemble", np.array(trajs)), ("nca_ensemble", nca)):
            if model in out:
                preds = pool_preds_sim(jobs) if model == "sim_ensemble" else pool_preds_nca(jobs, S)
                calibrate_doc(out[model], conformal(t_obs, a_obs, grid, tr, S, preds, model), len(preds))
    else:
        for doc in out.values():
            calibrate_doc(doc, None, 0)
    return out


N_POOL = 20  # members per pool series for the conformal point predictions (member median)


def pool_jobs(cut, exclude_wound):
    """WHAD pool series usable at the upload's cut-off (P1's prepare() skips), minus exclude_wound, with follower members
    fitted on their series frames <= cut (saved cubes; fits at most to 9.5 h)."""
    S, rows = v2.series_rows()
    S = {k: v for k, v in S.items() if v["wound"] != exclude_wound}
    cubes, g = v2.load_cubes(RULE), v2.GRIDS[RULE]
    jobs = []
    for k, s in sorted(S.items()):
        h = s["t"] <= cut + 1e-9
        if h.sum() < 2 or (~h).sum() == 0 or s["a"][h][-1] <= 0.1:
            continue
        n = min(int(h.sum()), cubes[k].shape[2])
        mem = v2.boot_fit(cubes[k], n, g, np.random.default_rng(zlib.crc32(f"{k}|{cut:g}".encode())))["members"][:N_POOL]
        jobs.append((k, k, s["source"], s["t"], s["a"], *rows[k], cut, mem, RULE))
    return S, jobs


def pool_preds_sim(jobs):
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(v2.WORKERS) as ex:
        res = dict(ex.map(v2.run_ens, jobs))
    return {k: (ts + np.arange(tr.shape[1]), np.median(tr, 0)) for k, (ts, tr) in res.items()}


def pool_preds_nca(jobs, S):
    """Each pool series is rolled out with the NCA fold model that holds ITS wound out (as P1's nca_realft gate files), so the
    conformal residuals stay out-of-sample; with no fold models, the v2 base weights for all."""
    sys.path.insert(0, NCA_DIR)
    from api import nca_forecast
    out = {}
    for _, k, source, t, a, frames, wf, cut, mem, _ in jobs:
        w, _ = nca_weights_for(S[k]["wound"], is_whad=True)
        ic = v2.n_obs(t, cut) - 1
        hours = t[ic] + np.arange(1, int(v2.H_SIM - t[ic]) + 1)
        A = np.asarray(nca_forecast(v2.lattice(k, source, frames[ic], wf[ic]), mem, t[:ic + 1], a[:ic + 1], hours,
                                    stochastic=True, seed=0, weights=w))
        out[k] = (np.concatenate([[t[ic]], hours]), np.concatenate([[a[ic]], np.median(A, 0)]))
    return out


def conformal(t_obs, a_obs, grid, up_trajs, S, preds, model):
    """P1's eval/forecast_baselines.forecast_file with the upload as the only test series (no_truth) and the WHAD pool."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "eval"))
    import forecast_baselines as FB
    S = dict(S)
    S["upload"] = dict(id="upload", wound="upload", cond="upload", source="upload", part="", t=t_obs, a=a_obs, no_truth=True)
    key = lambda t, a: np.asarray(t, float).tobytes() + np.asarray(a, float).tobytes()
    cut = float(t_obs[-1])
    P = {key(S[k]["t"][S[k]["t"] <= cut + 1e-9], S[k]["a"][S[k]["t"] <= cut + 1e-9]): v for k, v in preds.items()}
    P[key(t_obs, a_obs)] = (grid, np.median(up_trajs, 0))
    FB.BASELINES[model] = lambda t_h, a_h, G: np.interp(G, *P[key(t_h, a_h)])
    G_long = np.arange(grid[0], 20 * HORIZON, 0.25)  # as data/upload.py
    pool = {k for k in preds}  # series with a prediction (P1's prepare() skips the rest anyway)
    doc = FB.forecast_file("upload", "upload_vs_whad", model, cut, S, {"upload"}, pool, grid, G_long, float(HORIZON))
    return doc["forecasts"][0] if doc["forecasts"] else None


def calibrate_doc(doc, cal, n_pool):
    fc = doc["forecasts"][0]
    fc["raw_band"] = dict(label="uncalibrated spread", area_q05=fc["area_q05"], area_q50=fc["area_q50"],
                          area_q95=fc["area_q95"], t50=fc["t50"], t90=fc["t90"], p_close_by_T=fc["p_close_by_T"])
    if cal is None:
        fc["band"] = ("single frame: parameters drawn from the training-population prior; band not conformal-calibrated "
                      "(as data/upload.py's one-frame case)")
        return
    assert np.allclose(cal["t_hours"], fc["t_hours"]), "conformal grid differs"
    for k in ("area_q05", "area_q50", "area_q95", "t50", "t90", "p_close_by_T"):
        fc[k] = cal[k]
    fc["band"] = (f"90% band = P1's leave-one-wound-out conformal (eval/forecast_baselines.forecast_file), pool = {n_pool} "
                  "WHAD series (the upload's own wound excluded); raw_band = uncalibrated ensemble spread")


N_FOLDS = 4  # P1's nca/real_data.py: fold = crc32(wound) % 4


def sha12(path):
    import hashlib
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def nca_weights_for(wound, is_whad):
    """NCA weights for a series of physical wound `wound`: the real-WHAD fine-tuned fold model that holds the wound out
    (nca/v2/weights_real_fold{k}.pt, k = crc32(wound) % 4, checked against nca/v2/real_folds.json when present), else the v2
    base weights. Non-WHAD uploads are in no fold's training set, so any fold model is out-of-sample (same crc32 rule)."""
    d = os.path.dirname(NCA_WEIGHTS)
    k = zlib.crc32(wound.encode()) % N_FOLDS
    w = os.path.join(d, f"weights_real_fold{k}.pt")
    if not os.path.exists(w):
        return NCA_WEIGHTS, None
    fmap = os.path.join(d, "real_folds.json")
    if is_whad and os.path.exists(fmap):
        m = json.load(open(fmap))
        test = set(m.get("folds", {}).get(str(k), [])) if "folds" in m else {x for x, f in m.items() if int(f) == k}
        assert wound in test, f"fold {k} test set does not contain {wound} ({fmap})"
    return w, k


def nca_band(occ, members, t_obs, a_obs, grid, weights):
    """Agent 2's NCA (nca/api.py): occ = lattice at the LAST observed frame. Returns (members, len(grid)) areas, or None
    (with a message) if the NCA code or weights are not available here."""
    try:
        sys.path.insert(0, NCA_DIR)
        from api import nca_forecast
        return np.asarray(nca_forecast(occ, members, t_obs, a_obs, grid, stochastic=True, seed=0,
                                       weights=weights))
    except Exception as e:  # missing module, torch or weights: emit the sim file only
        print(f"NCA band skipped ({type(e).__name__}: {e})")
        return None


def load_png(path, wound_value):
    from PIL import Image
    return np.array(Image.open(path)) == wound_value


def write(out, out_dir, name):
    os.makedirs(out_dir, exist_ok=True)
    for model, doc in out.items():
        path = os.path.join(out_dir, f"{name}_{model}.json")
        json.dump(doc, open(path, "w"))
        print("wrote", os.path.relpath(path))


def samples():
    """Precomputed "try a sample" uploads from a manual WHAD wound (masks at full resolution, 0 = wound)."""
    from start_state import load_png_mask, UM_PER_PX
    pos, cond, wound = "exp1_partII_CC_P2", "CC", "exp1_pos2033"
    masks = [load_png_mask(pos, k)[0] for k in (0, 1, 2)]
    sq = dict(status="manual_mask", reasons=[])
    write(forecast_upload(masks, UM_PER_PX, 1.0, cond, sq, f"sample_{pos}_3frames", wound), OUT_DIR, "sample_3frames")
    write(forecast_upload(masks[:1], UM_PER_PX, 1.0, cond, sq, f"sample_{pos}_1frame", wound), OUT_DIR, "sample_1frame")
    blank = np.zeros_like(masks[0])
    assert forecast_upload([blank], UM_PER_PX, 1.0, cond, None, "sample_blank") is None


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", action="store_true")
    ap.add_argument("--masks", nargs="+")
    ap.add_argument("--um-per-px", type=float)
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--condition")
    ap.add_argument("--wound-value", type=int, default=255)
    ap.add_argument("--seg-quality")
    ap.add_argument("--wound-id", default="upload")
    ap.add_argument("--out-dir", default=OUT_DIR)
    a = ap.parse_args()
    if a.samples:
        samples()
    else:
        sq = json.load(open(a.seg_quality)) if a.seg_quality else None
        out = forecast_upload([load_png(p, a.wound_value) for p in a.masks], a.um_per_px, a.interval, a.condition, sq,
                              a.wound_id)
        if out is None:
            sys.exit(2)
        write(out, a.out_dir, a.wound_id)
