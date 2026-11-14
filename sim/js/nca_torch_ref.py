"""Run in Agent 2's checkout (has torch): writes the same ref.json as nca_ref.py but from nca/model.py itself.
python3 sim/js/nca_torch_ref.py nca/weights.json /tmp/ref_torch.json   (run from the repo root containing nca/)
Then: node sim/js/nca_check.mjs nca/weights.json /tmp/ref_torch.json  -> maxAbsDiff should be ~1e-5."""
import json, sys, math, numpy as np, torch
sys.path.insert(0, ".")
from nca.model import NCA

wt = json.load(open(sys.argv[1]))
nh = len(wt["l2.bias"]) - 10
net = NCA(nh=nh, hidden=len(wt["l1.bias"]))
net.load_state_dict({k: torch.tensor(v, dtype=torch.float32) for k, v in wt.items()}, strict=False)
H, W = 30, 40
rho = np.ones((H, W), np.float32); rho[:, 15:25] = 0.0; rho[:, 14] = rho[:, 25] = 0.5
Tm, bias = 0.5, 7 / 9
par = torch.tensor([[math.log(Tm) / 2 + 1.5, 2 * bias - 1]], dtype=torch.float32)
with torch.no_grad():
    fr = net(torch.from_numpy(rho)[None, None], par, 6, stochastic=False)[0].numpy()
json.dump(dict(h=H, w=W, Tm=Tm, bias=bias, frames=[f.ravel().tolist() for f in fr]), open(sys.argv[2], "w"))
