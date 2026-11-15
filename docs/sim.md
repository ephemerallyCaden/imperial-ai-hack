# Cell simulator: rules and output format (P2, `sim/cellsim.py`)

> **Scope.** Stitch models migration-only closure of MCF10A scratch wounds (mitomycin C, serum- and EGF-free medium, so division is off). The
> follower rule keeps the sheet packed, a simple stand-in for force transmission that published measurements put at hundreds of um behind the front.
> It is not a model of skin healing: no clotting, inflammation, fibroblasts, matrix, proliferation or 3D tissue. Parameters are fitted per wound for
> this 640x880 um field and are not measured cell properties. The wound-bias parameter is not identified from these data, so Tm carries the signal.
> All tuning and evaluation are on WHAD only (WHiM-BC as an external check).
> Sources: WHAD protocol, Iheme et al. 2024, IEEE Data Descr. 1:95, doi 10.1109/ieeedata.2024.3481394 (Zenodo 12806149): mitomycin C 10 ug/mL for 2 h,
> then imaging in DMEM-F12 + 1% pen/strep without serum or EGF. MCF10A doubles in about 20-27 h (Cellosaurus CVCL_0598), so division is off because of
> the protocol, not because growth is slow. Force and velocity correlations extend about 170-200 um, and more than 500 um for MCF10A on stiff gels
> (Vishwakarma 2018, doi 10.1038/s41467-018-05927-6; Petitjean 2010, doi 10.1016/j.bpj.2010.01.030; Ng 2012, doi 10.1083/jcb.201207148); each sheet
> beside a WHAD wound is about 15 sites (300 um) wide. Skin healing: Gurtner 2008, doi 10.1038/nature07039; Rodrigues 2019, doi 10.1152/physrev.00067.2017.

> **P2 v2 (Sun 00:00): the follower rule is the default for WHAD forecasts, upload, draw tool and playback.** Use `Params(rule="follow")`
> (Agent 4, 3dd4fcf). When a cell connected to the sheet moves, the sites behind it stay filled, so the sheet stays packed and the wound closes as a
> front, and fitted Tm no longer depends on field size. This is a simple stand-in for force transmission through the sheet, NOT "leaders pull passive
> followers": follower cells crawl actively (Farooqui & Fenteany 2005, doi 10.1242/jcs.01577). Lattice precedent: pulling in exclusion models,
> Chappelle & Yates 2019, doi 10.1103/PhysRevE.99.062413 (our chain rule is a many-cell generalisation); Simpson 2007, doi 10.1103/PhysRevE.76.021918.
> Reach is unlimited here (consistent with the 170-500 um correlation lengths against a 300 um sheet); a finite reach is future work.
> Not modelled: leader cells and fingers (Poujade 2007, doi 10.1073/pnas.0705062104); purse-string vs crawling closure, which depends on gap geometry
> (Ravasio 2015, doi 10.1038/ncomms8683; Anon 2012, doi 10.1073/pnas.1117814109; Brugues 2014, doi 10.1038/nphys3040). The code default stays `rule="free"`, so the v1 results (sim_ensemble, rules below) reproduce bit for bit. Under the follower rule:
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
7. **Rule** (`Params.rule`, P2 v2): `"free"` (default; every result merged before v2, reproduced bit for bit, see `sim/tests/test_rules.py`) = a mover leaves a vacancy behind. `"follow"` = a mover connected to the reservoir (Moore path through occupied sites) moves with the sheet behind it shifting one site (a stand-in for force transmission, not passive followers); in occupancy terms its target fills and its source stays occupied. Movers not connected (islands) leave a vacancy. Front-like, size-independent closure (`docs/follower-report.md`). JS port must match: only cells with an empty Moore neighbour draw random numbers; the reservoir's connected component is kept incrementally (connected winners' targets join; `join_islands` absorbs an island that touches it); the run stops early once the field is full. Fitted `Tm` is about 8-10x larger under `"follow"` (grid up to 50 h).
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

