# NCA: mass-conserving density emulator of the cell-agent simulator (P2, `nca/`)

The NCA learns the coarse-grained dynamics of `sim/cellsim.py` (docs/sim.md) on its density grid, so ensembles and the
draw-tool band run in milliseconds instead of re-running agents. It is an **emulator** of the simulator, trained only on
simulator output.

## Model (`nca/model.py`; the JS port `sim/js/nca.js` must match it)
- Grid: the simulator's density grid, `coarse_grain(occ, GRAIN)`. WHAD lattice is 32 x 44 sites at 20 um, so 16 x 22 cells.
  The model is convolutional, so it runs on any size, but it is trained on WHAD-sized fields only.
- State channels `S = 6`: `rho` (density 0..1), `R` (reservoir fraction, fixed at t0), 4 hidden (tanh-bounded).
- Perception per channel: fixed 3 x 3 [identity, sobel_x, sobel_y, laplacian], zero padding. Index = channel * 4 + filter.
- Per-cell MLP: 27 inputs (24 perception, 2 parameters, 1 noise) -> 48 (ReLU) -> 14 outputs (9 flux logits in
  `NB` order then "stay", 1 source, 4 hidden deltas).
- Parameters as channels: `p0 = 2 (ln Tm - ln 0.05) / (ln 5 - ln 0.05) - 1`, `p1 = 2 bias - 1`.
- Update, K = 2 substeps per hour:
  1. `frac = softmax(logits + noise)`.
  2. Cell i wants to send `rho_i * frac_k * room_j` to neighbour j = i + NB[k], with `room = max(0, 1 - rho)` and no
     room outside the grid.
  3. Each target scales all its inflows by `min(1, room_j / demand_j)`. So `0 <= rho <= 1` without clamping, and the
     flux conserves total density exactly (`nca/tests/test_mass.py`).
  4. Source (division) is gated by `division`, which is 0 for WHAD (mitomycin), so there is no source.
  5. Reservoir floor `rho = max(rho, R)`, matching the simulator refilling its border-band sites occupied at t0.
     This is the only way mass enters, the same as in the simulator.
- Stochastic: Gaussian noise input channel plus logit noise, trained with an energy-score term so the members spread like
  simulator seeds.

## Training data (`nca/gen_data.py`, `nca/train.py`)
- 3000 simulator runs (frozen rules, sim 1e26b38 / c5ccc6c), 19 h, hourly frames, 32 x 44 lattice.
- Parameters: Tm log-uniform in [0.05, 5] h, bias uniform in [0.25, 0.9] (the calibration grid). Division off.
- Start shapes: 50% real WHAD masks from frames t <= 2 h only (the earliest cut-off, so no held-out wound's later
  shapes enter training), flipped. The other 50% are synthetic WHAD-like scratches and blobs.
- Loss: per-cell energy score (2 members) + per-cell MSE + wound-area MSE, with a rollout-length curriculum up to 19 h.

## Gate forecasts (`nca/forecast_gate.py`, #25/#26)
- Writes `eval/forecasts/whad/{loo_all,loo_manual,CC_to_C61}/{nca_ensemble,nca_deterministic,nca_ensemble_raw}_{cut}h.json`.
  The series, series-time cut-offs (1.9/3.8/5.7/9.5 h), grid, T = 19 h and the leave-one-wound-out conformal come from
  P1's `eval/forecast_baselines.py`, imported rather than reimplemented. The calibration pool never contains the test
  series' physical wound.
- The NCA only supplies the point trajectory that P1's conformal wraps, the same way as for the statistical baselines.
  - `nca_ensemble`: median of 50 stochastic members, one per bootstrapped (Tm, bias) fit from Agent 1's
    `sim/fits/whad_*fits.json`, fitted on frames <= cut-off only.
  - `nca_deterministic`: noise-free NCA at the point fit. This is the #26 ablation.
  - `nca_ensemble_raw`: raw member quantiles, no calibration.
- Start state: the observed mask at the last frame <= cut-off. Auto-segmented series use Agent 1's synthetic band with
  the observed area. The forecast is rescaled to the observed area at that frame.
- `nca/forecast_whad.py` (old cut-offs 2/4/6/10, folds loo/B) is superseded and its output was deleted.
- Upload path / other callers: `nca/api.py` `nca_forecast(occ, members, t_obs_hours, area_obs, hours_out)`.

