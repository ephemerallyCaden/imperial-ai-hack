"""#24 done-criterion: NCA rollout error vs simulator, compared with the simulator's own member spread.
For each test config (fresh wound + params, unseen in training) run M simulator seeds and M NCA members.
  sim_spread  = mean |a_i - a_j| over sim member pairs (wound-area trajectory, all frames)
  nca_err_det = mean |a_nca_det - a_sim_i|          (deterministic NCA vs each sim member)
  nca_err_ens = mean |a_nca_k - a_sim_i|            (stochastic NCA member vs sim member)
Pass: nca_err_det < sim_spread. Also reports per-cell density RMSE and NCA ensemble spread vs sim spread.
python nca/eval_vs_sim.py --weights nca/weights.pt --n 24 --m 8"""
import sys, os, argparse, json, numpy as np, torch
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get("SIM_DIR", os.path.join(HERE, "..", "sim"))); sys.path.insert(0, HERE)
from cellsim import simulate, Params, reservoir_mask, coarse_grain
from gen_data import start_state, sample_params, GRAIN
from model import NCA, norm_params


def run(args):
    i, m, hours = args
    rng = np.random.default_rng(10 ** 6 + i)  # disjoint from training seeds
    occ0 = start_state(rng); Tm, bias = sample_params(rng)
    p = Params(Tm=Tm, bias=bias)
    D = np.stack([simulate(occ0, p, hours, seed=10 ** 6 + 100 * i + s, grain=GRAIN)["density"] for s in range(m)])
    R = coarse_grain(reservoir_mask(occ0, p.edge, getattr(p, "res_dist", None)).astype(np.uint8), GRAIN)
    return D, R, (Tm, bias)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--weights", default=os.path.join(HERE, "weights.pt"))
    ap.add_argument("--n", type=int, default=24); ap.add_argument("--m", type=int, default=8); ap.add_argument("--hours", type=int, default=19)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    with Pool(8) as p:
        res = p.map(run, [(i, a.m, a.hours) for i in range(a.n)])
    net = NCA(); net.load_state_dict(torch.load(a.weights, map_location="cpu")); net.eval()
    rows = []
    for D, R, (Tm, bias) in res:
        A = 1 - D.mean((2, 3)); A = A / A[:, :1]  # area relative to frame 0, (m, F)
        x0 = torch.tensor(D[:1, :1]); r = torch.tensor(R)[None, None]; par = torch.tensor([norm_params(Tm, bias)], dtype=torch.float32)
        with torch.no_grad():
            det = net(x0, par, D.shape[1] - 1, R=r, stochastic=False)[0].numpy()
            ens = net(x0.repeat(a.m, 1, 1, 1), par.repeat(a.m, 1), D.shape[1] - 1, R=r.repeat(a.m, 1, 1, 1), stochastic=True).numpy()
        ad = 1 - det.mean((1, 2)); ad = ad / ad[0]
        ae = 1 - ens.mean((2, 3)); ae = ae / ae[:, :1]
        iu = np.triu_indices(a.m, 1)
        rows.append(dict(
            Tm=Tm, bias=bias,
            sim_spread=float(np.abs(A[:, None] - A[None]).mean(-1)[iu].mean()),
            nca_err_det=float(np.abs(ad[None] - A).mean()),
            nca_err_ens=float(np.abs(ae[:, None] - A[None]).mean()),
            nca_spread=float(np.abs(ae[:, None] - ae[None]).mean(-1)[iu].mean()),
            dens_rmse_det=float(np.sqrt(((det[None] - D) ** 2).mean())),
            dens_rmse_sim=float(np.sqrt(((D[:, None] - D[None]) ** 2).mean((2, 3, 4))[iu].mean() / 2)),
            final_area_sim=float(A[:, -1].mean()), final_area_nca=float(ad[-1])))
    keys = ["sim_spread", "nca_err_det", "nca_err_ens", "nca_spread", "dens_rmse_det", "dens_rmse_sim"]
    summ = {k: float(np.mean([r[k] for r in rows])) for k in keys}
    summ["frac_configs_det_below_spread"] = float(np.mean([r["nca_err_det"] < r["sim_spread"] for r in rows]))
    summ["pass"] = summ["nca_err_det"] < summ["sim_spread"]
    print(json.dumps(summ, indent=1))
    for r in rows:
        print(f"Tm={r['Tm']:.3f} bias={r['bias']:.2f} spread={r['sim_spread']:.4f} det={r['nca_err_det']:.4f} ens={r['nca_err_ens']:.4f} "
              f"final sim={r['final_area_sim']:.3f} nca={r['final_area_nca']:.3f}")
    if a.out:
        json.dump(dict(summary=summ, rows=rows), open(a.out, "w"), indent=1)
