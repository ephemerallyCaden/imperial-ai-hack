# P2 v2 external check on WHiM-BC (Agent 4, sim/v2_whimbc.py)

WHiM-BC was never used for any P2 choice. P1's pipeline unchanged (eval/forecast_baselines: load, splits, prepare, forecast_file conformal; cut-offs 3/6/9 h, T = 24 h), scored with eval/score_forecasts.py; full rows in eval/results/scorecard_whimbc_v2_external.csv. Gate = design 5.3 (qscore <= 1.10 x best statistical baseline AND coverage 0.85-0.95). Lower qscore is better; CI = bootstrap over wells.

Caveats: (1) pixel scale unknown; synthetic band start on the WHAD 32x44 lattice; absolute Tm not comparable with WHAD. (2) free-rule rows (sim_ensemble, sim_frozen_shrink) transfer less cleanly (their shape depends on field size in sites). (3) settings frozen from a611525 (sim/v2.py), no WHiM-BC tuning.

| split | cut | best baseline (qscore, cov) | model | qscore [95% CI] | x best | x sim_ensemble | cov | gate | raw cov |
|---|---|---|---|---|---|---|---|---|---|
| Monolayer_to_Sphere | 3 h | lvcf (0.3122, 0.15) | sim_ensemble | 0.3856 [0.2674, 0.5014] | 1.24 | 1.00 | 0.23 | FAIL | 0.06 |
| Monolayer_to_Sphere | 3 h | lvcf (0.3122, 0.15) | sim_follow | 0.3929 [0.2671, 0.5234] | 1.26 | 1.02 | 0.25 | FAIL | 0.17 |
| Monolayer_to_Sphere | 3 h | lvcf (0.3122, 0.15) | sim_frozen_shrink | 0.4091 [0.3081, 0.5214] | 1.31 | 1.06 | 0.15 | FAIL | 0.15 |
| Monolayer_to_Sphere | 3 h | lvcf (0.3122, 0.15) | sim_follow_shrink | 0.3937 [0.2784, 0.5126] | 1.26 | 1.02 | 0.19 | FAIL | 0.21 |
| Monolayer_to_Sphere | 6 h | gompertz (0.1308, 0.58) | sim_ensemble | 0.1627 [0.1136, 0.2175] | 1.24 | 1.00 | 0.53 | FAIL | 0.06 |
| Monolayer_to_Sphere | 6 h | gompertz (0.1308, 0.58) | sim_follow | 0.1542 [0.1002, 0.2122] | 1.18 | 0.95 | 0.53 | FAIL | 0.25 |
| Monolayer_to_Sphere | 6 h | gompertz (0.1308, 0.58) | sim_frozen_shrink | 0.1718 [0.1228, 0.2274] | 1.31 | 1.06 | 0.53 | FAIL | 0.06 |
| Monolayer_to_Sphere | 6 h | gompertz (0.1308, 0.58) | sim_follow_shrink | 0.1661 [0.1097, 0.2272] | 1.27 | 1.02 | 0.53 | FAIL | 0.28 |
| Monolayer_to_Sphere | 9 h | gompertz (0.0798, 0.88) | sim_ensemble | 0.1512 [0.0965, 0.2362] | 1.89 | 1.00 | 0.42 | FAIL | 0.04 |
| Monolayer_to_Sphere | 9 h | gompertz (0.0798, 0.88) | sim_follow | 0.1232 [0.0726, 0.2045] | 1.54 | 0.81 | 0.71 | FAIL | 0.42 |
| Monolayer_to_Sphere | 9 h | gompertz (0.0798, 0.88) | sim_frozen_shrink | 0.1639 [0.1074, 0.2381] | 2.05 | 1.08 | 0.29 | FAIL | 0.00 |
| Monolayer_to_Sphere | 9 h | gompertz (0.0798, 0.88) | sim_follow_shrink | 0.1257 [0.0704, 0.2027] | 1.58 | 0.83 | 0.71 | FAIL | 0.29 |
| loo | 3 h | lvcf (0.0921, 0.92) | sim_ensemble | 0.1204 [0.0880, 0.1610] | 1.31 | 1.00 | 0.92 | FAIL | 0.05 |
| loo | 3 h | lvcf (0.0921, 0.92) | sim_follow | 0.1222 [0.0902, 0.1629] | 1.33 | 1.01 | 0.92 | FAIL | 0.13 |
| loo | 3 h | lvcf (0.0921, 0.92) | sim_frozen_shrink | 0.1193 [0.0906, 0.1580] | 1.29 | 0.99 | 0.92 | FAIL | 0.20 |
| loo | 3 h | lvcf (0.0921, 0.92) | sim_follow_shrink | 0.1169 [0.0867, 0.1553] | 1.27 | 0.97 | 0.92 | FAIL | 0.28 |
| loo | 6 h | lvcf (0.0816, 0.91) | sim_ensemble | 0.0769 [0.0636, 0.0934] | 0.94 | 1.00 | 0.91 | PASS | 0.18 |
| loo | 6 h | lvcf (0.0816, 0.91) | sim_follow | 0.0810 [0.0637, 0.1002] | 0.99 | 1.05 | 0.91 | PASS | 0.38 |
| loo | 6 h | lvcf (0.0816, 0.91) | sim_frozen_shrink | 0.0742 [0.0604, 0.0886] | 0.91 | 0.96 | 0.91 | PASS | 0.12 |
| loo | 6 h | lvcf (0.0816, 0.91) | sim_follow_shrink | 0.0861 [0.0688, 0.1050] | 1.05 | 1.12 | 0.91 | PASS | 0.30 |
| loo | 9 h | linear (0.0801, 0.90) | sim_ensemble | 0.0856 [0.0629, 0.1150] | 1.07 | 1.00 | 0.90 | PASS | 0.06 |
| loo | 9 h | linear (0.0801, 0.90) | sim_follow | 0.0819 [0.0554, 0.1179] | 1.02 | 0.96 | 0.90 | PASS | 0.35 |
| loo | 9 h | linear (0.0801, 0.90) | sim_frozen_shrink | 0.0842 [0.0616, 0.1168] | 1.05 | 0.98 | 0.90 | PASS | 0.01 |
| loo | 9 h | linear (0.0801, 0.90) | sim_follow_shrink | 0.0784 [0.0537, 0.1155] | 0.98 | 0.92 | 0.90 | PASS | 0.35 |

