# P2 results and caveats (cell simulator, calibration, sim ensemble)

Branch `feature/p2-agent1` (on main 887d230). Details: `docs/sim.md`. Numbers from Sat 21:30; my own check of median error and 90% coverage
against observed areas, not P1's scorer (CRPS lives there). NCA rows: Agent 2 (`nca/forecasts/whad/`).

## Pipeline
1. First-frame wound mask -> 32 x 44 lattice of 20 um sites (one site = one cell; area error < 0.3%, limit 2%) (`sim/start_state.py`).
2. Per wound, fit migration time Tm and wound bias on frames <= t0 only: grid plus off-grid refine, 50 bootstrap members (`sim/calibrate.py`).
3. Each member drives one cell-agent simulation (Migliaccio 2023 rules, division off) to 19 h -> area q05/q50/q95, t50/t90, P(90% closed by 12 h) -> forecast JSON (`sim/forecast.py`).

## Scorecard rows (area_norm; MAE = median forecast vs observed; cov90 = observed inside the 90% band)
Data: WHAD MCF10A, 16 manual-mask positions (9 wounds) + 40 auto-segmented positions (22 wounds). loo = leave-one-wound-out
(both plate parts of a wound held out together); B = train CC, test C61 (7 wounds). Files: `sim/forecasts/whad/sim_ensemble_{fold}_t{t0}.json`
(commit 98dae8b). Cut-offs are absolute hours (P1 to confirm vs "first 10/20/30/50% of frames").

| fold | t0 (h) | sim MAE manual / auto | sim cov90 manual / auto | NCA MAE | NCA cov90 |
|---|---|---|---|---|---|
| loo | 2 | 0.180 / 0.128 | 0.15 / 0.27 | | |
| loo | 4 | 0.127 / 0.118 | 0.18 / 0.14 | | |
| loo | 6 | 0.094 / 0.096 | 0.27 / 0.15 | | |
| loo | 10 | 0.080 / 0.077 | 0.24 / 0.18 | | |
| B_CC_to_C61 | 2 | 0.176 / 0.134 | 0.09 / 0.32 | | |
| B_CC_to_C61 | 4 | 0.141 / 0.137 | 0.03 / 0.07 | | |
| B_CC_to_C61 | 6 | 0.113 / 0.124 | 0.09 / 0.05 | | |
| B_CC_to_C61 | 10 | 0.082 / 0.089 | 0.17 / 0.18 | | |

## Honest findings (one line each)
- **Bands are not calibrated:** raw sim coverage is 0.03-0.32 against a nominal 0.90. Calibration needs P1's conformal step; P2 adds no inflation term.
- **Parameter uncertainty is a small part of the error:** mean band width 0.07-0.13 vs mean |error| 0.08-0.14 (loo). Bootstrap members spread about +-15% in Tm (log range 0.2-0.36), so the misfit is structural (98dae8b).
- **Early cut-offs run fast:** mean (forecast - observed) area is -0.087 / -0.076 / -0.041 / 0.000 at t0 = 2 / 4 / 6 / 10 (loo). The sim closes too fast when fitted on few frames.
- **Vacancies spread rather than close as a front:** with division off, holes diffuse into the sheet. On exp1_partII_C61_P2, 37% of empty sites are outside the original wound by 4 h and 52% by 8 h, and some get trapped, so the sim ends at 0.035 vs 0.002 observed (Agent 4). Read it as sheet stretching: WHAD masks count only the gap.
- **Closure speed depends on field size (frozen rules):** the same 12-site scratch at Tm 0.5 reaches area 0.19 by 19 h in a 44 x 44 field vs 0.36 in a 44 x 456 strip, and the CC preset in a 120 x 168 field is still 0.81 at 24 h (Agent 4). Fitted Tm is valid only for the 640 x 880 um WHAD field, so uploads are windowed to it (`sim/upload.py`).
- **Bias is poorly identified:** 34% of t0 = 10 fits sit at the 0.25 lower edge and 7% at 0.9. Per wound, bias moves by a median of 0.23 (of a 0.65 range) between t0 = 4/6/10, while Tm moves by 0.22 in log. Tm carries the signal.
- **CC vs C61 presets look the same, but the data differ:** within each plate part C61 is slower (part II area at 10 h 0.62 vs 0.44; part I at 19 h 1.01 vs 0.86). The part I vs II gap is far larger, and pooling parts gives near-identical medians (Tm 0.97 vs 1.07 h, IQR 0.52-3.2 vs 0.49-5.0). So the draw-tool presets (CC 0.948 h / 0.25, C61 1.052 h / 0.383) do not show the condition effect.
- **The draw tool is a preset simulation, not a forecast:** medians over all wounds at t0 = 10, with no band, labelled "simulation, preset parameters" (`presets.draw_tool`).
- **Auto-segmented wounds** start from a synthetic vertical band with the observed first-frame area, because no masks exist on this machine. They are tagged in `segmentation_quality.reasons`; the manual-only rows use `status == "manual_mask"`.
- **Stalled wounds:** 10 of 56 t0 = 10 fits sit at the Tm = 5 h upper edge. All are part I wounds that barely close (5 C61, 3 N61, 2 CC), so Tm there is a lower bound.
- **Why 20 um sites:** at 10 um the sim could not close part II wounds (fits pinned at the Tm floor, area stalled near 0.2 of initial vs 0.01-0.07 observed), so we switched to the design's one site = one cell (d462179).

## Likely judge questions
- **Why simulate cells instead of fitting a curve?** The simulator turns any wound shape into a mechanistic forecast and provides the NCA's training data and the draw tool. On area alone, simple curve baselines are strong; see P1's scorecard.
- **Are your 90% bands calibrated?** Not the raw sim ensemble: coverage is 0.03-0.32. Parameter spread is honest but small, so calibrated bands come from P1's conformal step.
- **Any leakage?** Fits use frames <= t0 only. loo holds out both parts of a wound (part I and II are the same wound, R15). Presets come from training wounds only, and the code asserts no overlap. The same cut-off applies to every wound.
- **What does Tm mean physically?** It ranks wounds (part II 0.14-0.65 h vs part I 0.4-5 h), but it is tied to the 640 x 880 um field: under these rules closure speed depends on field size, so it is not a measured migration time.
- **Why is division off?** This is design 5.1b for WHAD: the 19 h assay is treated as migration-dominated, with Migliaccio's Phi as the sanity check. We have not separately verified it on WHAD.
- **Why does the playback show scattered holes rather than a front?** The frozen rules close by vacancy diffusion. A follower rule (the chain shifts behind a mover) closes as a front, linear R^2 0.999 vs data 0.978-0.996 (Agent 4, `feature/p2-follower`). It is not in the scored results.
- **Do CC and C61 differ?** Yes, within each plate part (C61 slower). The fitted sim parameters pool parts and do not resolve it, and bias is weakly identified.
