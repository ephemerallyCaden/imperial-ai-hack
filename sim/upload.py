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
    wider band), never including exclude_wound; flagged "measure_again" as preset-based.
  - 2+ frames -> fit Tm and bias on the observed areas (grid as sim/calibrate.py, frames interval_h apart) + 50 bootstrap members.
  - Forecast grid hourly from the last frame to 19 h (the WHAD horizon the models were validated on).
  - Field size: fitted Tm depends on the field of view (vacancies leave through the border reservoir), so every upload is
    mapped onto the WHAD field extent (32 x 44 sites = 640 x 880 um): a window centred on the first frame's wound, padded with
    cells if the image is smaller. Uploads whose field differs from WHAD by more than 5% are flagged.
  - NCA band: Agent 2's nca/api.py nca_forecast (start = lattice of the LAST frame), from $NCA_DIR (default <repo>/nca).
"""
import sys, os, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import calibrate, forecast as F
from cellsim import Params, simulate, SITE_UM
from start_state import mask_to_lattice, area_error

NCA_DIR = os.environ.get("NCA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "nca"))

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "forecasts", "upload")
HORIZON, T_CLOSE, N_MEMBERS, PRIOR_T0 = 19, 12, 50, "10"
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
    flag = dict(type="measure_again", reason=f"The image field ({H * um_per_px:.0f} x {W * um_per_px:.0f} um) differs from "
                f"the {FIELD_UM[0]:.0f} x {FIELD_UM[1]:.0f} um field the parameters were fitted on; the forecast uses a "
                "window of that size around the wound.")
    return out, flag


def prior_members(condition, exclude_wound, rng):
    """(Tm, bias) of WHAD training wounds' fits at t0 = 10, same condition if known, sampled with replacement."""
    df = F.load_curves()
    meta = df.drop_duplicates("position").set_index("position")[["wound", "condition"]].to_dict("index")
    fits = {**json.load(open(calibrate.OUT))["fits"], **json.load(open(F.AUTO_FITS))["fits"]}
    pool = [[fits[p][PRIOR_T0]["Tm"], fits[p][PRIOR_T0]["bias"]] for p in fits
            if fits[p].get(PRIOR_T0) and meta[p]["wound"] != exclude_wound
            and (condition is None or meta[p]["condition"] == condition)]
    assert pool, f"no training fits for condition {condition}"
    return [pool[i] for i in rng.integers(0, len(pool), N_MEMBERS)], len(pool)


def fit_members(occ0, wf, interval_h, rng):
    """Grid fit of (Tm, bias) on observed wound fractions wf (frames interval_h apart) + bootstrap members."""
    hours = (len(wf) - 1) * interval_h
    err = np.zeros((len(calibrate.TM_GRID), len(calibrate.BIAS_GRID), len(wf)))
    for i, Tm in enumerate(calibrate.TM_GRID):
        for j, b in enumerate(calibrate.BIAS_GRID):
            for s in range(calibrate.SEEDS):
                r = simulate(occ0, Params(Tm=Tm, bias=b), hours, frame_dt=interval_h, seed=s)
                err[i, j] += (r["wound_frac"] - wf) ** 2 / calibrate.SEEDS
    fr = np.arange(len(wf))  # fit_from_cube counts frames with index <= t0
    return calibrate.fit_from_cube(fr, err, len(wf) - 1, rng)


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
    seg_quality = seg_quality or dict(status="ok", reasons=[])
    rng = np.random.default_rng(zlib.crc32(wound_id.encode()))
    masks, field_flag = to_whad_field(masks, um_per_px)
    flags = [field_flag] if field_flag else []
    occ0 = mask_to_lattice(masks[0], um_per_px, SITE_UM)
    lat_err = area_error(occ0, masks[0])
    assert lat_err < 0.02, f"lattice area error {lat_err:.2%}"
    wf = np.array([m.mean() for m in masks])
    t_obs = np.arange(len(masks)) * float(interval_h)
    a_obs = wf / wf[0]
    if len(masks) == 1:
        members, n_pool = prior_members(condition, exclude_wound, rng)
        how = f"preset: {N_MEMBERS} draws from the fitted parameters of {n_pool} WHAD wounds ({condition or 'all conditions'})"
        flags.append(dict(type="measure_again", reason="Only one frame, so this forecast uses typical parameters, "
                                                       "not this wound's own; upload more frames to narrow the band."))
    else:
        fit = fit_members(occ0, wf, interval_h, rng)
        members = fit["members"]
        how = f"fit on {len(masks)} frames: Tm {fit['Tm']:.2f} h, bias {fit['bias']:.2f}, rmse {fit['rmse']:.4f}"
    grid = np.arange(np.floor(t_obs[-1]) + 1, HORIZON + 1, dtype=float)
    trajs = []
    for i, (Tm, bias) in enumerate(members):
        r = simulate(occ0, Params(Tm=Tm, bias=bias), HORIZON, seed=1000 + i)  # hourly frames from t = 0
        trajs.append(r["wound_frac"][grid.astype(int)] / r["wound_frac"][0])
    notes = (f"Upload forecast (sim/upload.py). Lattice {occ0.shape} at {SITE_UM:g} um/site, area error {lat_err:.2%}. "
             f"Parameters: {how}.")
    out = {"sim_ensemble": build_doc("sim_ensemble", wound_id, condition, t_obs, a_obs, grid, np.array(trajs),
                                     seg_quality, flags, notes)}
    nca = nca_band(mask_to_lattice(masks[-1], um_per_px, SITE_UM), members, t_obs, a_obs, grid)
    if nca is not None:
        out["nca_ensemble"] = build_doc("nca_ensemble", wound_id, condition, t_obs, a_obs, grid, nca, seg_quality, flags,
                                        notes + " NCA emulator band from the same members.")
    return out


def nca_band(occ0, members, t_obs, a_obs, grid):
    """Agent 2's NCA (nca/api.py): occ = lattice at the LAST observed frame. Returns (members, len(grid)) areas, or None
    (with a message) if the NCA code or weights are not available here."""
    try:
        sys.path.insert(0, NCA_DIR)
        from api import nca_forecast
        return np.asarray(nca_forecast(occ, members, t_obs, a_obs, grid, stochastic=True, seed=0,
                                       weights=os.path.join(NCA_DIR, "weights.pt")))
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
