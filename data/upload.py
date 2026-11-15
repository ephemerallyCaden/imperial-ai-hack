"""Upload pipeline (design.md 4.4): 1-5 frames -> QC -> wound masks -> forecast with a calibrated 90% band.

  python -I data/upload.py --frames a.png b.png c.png --interval 1 --scale 0.454 --out OUTDIR [--name NAME]
  python -I data/upload.py --samples            # build the "try a sample" files in web/data/samples/

Scope: phase-contrast scratch assays like WHAD (MCF10A, 0.454 um/px). Other scales are resampled to 0.454 um/px and
flagged as outside the validated scope. Missing interval or scale -> refused.
Refusal rules (5.5): a frame is refused if blank, out of focus (texture_p90 < 1.0), wound mask < 1% or > 70% of the
field, or more than 3 wound components each > 5% of the field. Any refused frame refuses the upload.
Forecast: 1 frame -> spread of the 28 WHAD wounds' observed curves ("typical wound", no measured rate);
>= 2 frames -> edge-speed baseline + leave-one-wound-out conformal band (pool = WHAD wounds). More frames narrow it.
Outputs in OUTDIR:
  NAME.json              forecast contract file (contracts/forecast.schema.json), or {"version","refused":true,"reasons"}
  NAME_frameK_mask.png   wound mask per frame (white = wound), for the outline overlay
  NAME_masks.npz         masks at 1.816 um/px (same format as data/processed/whad_masks) for the simulator start state
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "eval")]
from segment import DOWN, FOCUS_FLOOR, load_gray, segment, texture_p90  # noqa: E402
import forecast_baselines as FB  # noqa: E402

WHAD_UM_PER_PX = 0.454
HORIZON_H = 19.0


def stall_threshold(cut):
    """Stall threshold for the nearest WHAD cut-off (eval/results/flag_thresholds.json, from eval/flags.py)."""
    p = os.path.join(HERE, "..", "eval", "results", "flag_thresholds.json")
    if not os.path.exists(p):
        return None
    th = json.load(open(p))
    return th[min(th, key=lambda k: abs(float(k) - cut))]["p_stall"]


def schedule_advice(p, cut):
    """Next step from P(90% closed by 19 h), using the held-out WHAD stop-early simulation (eval/scheduler.py)."""
    checks = [1.9, 3.8, 5.7, 9.5]
    nxt = next((c for c in checks if c > cut + 1e-9), None)
    if p <= 0.1:
        return {"action": "call", "call": "unlikely to reach 90% closure by 19 h",
                "evidence": "on held-out WHAD wounds such early calls were right 89% of the time (always saying no: 73%)"}
    if p >= 0.9:
        return {"action": "call", "call": "likely to reach 90% closure by 19 h",
                "evidence": "untested: no held-out WHAD wound got this call early"}
    return {"action": "image_again", "next_image_hours": nxt,
            "evidence": "the 90% band narrows on average from 0.59 (1.9 h) to 0.32 (3.8 h) of the starting area"}


def check_frame(img, scale):
    reasons = []
    if img.std() < 1e-3:
        return None, ["blank frame"]
    if abs(scale - WHAD_UM_PER_PX) > 0.05 * WHAD_UM_PER_PX:  # bring to WHAD resolution before segmenting
        img = ndi.zoom(img, scale / WHAD_UM_PER_PX, order=1)
    focus = texture_p90(img)
    if focus < FOCUS_FLOOR:
        reasons.append(f"out of focus (texture score {focus:.2f} < {FOCUS_FLOOR})")
    m = segment(img)
    frac = float(m.mean())
    if frac < 0.01:
        reasons.append(f"no wound found ({100 * frac:.1f}% of the field < 1%)")
    elif frac > 0.70:
        reasons.append(f"wound covers {100 * frac:.0f}% of the field (> 70%): probably not a scratch assay")
    lab, n = ndi.label(m)
    big = int((ndi.sum(m, lab, range(1, n + 1)) > 0.05 * m.size).sum()) if n else 0
    if big > 3:
        reasons.append(f"{big} separate wound regions > 5% of the field (> 3)")
    return m, reasons


CALIBRATED = {"CC", "C61", "N61", "NC"}  # WHAD MCF10A conditions in the calibration pool


def condition_guard(f, condition, cut):
    """v4 (R28): an uploaded condition outside the calibration set gets the band widened by the factor measured on
    known conditions (eval/results/condition_shift.json, edge_speed) and an uncalibrated_condition flag."""
    p = os.path.join(HERE, "..", "eval", "results", "condition_shift.json")
    if condition is None or condition in CALIBRATED or not os.path.exists(p):
        return
    fac = json.load(open(p)).get("edge_speed", {})
    if not fac:
        return
    lam = fac[min(fac, key=lambda k: abs(float(k) - cut))]["lambda"]
    lo, med, hi = (np.array(f[k]) for k in ("area_q05", "area_q50", "area_q95"))
    f["area_q05"] = np.round(np.maximum(med - lam * (med - lo), 0), 4).tolist()
    f["area_q95"] = np.round(med + lam * (hi - med), 4).tolist()
    f["flags"].append({"type": "uncalibrated_condition",
                       "reason": f"'{condition}' is not in the calibration set (WHAD MCF10A CC/C61/N61/NC): band widened x{lam:g}; "
                                 "calibration did not transfer to a new cell type in our tests."})


def run(frames, interval, scale, out, name, exclude_wound=None, condition=None):
    os.makedirs(out, exist_ok=True)
    if not interval or not scale:
        doc = {"version": "1.0", "refused": True, "reasons": ["frame interval and pixel scale are required"]}
        json.dump(doc, open(f"{out}/{name}.json", "w")); return doc
    masks, reasons = [], []
    for k, f in enumerate(frames):
        m, r = check_frame(load_gray(f), scale)
        reasons += [f"frame {k + 1}: {x}" for x in r]
        if m is not None:
            masks.append(m)
            Image.fromarray((m * 255).astype(np.uint8)).save(f"{out}/{name}_frame{k + 1}_mask.png")
    if reasons:
        doc = {"version": "1.0", "refused": True, "reasons": reasons}
        json.dump(doc, open(f"{out}/{name}.json", "w")); return doc
    t = np.arange(len(masks)) * float(interval)
    w = np.array([m.mean() for m in masks])
    a = w / w[0]
    np.savez_compressed(f"{out}/{name}_masks.npz", masks=np.stack(masks).astype(np.uint8), t_hours=t,
                        um_per_px=WHAD_UM_PER_PX * DOWN)
    S = {k: v for k, v in FB.load("whad").items() if v["wound"] != exclude_wound}
    S["upload"] = dict(id="upload", wound="upload", cond="upload", source="upload", part="", t=t, a=a, no_truth=True)
    cut = float(t[-1])
    G = np.arange(np.floor(cut) + 1, HORIZON_H + 1e-9, 1.0)
    G_long = np.arange(G[0], 20 * HORIZON_H, 0.25)
    pool = set(S) - {"upload"}
    if len(masks) >= 2:
        doc = FB.forecast_file("upload", "upload_vs_whad", "edge_speed", cut, S, {"upload"}, pool, G, G_long, HORIZON_H)
    else:  # one frame: no rate measured; use the spread of WHAD wounds' observed curves
        E = np.stack([np.interp(G, s["t"], s["a"]) for k, s in S.items() if k in pool])
        lq, hq = FB.q_levels(len(E))
        lo, med, hi = np.quantile(E, [lq, 0.5, hq], axis=0, method="inverted_cdf")
        r4 = lambda x: [round(float(v), 4) for v in x]
        ev = {}
        for lvl, key in FB.EVENTS:
            tt = np.array([x if (x := FB.event_time(s["t"], s["a"], lvl)) is not None else np.inf for k, s in S.items() if k in pool])
            q = np.quantile(tt, [lq, 0.5, hq], method="inverted_cdf")
            fin = lambda x: round(float(x), 2) if np.isfinite(x) else None
            ev[key] = {"median": fin(q[1]), "q05": fin(q[0]), "q95": fin(q[2]), "censored_prob": round(float(np.mean(tt > G[-1])), 3)}
        ev["p"] = float(np.mean([(x := FB.event_time(s["t"], s["a"], 0.1)) is not None and x <= HORIZON_H for k, s in S.items() if k in pool]))
        doc = {"version": "1.0", "model": "whad_population_prior", "dataset": "upload", "fold": "upload_vs_whad", "cutoff_hours": cut,
               "level": FB.LEVEL, "p_close_by_T_hours": HORIZON_H, "notes": "one frame: spread of WHAD wounds, no measured closure rate",
               "forecasts": [{"wound_id": "upload", "t_hours": r4(G), "area_q05": r4(lo), "area_q50": r4(med), "area_q95": r4(hi),
                              "t50": ev["t50"], "t90": ev["t90"], "p_close_by_T": round(ev["p"], 3), "p_stall": None, "flags": [],
                              "segmentation_quality": {"status": "ok", "reasons": []},
                              "observed": {"t_hours": r4(t), "area": r4(a)}}]}
    f = doc["forecasts"][0]
    f["segmentation_quality"] = {"status": "ok", "reasons": []}
    f["flags"] = []
    if abs(scale - WHAD_UM_PER_PX) > 0.05 * WHAD_UM_PER_PX:
        f["segmentation_quality"] = {"status": "flagged", "reasons": [f"scale {scale} um/px resampled; validated only at 0.454 um/px (WHAD)"]}
    th = stall_threshold(cut)
    if f["p_stall"] is not None and th is not None and f["p_stall"] >= th:
        f["flags"].append({"type": "stall", "reason": f"{100 * f['p_stall']:.0f}% of plausible futures close less than 10% more "
                           f"by {HORIZON_H:g} h (flag threshold {th:.2f}, tuned leave-one-wound-out on WHAD)."})
    condition_guard(f, condition, cut)
    doc["schedule"] = schedule_advice(f["p_close_by_T"], cut)
    doc["notes"] = (doc.get("notes", "") + f" | frames={len(masks)}, interval={interval} h, scale={scale} um/px, "
                    f"wound at first frame {100 * w[0]:.1f}% of field").strip(" |")
    json.dump(doc, open(f"{out}/{name}.json", "w"))
    return doc


def samples():
    """'Try a sample': 3 real WHAD frames from one held-out wound (its wound is excluded from the calibration pool),
    plus a blurred and a blank frame to show the refusal rules. Inputs saved as half-resolution PNG (0.908 um/px)."""
    root = os.environ.get("CLOSURECALL_DATA", os.path.join(HERE, "raw"))
    src = f"{root}/whad/x/whad/images/MCF10A/exp1/part_II/CC/P2"
    out = os.path.join(HERE, "..", "web", "data", "samples")
    os.makedirs(out, exist_ok=True)
    import glob
    fs = sorted(glob.glob(f"{src}/*_t0[0-2]_ch00.tif"))
    pngs = []
    for k, f in enumerate(fs):
        img = load_gray(f)[::2, ::2]
        p = f"{out}/sample_frame{k + 1}.png"
        Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(p); pngs.append(p)
    blurred = ndi.gaussian_filter(np.asarray(Image.open(pngs[0]), dtype=np.float32), 8)
    Image.fromarray(blurred.astype(np.uint8)).save(f"{out}/bad_blurred.png")
    Image.fromarray(np.zeros((720, 960), np.uint8)).save(f"{out}/bad_blank.png")
    wound = "exp1_pos2033"
    for n in (1, 2, 3):
        d = run(pngs[:n], 1, 0.908, out, f"sample_{n}frame", exclude_wound=wound)
        f = d["forecasts"][0]
        width = np.mean(np.array(f["area_q95"]) - np.array(f["area_q05"]))
        print(f"  sample, {n} frame(s): model {d['model']}, mean band width {width:.3f}, t90 {f['t90']}, P(90% closed by 19 h) {f['p_close_by_T']}")
    for bad in ("bad_blurred", "bad_blank"):
        d = run([f"{out}/{bad}.png"], 1, 0.908, out, bad)
        print(f"  {bad}: refused={d.get('refused')} {d.get('reasons')}")


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", nargs="+"); ap.add_argument("--interval", type=float); ap.add_argument("--scale", type=float)
    ap.add_argument("--condition", default=None, help="e.g. CC; outside CC/C61/N61/NC -> widened band + flag"); ap.add_argument("--out", default="upload_out"); ap.add_argument("--name", default="upload"); ap.add_argument("--samples", action="store_true")
    a = ap.parse_args()
    if a.samples:
        samples()
    else:
        d = run(a.frames[:5], a.interval, a.scale, a.out, a.name, condition=a.condition)
        print(json.dumps({k: d[k] for k in ("refused", "reasons") if k in d}) if d.get("refused") else f"forecast -> {a.out}/{a.name}.json")
