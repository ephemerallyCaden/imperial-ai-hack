# P2 results and caveats (cell simulator, calibration, sim ensemble)

> **Scope.** Stitch's simulator is a mechanistic lattice model of collective epithelial migration in 2D in-vitro scratch assays
> (MCF10A cells, WHAD dataset). It forecasts the closure of the assay's cell-free gap; it does **not** model skin wounds in patients. In-vivo healing
> adds haemostasis, inflammation, granulation tissue, contraction and remodelling, and none of these is modelled. Cell division is switched off for
> WHAD (our modelling choice for a 19 h migration assay; whether WHAD used a proliferation inhibitor is not verified here). The wound-bias
> parameter is not identified from these data, so Tm carries the signal. All tuning and evaluation are on WHAD only.

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
- **Why does the playback show scattered holes rather than a front?** The v1 (free) rule closes by vacancy diffusion. v2 uses the follower rule (the chain shifts behind a mover), which closes as a front: linear R^2 0.999 vs data 0.978-0.996 (Agent 4).
- **Do CC and C61 differ?** In normalised area C61 looks slower, but in part II that is mostly because C61 wounds start larger. Absolute closure (1.01 vs 1.19% of field/h) and fitted Tm (0.48 vs 0.50 h) overlap. The large effect is plate part (part I barely closes), not condition. Bias is weakly identified, so we don't claim a bias difference.
- **Does the simulator beat simple baselines?** Only with enough data: at 9.5 h it matches or beats linear (loo_all 0.0301 vs 0.0311). At 1.9-5.7 h edge_speed is better by 14-39%: a two-parameter cell model fitted on 2-6 frames is not more accurate than a fitted front speed.

