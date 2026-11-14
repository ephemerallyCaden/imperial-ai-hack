"""numpy port of nca/model.py NCA.step (deterministic, layout with R channel + capped flux) to check sim/js/nca.js without torch.
python3 -I sim/js/nca_ref.py weights.json out.json  -> writes rho0, params, frames for nca_check.mjs"""
import json, sys, numpy as np

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
K4 = np.array([[[0, 0, 0], [0, 1, 0], [0, 0, 0]], [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
               [[-1, -2, -1], [0, 0, 0], [1, 2, 1]], [[1, 2, 1], [2, -12, 2], [1, 2, 1]]], float)
K4[1:3] /= 8; K4[3] /= 16


def conv(a, k):  # zero-pad 3x3 cross-correlation (torch conv2d)
    p = np.pad(a, 1); H, W = a.shape
    return sum(k[i, j] * p[i:i + H, j:j + W] for i in range(3) for j in range(3))


def step(rho, R, hid, par, wt, K=2):
    H, W = rho.shape
    x = [rho, R] + list(hid)
    perc = [conv(c, K4[f]) for c in x for f in range(4)]
    inp = np.stack(perc + [np.full((H, W), par[0]), np.full((H, W), par[1]), np.zeros((H, W))], -1)
    a = np.maximum(0, inp @ np.array(wt["l1.weight"]).T + wt["l1.bias"])
    out = a @ np.array(wt["l2.weight"]).T + wt["l2.bias"]
    lg, dh = out[..., :9], out[..., 10:]
    fr = np.exp(lg - lg.max(-1, keepdims=True)); fr /= fr.sum(-1, keepdims=True)
    room = np.maximum(0, 1 - rho); roomp = np.pad(room, 1)
    want = [rho * fr[..., k] * roomp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for k, (dy, dx) in enumerate(NB)]
    demand = sum(np.pad(want[k], 1)[1 - dy:1 - dy + H, 1 - dx:1 - dx + W] for k, (dy, dx) in enumerate(NB))
    scale = np.where(demand > room, room / np.maximum(demand, 1e-12), 1.0); scalep = np.pad(scale, 1)
    new = rho.copy()
    for k, (dy, dx) in enumerate(NB):
        sent = want[k] * scalep[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        new = new - sent + np.pad(sent, 1)[1 - dy:1 - dy + H, 1 - dx:1 - dx + W]
    hid = np.tanh(hid + np.moveaxis(dh, -1, 0) / K)
    return np.maximum(new, R), hid


def test_input(H=30, W=40):
    """straight scratch on the coarse grid + a reservoir R = 0.5 on border cells that start full (edge 2 of grain 4)."""
    rho = np.ones((H, W)); rho[:, 15:25] = 0.0; rho[:, 14] = rho[:, 25] = 0.5
    b = np.zeros((H, W), bool); b[0] = b[-1] = b[:, 0] = b[:, -1] = True
    R = np.where(b & (rho == 1), 0.5, 0.0)
    return rho, R


if __name__ == "__main__":
    wt = json.load(open(sys.argv[1]))
    nh = len(wt["l2.bias"]) - 10
    rho, R = test_input(); H, W = rho.shape
    Tm, bias = 0.5, 7 / 9
    lo, hi = np.log(0.05), np.log(5.0)
    par = [2 * (np.log(Tm) - lo) / (hi - lo) - 1, 2 * bias - 1]
    rho = np.maximum(rho, R); hid = np.zeros((nh, H, W)); frames = [rho.copy()]
    for _ in range(6):
        for _ in range(2): rho, hid = step(rho, R, hid, par, wt)
        frames.append(rho.copy())
    json.dump(dict(h=H, w=W, Tm=Tm, bias=bias, R=R.ravel().tolist(), frames=[f.ravel().tolist() for f in frames]),
              open(sys.argv[2], "w"))
