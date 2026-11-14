"""Run in a checkout with torch + Agent 2's nca/: deterministic torch reference rollouts for sim/js/nca_check.mjs.
python3 sim/js/nca_torch_ref.py nca/v2/weights.pt /tmp/ref_v2.json   (or nca/weights.pt for v1; run from the repo root)
Builds the net from nca/model.py load_config(weights) (v2: division 1, Tm encoding to tm_max, clip to the trained range,
as nca/api.py rollout) and writes several cases: in-range Tm, a high Tm (v2 encoding) and an out-of-range Tm (clip).
Then: node sim/js/nca_check.mjs <weights.json> /tmp/ref_v2.json <weights.config.json>  -> maxAbsDiff ~1e-6 per case."""
import json, os, sys
import numpy as np, torch
sys.path.insert(0, "."); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nca.model import load_config, build, encode
from nca_ref import test_input

wpath, out = sys.argv[1], sys.argv[2]
cfg = load_config(wpath); net = build(cfg)
net.load_state_dict(torch.load(wpath, map_location="cpu")); net.eval()
rho, R = test_input(); H, W = rho.shape
t = lambda a: torch.from_numpy(a.astype(np.float32))[None, None]
cases = []
for Tm, bias in [(0.5, 7 / 9), (20.0, 0.5), (80.0, 0.95)]:  # last one is outside [tm_max, bias_max] for both versions
    tm_c, b_c = float(np.clip(Tm, cfg["tm_min"], cfg["tm_max"])), float(np.clip(bias, cfg["bias_min"], cfg["bias_max"]))
    par = torch.tensor([encode(cfg, tm_c, b_c)], dtype=torch.float32)
    with torch.no_grad():
        fr = net(t(rho), par, 6, R=t(R), stochastic=False)[0].numpy()
    cases.append(dict(Tm=Tm, bias=bias, frames=[f.ravel().tolist() for f in fr]))
json.dump(dict(h=H, w=W, R=R.ravel().tolist(), config=cfg, cases=cases, frames=cases[0]["frames"], Tm=cases[0]["Tm"],
               bias=cases[0]["bias"]), open(out, "w"))
print(out, "config", cfg["version"], "division", cfg["division"], "tm_max", cfg["tm_max"], len(cases), "cases")
