# Cell simulator: rules and output format (P2, `sim/cellsim.py`)

> **P2 v2 (Sun 00:00): the follower rule is the default for WHAD forecasts, upload, draw tool and playback.** Use `Params(rule="follow")`
> (Agent 4, 3dd4fcf). A cell that moves pulls the chain behind it, so the sheet stays packed and the wound closes as a front, and fitted Tm no longer
> depends on field size. The code default stays `rule="free"`, so the v1 results (sim_ensemble, rules below) reproduce bit for bit. Under the follower rule:
> Tm grid 0.05-500 h (fits are about 8-10x the free-rule Tm; part II about 4-8 h, part I stalls up to 500 h); fits in `sim/fits/whad_fits_follow.json` (sim/v2.py,
> series time at P1's cut-offs, near-tie break); gate files `sim_follow*` via `python sim/v2.py gate sim_follow`; upload `sim/upload.py` (follower fits and
> prior, NCA band only with the follower weights `nca/v2/weights.pt`). Results and the pre-declared criterion it did not pass: `docs/p2-results.md` "P2 v2".
> Upload bands (Sun 00:15): `area_q05/q50/q95` = P1's leave-one-wound-out conformal (`forecast_file`, upload = test series, pool = WHAD series minus
> the upload's own wound, point = member median; pool points from follower fits at the upload's cut-off), as `data/upload.py`. The raw ensemble is
> kept in `raw_band` ("uncalibrated spread"); `band` says which was used. One frame: population-prior draws, with no conformal step (as `data/upload.py`).
> The 3-frame sample (exp1_partII_CC_P2): the observed 0.06 at 19 h is inside the calibrated band (0.00-0.45), whereas the raw band was 0/0/0. The observation
> is inside at 13 of 17 forecast hours, and just above the top at 7-10 h (by up to 0.02), because the follower sim closes this wound too fast mid-course.

Run: `python3 sim/cellsim.py --hours 24 --Tm 0.1 [--Td 20] [--out run.npz]` (synthetic straight scratch, ~1 s).
API: `simulate(occ0, Params(...), hours, frame_dt=1.0, seed=0, grain=GRAIN) -> dict`; `occ0` is an (H,W) uint8 array, 1 = cell.
Shared constants in `sim/cellsim.py`: `DT = 0.05` (h per step), `SITE_UM = 20` (one site = one cell), `GRAIN = 2`. A WHAD field (1920x1440 px at 0.454 um/px) becomes a **32 x 44** lattice and a **16 x 22** density grid.

