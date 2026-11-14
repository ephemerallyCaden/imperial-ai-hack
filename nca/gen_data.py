"""NCA training data from the cell-agent simulator (sim/cellsim.py, Agent 1's canonical rules).

Start states: real WHAD mask shapes from frames t <= EARLY_T only (the earliest cut-off, so every forecast already
has them at t0; no held-out wound's later shapes or dynamics enter training), flipped, and synthetic WHAD-like
scratches/blobs on the same 32 x 44 lattice; parameters sampled over the calibration range (log Tm, bias).
python nca/gen_data.py --n 1200 --out /tmp/nca_data.npz
Saves density (N,F,h,w), R (N,h,w) coarse reservoir fraction, params (N,2) [Tm, bias].
"""
import argparse, glob, os, sys
import numpy as np
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sim")); sys.path.insert(0, HERE)
from cellsim import simulate, Params, reservoir_mask, coarse_grain, SITE_UM, GRAIN
from start_state import load_png_mask, mask_to_lattice
from model import TM_MIN, TM_MAX, BIAS_MIN, BIAS_MAX

MASKS = os.path.join(HERE, "..", "data", "processed", "whad_masks")
EARLY_T = 2  # frames <= the earliest cut-off t0 (sim/fits/whad_fits.json cutoffs[0])
_cache = {}


def whad_shapes():
    if not _cache:
        # same loader + resample as sim/calibrate.py (full-res PNG -> 32 x 44 lattice at SITE_UM = 20 um)
        for pos in sorted(os.path.basename(f)[:-4] for f in glob.glob(f"{MASKS}/*.npz")):
            fr = []
            for k in range(EARLY_T + 1):
                try:
                    fr.append(mask_to_lattice(*load_png_mask(pos, k), SITE_UM))
                except (IndexError, ValueError, FileNotFoundError):
                    pass
            if fr := [o for o in fr if (o == 0).any()]:
                _cache[pos] = fr
    return _cache


def synthetic(rng, H=32, W=44):  # WHAD lattice at SITE_UM (sim/start_state.py)
    occ = np.ones((H, W), np.uint8)
    yy, xx = np.mgrid[:H, :W]
    if rng.random() < 0.75:  # tilted, wobbly scratch crossing the field (like WHAD)
        ang = rng.normal(0, 0.2); w = rng.uniform(0.1, 0.4) * W
        c = W / 2 + rng.normal(0, 3)
        wob = rng.normal(0, 1.2) * np.sin(yy / rng.uniform(4, 12) + rng.uniform(0, 6))
        d = (xx - c) - np.tan(ang) * (yy - H / 2) + wob
        occ[np.abs(d) < w / 2] = 0
    else:
        for _ in range(rng.integers(1, 3)):
            cy, cx = rng.uniform(8, H - 8), rng.uniform(10, W - 10)
            ry, rx = rng.uniform(3, 10), rng.uniform(3, 12)
            occ[((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 < 1] = 0
    return occ


def sample_params(rng):
    return float(np.exp(rng.uniform(np.log(TM_MIN), np.log(TM_MAX)))), float(rng.uniform(BIAS_MIN, BIAS_MAX))


def start_state(rng):
    if rng.random() < 0.5:
        sh = whad_shapes(); k = sorted(sh)[rng.integers(len(sh))]
        occ = sh[k][rng.integers(len(sh[k]))].copy()
        if rng.random() < 0.5: occ = occ[::-1]
        if rng.random() < 0.5: occ = occ[:, ::-1]
        return np.ascontiguousarray(occ)
    return synthetic(rng)


def one(args):
    i, hours, seed0 = args
    rng = np.random.default_rng(seed0 + i)
    occ0 = start_state(rng); Tm, bias = sample_params(rng)
    p = Params(Tm=Tm, bias=bias)
    r = simulate(occ0, p, hours, seed=seed0 + i, grain=GRAIN)
    R = coarse_grain(reservoir_mask(occ0, p.edge).astype(np.uint8), GRAIN)
    return r["density"], R, np.array([Tm, bias], np.float32)


def generate(n, hours=19, seed0=1000, procs=8):
    whad_shapes()  # load once before forking
    with Pool(procs) as pool:
        res = pool.map(one, [(i, hours, seed0) for i in range(n)])
    return (np.stack([r[0] for r in res]), np.stack([r[1] for r in res]), np.stack([r[2] for r in res]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=1200); ap.add_argument("--hours", type=int, default=19)
    ap.add_argument("--out", default="/tmp/nca_data.npz"); ap.add_argument("--seed0", type=int, default=1000)
    a = ap.parse_args()
    D, R, P = generate(a.n, a.hours, a.seed0)
    np.savez_compressed(a.out, density=D, R=R, params=P)
    A = (1 - D.mean((2, 3))); A = A / A[:, :1]
    print("saved", a.out, D.shape, "area@19h q10/50/90:", np.round(np.quantile(A[:, -1], [.1, .5, .9]), 3))
