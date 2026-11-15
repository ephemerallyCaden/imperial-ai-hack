"""Real WHAD frames -> NCA training sequences (#61, NCA-real 1).

Series and frames: exactly eval/forecast_baselines.load("whad") (wound_frac <= 0.70, >= 5 frames, a0 > 0.01).
Masks: manual series from data/processed/whad_masks/<position>.npz (matched by absolute frame time); auto series
re-segmented from the raw tifs with data/segment.py (1/4 res = 1.816 um/px, same as whad_auto_curves.csv).
Each mask -> start_state.mask_to_lattice (32 x 44, 1 = cell) -> coarse_grain(GRAIN) density (16 x 22, 1 = cells).
R = api.lattice_to_state(first frame lattice)[1]. Params = sim/fits whad(_auto)_fits.json fits[position]["9.5"].

python -I nca/real_data.py   -> data/processed/nca_real_whad.npz  (np.load(..., allow_pickle=False))
  ids, wounds, datasets, sources (str), params (N, 2 float32 [Tm h, bias]),
  {i}__density (F, h, w float32), {i}__t (F float32, hours since first frame), {i}__R (F, h, w float32, reservoir per frame)
"""
import glob, json, os, sys, time
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path[:0] = [HERE, os.path.join(ROOT, "sim"), os.path.join(ROOT, "eval"), os.path.join(ROOT, "data")]
from start_state import mask_to_lattice
from cellsim import coarse_grain, GRAIN
from api import lattice_to_state
from segment import load_gray, segment
import forecast_baselines as FB

DATA = os.environ.get("CLOSURECALL_DATA", "C:/Users/rando/hack-data")
PROC = os.path.join(ROOT, "data", "processed")
OUT = os.path.join(PROC, "nca_real_whad.npz")
UM_PER_PX = 1.816
CUT = "9.5"


def frame_table():
    """Absolute frame times of the rows FB.load keeps, per position (same filter + sort)."""
    man = pd.read_csv(f"{PROC}/whad_curves.csv")
    auto = pd.read_csv(f"{PROC}/whad_auto_curves.csv")
    df = pd.concat([man, auto], ignore_index=True)
    df = df[df.wound_frac <= 0.70]
    return {p: g.sort_values("t_hours") for p, g in df.groupby("position")}


def fit_params(fits, pos):
    f = fits[pos]
    key = CUT if CUT in f else max(f, key=float)
    return f[key]["Tm"], f[key]["bias"], key


CUTS = ["1.9", "3.8", "5.7", "9.5"]


def fit_params_by_cut(fits, pos):
    """(4, 2) Tm, bias fitted on frames <= each cut-off: what the forecast actually receives (NaN if missing)."""
    f = fits[pos]
    return [(f[c]["Tm"], f[c]["bias"]) if c in f else (np.nan, np.nan) for c in CUTS]


def masks_manual(pos, t_abs):
    z = np.load(f"{PROC}/whad_masks/{pos}.npz")
    th = z["t_hours"]
    assert abs(float(z["um_per_px"]) - UM_PER_PX) < 1e-6
    return [z["masks"][int(np.flatnonzero(np.isclose(th, t))[0])].astype(bool) for t in t_abs]


def masks_auto(g):
    r = g.iloc[0]
    d = f"{DATA}/whad_full/whad/images/MCF10A/{r.experiment}/part_{r.part}/{r.condition}/{r.position.rsplit('_', 1)[1]}"
    # Some P dirs hold two positions (exp1/part_II/NC/P3: pos3031 t00-t01, pos3026 t00-t20) and build_whad_auto kept
    # whichever tif came last per frame, so pick the tif whose mask reproduces the CSV wound_frac (same frames as FB).
    out, used = [], set()
    for k, wf in zip(g.frame.astype(int), g.wound_frac):
        cands = [segment(load_gray(f)) for f in sorted(glob.glob(f"{d}/*_t{k:02d}_ch00.tif"))]
        hit = [j for j, m in enumerate(cands) if abs(m.mean() - wf) < 1e-6]
        assert hit, (r.position, k, [m.mean() for m in cands], wf)
        out.append(cands[hit[0]]); used.add((len(cands), hit[0]))
    if any(n > 1 for n, _ in used):
        print(f"  WARNING {r.position}: P dir holds >1 imaging position; frames mix tifs {sorted(used)} as in whad_auto_curves.csv")
    return out


