# Follower (sheet-like) rule: prototype report (Agent 4, feature/p2-follower)

Status: documented finding, NOT switched in tonight (user target: all P2 work done by 00:00; refit, NCA retrain
and JS re-port do not fit). The frozen rules are unchanged on every agent branch; the new rule is
`Params(follow=True)` (default False, output bit-identical when off).

**Summary.** The follower rule fixes the visual problem (front-like closure, packed sheet, no holes), removes the
field-size dependence, and matches the near-linear WHAD part II closure (R^2 0.999 vs data 0.98-0.996). Forecast
error after t0 = 10 drops for part II wounds (manual median rmse_out 0.0166 -> 0.0089; auto 0.0212 -> 0.0126), is
similar or slightly better at t0 = 4, and is mixed for part I: their stalls need Tm beyond the 50 h grid edge.
Ensemble 90% band coverage rises in every fold and cut-off (loo t10: manual 0.24 -> 0.53, auto 0.18 -> 0.51), but
stays well under nominal.

## Rule
A mover connected to the reservoir (Moore path through occupied sites to the refilled border band) pulls the chain of
cells behind it one site, so the vacancy exits at the reservoir and is refilled. In occupancy terms: its target fills
and its source stays occupied. Movers not connected (islands) leave a vacancy as before. Connectivity is the Moore
component of occupied sites containing the reservoir; it only grows (connected moves never vacate), so it is unique and
does not depend on the warm start. Tm, bias, dens_exp, conflicts and reservoir are unchanged. Output format unchanged.
Code: `sim/cellsim.py` (dilate, grow_connected, step, simulate).

## Results

### 1. Front-like closure (frame strip `docs/follower-strip-C61_P2.png`)
exp1_partII_C61_P2, seed 0. Frozen Tm 0.5 / bias 0.78 (fit); follow Tm 4 / bias 0.78 (hand-picked; the refit at t0 = 10 gives Tm 3.97 / bias 0.77, the same).
Rows: agents frozen, agents follow, smoothed + area-matched outline frozen, the same for follow.

| t (h) | 4 | 8 | 12 | 16 | 19 |
|---|---|---|---|---|---|
| data wound_frac | 0.201 | 0.140 | 0.071 | 0.012 | 0.002 |
| frozen | 0.207 | 0.134 | 0.077 | 0.048 | 0.035 |
| follow | 0.202 | 0.141 | 0.081 | 0.021 | 0.002 |

Follow: the band narrows from both edges, pinches off at about 12-16 h and is closed at 19 h, with no holes in the
sheet. The smoothed view and outline read as a closing wound to the end. Frozen: scattered vacancies from about 4 h.

### 2. Packed sheet and islands (C61_P2; `sim/follower_checks.py 2.0`)
| | t (h) | empties inside original wound | isolated empty sites | moves leaving a vacancy |
|---|---|---|---|---|
| frozen | 4 / 8 / 12 / 19 | 0.63 / 0.48 / 0.48 / 0.41 | 30 / 58 / 66 / 40 | 1.00 |
| follow (Tm 2) | 4 / 8 | 1.00 / 1.00 | 2 / 2 | 0.00 (no island movers) |

### 3. Size independence (12-site wavy scratch, mean of 3 seeds; area_norm at 4/8/12/19/24 h)
| field | frozen Tm 0.5 | follow Tm 2 |
|---|---|---|
| 44x44 | 0.85 0.60 0.37 0.20 0.13 | 0.47 0.05 0 0 0 |
| 44x456 | 0.97 0.79 0.58 0.36 0.27 | 0.60 0.17 0 0 0 |
| 120x168 | 0.97 0.93 0.89 0.85 0.82 | 0.57 0.14 0 0 0 |

Follow: 44x456 and 120x168 agree; 44x44 is slightly faster because the wound ends touch the border reservoir.
Frozen closure depends on the field size, because vacancies diffuse out through the border.

