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

Rules (Params.rule):
  "free"   (default; every result merged before P2 v2): a mover leaves a vacancy behind; vacancies diffuse back
           to the reservoir, so the sheet fills with holes and closure speed depends on the field size.
  "follow" (P2 v2, docs/follower-report.md): a mover connected to the reservoir (Moore path through occupied
           sites) pulls the chain of cells behind it one site, so the vacancy exits at the reservoir and is refilled.
           In occupancy terms its target fills and its source stays occupied. Movers not connected (islands) leave a
           vacancy as in "free". Same Tm/bias/dens_exp/conflict rules. Front-like closure, size independent.
           Implementation (step_follow): only cells with an empty Moore neighbour can act, so only they draw random
           numbers; connectivity = the reservoir's occupied Moore component, kept incrementally.
"""
from dataclasses import dataclass, asdict
import numpy as np

DT = 0.05  # hours per step; shared by calibrate.py, NCA data generation and sim/js/engine.js
SITE_UM = 20.0  # one lattice site = one cell; WHAD lattice is 32 x 44 (start_state.mask_to_lattice)
GRAIN = 2  # coarse-grain factor: WHAD density grid is 16 x 22

NB = np.array([(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)])
NB9 = np.array([(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])


@dataclass
class Params:
    Tm: float = 1.0          # hours per migration attempt (Tm = delta^2 / D)
    Td: float | None = None  # hours per division attempt; None = division off
    bias: float = 7 / 9      # prob of choosing a wound-ward target
    dens_exp: float = 0.5    # migration rate scales with rho_local ** dens_exp (0 = off)
    dt: float = DT           # hours per step (keep <= smallest Tm: move prob = dt/Tm saturates at 1)
    blur: int = 6            # radius (sites) of the emptiness blur that defines "toward the wound"
    edge: int = 2            # reservoir band width (sites)
    rule: str = "free"       # "free" (default, bit-identical to pre-v2 results) or "follow" (sheet-like, P2 v2)


RULES = ("free", "follow")


_EDGE_IDX = {}


def _edge_idx(n, r):
    """Indices that edge-replicate an axis of length n by r + 1 on both sides (= np.pad mode="edge")."""
    if (n, r) not in _EDGE_IDX:
        _EDGE_IDX[(n, r)] = np.clip(np.arange(-(r + 1), n + r + 1), 0, n - 1)
    return _EDGE_IDX[(n, r)]


def box_mean(a, r):
    """Mean over (2r+1)^2 window, edge-replicated, via cumulative sums (padding by index: same values as np.pad)."""
    p = a.astype(np.float32)[_edge_idx(a.shape[0], r)][:, _edge_idx(a.shape[1], r)]
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
    """In place: extend conn to every occupied site Moore-connected to it (conn only grows under "follow")."""
    occb = occ.astype(bool)
    conn &= occb
    while True:
        nxt = dilate(conn) & occb
        if (nxt == conn).all():
            return conn
        conn[:] = nxt


def join_islands(conn, occ):
    """After a "follow" step: if an island (occupied, not connected) now touches the component, absorb it.
    Keeps conn equal to grow_connected(reservoir, occ) recomputed from scratch (sim/tests/test_rules.py)."""
    if occ.sum() != conn.sum() and (dilate(conn) & ~conn & occ.astype(bool)).any():
        grow_connected(conn, occ)
    return conn


def step(occ, p: Params, rng, conn=None):
    """Advance one step in place. occ: (H,W) uint8, 1 = cell. conn: reservoir-connected mask, needed for "follow"."""
    if p.rule == "follow":
        return step_follow(occ, p, rng, conn)
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
    ys, xs, move, ty, tx = _choose_targets(ys, xs, move, gy, gx, empty, p, rng)
    occ[ty, tx] = 1
    occ[ys[move], xs[move]] = 0
    return occ


def _choose_targets(ys, xs, move, gy, gx, empty, p, rng):
    """Shared by both rules: biased choice among empty Moore neighbours, then random-priority conflicts."""
    H, W = empty.shape
    n = len(ys)
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
        return ys, xs, move, ty, tx
    # resolve conflicts: lowest random key wins each target site
    tgt = ty * W + tx
    key = rng.random(len(tgt))
    best = np.full(H * W, 2.0)
    np.minimum.at(best, tgt, key)
    win = key == best[tgt]
    return ys[win], xs[win], move[win], ty[win], tx[win]


def _grad_at(g, ys, xs):
    """np.gradient(g) (edge_order 1) evaluated only at (ys, xs)."""
    H, W = g.shape
    yp, ym = np.minimum(ys + 1, H - 1), np.maximum(ys - 1, 0)
    xp, xm = np.minimum(xs + 1, W - 1), np.maximum(xs - 1, 0)
    return (g[yp, xs] - g[ym, xs]) / (yp - ym), (g[ys, xp] - g[ys, xm]) / (xp - xm)


def step_follow(occ, p: Params, rng, conn):
    """One "follow" step in place; updates conn (bool, reservoir-connected cells) in place.
    Only cells with an empty Moore neighbour can act (others have no target), so only they draw random numbers."""
    empty = occ == 0
    ys, xs = np.nonzero(~empty & dilate(empty))
    if len(ys) == 0:
        return occ
    H, W = occ.shape  # rho = box_mean(occ, 1) at the front cells only (edge-replicated 3x3 mean, by gather)
    rho = occ[np.clip(ys[:, None] + NB9[:, 0], 0, H - 1), np.clip(xs[:, None] + NB9[:, 1], 0, W - 1)].mean(1)
    pm = np.minimum(1.0, p.dt / p.Tm) * rho ** p.dens_exp
    pd = 0.0 if p.Td is None else min(1.0, p.dt / p.Td)
    u = rng.random(len(ys))
    move = u < pm
    act = move | (u < pm + pd)
    if not act.any():
        return occ
    ys, xs, move = ys[act], xs[act], move[act]
    gy, gx = _grad_at(box_mean(empty, p.blur), ys, xs)
    ys, xs, move, ty, tx = _choose_targets(ys, xs, move, gy, gx, empty, p, rng)
    if len(ys) == 0:
        return occ
    con = conn[ys, xs]
    occ[ty, tx] = 1
    conn[ty[con], tx[con]] = True  # a connected cell's target is adjacent to it, so it joins the component
    vac = move & ~con
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
    assert p.rule in RULES, f"unknown rule {p.rule!r}; one of {RULES}"
    follow = p.rule == "follow"
    conn = grow_connected(res.copy(), occ) if follow else None
    spf = max(1, round(frame_dt / p.dt))
    nf = int(round(hours / frame_dt)) + 1
    occs, dens = [occ.copy()], [coarse_grain(occ, grain)]
    for _ in range(nf - 1):
        if follow and occ.all():  # closed: nothing can move or divide any more, so the state is final
            occs.append(occ.copy()); dens.append(dens[-1])
            continue
        for _ in range(spf):
            step(occ, p, rng, conn)
            refill(occ, res)
            if follow:
                join_islands(conn, occ)
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
    ap.add_argument("--rule", default="free", choices=RULES)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    t = time.time()
    r = simulate(straight_scratch(), Params(Tm=a.Tm, Td=a.Td, rule=a.rule), a.hours)
    print(f"{time.time()-t:.1f}s; wound_frac every 4h:", np.round(r["wound_frac"][::4], 3))
    if a.out:
        np.savez_compressed(a.out, **r)
