"""Train the NCA on simulator density grids. python nca/train.py --data /tmp/nca_data.npz --out nca/weights.pt"""
import argparse, time, numpy as np, torch
from model import NCA, norm_params

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="/tmp/nca_data.npz"); ap.add_argument("--out", default="nca/weights.pt")
ap.add_argument("--steps", type=int, default=3000); ap.add_argument("--bs", type=int, default=32); ap.add_argument("--nval", type=int, default=60)
a = ap.parse_args()
torch.manual_seed(0)
d = np.load(a.data)
X = torch.tensor(d["density"]); P = torch.tensor([norm_params(*p) for p in d["params"]], dtype=torch.float32)
Xtr, Ptr, Xva, Pva = X[a.nval:], P[a.nval:], X[:a.nval], P[:a.nval]
F_ = X.shape[1] - 1
net = NCA(); opt = torch.optim.Adam(net.parameters(), 2e-3)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=a.steps)
t0 = time.time()
for it in range(a.steps):
    L = min(F_, 4 + it // 150)  # curriculum: rollout length
    s = torch.randint(0, F_ - L + 1, (1,)).item() if L < F_ else 0
    idx = torch.randint(0, len(Xtr), (a.bs,))
    x = Xtr[idx][:, s:s + L + 1]; p = Ptr[idx]
    y1 = net(x[:, :1], p, L); y2 = net(x[:, :1], p, L)
    tgt = x[:, 1:]
    es = (y1[:, 1:] - tgt).abs().mean() - 0.5 * (y1[:, 1:] - y2[:, 1:]).abs().mean()  # energy score (per-cell)
    mse = ((y1[:, 1:] - tgt) ** 2).mean() * 10
    area = ((y1[:, 1:].mean((2, 3)) - tgt.mean((2, 3))) ** 2).mean() * 50  # wound-area (=closure) error
    loss = es + mse + area
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
    if it % 200 == 0 or it == a.steps - 1:
        with torch.no_grad():
            yv = net(Xva[:, :1], Pva, F_)
            rm = ((yv - Xva) ** 2).mean().sqrt().item(); ae = (yv.mean((2, 3)) - Xva.mean((2, 3))).abs().mean().item()
        print(f"{it} L={L} loss={loss.item():.4f} val_rmse={rm:.4f} val_area_mae={ae:.4f} {time.time()-t0:.0f}s", flush=True)
torch.save(net.state_dict(), a.out)
