"""Cell-agent lattice simulator (design 5.1b). numpy only; rules are simple enough to port to JS.

One lattice site = one cell (~20 um). Per step (dt hours) every cell, in parallel:
  - migrates with prob dt/Tm * rho_local**dens_exp   (density-dependent movement)
  - else divides with prob dt/Td                      (only if Td is set; off for WHAD)
into a random EMPTY Moore neighbour (no empty neighbour = contact inhibited / quiescent).
Wound bias: with prob `bias` (Migliaccio: 7/9) the target is chosen only among empty neighbours
pointing toward the wound (up the blurred-emptiness gradient); else uniformly among empty ones.
Conflicts (two cells claim one site) are resolved by random priority.
Boundary: border-band sites (width `edge`) that are occupied at t0 are a reservoir, refilled every step
(cells keep entering the ROI, as in the WHAD field of view).
"""
from dataclasses import dataclass, asdict
import numpy as np

DT = 0.05  # hours per step; shared by calibrate.py, NCA data generation and sim/js/engine.js
SITE_UM = 20.0  # one lattice site = one cell; WHAD lattice is 32 x 44 (start_state.mask_to_lattice)
GRAIN = 2  # coarse-grain factor: WHAD density grid is 16 x 22

NB = np.array([(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)])


@dataclass
class Params:
    Tm: float = 1.0          # hours per migration attempt (Tm = delta^2 / D)
    Td: float | None = None  # hours per division attempt; None = division off
    bias: float = 7 / 9      # prob of choosing a wound-ward target
    dens_exp: float = 0.5    # migration rate scales with rho_local ** dens_exp (0 = off)
    dt: float = DT           # hours per step (keep <= smallest Tm: move prob = dt/Tm saturates at 1)
    blur: int = 6            # radius (sites) of the emptiness blur that defines "toward the wound"
    edge: int = 2            # reservoir band width (sites)
    follow: bool = False     # PROTOTYPE (feature/p2-follower): sheet-like followers, see step()


