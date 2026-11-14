"""Auto-segment WHAD MCF10A positions that have no manual masks (design.md 6.1: exp1 remainder + exp2).

Run with `python -I data/build_whad_auto.py`. Images come from $CLOSURECALL_DATA/whad_full (fetched by range
requests from Zenodo 12806149). Segmenter: data/segment.py (IoU ~0.72 vs manual masks; area error ~1.8 points).
Frames whose mask covers <1% or >70% of the field are kept but marked qc=fail (design.md 5.5 refusal rules).
Output: data/processed/whad_auto_curves.csv  same columns as whad_curves.csv + experiment, qc; source = auto
"""
import glob, os, re, sys
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from segment import load_gray, segment  # noqa: E402

ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(HERE, "raw"))


def main():
    rows = []
    dirs = sorted(glob.glob(f"{ROOT}/whad_full/whad/images/MCF10A/exp[12]/part_*/*/P*"))
    for n, d in enumerate(dirs, 1):
        exp, part, cond, p = d.replace("\\", "/").split("/")[-4:]
        part = part.replace("part_", "")
        frames = {}
        for f in glob.glob(f"{d}/*_ch00.tif"):
            k = int(re.search(r"_t(\d+)_ch00\.tif$", f).group(1))
            img = load_gray(f)
            if k <= 19 and img.std() > 1:  # t20 is an all-zero dummy; skip blank frames
                frames[k] = (segment(img).mean(), re.search(r"pos\d+", f).group())
        if not frames:
            continue
        ks = sorted(frames)
        wound = f"{exp}_{frames[ks[0]][1]}"
        w0 = frames[ks[0]][0]
        for k in ks:
            w = frames[k][0]
            qc = "ok" if 0.01 <= w <= 0.70 else "fail"
            rows.append((f"{exp}_part{part}_{cond}_{p}", wound, exp, part, cond, k, float(k), w,
                         w / w0 if w0 else np.nan, 1 - w / w0 if w0 else np.nan, "auto", qc))
        print(f"  [{n}/{len(dirs)}] {exp} part {part} {cond}/{p}: {len(ks)} frames, wound {w0:.3f} -> {frames[ks[-1]][0]:.3f}", flush=True)
    df = pd.DataFrame(rows, columns=["position", "wound", "experiment", "part", "condition", "frame", "t_hours",
                                     "wound_frac", "area_norm", "closure", "source", "qc"])
    df.to_csv(os.path.join(HERE, "processed", "whad_auto_curves.csv"), index=False)
    print(f"whad auto: {df.position.nunique()} positions, {df.wound.nunique()} wounds, {len(df)} frames, "
          f"qc fail {int((df.qc == 'fail').sum())} -> whad_auto_curves.csv")
    print(df.groupby(["experiment", "condition"]).wound.nunique().to_string())


if __name__ == "__main__":
    main()