## Rules (per step of `dt` hours, all cells in parallel; numpy only, easy to port to JS)
1. One lattice site = one cell (~20 um). Square lattice, Moore (8) neighbourhood.
2. A cell migrates with prob `dt/Tm * rho_local**dens_exp` (rho_local = occupied fraction of its 3x3 block; density-dependent movement). Else it divides with prob `dt/Td` (Migliaccio Pd; `Td=None` = division off, used for WHAD).
3. The target is a random EMPTY neighbour. No empty neighbour = contact inhibited, nothing happens. Division places the daughter there.
4. Wound bias: with prob `bias` (default 7/9) the target is restricted to empty neighbours pointing up the gradient of blurred emptiness (radius `blur`); otherwise any empty neighbour.
5. Two cells claiming one site: random priority wins.
6. Boundary: border-band sites (width `edge`) occupied at t0 are a reservoir, refilled every step (cells keep entering the field of view; a wound touching the border stays open there).
7. **Rule** (`Params.rule`, P2 v2): `"free"` (default; every result merged before v2, reproduced bit for bit, see `sim/tests/test_rules.py`) = a mover leaves a vacancy behind. `"follow"` = a mover connected to the reservoir (Moore path through occupied sites) pulls the chain behind it one site; in occupancy terms its target fills and its source stays occupied. Movers not connected (islands) leave a vacancy. Front-like, size-independent closure (`docs/follower-report.md`). JS port must match: only cells with an empty Moore neighbour draw random numbers; the reservoir's connected component is kept incrementally (connected winners' targets join; `join_islands` absorbs an island that touches it); the run stops early once the field is full. Fitted `Tm` is about 8-10x larger under `"follow"` (grid up to 50 h).
Parameters fitted per wound (#23): `Tm`, `bias` only (n_params = 2). Fixed: `dens_exp` = 0.5, `blur` = 6, `edge` = 2, `Td` = None. Time step: `dt` = 0.05 h; keep `dt` <= the smallest `Tm` (the move probability `dt/Tm` saturates at 1, so smaller `Tm` stops making cells faster).

## Output (`np.savez_compressed`, keys of the dict `simulate` returns)
| key | shape / dtype | meaning |
|---|---|---|
| `occ` | (F,H,W) uint8 | agent lattice per frame, 1 = cell |
| `density` | (F,H/g,W/g) float32 | block-mean coarse-grain of `occ` (g = `grain`); this is the NCA's state |
| `t_hours` | (F,) | frame times, hours from start |
| `wound_frac` | (F,) | `1 - mean(occ)`: empty fraction of the lattice (= wound / ROI, same definition as `whad_curves.csv`) |
| `grain` | int | coarse-grain factor |
| `params` | str | repr of the Params used |
Invariant (on the cropped region when H or W is not a multiple of g): `density.mean() == occ.mean()` (agent area = density area every frame).

## Start state from a WHAD mask (`sim/start_state.py`)
`load_png_mask(position, frame)` (full-res PNG, `$WHAD_DIR`) or `load_npz_masks(path)` (P1's downsampled npz), then
`mask_to_lattice(wound, um_per_px, site_um=20)` gives `occ0` for `simulate`. Area-preserving: the number of empty sites is
`round(mask wound fraction * n_sites)`; measured error 0.01-0.07% (limit 2%). `python3 sim/start_state.py <position>` prints it.
Lattice H and W are rounded to multiples of 4 (`multiple`), so `coarse_grain` never crops. `load_png_mask(position)` with no frame uses the first annotated frame (some positions start at t02 or t03).

## Calibration (`sim/calibrate.py`, #23)
`python3 sim/calibrate.py --all` writes `sim/fits/whad_fits.json` (a few minutes). `python3 sim/calibrate.py <position> <t0>` fits one wound and prints the curves.
- Fit: grid search over `Tm` (0.05-5 h, 21 log steps) x `bias` (0.25-0.9, 6 steps), cost = MSE of `wound_frac` on the observed frames up to `t0`, 3 seeds; start = first annotated frame's mask. The minimum is refined off-grid (`refine`: parabolic vertex along log Tm and bias, kept inside the argmin's cell).
- Cut-offs `t0` = frames 2, 4, 6, 10 (10/20/30/50% of 20 hourly frames, the same for every position, as P1-5).
- Spread: 50 bootstrap resamples of the observed frames, each minimised off-grid, give `members` = list of `[Tm, bias]` (continuous, no longer collapsed onto grid points; the bootstrap rng is seeded per position). Ensemble forecasts combine these with simulator seeds.
- Presets: median `Tm` and `bias` per condition over a fold's training positions only (asserted). `presets` holds `B_CC_to_C61` (no C61 training data, so the CC preset is used for C61 test wounds) and `draw_tool`. Fold A was dropped in R15; leave-one-wound-out presets are computed in `sim/forecast.py`.
- `in_range_frac`: fraction of frames where the preset's simulated `area_norm` lies inside the training wounds' observed min-max at that frame.
- `presets.draw_tool` = median over ALL positions per condition at t0 = 10: CC Tm 0.79 h, bias 0.65 (n 7); C61 Tm 0.88 h, bias 0.25 (n 6). Draw tool only, never for scoring (includes test wounds). C61 is bimodal (part II about 0.5 h, part I 1.3-5 h), so the median is a compromise.

**Results (20:20 Sat, `whad_fits.json`).** Per-wound fit RMSE 0.001-0.025 (absolute wound_frac) up to t0. All fits are inside the grid
except part I C61_P1 and C61_P2, which stall (no closure) and sit at the Tm = 5 h edge from t0 = 4. `in_range_frac` per fold at
t0 = 2/4/6/10: A_partI_to_partII 0.54/0.61/0.72/0.95; A_partII_to_partI 0.56/0.80/0.81/0.89; B_CC_to_C61 0.77/0.84/0.97/0.92.
Short cut-offs are noisy (2-3 frames). `bias` is weakly identified (fits jump between 0.25 and 0.9); `Tm` carries the signal.
Fold A is a large shift: part I presets (CC Tm about 2 h, C61 5 h) are far slower than part II wounds (0.3-0.8 h), so use per-wound
fits up to t0, with presets only as a prior or fallback.

`whad_fits.json` layout: `params` (grid, cut-offs, dt, site_um); `fits[position][t0]` = `{t0, start_frame, n_obs, Tm, bias, rmse, at_grid_edge, members}` (null when fewer than 2 frames are observed by `t0`); `presets[fold][t0]` = `{CC: {Tm, bias, n}, C61: {...}, in_range_frac}`.

**Agreed parameter range** (fit grid = NCA training range): `Tm` in [0.05, 5] h, log-uniform; `bias` in [0.25, 0.9].
Part II (fast-closing) wounds fit Tm 0.14-0.65 h; part I (slow or stalled) fit 0.4-5 h.

**Why 20 um sites (R, 20:30 Sat).** At 10 um sites the sim could not close part II wounds (fits pinned at the Tm floor; area
stalled near 0.2 of initial by 19 h, while data reaches 0.01-0.07). Without division, a packed sheet fills the wound only by
vacancies diffusing back to the border reservoir. 20 um sites (the design's one site = one cell) make that 4x faster at the
same Tm. Tried and rejected: a near-wound reservoir (`res_dist`, closes too fast early and decelerates), a gap-area observable
(breaks part I), and direction-first targeting (no gain at 20 um). Remaining misfit: the data close almost linearly to zero, while
the sim decelerates slightly near the end (RMSE about 0.06-0.10 of initial area over the full 19 h).

## Simulator-ensemble forecasts (`sim/forecast.py`, #26; 00:00 gate fallback)
**Superseded for scoring (22:25 Sat):** the gate files are now `eval/forecasts/whad/{loo_all,loo_manual,CC_to_C61}/sim_ensemble{,_raw}_{cut}h.json`
from `sim/forecast_gate.py`. They use P1's series (time since the series' first frame, wound_frac <= 0.70), cut-offs 1.9/3.8/5.7/9.5 h, P1's folds and
P1's conformal (`eval/forecast_baselines.forecast_file`), and they start from the cut-off mask rescaled to its observed area, as the NCA. Fits are keyed "1.9" ... "9.5"
(series time, commit aed3174). Run with a Python that has scipy (e.g. `/tmp/p2venv/bin/python sim/forecast_gate.py`, about 5 min). Results: `docs/p2-results.md`.
The notes below describe the earlier `sim/forecasts/whad/` files (t0 2/4/6/10, folds loo / B_CC_to_C61), which have been removed.
`python3 sim/forecast.py` (a few minutes, all cores) writes `sim/fits/whad_auto_fits.json` and
`sim/forecasts/whad/sim_ensemble_{fold}_t{cutoff}.json`, one file per fold and cut-off, valid against `contracts/forecast.schema.json`.
- Folds (R15): `loo` = every WHAD MCF10A position (16 manual + 44 auto); presets come from other physical wounds of the same condition, with both parts of the held-out wound excluded (asserted). `B_CC_to_C61` = every C61 position; presets come from CC wounds only.
- Cut-offs `cutoff_hours` = 2, 4, 6, 10 (absolute, the same for every wound). Forecast grid: hourly from cutoff + 1 to 19. A position with no frame at or before the cut-off is skipped (only `exp1_partI_CC_P3` at t0 = 2).
- Members: 50 per-wound bootstrap `[Tm, bias]` fits on frames up to the cut-off, one simulator seed each (`1000 + i`), run from the first-frame start state to 19 h. The fold preset is used only when fewer than 2 frames are observed.
- Start state: manual positions use their own first-frame mask; auto positions have no mask on disk, so they start from `band_start` (a synthetic vertical band with the observed first-frame area).
- Auto frames with `qc == "fail"` are excluded from fitting and from the observed area at the cut-off.
- Tags: manual-only subset is `segmentation_quality.status == "manual_mask"`. Auto forecasts carry "ok" or "flagged" (QC failure up to the cut-off), and `reasons` names the synthetic start.
- Events: `t50`/`t90` = first time area <= 0.5 / 0.1 (interpolated); observed before the cut-off gives that time with `censored_prob` 0. `p_close_by_T` = P(t90 <= 12 h). `p_stall` is null and `flags` is empty (P1-12 defines them).
- Known limit: closure in the sim relies on vacancies diffusing through the sheet. Holes scatter and some get trapped (about 0.03 floor), and the playback shows no clean front. A follower rule is the candidate fix after the gate.
- **Results (21:00 Sat; my own check against the observed areas, not P1's scorer).** Median-forecast MAE in area_norm: loo 0.18/0.13/0.11/0.07 (manual) at t0 = 2/4/6/10, and B 0.16/0.13/0.13/0.08. The empirical 90% band coverage is only **0.05-0.35**: the raw ensemble is badly under-dispersed. Bootstrap members from 2-10 early frames collapse to one grid point, and seed noise on a 32 x 44 lattice is small next to the model's structural misfit. These files are an honest "raw simulator ensemble" scorecard row, but a weak gate fallback; a conformal wrapper (P1's bands) would be needed for calibrated bands.
- **Field-size caveat.** Without division, vacancies leave through the border reservoir, so closure speed depends on the field size (Agent 4: the same scratch at Tm 0.5 reaches area 0.19 at 19 h in a 44 x 44 field and 0.36 in a 44 x 456 strip). Fitted Tm is only meaningful for the WHAD field (32 x 44 sites = 640 x 880 um). Do not run WHAD-fitted parameters on a differently sized lattice: `sim/upload.py` maps uploads onto that extent, and draw-tool or zoom canvases of other sizes heal at a different speed.

## Upload glue (`sim/upload.py`, #45)
`forecast_upload(masks, um_per_px, interval_h, condition, seg_quality, wound_id, exclude_wound)` or
`python3 sim/upload.py --masks f0.png [f1.png ...] --um-per-px U --interval H [--condition CC] [--wound-value 255] [--seg-quality q.json] --out-dir D`.
Masks are True = wound, in time order, `interval_h` apart. The output is `{wound_id}_sim_ensemble.json`, plus `{wound_id}_nca_ensemble.json` when Agent 2's `nca/api.py` and its weights import (`$NCA_DIR`, default `<repo>/nca`); fold = dataset = "upload".
- Refused, so no file and exit code 2: `seg_quality.status == "refused"`, missing scale, or any mask outside 1-70% of the field.
- 1 frame: 50 draws from the t0 = 10 fits of WHAD wounds of the same condition (never `exclude_wound`), so the band is wide; noted in the `band` field and notes, with no flag (design R16: no measure-again flag until a signal passes). A different field size is a `segmentation_quality` reason, not a flag. 2+ frames: grid fit plus bootstrap, as in #23.
- The field is windowed or padded to 640 x 880 um around the wound; differences above 5% are flagged. The lattice area check (< 2%) is asserted. The grid runs hourly to 19 h.
- NCA band: `NCA_DIR=<agent2 worktree>/nca /tmp/p2venv/bin/python sim/upload.py --samples` (needs torch; `/tmp/p2venv` is Agent 2's venv and is not durable). The committed `sample_*_nca_ensemble.json` came from Agent 2's `a9ef439` code with weights sha256 `c413a063825e`.
- `python3 sim/upload.py --samples` writes `sim/forecasts/upload/sample_3frames_*.json` and `sample_1frame_*.json` (manual masks t00-t02 of `exp1_partII_CC_P2`, with wound `exp1_pos2033` excluded from the prior) and checks that a blank mask is refused.
- **Off-grid members (21:30 Sat).** Members are now continuous: a median of 22-50 distinct `[Tm, bias]` per wound at t0 >= 4, and 3 at t0 = 2 (only 2 frames to resample), against 1-3 before. Their spread is honest but small: the median range of log Tm across members is 0.2-0.36, about +-15% in Tm. Coverage before -> after, manual/auto: loo t0 = 2: 0.14/0.25 -> 0.15/0.27; 4: 0.22/0.13 -> 0.18/0.14; 6: 0.22/0.16 -> 0.27/0.15; 10: 0.27/0.17 -> 0.24/0.18. B: 0.03-0.32 after. MAE is unchanged (loo 0.18/0.13/0.09/0.08 manual). Mean 90% band width is 0.07-0.13 against a mean absolute error of 0.08-0.14, and early cut-offs are biased (forecast area too low by 0.04-0.09, closing too fast). **Finding: parameter uncertainty is a small part of the error; the misfit is structural**, so calibrated bands need P1's conformal step (no inflation term on the P2 side).