def box_mean(a, r):
    """Mean over (2r+1)^2 window, edge-replicated, via cumulative sums."""
    p = np.pad(a.astype(np.float32), r + 1, mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s[: a.shape[0], : a.shape[1]] / (k * k)


def reservoir_mask(occ0, edge):
    """Border band sites that are occupied at t0 (a wound touching the border stays open there)."""
    m = np.zeros(occ0.shape, bool)
    if edge > 0:
        m[:edge] = m[-edge:] = True
        m[:, :edge] = m[:, -edge:] = True
    return m & (occ0 == 1)


def refill(occ, res):
    occ[res] = 1


def dilate(m):
    """Moore (8-neighbour) dilation of a bool mask."""
    d = m.copy()
    d[1:] |= m[:-1]; d[:-1] |= m[1:]
    d2 = d.copy()
    d2[:, 1:] |= d[:, :-1]; d2[:, :-1] |= d[:, 1:]
    return d2


def grow_connected(conn, occ):
    """In place: extend conn to every occupied site Moore-connected to it (warm start; conn only grows)."""
    occb = occ.astype(bool)
    conn &= occb
    while True:
        nxt = dilate(conn) & occb
        if (nxt == conn).all():
            return conn
        conn[:] = nxt


def step(occ, p: Params, rng, conn=None):
    """Advance one step in place. occ: (H,W) uint8, 1 = cell.
    p.follow (prototype): a mover connected to the reservoir (conn) pulls the chain of cells behind it one site,
    along an occupied path back to the reservoir, which refills; in occupancy terms its source stays occupied.
    Movers not connected to the reservoir (islands) leave a vacancy as before. conn: bool mask, required if p.follow."""
    H, W = occ.shape
    ys, xs = np.nonzero(occ)
    if len(ys) == 0:
        return occ
    empty = (occ == 0)
    rho = box_mean(occ, 1)[ys, xs]
    pm = np.minimum(1.0, p.dt / p.Tm) * rho ** p.dens_exp
    pd = 0.0 if p.Td is None else min(1.0, p.dt / p.Td)
    u = rng.random(len(ys))
    move = u < pm
    div = (~move) & (u < pm + pd)
    act = move | div
    if not act.any():
        return occ
    ys, xs, move = ys[act], xs[act], move[act]
    n = len(ys)
    # wound direction: up the gradient of blurred emptiness
    g = box_mean(empty, p.blur)
    gy, gx = np.gradient(g)
    gy, gx = gy[ys, xs], gx[ys, xs]
    # candidate scores for the 8 neighbours
    ny = ys[:, None] + NB[None, :, 0]
    nx = xs[:, None] + NB[None, :, 1]
    inside = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
    nyc, nxc = np.clip(ny, 0, H - 1), np.clip(nx, 0, W - 1)
    free = inside & empty[nyc, nxc]
    toward = (NB[None, :, 0] * gy[:, None] + NB[None, :, 1] * gx[:, None]) > 0
    use_bias = rng.random(n) < p.bias
    score = rng.random((n, 8)) + 2.0 * (toward & use_bias[:, None] & free)
    score[~free] = -1.0
    # a biased cell with no free wound-ward neighbour falls back to any free one (score still >= 0)
    k = score.argmax(1)
    ok = score[np.arange(n), k] >= 0
    ty, tx = nyc[np.arange(n), k], nxc[np.arange(n), k]
    ys, xs, move, ty, tx = ys[ok], xs[ok], move[ok], ty[ok], tx[ok]
    if len(ys) == 0:
        return occ
    # resolve conflicts: lowest random key wins each target site
    tgt = ty * W + tx
    key = rng.random(len(tgt))
    best = np.full(H * W, 2.0)
    np.minimum.at(best, tgt, key)
    win = key == best[tgt]
    ys, xs, move, ty, tx = ys[win], xs[win], move[win], ty[win], tx[win]
    occ[ty, tx] = 1
    vac = move & ~conn[ys, xs] if p.follow else move
    occ[ys[vac], xs[vac]] = 0
    return occ


def coarse_grain(occ, g):
    """Block-mean density grid, factor g (crops to a multiple of g)."""
    H, W = (occ.shape[0] // g) * g, (occ.shape[1] // g) * g
    return occ[:H, :W].reshape(H // g, g, W // g, g).mean((1, 3)).astype(np.float32)


def simulate(occ0, p: Params, hours, frame_dt=1.0, seed=0, grain=GRAIN):
    """Run and record. Returns dict matching docs/sim.md (npz-ready)."""
    rng = np.random.default_rng(seed)
    occ = occ0.astype(np.uint8).copy()
    res = reservoir_mask(occ, p.edge)
    refill(occ, res)
    conn = grow_connected(res.copy(), occ) if p.follow else None
    spf = max(1, round(frame_dt / p.dt))
    nf = int(round(hours / frame_dt)) + 1
    occs, dens = [occ.copy()], [coarse_grain(occ, grain)]
    for _ in range(nf - 1):
        for _ in range(spf):
            step(occ, p, rng, conn)
            refill(occ, res)
            if p.follow:
                grow_connected(conn, occ)
        occs.append(occ.copy())
        dens.append(coarse_grain(occ, grain))
    occs = np.stack(occs)
    return dict(
        occ=occs,
        density=np.stack(dens),
        t_hours=np.arange(nf) * spf * p.dt,
        wound_frac=1.0 - occs.mean((1, 2)),
        grain=grain,
        params=np.array(str(asdict(p))),
    )


def straight_scratch(H=120, W=160, width=30):
    occ = np.ones((H, W), np.uint8)
    c = W // 2
    occ[:, c - width // 2: c + width // 2] = 0
    return occ


if __name__ == "__main__":
    import argparse, time
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--Tm", type=float, default=1.0)
    ap.add_argument("--Td", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    t = time.time()
    r = simulate(straight_scratch(), Params(Tm=a.Tm, Td=a.Td), a.hours)
    print(f"{time.time()-t:.1f}s; wound_frac every 4h:", np.round(r["wound_frac"][::4], 3))
    if a.out:
        np.savez_compressed(a.out, **r)
