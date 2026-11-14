# P2 results and caveats (cell simulator, calibration, sim ensemble)

Branch `feature/p2-agent1` (on main f51bb86). Details: `docs/sim.md`. Gate numbers are from P1's scorer
(`python eval/score_forecasts.py eval/forecasts --gate sim_ensemble`, Sat 22:25). qscore = mean pinball loss over q05/q50/q95,
a CRPS approximation, lower is better. cov = 90% band coverage. The gate requires qscore within 10% of the best baseline AND
coverage 0.85-0.95.

## Pipeline
1. The observed wound mask at the last frame <= cut-off becomes a 32 x 44 lattice of 20 um sites (one site = one cell; area error < 0.3%, limit 2%). Auto-segmented wounds, which have no mask on disk, start from a synthetic band with that frame's area (`sim/start_state.py`, `sim/forecast.py band_start`).
2. Per wound, fit migration time Tm and wound bias on series frames t <= cut-off only (series time = hours since the series' first frame, P1's rows): grid plus off-grid refine, 50 bootstrap members (`sim/calibrate.py`, commit aed3174).
3. Each member drives one cell-agent simulation (Migliaccio 2023 rules, division off), rescaled to the observed area at the start, as the NCA. The member median is the point forecast for P1's leave-one-wound-out conformal (`eval/forecast_baselines.forecast_file`, called unchanged), giving `sim_ensemble`. `sim_ensemble_raw` is the uncalibrated ensemble (`sim/forecast_gate.py`, commit 8ea9691).

## Gate (WHAD; P1's series, folds, cut-offs 1.9/3.8/5.7/9.5 h and calibration pools; files `eval/forecasts/whad/{fold}/sim_ensemble{,_raw}_{cut}h.json`)
| fold | cut (h) | best baseline: qscore / cov | sim_ensemble: qscore / cov | gate | sim_ensemble_raw: qscore / cov | nca_ensemble: qscore / cov | NCA gate |
|---|---|---|---|---|---|---|---|
| loo_all | 1.9 | edge_speed 0.0657 / 0.93 | 0.0772 / 0.93 | FAIL | 0.1385 / 0.12 | 0.0782 / 0.93 | FAIL |
| loo_all | 3.8 | edge_speed 0.0385 / 0.93 | 0.0492 / 0.93 | FAIL | 0.0907 / 0.21 | 0.0495 / 0.93 | FAIL |
| loo_all | 5.7 | edge_speed 0.0327 / 0.93 | 0.0409 / 0.92 | FAIL | 0.0673 / 0.17 | 0.0397 / 0.93 | FAIL |
| loo_all | 9.5 | linear 0.0311 / 0.92 | 0.0301 / 0.92 | PASS | 0.0515 / 0.19 | 0.0304 / 0.92 | PASS |
| loo_manual | 1.9 | edge_speed 0.0412 / 0.87 | 0.0572 / 0.87 | FAIL | 0.1542 / 0.14 | 0.0559 / 0.87 | FAIL |
| loo_manual | 3.8 | gompertz 0.0393 / 0.87 | 0.0464 / 0.87 | FAIL | 0.1028 / 0.20 | 0.0458 / 0.87 | FAIL |
| loo_manual | 5.7 | edge_speed 0.0362 / 0.87 | 0.0432 / 0.86 | FAIL | 0.0672 / 0.22 | 0.0404 / 0.85 | FAIL |
| loo_manual | 9.5 | linear 0.0330 / 0.88 | 0.0334 / 0.88 | PASS | 0.0543 / 0.16 | 0.0318 / 0.88 | PASS |
| CC_to_C61 | 1.9 | edge_speed 0.0794 / 0.78 | 0.0908 / 0.79 | FAIL | 0.1737 / 0.07 | 0.0921 / 0.82 | FAIL |
| CC_to_C61 | 3.8 | edge_speed 0.0345 / 0.92 | 0.0392 / 0.96 | FAIL | 0.0993 / 0.24 | 0.0394 / 0.99 | FAIL |
| CC_to_C61 | 5.7 | edge_speed 0.0344 / 0.86 | 0.0320 / 0.91 | PASS | 0.0779 / 0.11 | 0.0328 / 0.86 | PASS |
| CC_to_C61 | 9.5 | linear 0.0305 / 0.91 | 0.0307 / 0.81 | FAIL | 0.0461 / 0.16 | 0.0311 / 0.86 | PASS |

