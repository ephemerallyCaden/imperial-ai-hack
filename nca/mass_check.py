"""Mass accounting for NCA v2 vs the follower sim (no double counting of front source and reservoir inflow).
python nca/mass_check.py --weights nca/v2/weights.pt --n 6
Per validation run (unseen seeds): total cell mass per hour (sites) for the sim (mean of 4 seeds) and the NCA
(deterministic), and the NCA's mass change split into flux (must be 0), front source and reservoir floor."""
import argparse, os, sys
import numpy as np, torch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "sim"), HERE]
from cellsim import simulate, Params, reservoir_mask, coarse_grain, GRAIN
from gen_data import start_state, sample_params
from model import build, load_config, encode

ap = argparse.ArgumentParser(); ap.add_argument("--weights", default=os.path.join(HERE, "v2", "weights.pt")); ap.add_argument("--n", type=int, default=6)
a = ap.parse_args()
cfg = load_config(a.weights); net = build(cfg); net.load_state_dict(torch.load(a.weights, map_location="cpu")); net.eval()
g2 = GRAIN * GRAIN
for i in range(a.n):
    rng = np.random.default_rng(2 * 10 ** 6 + i)
    occ0 = start_state(rng); Tm, bias = sample_params(rng, cfg)
    p = Params(Tm=Tm, bias=bias, rule="follow" if cfg["follow"] else "free")
    D = np.stack([simulate(occ0, p, 19, seed=2 * 10 ** 6 + 10 * i + s)["density"] for s in range(4)])
    R = coarse_grain(reservoir_mask(occ0, p.edge).astype(np.uint8), GRAIN)
    net.stats = {}
    with torch.no_grad():
        y = net(torch.tensor(D[:1, :1]), torch.tensor([encode(cfg, Tm, bias)], dtype=torch.float32), 19,
                R=torch.tensor(R)[None, None], stochastic=False)[0].numpy()
    src = torch.stack(net.stats["source"]).numpy()[:, 0] * g2; res = torch.stack(net.stats["reservoir"]).numpy()[:, 0] * g2
    net.stats = None
    m_sim = D.sum((2, 3)).mean(0) * g2; m_nca = y.sum((1, 2)) * g2
    dm = m_nca[-1] - m_nca[0]; flux = dm - src.sum() - res.sum()
    print(f"Tm={Tm:6.2f} bias={bias:.2f} | mass (sites) t=0,4,8,12,19: sim {np.round(m_sim[[0,4,8,12,19]]).astype(int)} "
          f"nca {np.round(m_nca[[0,4,8,12,19]]).astype(int)} | NCA gain {dm:6.1f} = source {src.sum():6.1f} + reservoir {res.sum():5.1f} "
          f"+ flux {flux:+.1e} | sim gain {m_sim[-1]-m_sim[0]:6.1f} | max mass {m_nca.max():.0f} <= sites {occ0[:32,:44].size}")
