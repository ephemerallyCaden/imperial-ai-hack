"""Train the NCA on simulator density grids. python nca/train.py --data /tmp/nca_data.npz --out nca/weights.pt"""
import argparse, os, sys, time, numpy as np, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import NCA, norm_params

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="/tmp/nca_data.npz"); ap.add_argument("--out", default="nca/weights.pt")
ap.add_argument("--steps", type=int, default=3000); ap.add_argument("--bs", type=int, default=32); ap.add_argument("--nval", type=int, default=60); ap.add_argument("--curr", type=int, default=100)
ap.add_argument("--init", default=None, help="fine-tune from these weights (full-length rollouts, cosine LR)")
ap.add_argument("--lr", type=float, default=3e-3)
ap.add_argument("--w-anorm", type=float, default=0.0, help="weight of the energy score on area / area(t=0) (closure curve)")
ap.add_argument("--w-mse", type=float, default=10.0, help="per-cell MSE weight (pulls members to the mean; lower = more spread)")
a = ap.parse_args()
torch.manual_seed(0); torch.set_num_threads(4)
d = np.load(a.data)
X = torch.tensor(d["density"]); RR = torch.tensor(d["R"])[:, None]; P = torch.tensor([norm_params(*p) for p in d["params"]], dtype=torch.float32)
Xtr, Rtr, Ptr, Xva, Rva, Pva = X[a.nval:], RR[a.nval:], P[a.nval:], X[:a.nval], RR[:a.nval], P[:a.nval]
F_ = X.shape[1] - 1
net = NCA(); opt = torch.optim.Adam(net.parameters(), 2e-3)
if a.init:
    net.load_state_dict(torch.load(a.init, map_location="cpu")); a.curr = 1  # L = F_ from the start
    for g in opt.param_groups: g["lr"] = a.lr
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.steps)
else:
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, a.lr, total_steps=a.steps)
best = 1e9
t0 = time.time()
for it in range(a.steps):
    L = min(F_, 4 + it // a.curr)  # curriculum: rollout length
    s = torch.randint(0, F_ - L + 1, (1,)).item() if L < F_ else 0
    idx = torch.randint(0, len(Xtr), (a.bs,))
    x = Xtr[idx][:, s:s + L + 1]; p = Ptr[idx]; r = Rtr[idx]
    y = net(x[:, :1].repeat(2, 1, 1, 1), p.repeat(2, 1), L, R=r.repeat(2, 1, 1, 1))  # two members per sample
    y1, y2 = y[:a.bs], y[a.bs:]
    tgt = x[:, 1:]
    es = (y1[:, 1:] - tgt).abs().mean() - 0.5 * (y1[:, 1:] - y2[:, 1:]).abs().mean()  # energy score (per-cell)
    mse = ((y1[:, 1:] - tgt) ** 2).mean() * a.w_mse
    area = ((y1[:, 1:].mean((2, 3)) - tgt.mean((2, 3))) ** 2).mean() * 50  # wound-area (=closure) error
    loss = es + mse + area
    if a.w_anorm:  # energy score on the normalised closure curve: fixes the fast-Tm tail and the member spread
        w0 = 1 - x[:, :1].mean((2, 3)).clamp(max=1 - 1e-3)
        an = lambda z: (1 - z[:, 1:].mean((2, 3))) / w0
        loss = loss + a.w_anorm * ((an(y1) - an(x)).abs().mean() - 0.5 * (an(y1) - an(y2)).abs().mean())
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
    if it % (100 if a.init else 200) == 0 or it == a.steps - 1:
        with torch.no_grad():
            yv = net(Xva[:, :1], Pva, F_, R=Rva)
            rm = ((yv - Xva) ** 2).mean().sqrt().item(); ae = (yv.mean((2, 3)) - Xva.mean((2, 3))).abs().mean().item()
            wv = 1 - Xva.mean((2, 3)); an_err = (((1 - yv.mean((2, 3))) - wv) / wv[:, :1]).abs().mean().item()
        if an_err < best and L == F_:
            best = an_err; torch.save(net.state_dict(), a.out)
        print(f"{it} L={L} loss={loss.item():.4f} val_rmse={rm:.4f} val_area_mae={ae:.4f} val_norm_area_mae={an_err:.4f} {time.time()-t0:.0f}s", flush=True)
if best == 1e9:
    torch.save(net.state_dict(), a.out)
print("best val_norm_area_mae", best, "->", a.out)
