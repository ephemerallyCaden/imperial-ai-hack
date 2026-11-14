"""WHAD mask -> simulator start state (area-preserving) and checks (#22).

Mask convention: wound = True. Sources: full-res PNGs (0 = wound, 0.454 um/px) under $WHAD_DIR
(default ~/whad-data/whad/masks/MCF10A/exp1), or P1's data/processed/whad_masks/<position>.npz.
"""
import glob, os, re
import numpy as np

UM_PER_PX = 0.454
WHAD_DIR = os.environ.get("WHAD_DIR", os.path.expanduser("~/whad-data/whad/masks/MCF10A/exp1"))


def load_png_mask(position, frame=None):
    """position like exp1_partII_C61_P1; returns (bool wound mask, um_per_px).
    frame=None: first annotated frame with any wound pixels (some positions start at t02/t03, as in whad_curves.csv)."""
    from PIL import Image
    m = re.match(r"exp1_part(I+)_(\w+)_(P\d+)$", position)
    d = f"{WHAD_DIR}/part_{m.group(1)}/{m.group(2)}/{m.group(3)}"
    for k in ([frame] if frame is not None else range(20)):
        f = glob.glob(f"{d}/*_t{k:02d}_ch00_mask.png")
        if f:
            w = np.array(Image.open(f[0])) == 0
            if w.any():
                return w, UM_PER_PX
    raise FileNotFoundError(f"no usable mask for {position} frame {frame} in {d}")


def load_npz_masks(path):
    z = np.load(path)
    return z["masks"].astype(bool), float(z["um_per_px"]), z["t_hours"]


def mask_to_lattice(wound, um_per_px, site_um=20.0, multiple=4):
    """Area-preserving resample: block-mean the wound mask to site size, then mark the
    N_empty = round(wound_frac * n_sites) most-wound sites empty. Returns occ (1 = cell).
    H and W are rounded to multiples of `multiple` (the coarse-grain factor) so coarse_grain never crops."""
    s = site_um / um_per_px
    H = max(multiple, multiple * round(wound.shape[0] / s / multiple))
    W = max(multiple, multiple * round(wound.shape[1] / s / multiple))
    ye = np.linspace(0, wound.shape[0], H + 1).round().astype(int)
    xe = np.linspace(0, wound.shape[1], W + 1).round().astype(int)
    # block means via integral image
    c = np.pad(wound.astype(np.float64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    tot = c[ye[1:]][:, xe[1:]] - c[ye[:-1]][:, xe[1:]] - c[ye[1:]][:, xe[:-1]] + c[ye[:-1]][:, xe[:-1]]
    frac = tot / np.outer(np.diff(ye), np.diff(xe))
    n_empty = int(round(wound.mean() * H * W))
    order = np.argsort(-frac.ravel(), kind="stable")
    occ = np.ones(H * W, np.uint8)
    occ[order[:n_empty]] = 0
    return occ.reshape(H, W)


def area_error(occ, wound):
    """Relative error of lattice wound fraction vs mask wound fraction."""
    return abs((1 - occ.mean()) - wound.mean()) / wound.mean()


if __name__ == "__main__":
    import sys
    pos = sys.argv[1] if len(sys.argv) > 1 else "exp1_partII_C61_P1"
    w, u = load_png_mask(pos)
    for site in (20.0, 10.0):
        occ = mask_to_lattice(w, u, site)
        print(pos, f"site {site} um: lattice {occ.shape}, wound_frac mask {w.mean():.4f} lattice {1-occ.mean():.4f}, err {area_error(occ, w):.4%}")
