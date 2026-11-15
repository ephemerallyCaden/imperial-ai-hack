"""NCA v2 (follower rule) on REAL WHAD frames: P1's nca/finetune_real.py recipe (#63) applied unchanged to nca/v2/weights.pt.
Copied (not imported: finetune_real.py is a script) with only these changes, everything else identical:
  - model, Tm/bias encoding and clamping from the init weights' config (nca/v2/weights.config.json: follower rule,
    source gate on, Tm 0.05-500 h); the config is written next to every output;
  - WHAD param labels = the FOLLOWER fits (sim/fits/whad_fits_follow.json, fits[position]["9.5"], the same cut-off P1
    used for its free-rule labels); the fits file's rule is asserted;
  - defaults: --init nca/v2/weights.pt, --out nca/v2/weights_real_fold{k}.pt, --zaritsky '' (WHAD only, as nca_realft).
python nca/v2/finetune_real_follow.py --fold 0   (... 1, 2, 3)

P1's original docstring:
#63: fine-tune the (simulator-trained) NCA on REAL wound frames, wound-level cross-validation folds.

python nca/finetune_real.py --fold 0            # train on WHAD folds != 0 + all Zaritsky, validate on WHAD fold 0
python nca/finetune_real.py --fold all          # train on everything, keep the last weights (final export)
Inputs (np.savez_compressed, allow_pickle=False): ids, wounds, datasets, params (N,2: Tm h, bias), sources and per
sequence i: {i}__density (F,h,w; 1 = cells), {i}__t (F, hours since first frame), {i}__R (h,w reservoir).
fold(wound) = crc32(wound) % nfolds, so frames of one physical wound never sit on both sides of a split.
Loss as train.py (two stochastic members): per-cell energy score + w_anorm * energy score on wound/wound(start)
+ 50 * area MSE + w_mse * per-cell MSE, all at the observed frames (target frame j at hour round(t_j - t_s)).
Validation metric: deterministic rollout from each held-out sequence's first frame, mean |pred wound/wound0 -
obs wound/wound0| over the observed frames after the first (wound = 1 - mean density).
"""
import argparse, json, os, shutil, sys, time, zlib, numpy as np, torch
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from model import build, load_config, encode, config_path

ap = argparse.ArgumentParser()
ap.add_argument("--whad", default="data/processed/nca_real_whad.npz")
ap.add_argument("--zaritsky", default="", help="used for training if it exists ('' = off; v2 default off, as nca_realft)")
ap.add_argument("--fits", default="sim/fits/whad_fits_follow.json", help="follower-rule fits; WHAD labels = fits[pos]['9.5']")
ap.add_argument("--fold", default="0", help="k in [0, nfolds) or 'all'")
ap.add_argument("--nfolds", type=int, default=4)
ap.add_argument("--init", default="nca/v2/weights.pt")
ap.add_argument("--out", default=None, help="default nca/weights_real_fold{k}.pt")
ap.add_argument("--steps", type=int, default=800); ap.add_argument("--bs", type=int, default=8)
ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--max-hours", type=float, default=19.0)
ap.add_argument("--w-anorm", type=float, default=1.0); ap.add_argument("--w-mse", type=float, default=1.0)
ap.add_argument("--val-every", type=int, default=100); ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--augment", type=int, default=1, help="random horizontal/vertical flips of start, reservoir and targets")
ap.add_argument("--keep-edge-params", action="store_true", help="keep non-WHAD sequences whose params hit the grid corner")
ap.add_argument("--select", choices=["last", "val"], default="last",
                help="last = save the final weights (no peeking: the held-out fold is the gate's test set); "
                     "val = keep the best held-out checkpoint (leaks test outcomes into weight choice; diagnostics only)")
a = ap.parse_args()
torch.manual_seed(a.seed); torch.set_num_threads(4); rng = np.random.default_rng(a.seed)
a.out = a.out or f"nca/v2/weights_real_fold{a.fold}.pt"
CFG = load_config(a.init)
assert CFG.get("follow"), f"{a.init}: not a follower-rule model ({CFG})"
TM_MIN, TM_MAX, BIAS_MIN, BIAS_MAX = CFG["tm_min"], CFG["tm_max"], CFG["bias_min"], CFG["bias_max"]
FJ = json.load(open(a.fits))
assert FJ.get("params", {}).get("rule") == "follow", f"{a.fits}: not follower-rule fits"
FOLLOW = {p: f["9.5"] for p, f in FJ["fits"].items() if f.get("9.5")}
norm_params = lambda Tm, bias: encode(CFG, Tm, bias)


