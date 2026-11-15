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

---

# NCA v2: follower (sheet-like) rule (`nca/v2/`, branch feature/p2-v2-nca)

Decision (user, recorded on #68): adopt the follower rule everywhere. This openly departs from the pre-declared
criterion. v2 is the demo NCA, and the v1 rows stay in the scorecard. v1 files (`nca/weights.*`, `nca_ensemble*`,
`nca_deterministic*`) are unchanged.

## What changed vs v1
- **Simulator:** `Params(rule="follow")` (Agent 4, 3dd4fcf). A mover connected to the reservoir pulls the chain behind
  it, so its source stays occupied. The sheet stays packed and the wound closes as a front. A room-capped local flux
  cannot carry mass through rho = 1 cells.
- **Front mechanism:** the existing non-negative source head is switched ON (gate `division = 1`):
  `add = near * sigmoid(src - 3) * (1 - new) / K`, where `near` = 3 x 3 max of rho at the substep start (zero pad).
  So mass can only appear next to cells, and never inside an empty wound interior. The flux is still exactly
  conservative. Mass enters only through this front source and the reservoir floor.
- **Parameter range:** Tm 0.05-500 h (follower fits reach 500 h for stalled part I wounds). The encoding is
  `p0 = 2 (ln Tm - ln 0.05) / (ln 500 - ln 0.05) - 1`, so nothing is clipped.
- **Config travels with the weights:** `nca/v2/weights.config.json` (rule, Tm/bias range, source gate, data
  provenance). `nca/api.py`, the gate scripts and the JS read it; weights without a config are read as v1.
- **Loss:** from the start, an energy score on the normalised closure curve (`--w-anorm 2`) and a low per-cell MSE
  (`--w-mse 1`), so the members are not pulled together.

## Data and audit fixes (Agent 3's audit)
- 3000 follower runs (sha256 7df49a98108b) on the 32 x 44 lattice. Tm is log-uniform 0.05-500 h, bias 0.25-0.9.
- Start shapes: 50% real WHAD masks, but only frames with series time t <= 1.9 h (P1's earliest cut-off): 32 shapes
  from 16 positions, flipped. The other 50% are synthetic.
- Provenance is asserted end to end:
  - the npz stores {rule, Tm range, early_t} and `train.py` asserts they match the config;
  - the gate picks `whad_fits_follow.json` by the model's rule and asserts the fits file's `params.rule`;
  - the real-data scripts assert that every fold model is follower/v2.
- Training: 2000 steps with the curriculum to 19 h. Selection is on simulator validation runs only
  (best normalised-area MAE 0.0195; v1 was 0.036).
- Weights: `nca/v2/weights.pt` sha256 ccf3c4acdddf, `weights.json` a426643dab3b. Torch vs JS max diff 8.9e-7
  (Agent 3).

## v2 results (15 Nov, 00:30; weights ccf3c4acdddf, fits 490b4c7)
**Demo NCA = `nca_follow`** (sim-trained v2, `nca/v2/weights.pt`). This is the user's decision, after the real-data
fine-tune degraded the held-out fold diagnostic and before any gate score was read (#68).

**#24 emulator check: NOT MET, but improved.** `nca/eval_vs_sim.py` uses 24 unseen configs x 8 follower-sim seeds.

| | NCA error vs sim | sim member spread | configs passing |
|---|---|---|---|
| v2 (follower) | 0.021 | 0.008 | 9/24 |
| v1 (free rule) | 0.042 | 0.014 | 8/24 |

- Fast Tm: the simulator's spread is about 0 (it closes deterministically within an hour), so "below spread" is close
  to impossible there.
- Mid-range Tm (about 2-40 h, where the WHAD fits sit): the NCA closes too slowly. At Tm 9.7 h it gains 111 sites vs
  the simulator's 166 over 19 h.
- NCA member spread is still about 4-5x too small.

**Mass check (`nca/mass_check.py`, 8 runs): clean.**
- Flux residual <= 7e-5 sites over 19 h, i.e. float rounding.
- Mass gain = front source + reservoir. The reservoir share is <= 0.02, so there is no double counting: under the
  follower rule the chain refill is the front source.
- Source at sites with no cell in the 3 x 3 neighbourhood: exactly 0. Total density never exceeds the lattice.

**Noise bias (Agent 3).** On the 3.8 h panel wound the uncalibrated 50-member band lies entirely below the
deterministic rollout (0.059-0.075 vs 0.085 at 11 h). The noise channel shifts the mean dynamics (closes faster),
not just the spread. That is why `nca_follow_deterministic` is reported next to `nca_follow`. The primary stays
`nca_follow` (pre-declared).

**Real-data fine-tune (ablation, `nca/v2/finetune_real_follow.py`).** P1's recipe was applied unchanged:
crc32(wound) % 4 folds, 800 steps, flips, final weights. The labels are the follower fits. The diagnostic is P1's
held-out-fold metric: a deterministic rollout from frame 0, normalised area MAE.

| fold | v2 init | v2 fine-tuned | v1 init | v1 fine-tuned (P1) |
|---|---|---|---|---|
| 0 | 0.052 | 0.081 | 0.069 | 0.066 |
| 1 | 0.056 | 0.097 | 0.061 | 0.066 |
| 2 | 0.064 | 0.101 | 0.055 | 0.087 |
| 3 | 0.036 | 0.070 | 0.054 | 0.047 |

The fine-tune makes v2 worse in 4/4 folds, while training loss falls (0.13 to 0.04-0.07): likely overfitting on
35-49 sequences at lr 1e-3 with the source head. It is kept as `nca_follow_realft` for honesty and not retried.

**Gate.** P1's `eval/score_forecasts.py`; ratio = qscore / best *statistical* baseline; passable = ratio <= 1.10 and
coverage 0.85-0.95 (design.md 5.3). Each cell is qscore (coverage) ratio.

| split | cut | nca_follow (demo) | nca_follow_deterministic | nca_follow_realft | nca_ensemble (v1) | nca_realft (v1, P1) | best statistical |
|---|---|---|---|---|---|---|---|
| loo_all | 1.9 | 0.0668 (0.93) 1.19 | 0.0627 (0.93) 1.12 | 0.0572 (0.92) 1.02 P | 0.0715 (0.94) 1.27 | 0.0605 (0.93) 1.08 P | edge_speed 0.0562 |
| loo_all | 3.8 | 0.0478 (0.93) 1.24 | 0.0461 (0.92) 1.19 | 0.0415 (0.93) 1.07 P | 0.0499 (0.93) 1.29 | 0.0403 (0.93) 1.04 P | edge_speed 0.0386 |
| loo_all | 5.7 | 0.0409 (0.92) 1.25 | 0.0364 (0.92) 1.11 | 0.0382 (0.92) 1.17 | 0.0402 (0.92) 1.23 | 0.0356 (0.93) 1.09 P | edge_speed 0.0327 |
| loo_all | 9.5 | 0.0295 (0.91) 0.93 P | 0.0295 (0.91) 0.93 P | 0.0303 (0.92) 0.96 P | 0.0307 (0.92) 0.97 P | 0.0291 (0.92) 0.92 P | linear 0.0316 |
| loo_manual | 1.9 | 0.0515 (0.87) 1.25 | 0.0469 (0.87) 1.14 | 0.0430 (0.87) 1.04 P | 0.0559 (0.87) 1.36 | 0.0474 (0.86) 1.15 | edge_speed 0.0412 |
| loo_manual | 3.8 | 0.0465 (0.87) 1.18 | 0.0471 (0.87) 1.20 | 0.0448 (0.87) 1.14 | 0.0458 (0.87) 1.17 | 0.0398 (0.87) 1.01 P | gompertz 0.0393 |
| loo_manual | 5.7 | 0.0466 (0.87) 1.29 | 0.0439 (0.86) 1.21 | 0.0425 (0.86) 1.17 | 0.0404 (0.85) 1.12 | 0.0389 (0.87) 1.07 P | edge_speed 0.0362 |
| loo_manual | 9.5 | 0.0322 (0.86) 0.98 P | 0.0319 (0.84) 0.97 | 0.0323 (0.85) 0.98 P | 0.0318 (0.88) 0.97 P | 0.0316 (0.88) 0.96 P | linear 0.0330 |
| CC_to_C61 | 1.9 | 0.0969 (0.77) 1.22 | 0.0936 (0.77) 1.18 | 0.0783 (0.83) 0.99 | 0.0921 (0.82) 1.16 | 0.0863 (0.79) 1.09 | edge_speed 0.0794 |
| CC_to_C61 | 3.8 | 0.0397 (0.94) 1.15 | 0.0376 (0.94) 1.09 P | 0.0380 (0.90) 1.10 | 0.0394 (0.99) 1.14 | 0.0331 (0.94) 0.96 P | edge_speed 0.0345 |
| CC_to_C61 | 5.7 | 0.0370 (0.89) 1.07 P | 0.0344 (0.85) 1.00 | 0.0380 (0.81) 1.10 | 0.0328 (0.86) 0.95 P | 0.0314 (0.89) 0.91 P | edge_speed 0.0344 |
| CC_to_C61 | 9.5 | 0.0319 (0.72) 1.05 | 0.0300 (0.71) 0.98 | 0.0333 (0.73) 1.09 | 0.0311 (0.86) 1.02 P | 0.0266 (0.78) 0.87 | linear 0.0305 |
| **passes** | | **3/12** | 2/12 | 5/12 | 4/12 | 9/12 | |

Reading:
- The demo `nca_follow` passes 3/12: all of 9.5 h on the leave-one-out splits, plus CC_to_C61 at 5.7 h. v1 sim-trained
  passes 4/12. So the follower rule does not improve the gate on its own.
- `nca_follow_deterministic` has a lower qscore than `nca_follow` in 10 of 12 rows. This is consistent with the noise
  bias above, but its coverage is slightly lower, so it passes 2/12.
- The fine-tune ablation `nca_follow_realft` passes 5/12 on the gate even though it is worse on the from-frame-0
  diagnostic. The gate starts each forecast at the observed cut-off mask and is conformal-calibrated, which may hide
  the drift seen from frame 0. The demo decision was taken on the diagnostic before these scores, and is not revisited.
- Raw (uncalibrated) bands: `nca_follow_raw` covers 0.00-0.23 (qscore 0.049-0.181), so all calibration still comes
  from P1's conformal step.
- Baseline numbers here are from main 614e19e (P1's NC/P3 data fix), so the v1 rows differ slightly from the table above.
