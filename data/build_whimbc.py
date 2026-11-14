"""WHiM-BC (Zenodo 8131123, CC BY 4.0) -> wound curves. Run with `python -I data/build_whimbc.py`.

MCF-7 scratch assays: Monolayer = ordinary cancer cells (12 wells, t = 0,3,6,9,12,24,27 h);
Sphere = cancer-stem-cell-enriched (12 wells, t = 0,3,6,9,12,15 h). Masks: gray/*.png, bright (>127) = wound.
Sphere wells have 7 masks but the readme lists 6 time points; mask 7 jumps back to ~0.43 wound, so it is dropped.
Output: data/processed/whimbc_curves.csv  wound, condition, frame, t_hours, wound_frac, area_norm, closure, source
"""
import glob, os, re
import numpy as np, pandas as pd
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(HERE, "raw"))
TIMES = {"Monolayer": [0, 3, 6, 9, 12, 24, 27], "Sphere": [0, 3, 6, 9, 12, 15]}


def main():
    rows = []
    for kind, times in TIMES.items():
        for w in sorted(glob.glob(f"{ROOT}/whimbc/WHiM-BC Dataset/{kind}/{kind}_*")):
            fs = sorted(glob.glob(f"{w}/gray/*.png"), key=lambda f: int(re.search(r"segmentation_(\d+)\.png$", f).group(1)))
            fr = [(np.array(Image.open(f))[..., 0] > 127).mean() for f in fs[:len(times)]]
            wid = os.path.basename(w)
            for k, (t, x) in enumerate(zip(times, fr)):
                rows.append((wid, kind, k, float(t), x, x / fr[0], 1 - x / fr[0], "manual"))
    df = pd.DataFrame(rows, columns=["wound", "condition", "frame", "t_hours", "wound_frac", "area_norm", "closure", "source"])
    df.to_csv(os.path.join(HERE, "processed", "whimbc_curves.csv"), index=False)
    print(f"whimbc: {df.wound.nunique()} wells, {len(df)} frames -> whimbc_curves.csv")
    print(df.groupby("condition").wound.nunique().to_string())


if __name__ == "__main__":
    main()
