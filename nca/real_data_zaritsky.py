"""Zaritsky 2015 scratch-assay ROI masks -> real-frame NCA training sequences (#62, part of #60).

python -I nca/real_data_zaritsky.py [--raw DIR] [--out data/processed/nca_real_zaritsky.npz]
Raw dir: $CLOSURECALL_DATA/zaritsky (default ~/hack-data/zaritsky): 19 *.tar.gz wells + metadata.mat. Archives are
untrusted downloads: members are read in memory, nothing is extracted (run with python -I).

Per well: gap mask per ROI frame (wound = ROI == 0; truncated .mat frames skipped; the DKWH7_L1 nested tar is
recursed, as data/build_curves.zaritsky) -> drop glitch frames (wound fraction off the median of its +-2 kept
neighbours by > GLITCH x the start fraction, worst first, repeated; or exactly 0 while a later frame is not) ->
stop at the first frame with wound fraction < CLOSED -> keep the frame nearest each whole hour -> lattice
(start_state.mask_to_lattice, 20 um sites) -> coarse density (cellsim.coarse_grain) and reservoir R
(api.lattice_to_state on the first kept frame) -> (Tm, bias) point estimate by grid self-fit through the
simulator-trained NCA (forecast_gate.self_fit) on the whole kept sequence.

Output (np.savez_compressed, no object arrays, loads with allow_pickle=False):
  ids (well), wounds (zaritsky_<well>), datasets ("zaritsky"), params (N, 2 float32: Tm h, bias), sources ("manual")
  per sequence i: {i}__density (F, h, w float32, 1 = cells), {i}__t (F float32, hours since first kept frame),
  {i}__R (F, h, w float32, reservoir per frame). Grids differ by pixel size: 1.24 um/px -> 32 x 32, 0.879 um/px -> 22 x 22.
"""
import argparse, io, os, sys, tarfile, time, zlib
import numpy as np, scipy.io as sio

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path[:0] = [os.path.join(ROOT, "eval"), os.path.join(ROOT, "sim"), HERE]
from cellsim import coarse_grain, GRAIN, SITE_UM  # noqa: E402
from start_state import mask_to_lattice  # noqa: E402
import api  # noqa: E402
from forecast_gate import self_fit  # noqa: E402

GLITCH = 0.15  # max |frac - median(+-2 neighbours)| as a fraction of the start wound fraction
CLOSED = 0.01  # wound fraction of the field below which the wound counts as closed (series stops)
MAX_GLITCH = 1 / 3  # wells with more glitch frames than this share are too noisy to use (SN77_L30)


def read_rois(t, out):
    """{ROI file number: wound bool mask} from an open tar, recursing into the DKWH7_L1 nested tar."""
    for m in t:
        if m.name.endswith("experimentParams.mat") and m.size > 1_000_000:
            read_rois(tarfile.open(fileobj=io.BytesIO(t.extractfile(m).read())), out)
        elif "/ROI/" in m.name and m.name.endswith("_roi.mat"):
            try:
                out[int(os.path.basename(m.name)[:3])] = sio.loadmat(io.BytesIO(t.extractfile(m).read()))["ROI"] == 0
            except Exception:
                print(f"  unreadable ROI (skipped): {m.name}")


def glitch_keep(f):
    """Boolean keep mask over frames: drop the worst outlier vs its +-2 kept neighbours until none exceed GLITCH."""
    keep = np.ones(len(f), bool)
    ref = float(np.median(f[:3]))
    while True:
        idx = np.nonzero(keep)[0]; g = f[idx]
        dev = np.zeros(len(g))
        for j in range(len(g)):
            nb = np.r_[g[max(0, j - 2):j], g[j + 1:j + 3]]
            dev[j] = abs(g[j] - np.median(nb)) / ref if len(nb) else 0.0
            if g[j] == 0 and (g[j + 1:] > 0).any():
                dev[j] = max(dev[j], np.inf)
        j = int(dev.argmax())
        if dev[j] <= GLITCH:
            return keep
        keep[idx[j]] = False