def fold_of(w):
    return zlib.crc32(str(w).encode()) % a.nfolds


def load(path):
    d = np.load(path, allow_pickle=False)
    out = []
    for i in range(len(d["ids"])):
        Tm, bias = (float(v) for v in d["params"][i])
        if str(d["datasets"][i]) == "whad":  # follower-rule label (P1's npz carries free-rule labels)
            f = FOLLOW[str(d["ids"][i])]; Tm, bias = float(f["Tm"]), float(f["bias"])
        Tm = Tm if np.isfinite(Tm) else 1.0; bias = bias if np.isfinite(bias) else 0.5
        Tm, bias = min(max(Tm, TM_MIN), TM_MAX), min(max(bias, BIAS_MIN), BIAS_MAX)
        out.append(dict(id=str(d["ids"][i]), wound=str(d["wounds"][i]), dataset=str(d["datasets"][i]),
                        x=torch.tensor(d[f"{i}__density"], dtype=torch.float32), t=np.asarray(d[f"{i}__t"], np.float64),
                        R=(lambda r: r[:, None] if r.dim() == 3 else r[None, None].expand(len(d[f"{i}__t"]), 1, *r.shape))(
                            torch.tensor(d[f"{i}__R"], dtype=torch.float32)),  # (F,1,h,w): reservoir at each start frame
                        p=torch.tensor(norm_params(Tm, bias), dtype=torch.float32)))
    keep = [s for s in out if len(s["t"]) >= 2]
    if not a.keep_edge_params:  # self-fit stuck at the grid corner = no usable param label (review #66 finding 6)
        keep = [s for s, (Tm, bias) in zip(out, d["params"]) if len(s["t"]) >= 2 and not
                (s["dataset"] != "whad" and Tm <= TM_MIN * 1.02 and bias >= BIAS_MAX - 0.01)]
    return keep


seqs = load(a.whad)
if a.zaritsky and os.path.exists(a.zaritsky):
    seqs += load(a.zaritsky)
if a.fold == "all":
    tr, va = seqs, []
else:
    k = int(a.fold)
    va = [s for s in seqs if s["dataset"] == "whad" and fold_of(s["wound"]) == k]
    tr = [s for s in seqs if not (s["dataset"] == "whad" and fold_of(s["wound"]) == k)]
    assert not ({s["wound"] for s in tr} & {s["wound"] for s in va}), "wound in both train and val"
assert tr, "no training sequences"
groups = {}
for s in tr:
    groups.setdefault(tuple(s["x"].shape[1:]), []).append(s)
gkeys = list(groups); gw = np.array([len(groups[g]) for g in gkeys], float); gw /= gw.sum()
print(f"fold={a.fold} train={len(tr)} ({len({s['wound'] for s in tr})} wounds) val={len(va)} "
      f"({len({s['wound'] for s in va})} wounds) shapes={ {g: len(v) for g, v in groups.items()} }", flush=True)


def val_metric(net):
    """Deterministic rollout from frame 0 of each held-out sequence; mean |wound/wound0 pred - obs| over frames > 0."""
    if not va:
        return float("nan")
    errs = []
    with torch.no_grad():
        for s in va:
            hrs = np.rint(s["t"] - s["t"][0]).astype(int)
            if hrs.max() < 1:
                continue
            y = net(s["x"][None, :1], s["p"][None], int(hrs.max()), R=s["R"][:1], stochastic=False)[0]
            w0 = (1 - s["x"][0].mean()).clamp_min(1e-3)
            pw, ow = (1 - y.mean((1, 2))) / w0, (1 - s["x"].mean((1, 2))) / w0
            j = np.nonzero(hrs > 0)[0]
            errs.append((pw[hrs[j]] - ow[j]).abs().mean().item())
    return float(np.mean(errs))