**Summary:** calibrated, the simulator passes 3 of 12 groups. It beats the best baseline at loo_all 9.5 h (0.0301 vs 0.0311) and CC_to_C61 5.7 h
(0.0320 vs 0.0344), and ties at loo_manual 9.5 h. CC_to_C61 9.5 h matches on qscore (0.0307 vs 0.0305) but fails on coverage (0.81). It is 14-39% worse than edge_speed at the early cut-offs, including the headline loo_all
3.8 h (0.0492 vs 0.0385). Raw, it is badly under-dispersed: coverage 0.07-0.24.
NCA (Agent 2, commit 6b6251b, same fits aed3174 and P1's conformal; `docs/nca.md`): nca_ensemble passes 4 of 12 (both 9.5 h loo groups, and CC_to_C61 at 5.7 h and 9.5 h). Its qscore is within 7% of the calibrated sim in every group (within 3% in 9 of 12; the NCA is slightly better on loo_manual): the two models are nearly indistinguishable once both start from the cut-off mask and are conformal-calibrated. nca_deterministic is within about 5% of the ensemble; nca_ensemble_raw coverage is 0.01-0.24. Note that P1's gate() also counts the other P2 models as baselines; the best-baseline column here uses the statistical baselines only.
**#24 (NCA emulates the simulator) is NOT met:** NCA area error vs the sim is 0.042, against the sim's own member spread of 0.014 (`nca/eval_vs_sim.py`, Agent 2). It is fine for Tm > 0.5 h, but for Tm < 0.2 h the NCA closes fully while the sim leaves 2-6% open, and its member spread is about 6x too small. The fine-tune was dropped for time.

## Honest findings (one line each)
- **Raw bands are not calibrated:** raw sim coverage is 0.07-0.24 on P1's scorer (nominal 0.90). With P1's conformal step it reaches 0.79-0.96, the same procedure as the baselines.
- **Parameter uncertainty is a small part of the error:** raw band width is 0.03-0.10 on P1's scorer, against MAE 0.06-0.18. Bootstrap members spread about +-15% in Tm, so the misfit is structural.
- **Early cut-offs run fast** (measured on the earlier frame-0-start files, 98dae8b): mean (forecast - observed) area was -0.087 / -0.076 / -0.041 / 0.000 at t0 = 2 / 4 / 6 / 10 h. Fits on 2-4 frames make the sim close too fast; this matches the gate failing at the early cut-offs.
- **Vacancies spread rather than close as a front:** with division off, holes diffuse into the sheet. On exp1_partII_C61_P2, 37% of empty sites are outside the original wound by 4 h and 52% by 8 h, and some get trapped, so the sim ends at 0.035 vs 0.002 observed (Agent 4). Read it as sheet stretching: WHAD masks count only the gap.
- **Closure speed depends on field size (frozen rules):** the same 12-site scratch at Tm 0.5 reaches area 0.19 by 19 h in a 44 x 44 field vs 0.36 in a 44 x 456 strip, and the CC preset in a 120 x 168 field is still 0.81 at 24 h (Agent 4). Fitted Tm is valid only for the 640 x 880 um WHAD field, so uploads are windowed to it (`sim/upload.py`).
- **Bias is poorly identified** (98dae8b fits): 34% of t0 = 10 fits sit at the 0.25 lower edge and 7% at 0.9. Per wound, bias moves by a median of 0.23 (of a 0.65 range) between t0 = 4/6/10, while Tm moves by 0.22 in log. Tm carries the signal.
- **CC vs C61: the normalised gap is mostly wound size, not speed:** within each part C61 looks slower in area_norm (part II at 10 h 0.62 vs 0.44; part I at 19 h 1.01 vs 0.86). But part II C61 wounds start larger (median wound fraction 0.267 vs 0.218), and in absolute terms they close at about the same rate: 1.01 vs 1.19% of the field per hour over 0-10 h, ranges 0.82-1.59 vs 0.68-1.40. Fitted part II Tm agrees: 0.48 h (IQR 0.45-0.54) for C61 vs 0.50 h (0.40-0.62) for CC. The part I vs II gap is far larger than any condition gap; pooling parts mixed the two (pooled Tm 1.07 vs 0.97 h).
- **The draw tool is a preset simulation, not a forecast:** `presets.draw_tool` holds the part II medians at cut-off 9.5 h, manual + auto (n = 7 each): CC Tm 0.48 h, C61 0.48 h, with IQRs, labelled "simulation, preset parameters (WHAD part II fits)", and no band. With the near-identical 65c035a presets, the same drawn 0.18 disc reached 0.024 (CC) and 0.020 (C61) at 24 h, so the draw tool honestly shows no condition difference.
- **Auto-segmented wounds** start from a synthetic vertical band with the observed first-frame area, because no masks exist on this machine. They are tagged in `segmentation_quality.reasons`; the manual-only rows use `status == "manual_mask"`.
- **Stalled wounds** (98dae8b fits): 10 of 56 t0 = 10 fits sit at the Tm = 5 h upper edge. All are part I wounds that barely close (5 C61, 3 N61, 2 CC), so Tm there is a lower bound.
- **Follower rule (not shipped; `docs/follower-report.md` on `feature/p2-follower`, 2c7584e, Agent 4):** a moving cell pulls the chain behind it, so the wound closes as a front. On the earlier cut-offs (t0 2/4/6/10, frame-0 start) it lowers part II out-of-sample RMSE (t0 = 10: manual 0.0166 -> 0.0089, auto 0.0212 -> 0.0126) and lifts raw loo coverage at t0 = 10 from 0.24 / 0.18 to 0.53 / 0.51 (manual / auto). Tm is 8-10x larger, and 13 part I stalls sit at the 50 h grid edge. It was not refit at P1's cut-offs, retrained or ported to JS for the gate, so it is a finding, not a scored result.
- **Fair start:** the sim and the NCA both start from the observed mask at the cut-off, rescaled to the observed area there. Earlier sim files started at frame 0, which handicapped the sim against the NCA (data assimilation, not model skill).
- **Why 20 um sites:** at 10 um the sim could not close part II wounds (fits pinned at the Tm floor, area stalled near 0.2 of initial vs 0.01-0.07 observed), so we switched to the design's one site = one cell (d462179).

## Likely judge questions
- **Why simulate cells instead of fitting a curve?** The simulator turns any wound shape into a mechanistic forecast and provides the NCA's training data and the draw tool. On area alone, simple curve baselines are strong; see P1's scorecard.
- **Are your 90% bands calibrated?** Raw, no: coverage is 0.07-0.24. Through P1's leave-one-wound-out conformal (the same procedure as every baseline) it reaches 0.79-0.96, and that is what the gate scores.
- **Any leakage?** Fits use series frames <= cut-off only, and the conformal pool never contains the test wound (P1's code). loo holds out both parts of a wound (part I and II are the same wound, R15). Presets come from training wounds only, and the code asserts no overlap. The same cut-off applies to every wound.
- **What does Tm mean physically?** It ranks wounds (part II 0.14-0.65 h vs part I 0.4-5 h), but it is tied to the 640 x 880 um field: under these rules closure speed depends on field size, so it is not a measured migration time.
- **Why is division off?** This is design 5.1b for WHAD: the 19 h assay is treated as migration-dominated, with Migliaccio's Phi as the sanity check. We have not separately verified it on WHAD.
- **Why does the playback show scattered holes rather than a front?** The frozen rules close by vacancy diffusion. A follower rule (the chain shifts behind a mover) closes as a front, linear R^2 0.999 vs data 0.978-0.996 (Agent 4, `feature/p2-follower`). It is not in the scored results.
- **Do CC and C61 differ?** In normalised area C61 looks slower, but in part II that is mostly because C61 wounds start larger. Absolute closure (1.01 vs 1.19% of field/h) and fitted Tm (0.48 vs 0.50 h) overlap. The large effect is plate part (part I barely closes), not condition. Bias is weakly identified, so we don't claim a bias difference.
- **Does the simulator beat simple baselines?** Only with enough data: at 9.5 h it matches or beats linear (loo_all 0.0301 vs 0.0311). At 1.9-5.7 h edge_speed is better by 14-39%: a two-parameter cell model fitted on 2-6 frames is not more accurate than a fitted front speed.
