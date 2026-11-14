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
from nca.model import norm_params
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nca_ref import test_input
rho, R = test_input(); H, W = rho.shape
Tm, bias = 0.5, 7 / 9
par = torch.tensor([norm_params(Tm, bias)], dtype=torch.float32)
t = lambda a: torch.from_numpy(a.astype(np.float32))[None, None]
with torch.no_grad():
    fr = net(t(rho), par, 6, R=t(R), stochastic=False)[0].numpy()
json.dump(dict(h=H, w=W, Tm=Tm, bias=bias, R=R.ravel().tolist(), frames=[f.ravel().tolist() for f in fr]), open(sys.argv[2], "w"))
