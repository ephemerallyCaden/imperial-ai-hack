"""Display-side smoothing of the agent lattice (#29, option b): smoothed occupancy and an area-matched wound outline.

Vacancies spreading into the sheet = sheet stretching (lower cell density), so the viewer shows a smoothed density.
fine_density(occ, k, sigma): occupancy upsampled k x (nearest) then Gaussian-blurred with `sigma` sites. 1 = cells.
outline(fine, wound_frac, k): contour at the level where the fraction of fine pixels below it equals wound_frac,
so the outlined area equals the agent wound area (same area at every zoom). Polylines in site coordinates
(x = column, y = row, the lattice spans [0, W] x [0, H]).
"""
import numpy as np
from contourpy import contour_generator


def _blur_matrix(n, s):
    r = max(1, int(np.ceil(3 * s)))
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2)
    w /= w.sum()
    P = np.pad(np.eye(n), ((r, r), (0, 0)), mode="symmetric")
    return sum(w[i] * P[i:i + n] for i in range(2 * r + 1))


def fine_density(occ, k=2, sigma=2.5):
    """occ (F,H,W) or (H,W) -> float32 (F, H*k, W*k) in [0,1]."""
    occ = np.asarray(occ, np.float32)
    if occ.ndim == 2:
        occ = occ[None]
    up = occ.repeat(k, 1).repeat(k, 2)
    My, Mx = _blur_matrix(up.shape[1], sigma * k), _blur_matrix(up.shape[2], sigma * k)
    return np.clip(My @ up @ Mx.T, 0, 1).astype(np.float32)  # (F,h,w); matmul, not a naive einsum


def outline(fine, wound_frac, k=2):
    """fine (h,w) -> (level, [flat [x0,y0,x1,y1,...] polylines in site coords])."""
    n = int(round(wound_frac * fine.size))
    if n == 0:
        return None, []
    v = np.sort(fine.ravel())
    level = float((v[n - 1] + v[n]) / 2) if n < v.size else float(v[-1]) + 1e-6
    lines = contour_generator(z=fine, line_type="Separate").lines(level)
    return level, [np.round((ln + 0.5) / k, 2).ravel().tolist() for ln in lines if len(ln) > 1]