**Run length (user requirement: end a simulation only when the wound is fully healed).** Simulations shown as simulations
run until fully closed (every site occupied): live agent runs (worker `run` with `untilClosed`: stall guard 12 simulated h
without a change in the occupied count, cap 500 h), live NCA runs (`nca.js` `isHealed` / `isStalled`, below) and the synthetic zoom playback
(`make_zoom_playback.py --until-closed --hours 500`, `zoom_follow.json` closes at 27.5 h). Data-comparison panels stop at the
data horizon: scored forecasts, gate files, fits and the real-wound files (`whad_partII_C61_P2*`, `sim38`, `nca`) stay bound
to the 0-19 h observed window. Under `"follow"` a wound touching the field edge still closes (connected movers keep the
border sites behind them); under `"free"` it can stall there, and with no reservoir at all (whole border band empty) the cell
count is conserved, so it never closes (`node sim/js/heal_check.mjs`).
NCA closure criterion: density is continuous and never exactly 1 (v2 on the r9 disc: not all 1.0 within 300 h, mean rho
0.9997 when healed), so `isHealed(rho, {minRho: 0.95})` = every coarse cell >= 0.95. 0.95 sits above 0.75, a 2x2 coarse cell
missing one of its 4 sites, so "healed" means no site-sized hole is left; it is below 1 so round-off never blocks the stop.
Stall: `isStalled(means, {window: 12, eps: 1e-4})` on hourly mean rho. v2 heals the r9 disc at 25 h (the agent sim closes
it at about 24 h); v1 with no reservoir stalls at 12 h.