### 4. Linearity (R^2 of a line to area_norm while above 0.1)
Follow 0.999 and frozen 0.949 (44x44 scratch); WHAD part II data 0.978-0.996 (C61_P2, CC_P4, N61_P1, CC_P2).

### 5. Refit (`sim/follower_refit.py`, cost = wound_frac MSE as calibrate.py)
Both modes: all 56 WHAD positions (16 manual + 40 auto), 6 bias values, 3 seeds. Frozen: Tm grid 0.05-5 h
(21 points); follow: 0.05-50 h (31 points, same log spacing). Fit on frames <= t0 (grid argmin, no refine);
rmse_out = the same fit's error on the frames after t0 (the forecast error); full = best fit on all 19 h.
Results: `sim/fits/follower_compare_{frozen,follow}.json`; table: `python3 sim/follower_refit.py --table`.
Cut-offs are the old frame-index t0 = 4 and 10 (calibrate.py at 98dae8b). Agent 1 has since moved the official fits to
1.9/3.8/5.7/9.5 h series time with P1's wound_frac <= 0.70 filter (aed3174). So these numbers compare frozen vs follow
like for like, but are not the official scorecard numbers.

Median (mean) rmse_out of wound_frac:

| group | n | t0 = 4 frozen | t0 = 4 follow | t0 = 10 frozen | t0 = 10 follow | full frozen | full follow |
|---|---|---|---|---|---|---|---|
| manual part I | 8 | 0.0297 (0.0493) | 0.0256 (0.0363) | 0.0233 (0.0228) | 0.0200 (0.0245) | 0.0097 | 0.0119 |
| manual part II | 8 | 0.0270 (0.0295) | 0.0279 (0.0350) | 0.0166 (0.0164) | **0.0089 (0.0099)** | 0.0110 | 0.0083 |
| auto part I | 20 | 0.0307 (0.0359) | 0.0276 (0.0298) | 0.0190 (0.0229) | 0.0231 (0.0247) | 0.0094 | 0.0120 |
| auto part II | 19 / 16 | 0.0289 (0.0342) | 0.0246 (0.0397) | 0.0212 (0.0197) | **0.0126 (0.0201)** | 0.0106 | 0.0105 |

(auto part II: n = 19 at t0 = 4, 16 at t0 = 10.) In-sample rmse_in is slightly higher under follow in every group
(for example manual part II t0 = 10: 0.0070 -> 0.0091). Fitted Tm is about 8-10x larger (part II 4-8 h, part I 8-50 h).
At t0 = 10, 13 follow fits sit at the Tm = 50 h edge: 2 manual (part I C61_P1, C61_P2) and 11 auto part I. These are
stalled wounds that a front rule closes too fast even at 50 h, so the grid would need to go higher, or part I needs a
stall mechanism. Per manual wound at t0 = 10, rmse_out frozen -> follow: C61_P2 0.031 -> 0.008, N61_P1 0.024 -> 0.007,
CC_P4 0.019 -> 0.010; worse for part I NC_P1 0.028 -> 0.042 and CC_P3 0.008 -> 0.015.

### 6. Ensemble coverage (`sim/follower_forecast.py` + `/tmp/sanity_keep.py`)
Full sim_ensemble pipeline (calibrate.run_all + forecast.main unchanged, 50 bootstrap members, old cut-offs t2/4/6/10)
under follow, written only to /tmp/follower_scratch (frozen fits and forecasts asserted untouched). Frozen = the
committed sim/forecasts/whad at 98dae8b, same check. MAE of area_norm (median member) / fraction of observed points
inside the 90% band (nominal 0.90):

