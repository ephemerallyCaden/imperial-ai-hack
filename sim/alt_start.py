"""Alternative start states and observables for the Investigator (#91, design.md 9b). numpy only.

The normal start (start_state.mask_to_lattice, forecast.band_start) fills every non-wound site. These helpers change a
start lattice or the per-site migration time WITHOUT changing any default: alt_start(occ0) with default arguments returns
an identical copy, and simulate(..., tm_map=None) is the uniform-Tm simulator (sim/tests/test_alt_start.py).

  alt_start(occ0, density=1.0, edge_damage=0, damage_prob=0.5, edge=2, seed=0) -> occ (H,W) uint8, 1 = cell
      density < 1: vacate round((1 - density) * n) of the n cells outside the wound and outside the border reservoir
                   band (width `edge`, as cellsim.reservoir_mask), chosen uniformly without replacement (seeded).
      edge_damage = d > 0: vacate each such cell within Chebyshev distance d of a wound site with prob damage_prob
                   (a ragged, wider wound). Applied before the density step. The reservoir band is never touched.
  region_tm_map(shape, region, factor) -> (H,W) float Tm multiplier for simulate(tm_map=...): `factor` inside the bool
      `region`, 1 elsewhere. factor > 1 = slower migration there; np.inf = cells there never start a move (stall).
      The multiplier belongs to the site, so a cell moving into the region slows down there.
  observed_area(occ_frames, min_gap=10) -> (F,) fraction of the lattice in the visible wound: empty sites in
      4-connected empty components of at least `min_gap` sites. Small holes inside the sheet (for example from
      density < 1) are not counted, as a segmenter would not see them. Use the same observable for synthetic truth and
      for the Investigator's reruns; cellsim's `wound_frac` (1 - mean occ) counts every empty site.

Known limitation (follower rule): interior holes next to reservoir-connected cells refill within a few hours, so a lower
start density barely changes observed_area (sim/make_known_cause.py reports it); it is a weakly identifiable cause.
"""
import numpy as np


def _border(shape, edge):
    m = np.zeros(shape, bool)
    if edge > 0:
        m[:edge] = m[-edge:] = True
        m[:, :edge] = m[:, -edge:] = True
    return m


def _chebyshev_near(mask, d):
    """Sites within Chebyshev distance d of a True site (no wrap-around)."""
    out = mask.copy()
    for _ in range(d):
        g = out.copy()
        g[1:] |= out[:-1]; g[:-1] |= out[1:]
        h = g.copy()
        h[:, 1:] |= g[:, :-1]; h[:, :-1] |= g[:, 1:]
        out = h
    return out


def alt_start(occ0, density=1.0, edge_damage=0, damage_prob=0.5, edge=2, seed=0):
    assert 0 < density <= 1 and edge_damage >= 0 and 0 <= damage_prob <= 1
    occ = np.asarray(occ0).astype(np.uint8).copy()
    if density == 1.0 and edge_damage == 0:
        return occ
    rng = np.random.default_rng(seed)
    keep = _border(occ.shape, edge)  # the reservoir band stays as it was
    if edge_damage > 0:
        near = _chebyshev_near(occ == 0, int(edge_damage)) & (occ == 1) & ~keep
        occ[near & (rng.random(occ.shape) < damage_prob)] = 0
    if density < 1.0:
        cand = np.flatnonzero((occ == 1).ravel() & ~keep.ravel())
        k = int(round((1 - density) * cand.size))
        occ.ravel()[rng.choice(cand, k, replace=False)] = 0
    return occ


def region_tm_map(shape, region, factor):
    assert factor > 0
    m = np.ones(shape, float)
    m[np.asarray(region, bool)] = factor
    return m


def _components(empty):
    """4-connected component sizes; returns (labels (H,W) int, sizes list) by an iterative flood fill."""
    H, W = empty.shape
    lab = np.full((H, W), -1, int)
    sizes = []
    for start in np.flatnonzero(empty.ravel()):
        if lab.flat[start] >= 0:
            continue
        stack, n, c = [start], 0, len(sizes)
        lab.flat[start] = c
        while stack:
            i = stack.pop(); n += 1
            y, x = divmod(i, W)
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < H and 0 <= xx < W and empty[yy, xx] and lab[yy, xx] < 0:
                    lab[yy, xx] = c; stack.append(yy * W + xx)
        sizes.append(n)
    return lab, sizes


def observed_area(occ_frames, min_gap=10):
    occ_frames = np.asarray(occ_frames)
    if occ_frames.ndim == 2:
        occ_frames = occ_frames[None]
    out = []
    for occ in occ_frames:
        lab, sizes = _components(occ == 0)
        big = np.array([s >= min_gap for s in sizes] + [False])  # index -1 (cells) maps to False
        out.append(big[lab].sum() / occ.size)
    return np.array(out)
