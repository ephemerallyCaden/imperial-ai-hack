"""Raw data -> long-format wound-area curves in data/processed/.

Run with `python -I` (raw files are untrusted downloads; nothing is extracted to disk).

Outputs
  embryo_curves.csv    wound_id, group, frame, t_min, area_px, area_norm   (area_norm = area / area at frame 0)
  zaritsky_curves.csv  wound_id, cell_line, condition, frame, t_min, gap_frac, area_norm  (area_norm = gap / gap at frame 0)
  jin_profiles.npz     plain arrays (gitignored; source has no licence)
"""
import io, os, pickle, re, tarfile, zipfile
import numpy as np, pandas as pd, scipy.io as sio, tifffile
from scipy.ndimage import binary_fill_holes

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(HERE, "raw"))
OUT = os.path.join(HERE, "processed")
EMBRYO_MIN_PER_FRAME = 1.0  # from the Zenodo record description, not from file metadata


def embryo():
    rows = []
    z = zipfile.ZipFile(f"{ROOT}/embryo/Dataset.zip")
    for name in sorted(n for n in z.namelist() if n.startswith("Segmentations/") and n.endswith(".tif")):
        wid = os.path.basename(name)[:-4]
        masks = tifffile.imread(io.BytesIO(z.read(name))) > 0
        # masks are wound outlines; fill to get area
        area = np.array([binary_fill_holes(m).sum() for m in masks], dtype=float)
        group = re.sub(r"\d+$", "", wid)
        for i, a in enumerate(area):
            rows.append((wid, group, i, i * EMBRYO_MIN_PER_FRAME, a, a / area[0]))
    df = pd.DataFrame(rows, columns=["wound_id", "group", "frame", "t_min", "area_px", "area_norm"])
    df.to_csv(f"{OUT}/embryo_curves.csv", index=False)
    print(f"embryo: {df.wound_id.nunique()} wounds, {len(df)} frames -> embryo_curves.csv")


def zaritsky():
    import json
    index = {}  # wound_id -> (cell_line, condition) from GigaDB sample ids
    for f in json.load(open(f"{ROOT}/zaritsky/gigadb_index.json"))["data"]["files"]:
        if f["sample_id"]:
            line, cond = f["sample_id"].split("_cell-line_")
            index[f["file_name"].split(".")[0]] = (line, cond)
    md = sio.loadmat(f"{ROOT}/zaritsky/metadata.mat", squeeze_me=True)["metaData"]
    min_per_frame = dict(zip(md["experimentNames"].item(), md["timePerFrame"].item()))

    def roi_gaps(t, rois):
        for m in t:
            if m.name.endswith("experimentParams.mat") and m.size > 1_000_000:
                # DKWH7_L1.tar.gz: this entry is really a nested tar holding the experiment folder
                roi_gaps(tarfile.open(fileobj=t.extractfile(m)), rois)
            elif "/ROI/" in m.name and m.name.endswith("_roi.mat"):
                k = int(os.path.basename(m.name)[:3])
                try:
                    rois[k] = 1.0 - (sio.loadmat(io.BytesIO(t.extractfile(m).read()))["ROI"] > 0).mean()
                except Exception:
                    print(f"  unreadable ROI: {m.name}")

    rows = []
    for fn in sorted(os.listdir(f"{ROOT}/zaritsky")):
        if not fn.endswith(".tar.gz"):
            continue
        wid = fn[:-7]
        rois = {}
        with tarfile.open(f"{ROOT}/zaritsky/{fn}") as t:
            roi_gaps(t, rois)
        if not rois:
            print(f"  skip {wid}: no ROI masks found")
            continue
        dt = float(min_per_frame[wid])
        k0 = min(rois)  # SN77 wells number ROI frames from 1, the rest from 0
        line, cond = index.get(wid, ("?", "?"))
        for k in sorted(rois):
            rows.append((wid, line, cond, k - k0, (k - k0) * dt, rois[k], rois[k] / rois[k0]))
    df = pd.DataFrame(rows, columns=["wound_id", "cell_line", "condition", "frame", "t_min", "gap_frac", "area_norm"])
    df.to_csv(f"{OUT}/zaritsky_curves.csv", index=False)
    print(f"zaritsky: {df.wound_id.nunique()} wells, {len(df)} frames -> zaritsky_curves.csv")
    print(df.groupby(["cell_line", "condition"]).wound_id.nunique().to_string())


class _NumpyOnly(pickle.Unpickler):
    ALLOWED = {("numpy.core.multiarray", "_reconstruct"), ("numpy", "ndarray"), ("numpy", "dtype"), ("_codecs", "encode")}

    def find_class(self, mod, name):
        if (mod, name) not in self.ALLOWED:
            raise pickle.UnpicklingError(f"blocked {mod}.{name}")
        if mod == "numpy.core.multiarray":
            import numpy._core.multiarray as m
            return getattr(m, name)
        return super().find_class(mod, name)


def jin():
    raw = open(f"{ROOT}/jin/cell_density_profiles.npy", "rb").read()
    h = int.from_bytes(raw[8:10], "little")
    d = _NumpyOnly(io.BytesIO(raw[10 + h:]), encoding="latin1").load().item()
    out = {f"{k}__{kk}": np.asarray(v[kk], dtype=float) for k, v in d.items() for kk in ("x", "t", "U1", "U2", "U3")}
    np.savez(f"{OUT}/jin_profiles.npz", **out)
    print(f"jin: {len(d)} densities x 3 replicates -> jin_profiles.npz (x um, t h, density cells/um^2)")


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    os.makedirs(OUT, exist_ok=True)
    embryo()
    jin()
    zaritsky()