def main():
    t0 = time.time()
    S = FB.load("whad")
    tab = frame_table()
    fits = {**json.load(open(os.path.join(ROOT, "sim/fits/whad_fits.json")))["fits"],
            **json.load(open(os.path.join(ROOT, "sim/fits/whad_auto_fits.json")))["fits"]}
    arrs, ids, wounds, sources, params, params_cuts = {}, [], [], [], [], []
    area_err, corrs, shapes, cut_used, n_frames = [], [], set(), {}, 0
    for i, sid in enumerate(sorted(S)):
        s, g = S[sid], tab[sid]
        t_abs = g.t_hours.to_numpy(float)
        assert len(t_abs) == len(s["t"]) and np.allclose(t_abs - t_abs[0], s["t"]), sid
        masks = masks_manual(sid, t_abs) if s["source"] == "manual" else masks_auto(g)
        occs = [mask_to_lattice(m, UM_PER_PX) for m in masks]
        area_err += [abs((1 - o.mean()) - m.mean()) for o, m in zip(occs, masks)]
        dens = np.stack([coarse_grain(o, GRAIN) for o in occs]).astype(np.float32)
        R = np.stack([lattice_to_state(o)[1] for o in occs]).astype(np.float32)  # per frame: forecasts start at any frame
        Tm, bias, key = fit_params(fits, sid)
        cut_used[key] = cut_used.get(key, 0) + 1
        wf = 1 - dens.mean((1, 2))
        corrs.append(np.corrcoef(wf / wf[0], s["a"])[0, 1] if s["a"].std() > 0 else np.nan)
        shapes.add(dens.shape[1:])
        arrs[f"{i}__density"], arrs[f"{i}__t"], arrs[f"{i}__R"] = dens, np.asarray(s["t"], np.float32), R
        ids.append(sid); wounds.append(s["wound"]); sources.append(s["source"]); params.append((Tm, bias))
        params_cuts.append(fit_params_by_cut(fits, sid))
        n_frames += len(dens)
        print(f"  [{i + 1}/{len(S)}] {sid:22} {s['source']:6} F={len(dens):2d} wound {wf[0]:.3f}->{wf[-1]:.3f} "
              f"a_end {s['a'][-1]:.3f} corr {corrs[-1]:.3f}", flush=True)
    np.savez_compressed(OUT, ids=np.array(ids, str), wounds=np.array(wounds, str), datasets=np.array(["whad"] * len(ids)),
                        params=np.array(params, np.float32), sources=np.array(sources, str),
                        params_cuts=np.array(params_cuts, np.float32), cuts=np.array([float(c) for c in CUTS], np.float32), **arrs)

    z = np.load(OUT, allow_pickle=False)
    assert set(z["ids"]) == set(S) and all(f"{i}__density" in z.files for i in range(len(S)))
    c = np.array(corrs)
    print(f"\nN sequences {len(ids)} (manual {sources.count('manual')}, auto {sources.count('auto')}), frames {n_frames}")
    print(f"every FB.load('whad') series has a sequence: {set(z['ids']) == set(S)}")
    print(f"density grid shapes: {shapes}  (all 16x22: {shapes == {(16, 22)}})")
    print(f"lattice vs mask wound fraction: max abs error {max(area_err):.4f} (<= 0.02: {max(area_err) <= 0.02})")
    print(f"corr(1 - density.mean / first, FB area curve): min {np.nanmin(c):.3f} median {np.nanmedian(c):.3f} mean {np.nanmean(c):.3f}")
    print(f"fit cut keys used: {cut_used}")
    print(f"runtime {time.time() - t0:.1f}s, file {OUT} {os.path.getsize(OUT) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
