"""Classical texture segmenter for phase-contrast scratch assays (design.md 6.2).

Wound = low-texture region. Texture = local standard deviation of the (downsampled) image; threshold =
FRAC x the 90th percentile of texture; then morphological clean-up and keep the large components.

Usage:
  python -I data/segment.py eval      # IoU and area error vs WHAD manual masks, per plate part
"""
import glob, os, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

DOWN = 4          # work at 1/4 resolution (0.454 um/px -> 1.8 um/px)
WIN = 9           # texture window in downsampled pixels (~16 um, about one cell)
FRAC = 0.35       # threshold = FRAC * p90(texture)
MIN_COMP = 0.01   # keep components larger than 1% of the field


def load_gray(path):
    a = np.asarray(Image.open(path), dtype=np.float32)
    if a.ndim == 3:
        a = a[..., :3].mean(-1)
    return a


def segment(img, frac=FRAC, win=WIN):
    """img: 2D float array at full resolution. Returns bool wound mask at 1/DOWN resolution."""
    a = img[::DOWN, ::DOWN]
    a = (a - a.mean()) / (a.std() + 1e-6)
    m = ndi.uniform_filter(a, win)
    tex = np.sqrt(np.maximum(ndi.uniform_filter(a * a, win) - m * m, 0))
    w = tex < frac * np.percentile(tex, 90)
    w = ndi.binary_opening(w, iterations=2)
    w = ndi.binary_closing(w, iterations=4)
    w = ndi.binary_fill_holes(w)
    lab, n = ndi.label(w)
    if n:
        sizes = ndi.sum(w, lab, range(1, n + 1))
        w = np.isin(lab, 1 + np.nonzero(sizes >= MIN_COMP * w.size)[0])
    return w


def evaluate(root, frac=FRAC, win=WIN):
    """IoU and wound-area error (points of field) vs manual masks for the annotated WHAD positions."""
    rows = []
    for d in sorted(glob.glob(f"{root}/whad/masks/MCF10A/exp1/part_*/*/P*")):
        part = d.replace("\\", "/").split("/")[-3]
        idir = d.replace("/masks/", "/images/").replace("\\masks\\", "\\images\\")
        for mf in glob.glob(f"{d}/*_ch00_mask.png"):
            tag = re.search(r"(pos\d+_t\d+)_ch00_mask\.png$", mf).group(1)
            im = glob.glob(f"{idir}/*{tag}_ch00.tif")
            if not im:
                continue
            gt = (np.asarray(Image.open(mf)) == 0)[::DOWN, ::DOWN]
            if not gt.any():
                continue
            pr = segment(load_gray(im[0]), frac, win)
            iou = (gt & pr).sum() / max((gt | pr).sum(), 1)
            rows.append((part, iou, 100 * abs(pr.mean() - gt.mean())))
    r = np.array([(x[1], x[2]) for x in rows])
    for part in sorted({x[0] for x in rows}):
        s = np.array([(x[1], x[2]) for x in rows if x[0] == part])
        print(f"  {part:8} n={len(s):3d}  IoU mean {s[:,0].mean():.3f} median {np.median(s[:,0]):.3f}  area error {s[:,1].mean():.2f} pts")
    print(f"  all      n={len(r):3d}  IoU mean {r[:,0].mean():.3f}  area error {r[:,1].mean():.2f} pts")
    return r[:, 0].mean()


if __name__ == "__main__":
    root = os.environ.get("CLOSURECALL_DATA", "data/raw") + "/whad/x"
    if sys.argv[1:] == ["eval"]:
        print(f"segmenter FRAC={FRAC} WIN={WIN}")
        evaluate(root)
