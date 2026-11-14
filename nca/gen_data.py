"""Generate NCA training data: many simulator runs on random scratches/blobs with random (Tm, bias).
python nca/gen_data.py --n 400 --out /tmp/nca_data.npz  (WHAD-mask starts from #22 can be added later via --extra)"""
import sys, os, argparse, numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sim"))
from cellsim import simulate, Params


def random_wound(rng, H=120, W=160):
    occ = np.ones((H, W), np.uint8)
    yy, xx = np.mgrid[:H, :W]
    if rng.random() < 0.7:  # scratch: tilted, wobbly band
        ang = rng.normal(0, 0.25); w = rng.uniform(16, 40)
        c = W / 2 + rng.normal(0, 8)
        wob = rng.normal(0, 3) * np.sin(yy / rng.uniform(15, 40) + rng.uniform(0, 6))
        d = (xx - c) - np.tan(ang) * (yy - H / 2) + wob
        occ[np.abs(d) < w / 2] = 0
    else:  # blob(s)
        for _ in range(rng.integers(1, 3)):
            cy, cx = rng.uniform(30, H - 30), rng.uniform(40, W - 40)
            ry, rx = rng.uniform(10, 30), rng.uniform(10, 35)
            occ[((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 < 1] = 0
    return occ


TM_RANGE, BIAS_RANGE = (0.03, 0.5), (0.3, 0.95)


def sample_params(rng):
    return float(np.exp(rng.uniform(*np.log(TM_RANGE)))), float(rng.uniform(*BIAS_RANGE))


def one(args):
    i, hours = args
    rng = np.random.default_rng(1000 + i)
    Tm, bias = sample_params(rng)
    r = simulate(random_wound(rng), Params(Tm=Tm, bias=bias), hours, seed=i)
    return r["density"], np.array([Tm, bias], np.float32)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=400); ap.add_argument("--hours", type=int, default=20)
    ap.add_argument("--out", default="/tmp/nca_data.npz"); ap.add_argument("--procs", type=int, default=8)
    a = ap.parse_args()
    with Pool(a.procs) as p:
        res = p.map(one, [(i, a.hours) for i in range(a.n)])
    np.savez_compressed(a.out, density=np.stack([r[0] for r in res]), params=np.stack([r[1] for r in res]))
    print("saved", a.out, np.stack([r[0] for r in res]).shape)