## Commands
Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (torch pinned there).
- `python nca/gen_data.py --n 3000 --out /tmp/nca_data.npz` simulator training data (~1-2 min, 8 processes)
- `python -u nca/train.py --data /tmp/nca_data.npz --out nca/weights.pt --steps 2000 --curr 80 --nval 150` (~35 min CPU)
- `python nca/export.py nca/weights.pt nca/weights.json` weights for the JS port
- `python nca/forecast_gate.py` gate forecasts into `eval/forecasts/whad/`, then `python contracts/validate.py eval/forecasts/whad/*` and `python eval/score_forecasts.py eval/forecasts --gate nca_ensemble`

## Checks
- `python nca/tests/test_mass.py`: exact mass conservation and bounds.
- `python nca/eval_vs_sim.py`: #24 done-criterion. Compares NCA error vs simulator with the simulator's own member
  spread on unseen configs.
- Torch vs JS: `sim/js/nca_torch_ref.py` + `sim/js/nca_check.mjs` (Agent 3); max abs diff 2.4e-7.

## Results (14 Nov, 23:00; weights c413a063825e, fits aed3174)
**#24 emulator check: NOT MET.** `nca/eval_vs_sim.py` uses 24 unseen configs x 8 seeds. The NCA's closure-curve error
vs the simulator is 0.042 (mean; median 0.034). The simulator's own member spread is 0.014, and 8 of 24 configs pass.
- Tm > 0.5 h: the NCA error is below the simulator spread.
- Tm < 0.2 h: the NCA closes fully while the simulator leaves 2-6% open.
- NCA member spread is about 6x too small (0.002 vs 0.014). The training loss's MSE terms pull members to the mean.

**Gate (design.md 5.3).** Scored by P1's `eval/score_forecasts.py`. "ratio" = qscore of `nca_ensemble` / best
*statistical* baseline. Passable = ratio <= 1.10 and coverage in [0.85, 0.95].

| split | cut-off | n | nca_ensemble qscore | cov | best statistical baseline | qscore | ratio | result |
|---|---|---|---|---|---|---|---|---|
| loo_all | 1.9 | 56 | 0.0782 | 0.93 | edge_speed | 0.0657 | 1.19 | fail |
| loo_all | 3.8 | 56 | 0.0495 | 0.93 | edge_speed | 0.0385 | 1.29 | fail |
| loo_all | 5.7 | 55 | 0.0397 | 0.93 | edge_speed | 0.0327 | 1.22 | fail |
| loo_all | 9.5 | 52 | 0.0304 | 0.92 | linear | 0.0311 | 0.98 | pass |
| loo_manual | 1.9 | 16 | 0.0559 | 0.87 | edge_speed | 0.0412 | 1.36 | fail |
| loo_manual | 3.8 | 16 | 0.0458 | 0.87 | gompertz | 0.0393 | 1.17 | fail |
| loo_manual | 5.7 | 16 | 0.0404 | 0.85 | edge_speed | 0.0362 | 1.12 | fail |
| loo_manual | 9.5 | 16 | 0.0318 | 0.88 | linear | 0.0330 | 0.97 | pass |
| CC_to_C61 | 1.9 | 14 | 0.0921 | 0.82 | edge_speed | 0.0794 | 1.16 | fail |
| CC_to_C61 | 3.8 | 14 | 0.0394 | 0.99 | edge_speed | 0.0345 | 1.14 | fail |
| CC_to_C61 | 5.7 | 14 | 0.0328 | 0.86 | edge_speed | 0.0344 | 0.95 | pass |
| CC_to_C61 | 9.5 | 14 | 0.0311 | 0.86 | linear | 0.0305 | 1.02 | pass |

Reading:
- The calibrated NCA ties the best baseline only with half the frames observed (9.5 h), plus 5.7 h on the held-out
  condition. At early cut-offs it is 12-36% worse.
- The raw NCA ensemble covers only 1-24% (qscore 0.050-0.187), so all the calibration comes from P1's conformal step.
- `nca_deterministic` is within about 5% of `nca_ensemble`, so the stochastic members add little beyond their median.
- Note: P1's `gate()` counts every non-gated model in a group as a "baseline", so `nca_deterministic` shows up as
  "best baseline" in some rows. The table above compares against the statistical baselines only.
