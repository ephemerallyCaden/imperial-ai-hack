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

## Forecasts (`nca/forecast_whad.py`, #25/#26)
- Writes `nca/forecasts/whad/{model}_{fold}_t{t0}.json` (contract `contracts/forecast.schema.json`). Models:
  `nca_ensemble` (50 members) and `nca_deterministic` (ablation). Folds `loo` and `B_CC_to_C61`. Cut-offs t0 = 2, 4, 6, 10 h.
- Per wound, params are its own fit on frames <= t0 (`sim/fits/whad_fits.json`, 50 bootstrap members). A wound with
  fewer than 2 frames uses fits of other physical wounds instead.
- Start is the observed mask at the last frame <= t0; a wound with no frame <= t0 is skipped. The forecast is rescaled
  to that frame's observed area.
- `--auto` adds the auto-segmented wounds, using Agent 1's synthetic band start (no masks on this machine).
- Upload path / other callers: `nca/api.py` `nca_forecast(occ, members, t_obs_hours, area_obs, hours_out)`.

## Commands
Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (torch pinned there).
- `python nca/gen_data.py --n 3000 --out /tmp/nca_data.npz` simulator training data (~1-2 min, 8 processes)
- `python -u nca/train.py --data /tmp/nca_data.npz --out nca/weights.pt --steps 2000 --curr 80 --nval 150` (~35 min CPU)
- `python nca/export.py nca/weights.pt nca/weights.json` weights for the JS port
- `python nca/forecast_whad.py [--auto]` forecasts into `nca/forecasts/whad/`, then `python contracts/validate.py nca/forecasts/whad`
- `python nca/quick_score.py nca/forecasts/whad sim/forecasts/whad` coverage / median-error sanity table

## Checks
- `python nca/tests/test_mass.py`: exact mass conservation and bounds.
- `python nca/eval_vs_sim.py`: #24 done-criterion. Compares NCA error vs simulator with the simulator's own member
  spread on unseen configs.
- Torch vs JS: `sim/js/nca_torch_ref.py` + `sim/js/nca_check.mjs` (Agent 3); max abs diff 2.4e-7.

## Results
(filled in after the final run)
