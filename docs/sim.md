# Cell simulator: rules and output format (P2, `sim/cellsim.py`)

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
- Fit: grid search over `Tm` (0.05-5 h, 11 log steps) x `bias` (0.25-0.9), cost = MSE of `wound_frac` on the observed frames up to `t0`, 3 seeds; start = first annotated frame's mask.
- Cut-offs `t0` = frames 2, 4, 6, 10 (10/20/30/50% of 20 hourly frames, the same for every position, as P1-5).
- Spread: 50 bootstrap resamples of the observed frames, each refitted, give `members` = list of `[Tm, bias]`. Ensemble forecasts should combine these with simulator seeds.
- Presets: median `Tm` and `bias` per condition (CC, C61) over a fold's training positions only (asserted). Folds (P1's names): `A_partI_to_partII`, `A_partII_to_partI`, `B_CC_to_C61`. Fold B has no C61 training data, so it uses the CC preset for C61 test wounds.
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
