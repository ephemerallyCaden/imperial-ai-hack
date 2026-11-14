"""WHAD MCF10A annotated subset -> wound curves + downsampled masks (design.md 5.5, 6.1).

Run with `python -I data/build_whad.py` (masks are untrusted downloads).
Input:  $CLOSURECALL_DATA/whad/x/whad/masks/MCF10A/exp1/part_{I,II}/<cond>/P<n>/*_tNN_ch00_mask.png
        (0 = wound, 255 = cells; the extra *_mask_C0k.png files are small separate pieces and are ignored)
Output: data/processed/whad_curves.csv   position, part, condition, frame, t_hours, wound_frac, area_norm, closure, source
        data/processed/whad_masks/<position>.npz  (gitignored) masks[frames, H/4, W/4] uint8 1 = wound, t_hours, um_per_px
Units: hourly frames, t_hours = frame index; 0.454 um/px at full resolution. area_norm = wound_frac / wound_frac at the
first usable frame; closure = 1 - area_norm. MCF7 positions are not included (different mask layout).
"""
import glob, os, re
import numpy as np, pandas as pd
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(HERE, "raw"))
SRC = f"{ROOT}/whad/x/whad/masks/MCF10A/exp1"
OUT = os.path.join(HERE, "processed")
UM_PER_PX = 0.454
DOWN = 4


def main():
    os.makedirs(f"{OUT}/whad_masks", exist_ok=True)
    rows = []
    for d in sorted(glob.glob(f"{SRC}/part_*/*/P*")):
        part, cond, p = d.replace("\\", "/").split("/")[-3:]
        part = part.replace("part_", "")
        pos = f"exp1_part{part}_{cond}_{p}"
        frames = {}
        for f in glob.glob(f"{d}/*_ch00_mask.png"):
            k = int(re.search(r"_t(\d+)_ch00_mask\.png$", f).group(1))
            m = np.array(Image.open(f)) == 0
            if k <= 19 and m.any():  # t20 is an all-zero dummy in WHAD; skip blank frames
                frames[k] = m
        ks = sorted(frames)
        small = np.stack([frames[k][::DOWN, ::DOWN] for k in ks]).astype(np.uint8)
        np.savez_compressed(f"{OUT}/whad_masks/{pos}.npz", masks=small, t_hours=np.array(ks, float), um_per_px=UM_PER_PX * DOWN)
        # Part II is the SAME physical wound filmed after part I (same posNNNN id, files named "PartI_plus4_...",
        # masks overlap IoU 0.82-0.90). Gap between parts is unknown, so t_hours restarts at 0 in each part.
        # Any split must keep both parts of a wound (column `wound`) in the same fold.
        wound = re.search(r"pos\d+", os.path.basename(glob.glob(f"{d}/*_ch00_mask.png")[0])).group()
        w0 = frames[ks[0]].mean()
        for k in ks:
            w = frames[k].mean()
            rows.append((pos, wound, part, cond, k, float(k), w, w / w0, 1 - w / w0, "manual"))
    df = pd.DataFrame(rows, columns=["position", "wound", "part", "condition", "frame", "t_hours", "wound_frac", "area_norm", "closure", "source"])
    df.to_csv(f"{OUT}/whad_curves.csv", index=False)
    print(f"whad: {df.position.nunique()} positions, {len(df)} frames -> whad_curves.csv + whad_masks/")
    print(df.groupby(["part", "condition"]).position.nunique().to_string())


if __name__ == "__main__":
    main()
