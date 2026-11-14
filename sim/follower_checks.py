"""PROTOTYPE report checks for Params(follow=True) vs the frozen rules (feature/p2-follower).

  python3 sim/follower_checks.py [Tm_follow]      size independence, packedness, islands, linearity
Prints tables; no files written.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from cellsim import Params, simulate, step, reservoir_mask, refill, grow_connected, SITE_UM
from start_state import load_png_mask, mask_to_lattice

TM_F = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
FROZEN, FOLLOW = Params(Tm=0.5, bias=7 / 9), Params(Tm=TM_F, bias=7 / 9, follow=True)
CURVES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "processed", "whad_curves.csv")


def band(H, W, width=12):
    """Wavy horizontal scratch along x (same generator as the 20:30 size test)."""
    x = np.arange(W)
    c = H / 2 + 2 * np.sin(2 * np.pi * x / W * 2) + np.sin(2 * np.pi * x / W * 7 + 1)
    hw = width / 2 + 1.2 * np.sin(2 * np.pi * x / W * 5 + 2)
    y = np.arange(H)[:, None]
    return (~((y >= c - hw) & (y < c + hw))).astype(np.uint8)


def isolated_empty(o):
    e = o == 0
    p = np.pad(e, 1)
    nb = sum(np.roll(np.roll(p, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)[1:-1, 1:-1]
    return int((e & (nb == 0)).sum())


def lin_r2(t, a):
    """R^2 of a straight-line fit to area_norm while it is above 0.1."""
    k = a > 0.1
    if k.sum() < 3:
        return float("nan")
    t, a = t[k], a[k]
    res = a - np.polyval(np.polyfit(t, a, 1), t)
    return 1 - (res ** 2).sum() / ((a - a.mean()) ** 2).sum()


print(f"== 1. Size independence (12-site wavy scratch, 24 h, mean of 3 seeds); area_norm at 4/8/12/19/24 h")
for name, p in (("frozen Tm 0.5", FROZEN), (f"follow Tm {TM_F:g}", FOLLOW)):
    for H, W in ((44, 44), (44, 456), (120, 168)):
        o = band(H, W)
        a = np.mean([simulate(o, p, 24, seed=s)["wound_frac"] for s in range(3)], 0)
        print(f"  {name:14s} {H:3d}x{W:<3d}: {np.round(a[[4, 8, 12, 19, 24]] / a[0], 2)}")

print("== 2. Packedness + islands on WHAD exp1_partII_C61_P2 (start frame 0)")
occ0 = mask_to_lattice(*load_png_mask("exp1_partII_C61_P2", 0), SITE_UM)
w0 = occ0 == 0
for name, p in (("frozen Tm 0.5", FROZEN), (f"follow Tm {TM_F:g}", FOLLOW)):
    rng = np.random.default_rng(0)
    occ = occ0.copy(); res = reservoir_mask(occ, p.edge); refill(occ, res)
    conn = grow_connected(res.copy(), occ) if p.follow else None
    fills = vacs = 0
    out = {}
    for k in range(1, int(19 / p.dt) + 1):
        before = occ.copy()
        step(occ, p, rng, conn)
        fills += int((~before.astype(bool) & occ.astype(bool)).sum())
        vacs += int((before.astype(bool) & ~occ.astype(bool)).sum())
        refill(occ, res)
        if p.follow:
            grow_connected(conn, occ)
        t = k * p.dt
        if any(abs(t - x) < p.dt / 2 for x in (4, 8, 12, 19)):
            e = occ == 0
            out[round(t)] = (e.sum() / w0.sum(), (e & w0).sum() / max(e.sum(), 1), isolated_empty(occ), vacs / max(fills, 1))
            fills = vacs = 0
    for t, (an, ins, iso, vf) in out.items():
        print(f"  {name:14s} t {t:2d} h: area_norm {an:.2f}  empties inside orig wound {ins:.2f}  isolated empty sites {iso:3d}"
              f"  moves leaving a vacancy (since last row) {vf:.2f}")

print("== 3. Linearity: R^2 of a straight line to area_norm while > 0.1")
o = band(44, 44)
for name, p in (("frozen Tm 0.5", FROZEN), (f"follow Tm {TM_F:g}", FOLLOW)):
    r = simulate(o, p, 24, seed=0)
    a = r["wound_frac"] / r["wound_frac"][0]
    print(f"  {name:14s} 44x44 scratch: R^2 {lin_r2(r['t_hours'], a):.3f}  area_norm every 2 h {np.round(a[::2], 2)}")
df = pd.read_csv(CURVES)
for pos in ("exp1_partII_C61_P2", "exp1_partII_CC_P4", "exp1_partII_N61_P1", "exp1_partII_CC_P2"):
    c = df[df.position == pos].sort_values("frame")
    a = c.wound_frac.values / c.wound_frac.values[0]
    print(f"  data {pos:20s}: R^2 {lin_r2(c.t_hours.values, a):.3f}  area_norm every 2 h {np.round(a[::2], 2)}")