def hourly(t):
    """Indices of the frame nearest each whole hour (within 0.5 h), deduplicated."""
    sel = []
    for h in range(int(np.floor(t[-1])) + 1):
        j = int(np.abs(t - h).argmin())
        if abs(t[j] - h) <= 0.5 and (not sel or j > sel[-1]):
            sel.append(j)
    return np.array(sel)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(os.environ.get("CLOSURECALL_DATA", os.path.expanduser("~/hack-data")), "zaritsky"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "processed", "nca_real_zaritsky.npz"))
    a = ap.parse_args()
    import warnings; warnings.filterwarnings("ignore")
    import torch; torch.set_num_threads(4)
    t_start = time.time()
    md = sio.loadmat(f"{a.raw}/metadata.mat", squeeze_me=True)["metaData"]
    names = list(md["experimentNames"].item())
    um_px = dict(zip(names, md["pixelSize"].item())); min_fr = dict(zip(names, md["timePerFrame"].item()))
    net = api.load()

    out = {}; ids = []; params = []; max_err = []; rmses = []
    print(f"{'well':10s} {'um/px':>5s} {'raw':>4s} {'glitch':>6s} {'closed@h':>8s} {'F':>3s} {'grid':>7s} {'t_end':>5s} "
          f"{'maxdt':>5s} {'frac0':>5s} {'a_end':>5s} {'rise':>5s} {'err%':>5s}  Tm, bias  fit_rmse")
    for fn in sorted(os.listdir(a.raw)):
        if not fn.endswith(".tar.gz"):
            continue
        well = fn[:-7]
        rois = {}
        with tarfile.open(f"{a.raw}/{fn}") as t:
            read_rois(t, rois)
        if len(rois) < 2:
            print(f"{well:10s} skipped: {len(rois)} readable ROI frames"); continue
        upx, dt = float(um_px[well]), float(min_fr[well])
        k = np.array(sorted(rois)); masks = [rois[i] for i in k]; del rois
        f = np.array([m.mean() for m in masks])
        keep = glitch_keep(f)
        n_glitch = int((~keep).sum())
        if n_glitch > MAX_GLITCH * len(keep):
            print(f"{well:10s} skipped: {n_glitch}/{len(keep)} glitch frames"); continue
        k, f, masks = k[keep], f[keep], [m for m, q in zip(masks, keep) if q]
        closed = np.nonzero(f < CLOSED)[0]
        if len(closed):  # keep the first closed frame, drop the rest
            c = int(closed[0]) + 1
            k, f, masks = k[:c], f[:c], masks[:c]
        t_all = (k - k[0]) * dt / 60.0
        sel = hourly(t_all)
        if len(sel) < 3:
            print(f"{well:10s} skipped: {len(sel)} hourly frames"); continue
        t_h = t_all[sel].astype(np.float32)
        occs = [mask_to_lattice(masks[j], upx, SITE_UM) for j in sel]
        errs = [abs((1 - o.mean()) - masks[j].mean()) for o, j in zip(occs, sel)]  # absolute wound-fraction error
        rel0 = abs((1 - occs[0].mean()) - f[sel[0]]) / f[sel[0]]
        dens = np.stack([coarse_grain(o, GRAIN) for o in occs]).astype(np.float32)
        R = np.stack([api.lattice_to_state(o)[1] for o in occs]).astype(np.float32)  # reservoir per frame
        a_obs = f[sel] / f[sel[0]]
        point, _ = self_fit(net, occs[0], t_h.astype(float), a_obs, np.random.default_rng(zlib.crc32(well.encode())), nboot=1)
        wd = api.rollout(net, *api.lattice_to_state(occs[0]), point[None], int(round(t_h[-1])), stochastic=False)[0]
        rmse = float(np.sqrt(np.mean((np.interp(t_h, np.arange(len(wd)), wd / wd[0]) - a_obs) ** 2)))
        rise = max(0.0, float(max(a_obs[j] - a_obs[:j].min() for j in range(1, len(a_obs)))))  # largest rebound above the running min
        i = len(ids)
        out[f"{i}__density"], out[f"{i}__t"], out[f"{i}__R"] = dens, t_h, R
        ids.append(well); params.append(point); max_err.append(max(errs)); rmses.append(rmse)
        print(f"{well:10s} {upx:5.3f} {len(keep):4d} {n_glitch:6d} "
              f"{(f'{t_all[closed[0]]:.1f}' if len(closed) else '-'):>8s} {len(sel):3d} {str(dens.shape[1:]):>7s} "
              f"{t_h[-1]:5.1f} {np.diff(t_h).max():5.2f} {f[sel[0]]:5.3f} {a_obs[-1]:5.3f} {rise:5.3f} {100 * rel0:5.2f}  "
              f"{point[0]:.3f}, {point[1]:.2f}  {rmse:.3f}", flush=True)

    params = np.array(params, np.float32)
    np.savez_compressed(a.out, ids=np.array(ids, str), wounds=np.array([f"zaritsky_{w}" for w in ids], str),
                        datasets=np.array(["zaritsky"] * len(ids), str), params=params,
                        sources=np.array(["manual"] * len(ids), str), **out)
    z = np.load(a.out, allow_pickle=False); assert len(z["ids"]) == len(ids)
    F = [len(out[f"{i}__t"]) for i in range(len(ids))]
    print(f"\nwells kept {len(ids)}; frames/well min {min(F)} median {int(np.median(F))} max {max(F)} (total {sum(F)})")
    print(f"grid shapes: { {str(s): sum(out[f'{i}__density'].shape[1:] == s for i in range(len(ids))) for s in {out[f'{i}__density'].shape[1:] for i in range(len(ids))}} }")
    print(f"lattice vs mask wound fraction, max abs error over all kept frames: {max(max_err):.5f}")
    print(f"params: Tm {params[:, 0].min():.3f}-{params[:, 0].max():.3f} h, bias {params[:, 1].min():.2f}-{params[:, 1].max():.2f}")
    edge = np.isclose(params[:, 0], 0.05) & np.isclose(params[:, 1], 0.9)
    print(f"fit at the fast corner of the grid (Tm 0.05, bias 0.9): {int(edge.sum())}/{len(ids)}; "
          f"NCA fit RMSE (area_norm) median {np.median(rmses):.3f} max {max(rmses):.3f}")
    print(f"runtime {time.time() - t_start:.0f} s; {a.out} {os.path.getsize(a.out) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
