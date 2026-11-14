"""python nca/tests/test_mass.py : flux conserves total density exactly (no source, no reservoir) and keeps 0 <= rho <= 1."""
import os, sys, torch
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from model import NCA

torch.manual_seed(0)
net = NCA()
for p in net.parameters():
    torch.nn.init.normal_(p, std=1.0)  # strong random flux, incl. converging fronts
rho = torch.rand(4, 1, 16, 21); rho[:, :, :, 8:12] = 0.0
par = torch.zeros(4, 2)
with torch.no_grad():
    fr = net(rho, par, 30)
m0, m1 = rho.sum((1, 2, 3)), fr[:, -1].sum((1, 2))
assert torch.allclose(m0, m1, rtol=1e-5), (m0, m1)
assert fr.min() >= 0 and fr.max() <= 1 + 1e-6, (fr.min(), fr.max())
R = torch.zeros_like(rho); R[:, :, :, :2] = 1.0
with torch.no_grad():
    fr = net(rho, par, 30, R=R)
assert (fr[:, :, :, :2] >= 1 - 1e-6).all() and fr.max() <= 1 + 1e-6
print("ok: mass", m0.tolist(), "->", m1.tolist())