## Start state from a WHAD mask (`sim/start_state.py`)
`load_png_mask(position, frame)` (full-res PNG, `$WHAD_DIR`) or `load_npz_masks(path)` (P1's downsampled npz), then
`mask_to_lattice(wound, um_per_px, site_um=20)` gives `occ0` for `simulate`. Area-preserving: the number of empty sites is
`round(mask wound fraction * n_sites)`; measured error 0.01-0.07% (limit 2%). `python3 sim/start_state.py <position>` prints it.
Lattice H and W are rounded to multiples of 4 (`multiple`), so `coarse_grain` never crops. `load_png_mask(position)` with no frame uses the first annotated frame (some positions start at t02 or t03).

## Alternative starts and known-cause wounds (`sim/alt_start.py`, `sim/make_known_cause.py`, #91, for the Investigator, design 9b)
All defaults are unchanged and bit-identical (`sim/tests/test_alt_start.py`). Inputs and outputs are documented in the module docstring.
- `alt_start(occ0, density=1.0, edge_damage=0, damage_prob=0.5, edge=2, seed=0)`: lower start density (vacate `1 - density` of the sheet cells outside the reservoir band, seeded) and/or edge damage (vacate cells within Chebyshev distance `edge_damage` of the wound with prob `damage_prob`). Defaults return an identical copy.
- `simulate(..., tm_map=None)`: optional (H,W) per-site Tm multiplier; `region_tm_map(shape, region, factor)` builds one (`np.inf` = cells there never start a move, a stall). Python only, not in `sim/js/engine.js`.
- `observed_area(occ_frames, min_gap=10)`: visible wound = empty 4-connected components of at least `min_gap` sites (small holes inside the sheet are not counted). Use it for both the synthetic truth and the Investigator's reruns.
- `python3 sim/make_known_cause.py` writes `sim/synthetic/known_cause/`: `labels.json` (the key: wound_id, cause, params, seed, `observed` {t_hours, area} as in the forecast contract), `curves.csv` (whad_curves.csv columns, `source = synthetic`) and `syn01..syn10.json` playback files (export_playback format, agents + density, no cause in them). 5 causes x 2 seeds: normal, slow_migration (Tm x 3), low_density (0.75), edge_damage (2 sites, p 0.6), partial_stall (lower half stalled); follow rule, CC follow draw preset, synthetic band start.
- Identifiability (area_norm at 6/12/18 h, two seeds): normal 0.68-0.75 / 0.31-0.41 / 0.05; slow_migration 0.90-0.92 / 0.80-0.82 / 0.70; partial_stall 0.85-0.86 / 0.64-0.70 / 0.48-0.53; edge_damage 0.71-0.72 / 0.43-0.44 / 0.07-0.18 (larger start wound 0.31-0.32 vs 0.25); low_density 0.63-0.70 / 0.32-0.40 / 0.00-0.08, inside the normal seed spread: under the follower rule, holes next to reservoir-connected cells refill within a few hours, so low density is weakly identifiable from the area curve. Simulated wounds test whether the Investigator recovers a cause the simulator put in, not biology.

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

## Cross-scale check: front speed vs 2 sqrt(D r), division on (`sim/cross_scale.py`, #31)
`python -I sim/cross_scale.py` (about 80 s) writes `eval/results/cross_scale_front_speed.csv` and `eval/figures/cross_scale_front_speed.png`.
Jin points need `data/processed/jin_profiles.npz` (`data/build_curves.py`, raw file outside the repo via `CLOSURECALL_DATA`); without it the script runs on the simulator alone.
- **Continuum parameters, from the code** (`"free"` rule, bias 0, dens_exp 0): a move goes to a uniform empty Moore neighbour, so at low density the x-step is -1/0/+1 with prob 3/8, 2/8, 3/8 and **D = 0.375 a^2 / Tm** (a = 20 um). A division attempt fires with prob dt/Td per step, so the leading-edge growth rate is **r = 1/Td** (not ln2/Td). Single-cell check (one cell, 40 seeds, Tm 0.5 h, 20 h): MSD/4t = 323 +- 49 (s.e.) um^2/h against 300 predicted.
- **Runs**: half-plane sheet (40 rows, left reservoir) invading an empty strip for 8 Td; front = rightmost column with row-mean occupancy >= 0.5; speed = slope over the second half; 3 seeds. Grid Tm 0.1/0.3/1/3 h x Td 10/20/40 h.
- **Result (bias 0, dens_exp 0)**: the lattice front is **faster** than 2 sqrt(D r), by a ratio of **1.10-1.57** (e.g. Tm 0.1, Td 20: 19.0 vs 17.3 um/h; Tm 3, Td 10: 7.0 vs 4.5 um/h). The ratio falls as the front width sqrt(D/r) grows: 1.10-1.17 at 6-12 sites (Tm 0.1), 1.37-1.57 at 1-4 sites (Tm 1 and 3). So the simulator approaches Fisher-KPP in the wide-front (continuum) limit but does not reach it on this grid. We expected exclusion to make it slower; it is faster. A likely cause (not tested separately): a cell picks among its EMPTY neighbours rather than aborting when it picks an occupied one, so cells inside a crowded front still always move or divide outward, which makes the effective diffusivity rise with density (a pushed front). Nothing was tuned to match.
- **Shipped rule settings** (bias 7/9, dens_exp 0.5, Td 20 h, predicted with the same bias-free D): ratio **2.05-2.79** (e.g. Tm 1: 12.8 vs 5.5 um/h). The wound bias is a drift term, which Fisher-KPP does not have, so 2 sqrt(D r) does not describe the shipped rules; a D fitted from data with these rules is not a Fisher D.
- **Jin 2016 PC-3** (consistency check only): observed speed = slope of the 50%-of-plateau crossing of each side, while the gap is open (6 per density: 2 sides x 3 replicates, 12 h frames, 50 um bins), against 2 sqrt(D r) from the profile fits in `eval/results/jin_identifiability.csv`. Observed 5.9-9.0 um/h against predicted 6.7-16.3 um/h, ratio **0.50-0.97**, lowest at high density (14,000-20,000 cells/well: 0.50-0.72). The data fronts are slower than the asymptotic Fisher speed; a likely reason (not tested) is that 48 h is only 2-3 growth times (1/r about 16-24 h), so a pulled front is still accelerating when the gap closes. Same data both ways, so this is not an independent test. Only 5 time points and coarse bins, so the per-density sd is 1.7-3.1 um/h.
- **Conclusion**: within its own regime (no bias, no density dependence, front wider than a few sites) the lattice gives front speeds 10-17% above the continuum Fisher speed; on narrow fronts it is up to 57% above, and with the shipped bias about 2-2.8x. Simulator Tm/Td therefore cannot be read as Fisher (D, r) one-to-one; do not convert fitted Tm into a D for comparison with PDE fits without this correction.
