"""numpy port of nca/model.py NCA.step (deterministic) to check sim/js/nca.js without torch.
python3 -I sim/js/nca_ref.py weights.json out.json  -> writes rho0, params, frames for nca_check.mjs"""
import json, sys, numpy as np

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
K4 = np.array([[[0, 0, 0], [0, 1, 0], [0, 0, 0]], [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
               [[-1, -2, -1], [0, 0, 0], [1, 2, 1]], [[1, 2, 1], [2, -12, 2], [1, 2, 1]]], float)
K4[1:3] /= 8; K4[3] /= 16


def conv(a, k):  # zero-pad 3x3 cross-correlation (torch conv2d)
    p = np.pad(a, 1); H, W = a.shape
    return sum(k[i, j] * p[i:i + H, j:j + W] for i in range(3) for j in range(3))


def step(rho, hid, par, wt, K=2, edge=1):
    H, W = rho.shape; nh = hid.shape[0]
    x = [rho] + list(hid)
    perc = [conv(c, K4[f]) for c in x for f in range(4)]
    inp = np.stack(perc + [np.full((H, W), par[0]), np.full((H, W), par[1]), np.zeros((H, W))], -1)
    a = np.maximum(0, inp @ np.array(wt["l1.weight"]).T + wt["l1.bias"])
    out = a @ np.array(wt["l2.weight"]).T + wt["l2.bias"]
    lg, src, dh = out[..., :9], out[..., 9], out[..., 10:]
    fr = np.exp(lg - lg.max(-1, keepdims=True)); fr /= fr.sum(-1, keepdims=True)
    rp = np.pad(rho, 1, constant_values=1.0)
    new = rho * fr[..., 8]
    for k, (dy, dx) in enumerate(NB):
        nbr = rp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        sent = rho * fr[..., k] * (1 - nbr)
        new = new + rho * fr[..., k] - sent
        sp = np.pad(sent, 1)
        new = new + sp[1 - dy:1 - dy + H, 1 - dx:1 - dx + W]
    new = new + np.log1p(np.exp(src - 3)) * (1 - rho) / K
    hid = hid + np.moveaxis(dh, -1, 0) / K
    e = edge; m = np.zeros_like(new); m[:e] = m[-e:] = 1; m[:, :e] = m[:, -e:] = 1
    return np.clip(new * (1 - m) + m, 0, 1), hid


if __name__ == "__main__":
    wt = json.load(open(sys.argv[1]))
    nh = len(wt["l2.bias"]) - 10
    H, W = 30, 40
    rho = np.ones((H, W)); rho[:, 15:25] = 0.0; rho[:, 14] = rho[:, 25] = 0.5
    Tm, bias = 0.5, 7 / 9
    par = [np.log(Tm) / 2 + 1.5, 2 * bias - 1]
    hid = np.zeros((nh, H, W)); frames = [rho.copy()]
    for _ in range(6):
        for _ in range(2): rho, hid = step(rho, hid, par, wt)
        frames.append(rho.copy())
    json.dump(dict(h=H, w=W, Tm=Tm, bias=bias, frames=[f.ravel().tolist() for f in frames]), open(sys.argv[2], "w"))