def batch():
    """Sample a shape group, bs sequences, per-sample start frame s and end frame e (t_e - t_s <= Lh, Lh random).
    Returns start rho, R, params, hourly targets (B,N+1,h,w) and their mask (B,N+1)."""
    G = groups[gkeys[rng.choice(len(gkeys), p=gw)]]
    Lh = rng.uniform(1, a.max_hours)
    picks, N = [], 1
    for s in (G[i] for i in rng.integers(0, len(G), a.bs)):
        t = s["t"]; st = int(rng.integers(0, len(t) - 1))
        ok = [j for j in range(st + 1, len(t)) if t[j] - t[st] <= Lh] or [st + 1]
        hrs = {int(round(t[j] - t[st])): j for j in ok if round(t[j] - t[st]) >= 1}
        if not hrs:
            hrs = {1: st + 1}
        picks.append((s, st, hrs)); N = max(N, max(hrs))
    h, w = picks[0][0]["x"].shape[1:]
    tgt = torch.zeros(a.bs, N + 1, h, w); m = torch.zeros(a.bs, N + 1)
    for b, (s, st, hrs) in enumerate(picks):
        for hr, j in hrs.items():
            tgt[b, hr] = s["x"][j]; m[b, hr] = 1
    x0 = torch.stack([s["x"][st] for s, st, _ in picks])[:, None]
    R = torch.stack([s["R"][st] for s, st, _ in picks]); P = torch.stack([s["p"] for s, _, _ in picks])
    if a.augment:  # dynamics do not depend on orientation: same flip for start, reservoir and targets
        for dim in (-1, -2):
            if rng.random() < 0.5:
                x0, R, tgt = x0.flip(dim), R.flip(dim), tgt.flip(dim)
    return x0, R, P, tgt, m, N


net = build(CFG); net.load_state_dict(torch.load(a.init, map_location="cpu"))
json.dump({**CFG, "finetune": dict(recipe="nca/finetune_real.py (P1)", fold=a.fold, steps=a.steps, select=a.select, fits=a.fits)},
          open(config_path(a.out), "w"), indent=1)
opt = torch.optim.Adam(net.parameters(), a.lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.steps)
init_m = val_metric(net); best = init_m
print(f"init val_norm_area_mae={init_m:.4f}", flush=True)
if a.fold == "all" or not np.isfinite(init_m):
    best = float("inf")
elif va and a.select == "val":
    torch.save(net.state_dict(), a.out)  # fine-tuning never beats init -> keep init
t0 = time.time()
for it in range(a.steps):
    x0, R, P, tgt, m, N = batch()
    y = net(x0.repeat(2, 1, 1, 1), P.repeat(2, 1), N, R=R.repeat(2, 1, 1, 1))
    y1, y2 = y[:a.bs], y[a.bs:]
    msum = m.sum()
    cell = lambda e: (e.mean((2, 3)) * m).sum() / msum  # mean over cells, masked mean over (sample, hour)
    es = cell((y1 - tgt).abs()) - 0.5 * cell((y1 - y2).abs())
    mse = cell((y1 - tgt) ** 2) * a.w_mse
    area = (((y1.mean((2, 3)) - tgt.mean((2, 3))) ** 2) * m).sum() / msum * 50
    w0 = (1 - x0.mean((1, 2, 3))).clamp_min(1e-3)[:, None]
    an = lambda z: (1 - z.mean((2, 3))) / w0
    anes = (((an(y1) - an(tgt)).abs() - 0.5 * (an(y1) - an(y2)).abs()) * m).sum() / msum
    loss = es + mse + area + a.w_anorm * anes
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
    if (it + 1) % a.val_every == 0 or it == a.steps - 1:
        vm = val_metric(net)
        if va and vm < best:
            best = vm
            if a.select == "val":
                torch.save(net.state_dict(), a.out)
        print(f"{it + 1} N={N} loss={loss.item():.4f} val_norm_area_mae={vm:.4f} best={best:.4f} "
              f"{time.time() - t0:.0f}s ({(time.time() - t0) / (it + 1):.3f}s/step)", flush=True)
if not va or a.select == "last":
    torch.save(net.state_dict(), a.out)
final_m = val_metric(net) if va else float("nan")
rt = time.time() - t0
print(f"FINAL fold={a.fold} select={a.select} n_train={len(tr)} n_val={len(va)} init={init_m:.4f} final={final_m:.4f} best_seen={best if va else float('nan'):.4f} "
      f"runtime={rt:.0f}s ({rt / a.steps:.3f}s/step) -> {a.out}", flush=True)