| fold, t0 | manual frozen | manual follow | auto frozen | auto follow |
|---|---|---|---|---|
| loo t2 | 0.180 / 0.15 | 0.176 / 0.21 | 0.128 / 0.27 | 0.108 / 0.45 |
| loo t4 | 0.127 / 0.18 | 0.128 / 0.26 | 0.118 / 0.14 | 0.100 / 0.35 |
| loo t6 | 0.094 / 0.27 | 0.095 / 0.39 | 0.096 / 0.15 | 0.087 / 0.36 |
| loo t10 | 0.080 / 0.24 | **0.058 / 0.53** | 0.077 / 0.18 | **0.062 / 0.51** |
| B_CC_to_C61 t4 | 0.141 / 0.03 | 0.134 / 0.21 | 0.137 / 0.07 | 0.139 / 0.29 |
| B_CC_to_C61 t10 | 0.082 / 0.17 | 0.062 / 0.37 | 0.089 / 0.18 | 0.094 / 0.28 |

Coverage rises in every row (loo t10 about doubles), and MAE is equal or lower except B auto (slightly higher). Bands
are still far below the nominal 90% (under-dispersed), so the follower rule helps but does not fix calibration alone.
Re-run: `nice -n 19 python3 sim/follower_forecast.py /tmp/follower_scratch && python3 /tmp/sanity_keep.py
/tmp/follower_scratch/forecasts` (about 24 min at 4 workers under load).

## What switching would take
In order, about 3-5 h of work at today's machine load:
1. **Rules and fits (Agent 1):** merge `follow=True` as the default; set TM_GRID to 0.05-50 h (31 points, or higher
   for stalled part I wounds); re-run `calibrate.py --all` and `forecast.py`. About 1 h of CPU.
2. **NCA (Agent 2):** regenerate the training data under follow and retrain with a front source term (details
   below). The longest item: hours of training.
3. **JS (Agent 3):** port the connectivity rule, then run the parity check again. About 30-45 min.
4. **Playback (Agent 4):** re-run `sim/make_playback.py` + `export_playback.py` with the new fit. Minutes.

### 7. Impact
- **JS (Agent 3, `sim/js/engine.js`):** small. Add `follow` to the params, a Moore dilation, `growConnected` (loop to a
  fixpoint after each step's refill) and one condition on the vacate line, about 25 lines. Connectivity is unique
  (the reservoir's occupied Moore component), so JS can recompute it from scratch each step and still match Python.
  Parity test as before (20 seeds, area at 4/12/24 h). Estimate 30-45 min. The draw tool would then heal at the same
  speed on any canvas size, so the "draw at 32x44" workaround in docs/p2-handoff.md could go.
- **NCA (Agent 2, `nca/`):** large. Under follow the sheet stays packed (rho = 1 everywhere except the wound), and
  mass reaches the front through fully packed cells. The current NCA's flux is capped by the target's room
  (1 - rho), so no mass can pass through rho = 1 cells: it cannot represent this. Options: (a) let the existing
  source term act for WHAD as "inflow from beyond the field of view" (a front source, learned from the data; mass
  stays bounded by 1 and the reservoir floor stays); (b) a hidden pressure channel that allows flux through packed
  cells. (a) is the smaller change. Either way: regenerate the 3000 training runs under follow (minutes) and retrain
  (hours under the current load). The density state becomes close to binary, which is easier to learn. The
  parameter channel normalisation `p0` uses ln 5 as the Tm maximum and must change to the new Tm range.
- **Fits and forecasts (Agent 1):** Tm means something different (about 8-10x larger for the same wound); the Tm grid
  becomes 0.05-50 h. whad_fits.json, the auto fits, sim_ensemble forecasts and draw-tool presets all need regenerating
  (`calibrate.py --all` and `forecast.py`, about 1 h of CPU at the current load).

## Reproduce
- `python3 sim/follower_checks.py 2.0`: size independence, packedness, islands, linearity (about 20 s)
- `python3 sim/follower_refit.py frozen && python3 sim/follower_refit.py follow && python3 sim/follower_refit.py --table`
- `python3 sim/follower_forecast.py /tmp/follower_scratch && python3 /tmp/sanity_keep.py /tmp/follower_scratch/forecasts`