## P2 v2: follower rule (feature/p2-v2-sim): ADOPTED for physical realism, not for score
**Decision (user, recorded on #68):** the follower rule is the P2 simulator everywhere (WHAD forecasts, upload, draw tool, playback), because it
closes wounds as a front, as real monolayers do, and its fitted Tm does not depend on field size. **This departs from our pre-declared rule**:
sim_follow did NOT pass it. It beats v1 sim_ensemble on qscore in 6 of 12 groups (needed >= 7); coverage is in 0.85-0.95 in 9 of 12 groups for both;
headline loo_all 3.8 h is 0.0459 (v2) vs 0.0492 (v1) vs edge_speed 0.0385; and CC_to_C61 is worse in all four groups (worst 5.7 h: 0.0380 vs 0.0320).
The scorecard reports both v1 (sim_ensemble) and v2 (sim_follow) rows. Neither beats edge_speed at 1.9-5.7 h.
**WHiM-BC external check (Agent 4, frozen WHAD settings):** _slot: result pending_.
**Which NCA is the demo forecaster (user decision, Sun 00:20):** NCA v2 (trained on follower-rule simulations, Agent 2, `nca/v2/`), for
consistency with the follower-rule cells shown in the draw tool and playback. This is a stated choice, not the best score: **nca_realft** (P1, #71: the
v1 NCA fine-tuned on real WHAD frames, 4 wound-level folds) scores best on the gate (passes 9 of 12 groups). The scorecard keeps both rows.

**Tuned and evaluated on WHAD; no external test set** (a WHiM-BC check is with Agent 4). Code `sim/v2.py`; rule `Params(rule="follow")`
(Agent 4, 3dd4fcf). Fits are at P1's cut-offs in series time (`sim/fits/whad_fits_follow.json`, 490b4c7: Tm grid 0.05-500 h, near-tie break),
and the start, members and conformal are exactly as for sim_ensemble. The **pre-declared primary is sim_follow** (#68, declared before any v2 score
was read). Adopt rule: beat sim_ensemble on qscore in >= 7 of 12 groups AND have coverage in 0.85-0.95 in at least as many groups.
Scores: `python eval/score_forecasts.py eval/forecasts`, Sat 23:33, gate vs statistical baselines only (qscore <= 1.1 x best, cov 0.85-0.95).

| fold | cut (h) | best statistical baseline | sim_follow | sim_ensemble | sim_follow_raw | sim_ensemble_raw |
|---|---|---|---|---|---|---|
| loo_all | 1.9 | edge_speed 0.0657 / 0.93 | 0.0749 / 0.93 | 0.0772 / 0.93 | 0.1181 / 0.22 | 0.1385 / 0.12 |
| loo_all | 3.8 | edge_speed 0.0385 / 0.93 | 0.0459 / 0.93 | 0.0492 / 0.93 | 0.0802 / 0.31 | 0.0907 / 0.21 |
| loo_all | 5.7 | edge_speed 0.0327 / 0.93 | 0.0398 / 0.92 | 0.0409 / 0.92 | 0.0627 / 0.30 | 0.0673 / 0.17 |
| loo_all | 9.5 | linear 0.0311 / 0.92 | 0.0292 / 0.92 PASS | 0.0301 / 0.92 PASS | 0.0451 / 0.32 | 0.0515 / 0.19 |
| loo_manual | 1.9 | edge_speed 0.0412 / 0.87 | 0.0506 / 0.87 | 0.0572 / 0.87 | 0.1371 / 0.16 | 0.1542 / 0.14 |
| loo_manual | 3.8 | gompertz 0.0393 / 0.87 | 0.0454 / 0.87 | 0.0464 / 0.87 | 0.1106 / 0.16 | 0.1028 / 0.20 |
| loo_manual | 5.7 | edge_speed 0.0362 / 0.87 | 0.0461 / 0.87 | 0.0432 / 0.86 | 0.0714 / 0.31 | 0.0672 / 0.22 |
| loo_manual | 9.5 | linear 0.0330 / 0.88 | 0.0337 / 0.85 PASS | 0.0334 / 0.88 PASS | 0.0418 / 0.34 | 0.0543 / 0.16 |
| CC_to_C61 | 1.9 | edge_speed 0.0794 / 0.78 | 0.0914 / 0.79 | 0.0908 / 0.79 | 0.1642 / 0.06 | 0.1737 / 0.07 |
| CC_to_C61 | 3.8 | edge_speed 0.0345 / 0.92 | 0.0394 / 0.92 | 0.0392 / 0.96 | 0.0948 / 0.24 | 0.0993 / 0.24 |
| CC_to_C61 | 5.7 | edge_speed 0.0344 / 0.86 | 0.0380 / 0.84 | 0.0320 / 0.91 PASS | 0.0795 / 0.24 | 0.0779 / 0.11 |
| CC_to_C61 | 9.5 | linear 0.0305 / 0.91 | 0.0313 / 0.79 | 0.0307 / 0.81 | 0.0537 / 0.12 | 0.0461 / 0.16 |

#68: sim_follow qscore wins vs sim_ensemble 6/12; coverage in 0.85-0.95: sim_follow 9/12 vs sim_ensemble 9/12 -> DO NOT ADOPT

**Result against the pre-declared rule: not met** (adopted anyway, above). sim_follow beats sim_ensemble in 6 of 12 groups (needs 7), and coverage is in range in 9 of 12 for both. It passes the gate in
2 of 12 groups (both loo at 9.5 h), against 3 of 12 for sim_ensemble. Its wins are small (2-12% lower qscore, at all four loo_all cut-offs and loo_manual 1.9-3.8 h); it loses
all four CC_to_C61 groups (most at 5.7 h: 0.0380 vs 0.0320). At 1.9-5.7 h it still loses to the best statistical baseline by 10-27%. Raw coverage rises from 0.07-0.24 to 0.06-0.34, but stays far
from 0.90. Bias stays unidentified under the follow rule: before the tie-break, 45 of 56 bias fits sat at the 0.25 floor at 1.9 h; after it, 5 of 56.

**Ablations (variant selected on WHAD, not independently held out):**
| fold | cut (h) | best statistical baseline | sim_follow_shrink | sim_follow_fixbias | sim_frozen_shrink |
|---|---|---|---|---|---|
| loo_all | 1.9 | edge_speed 0.0657 / 0.93 | 0.0683 / 0.93 PASS | 0.0743 / 0.93 | 0.0702 / 0.93 PASS |
| loo_all | 3.8 | edge_speed 0.0385 / 0.93 | 0.0427 / 0.93 | 0.0457 / 0.93 | 0.0491 / 0.93 |
| loo_all | 5.7 | edge_speed 0.0327 / 0.93 | 0.0398 / 0.92 | 0.0401 / 0.92 | 0.0411 / 0.93 |
| loo_all | 9.5 | linear 0.0311 / 0.92 | 0.0285 / 0.92 PASS | 0.0293 / 0.91 PASS | 0.0298 / 0.92 PASS |
| loo_manual | 1.9 | edge_speed 0.0412 / 0.87 | 0.0403 / 0.88 PASS | 0.0505 / 0.87 | 0.0485 / 0.87 |
| loo_manual | 3.8 | gompertz 0.0393 / 0.87 | 0.0463 / 0.86 | 0.0456 / 0.87 | 0.0486 / 0.87 |
| loo_manual | 5.7 | edge_speed 0.0362 / 0.87 | 0.0477 / 0.86 | 0.0451 / 0.88 | 0.0446 / 0.86 |
| loo_manual | 9.5 | linear 0.0330 / 0.88 | 0.0313 / 0.86 PASS | 0.0331 / 0.85 PASS | 0.0332 / 0.87 PASS |
| CC_to_C61 | 1.9 | edge_speed 0.0794 / 0.78 | 0.0657 / 0.92 PASS | 0.0918 / 0.79 | 0.0744 / 0.87 PASS |
| CC_to_C61 | 3.8 | edge_speed 0.0345 / 0.92 | 0.0351 / 0.96 | 0.0396 / 0.91 | 0.0368 / 0.96 |
| CC_to_C61 | 5.7 | edge_speed 0.0344 / 0.86 | 0.0387 / 0.84 | 0.0380 / 0.85 | 0.0337 / 0.88 PASS |
| CC_to_C61 | 9.5 | linear 0.0305 / 0.91 | 0.0359 / 0.81 | 0.0315 / 0.79 | 0.0314 / 0.83 |

The empirical-Bayes shrink variants (a pool-only mixture prior at the same cut, with sigma = 0.01 fixed a priori) are the only P2 models that beat
edge_speed at 1.9 h: sim_follow_shrink at loo_manual (0.0403 vs 0.0412) and CC_to_C61 (0.0657 vs 0.0794), and sim_frozen_shrink at CC_to_C61
(0.0744). Both shrink variants pass 5 of 12 groups.
They were chosen after looking at WHAD errors, so treat them as a hypothesis for an external test, not a result.

### Judge question on v2
- **Is this how skin heals?** No. It models one ingredient: an epithelial sheet migrating into a scratch in a dish (MCF10A, WHAD), with division off
  and no immune cells, blood, matrix or contraction. Real skin wounds go through haemostasis, inflammation, proliferation with granulation tissue, and
  remodelling over days to weeks. Our claim is limited to forecasting in-vitro scratch-assay closure from a few frames, scored against simple
  baselines on held-out wounds.
- **Why use the follower rule if it didn't pass your own criterion?** We chose it for physical realism, and say so openly. v1 left scattered single-site holes and its fitted speed depended on the field size (area 0.19 vs 0.36 at 19 h for the same scratch in a 44 x 44 vs 44 x 456 field). v2 closes as a front with no size dependence. On forecast skill the two are a wash: 6 of 12 groups better, worse on the held-out condition, and both lose to a fitted edge speed at early cut-offs. We pre-declared an adopt rule, it failed, and we report that alongside both rows rather than hiding v1. All of this is tuned and evaluated on WHAD only; WHiM-BC is the external check.
