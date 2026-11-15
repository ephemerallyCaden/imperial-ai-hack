"""Importable NCA forecast entry point (for the upload path, #45, and anything else).

    import sys; sys.path.insert(0, "nca"); from api import nca_forecast
    A = nca_forecast(occ, members, t_obs_hours, area_obs, hours_out)       # (n_members, len(hours_out))

occ          start lattice (H, W) uint8, 1 = cell, AT THE LAST OBSERVED FRAME t_obs_hours[-1] (e.g. mask_to_lattice of
             that frame's mask). Any shape: the NCA is convolutional, so no fixed 16 x 22 grid is needed; the lattice is
             coarse-grained by GRAIN (odd edges cropped, as sim coarse_grain). Reservoir R = border band (Params().edge)
             occupied in `occ`, the same rule as the simulator.
members      [[Tm, bias], ...] (hours, prob); one NCA member per row. Clipped to the trained range.
t_obs_hours  observed frame times up to the cut-off (only the last one is used: it is the start time).
area_obs     observed area_norm (area / first-frame area) at those times; the last one rescales the forecast.
hours_out    output times (hours, > t_obs_hours[-1]); the NCA steps hourly from the start, values in between are
             linearly interpolated.
stochastic   True = NCA noise on (ensemble band); False = deterministic.
Returns area_norm trajectories, normalised to the first frame like whad_curves.csv.
Weights: nca/weights.pt (default, v1 frozen rules; override with weights=PATH, e.g. nca/v2/weights.pt for the follower
rule). A <weights>.config.json next to the file sets the Tm range, the source gate and the sim rule; none = v1.
"""
import os, sys
import numpy as np, torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sim")); sys.path.insert(0, HERE)
from cellsim import Params, reservoir_mask, coarse_grain, GRAIN
from model import NCA, build, load_config, encode

WEIGHTS = os.path.join(HERE, "weights.pt")
_nets = {}


def load(weights=WEIGHTS):
    if weights not in _nets:
        net = build(load_config(weights)); net.load_state_dict(torch.load(weights, map_location="cpu")); net.eval()
        _nets[weights] = net
    return _nets[weights]


def lattice_to_state(occ):
    """occ (H, W) 1 = cell -> (density, R) on the coarse grid."""
    occ = np.asarray(occ, np.uint8)
    R = reservoir_mask(occ, Params().edge).astype(np.uint8)
    return coarse_grain(occ, GRAIN), coarse_grain(R, GRAIN)


def rollout(net, rho, R, members, n, stochastic=True, seed=0):
    """rho, R (h, w) float32; members (B, 2) -> wound fraction (B, n+1), frame 0 = start."""
    torch.manual_seed(seed)
    m = np.asarray(members, float).reshape(-1, 2)
    c = net.cfg
    m = np.column_stack([np.clip(m[:, 0], c["tm_min"], c["tm_max"]), np.clip(m[:, 1], c["bias_min"], c["bias_max"])])
    B = len(m)
    x = torch.tensor(rho, dtype=torch.float32)[None, None].repeat(B, 1, 1, 1)
    r = torch.tensor(R, dtype=torch.float32)[None, None].repeat(B, 1, 1, 1)
    p = torch.tensor([encode(c, *q) for q in m], dtype=torch.float32)
    with torch.no_grad():
        fr = net(x, p, n, R=r, stochastic=stochastic).numpy()
    return 1.0 - fr.mean((2, 3))


def nca_forecast(occ, members, t_obs_hours, area_obs, hours_out, stochastic=True, seed=0, weights=WEIGHTS):
    net = load(weights)
    rho, R = lattice_to_state(occ)
    ts, a0 = float(t_obs_hours[-1]), float(area_obs[-1])
    hours_out = np.asarray(hours_out, float)
    n = int(np.ceil(hours_out.max() - ts))
    wf = rollout(net, rho, R, members, n, stochastic, seed)
    A = a0 * wf / np.maximum(wf[:, :1], 1e-9)
    grid = ts + np.arange(n + 1)
    return np.stack([np.interp(hours_out, grid, a) for a in A])


if __name__ == "__main__":  # smoke test on a WHAD mask
    from start_state import load_png_mask, mask_to_lattice
    from cellsim import SITE_UM
    occ = mask_to_lattice(*load_png_mask("exp1_partII_CC_P2", 4), SITE_UM)
    A = nca_forecast(occ, [[0.3, 0.7]] * 20, [0, 1, 2, 3, 4], [1, .95, .9, .85, .8], np.arange(5, 20))
    print(A.shape, np.round(np.quantile(A, [.05, .5, .95], axis=0)[:, ::3], 3))