## Verdict
- Gate passes, out of 6 (split x cut-off): every model passes 2/6 (loo 6 h and loo 9 h). All fail loo 3 h (1.27-1.33x
  lvcf) and all of Monolayer_to_Sphere, where even the best baselines are under-covered (lvcf 0.15, gompertz 0.58/0.88).
- **sim_follow vs sim_follow_shrink (the comparison that matters, follower rule adopted in #68):** shrink is lower in
  2/6 cells (loo 3 h 0.1169 vs 0.1222, loo 9 h 0.0784 vs 0.0819), about equal in 1 (M2S 3 h, +0.2%) and higher in 3
  (loo 6 h +6%, M2S 6 h +8%, M2S 9 h +2%). Every difference sits well inside the wound-bootstrap CIs. So WHiM-BC does
  NOT confirm "shrink helps"; at the short cut-off (3 h) the effect is -4% (loo) and +0.2% (M2S): small, not significant.
- sim_follow vs sim_ensemble (free rule): follow is lower in 3/6 cells, most at the held-out condition at 9 h (0.81x),
  and higher by 1-5% in the others; within CIs.
- Raw ensembles are badly under-dispersed (raw coverage 0.00-0.42); coverage comes from P1's conformal, which is why
  coverage is identical across models in loo.
- Reproduce: `nice -n 10 /tmp/p2venv/bin/python sim/v2_whimbc.py cubes && ... sim/v2_whimbc.py gate`
  (3 + 12 min on 4 workers), then `python eval/score_forecasts.py eval/forecasts/whimbc` (it overwrites
  eval/results/scorecard.csv; the committed subset is scorecard_whimbc_v2_external.csv).
