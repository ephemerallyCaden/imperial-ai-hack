# Stitch: who does what (Sat 19:45 to Sun 13:00)

Follows `docs/design.md` (R14); section numbers in brackets point there. Task IDs become GitHub Project items. **Must** = needed for the video and scorecard. **Should** = makes it better. **Stretch** = only if ahead.

| Role | Person | Owns | Branch |
|---|---|---|---|
| P1 Data, segmentation, baselines, scoring | randodeh | `data/`, `eval/`, `contracts/` | `feature/data-baselines` |
| P2 Cell simulator, NCA, calibration | Caden | `sim/`, `nca/` | `feature/model-caden` |
| P3 Viewer, Figma, README, video | Joanne | `web/`, `docs/video-script.md` | `feature/web-joanne` |

## What must exist at 08:00 Sunday (design.md section 14)

1. Draw a wound, watch it heal, zoom from cells to wound.
2. Upload 3 real WHAD frames, get a forecast with a 90% band and flags.
3. Held-out WHAD scorecard: our forecaster vs baselines, per fold, with coverage, CRPS and one failure case.
4. Gate result recorded with numbers.

Everything below serves one of those four. Never cut item 3.

## Critical path and fallbacks

```
P1 WHAD curves + masks (21:00) ──> P2 simulator fitted to WHAD ──> P2 NCA ensemble forecasts (23:45)
          │                                                                  │
          └──> P1 WHAD baselines + bands ──────> P1 scores both at the gate (00:00)
```

- **Fallback (5.3):** if the NCA misses the gate, the statistical forecaster (baselines + conformal, already working on embryo data) ships for forecasts and the NCA ships as the draw-tool emulator, labelled "emulator".
- Either way the scorecard and the video have real numbers. The plan never depends on the NCA winning.

## Interfaces (agreed formats; owner publishes an example file by 21:00)

| File | Owner | Used by | Contents |
|---|---|---|---|
| `data/processed/whad_curves.csv` | P1 | P2, P3 | position, part, condition, frame, t_hours, wound_frac (wound/ROI pixels), closure, source (manual/auto) |
| `data/processed/whad_masks/<position>.npz` | P1 | P2 | uint8 masks (frames x H x W), um_per_px, t_hours |
| `contracts/forecast.schema.json` + `contracts/example_forecast.json` | P1 | P2 emits, P3 reads | section 5.5 fields: wound_id, model, t_hours, area_q05/q50/q95, t50/t90 {median, q05, q95, censored_prob}, p_close_by_T, p_stall, flags, segmentation_quality, version |
| `web/public/sim/<name>.json` | P2 | P3 | agent positions per frame (or density grid per frame) + wound area per frame |
| `eval/results/scorecard_*.csv` + `eval/figures/*.png` | P1 | P3 | scorecard rows per fold, reliability plot, error vs fraction observed, worst wound |

## Shared timeline

| Time | Everyone |
|---|---|
| 20:00 | Team agrees this plan and the 6 decisions at the bottom |
| 20:45 | **Merge 1** to `main`: P1 data branch, Caden's design work. Leave the building by 21:00 |
| 21:00 | Example files for every interface exist; P2 and P3 build against them |
| 22:30 | Check-in (10 min): WHAD baseline numbers in? Simulator and NCA on track for 00:00? |
| **00:00** | **Gate.** P1 scores; decision + numbers into design.md section 16 |
| 00:30 | **Merge 2** after the gate |
| 01:00-07:00 | Staggered sleep (below); one person always awake |
| 04:00 | **Merge 3.** Demo path runs end to end on real files |
| 06:00 | **Video rough cut** from whatever exists (P3) |
| **08:00** | **Feature freeze.** Fixes, polish, README, video only |
| 09:00-11:00 | Record final video (backup recording kept) |
| 11:00 | Repo public, Devpost complete, all members added |
| **11:30** | **Submit** (last commit and video before 12:00) |
| 11:30-13:00 | Judge Q&A prep; judging 13:00-16:30 (video, then 6 min of questions) |

**Sleep (proposal):** Joanne 01:00-05:00 (fresh for video), randodeh 03:00-06:00, Caden 05:00-08:00. Swap freely, but never two asleep before 08:00.

Cut order if late (15c): LLM roles, then secondary datasets, then Zaritsky, then live upload (keep the sample fallback), then draw-tool polish.

---

## P1: randodeh (data, segmentation, baselines, scoring)

**Done already (pushed):** Zaritsky verified (14.5 min/frame, 1.24 um/px, 19 wells with masks, noisy); embryo count 62; Jin loader; 5 baselines; scoring (CRPS, coverage, bootstrap-over-wounds CI, t50/t90 error); leave-one-wound-out conformal bands (embryo coverage 0.91-0.93); related work.

| When | ID | Task | Done when |
|---|---|---|---|
| 19:45 | P1-1 Must | Get WHAD: copy Caden's `~/whad-data` subset, or start the Zenodo 12806149 download in the background | annotated 16 + 3 positions on P1's disk |
| 20:00 | P1-2 Must | Write `contracts/forecast.schema.json` + example file; agree in the 20:00 meeting | P2 and P3 say yes |
| 20:15 | P1-3 Must | Merge prep: rename to Stitch, `model/` to `nca/`, README handed to P3, resolve README conflict | merged at 20:45 |
| 21:00 | P1-4 Must | WHAD curves + masks per the interface table (drop all-zero t20; hours; part; condition) | 19 positions x 20 frames; example rows posted |
| 21:45 | P1-5 Must | WHAD baselines with the R15 splits: leave-one-wound-out (part I + II of a wound stay together), CC to C61, WHiM-BC monolayer to sphere; cut-offs 10/20/30/50% of frames; add Migliaccio power-law baseline | per-fold table, never pooled only |
| 22:45 | P1-6 Must | Conformal per 5.5: jackknife+ on the normalised max-over-horizon residual; coverage with n, Wilson CI and wound-bootstrap CI | per-fold coverage table |
| 23:30 | P1-7 Must | Make the forecast export follow the schema; generic scorer that takes any forecast JSON folder | baselines and P2's files score with one command |
| **00:00** | P1-8 Must | **Gate:** score P2's forecasts vs the best baseline; write the decision | gate row in design.md section 16 |
| 00:30 | P1-9 Must | Scorecard figures: reliability plot, error vs fraction observed, worst-wound panel, per fold | PNG + CSV in `eval/` |
| 01:30 | P1-10 Must | Package the texture segmenter (6.2) with IoU per part on annotated frames | IoU ~0.74 reproduced (part I 0.85, part II 0.62) |
| 02:15 | P1-11 Must | Upload pipeline (4.4): frames + interval + scale to mask to area curve to forecast; refusal rules (mask <1% or >70% ROI, >3 components above 5%, blank/out of focus, missing scale); 3 sample frames | samples forecast; a blank frame is refused |
| 06:00 | P1-12 Should | Flags: out-of-band, stall (flat area over a window), "measure again"; thresholds from training folds; precision/recall | thresholds recorded in design.md |
| 07:00 | P1-13 Should | Secondary results (embryo, Zaritsky) and all numbers for the README | table handed to P3 |
| 08:00+ | P1-14 Must | Answer sheet for judges: splits, coverage CI, why simple baselines are strong, failure case, what we don't claim | `docs/qa-prep.md` |
| | P1-15 Stretch | Auto-segment unannotated MCF10A (exp1 remainder + exp2); Fisher-KPP / Porous-Fisher on Jin; cached LLM triage notes | only if ahead |

## P2: Caden (cell simulator, NCA, calibration)

| When | ID | Task | Done when |
|---|---|---|---|
| 19:45 | P2-1 Must | Share WHAD subset with P1 (path or zip) | P1 has it |
| 20:00 | P2-2 Must | Cell-agent simulator (5.1b): Migliaccio rules (migrate Pm, divide Pd, contact inhibition, 7-of-9 wound bias) + density-dependent movement; division off for WHAD; one site = one cell (~20 um, check WHAD nuclei) | runs on a synthetic straight scratch |
| 21:00 | P2-3 Must | Start state from a WHAD mask (area-preserving resample) + coarse-graining to a density grid | lattice area within 2% of mask area; agent area = density area every frame |
| 21:30 | P2-4 Must | Fit Tm and bias per wound from frames up to t0; bootstrap for spread; CC and C61 presets from training folds only | fitted curves within the training wounds' observed range |
| 22:30 | P2-5 Must | NCA: density field, mass-conserving flux + non-negative source head, parameters as channels, stochastic; train on simulator output | rollout error vs simulator below the simulator's own member spread |
| 23:45 | P2-6 Must | NCA ensemble (50 members) forecasts on held-out WHAD wounds, both folds, emitted as forecast JSON | files validate against the schema; P1 scores at 00:00 |
| 00:30 | P2-7 Should | Extra scorecard rows: deterministic NCA (no ensemble) and the simulator ensemble itself, to show what the NCA adds | rows in P1's table |
| 01:00 | P2-8 Must | Draw tool engine: agent rules in JS in a Web Worker (up to ~20k agents) with CC/C61 presets | drawn wound heals at a usable frame rate in Joanne's page |
| 03:00 | P2-9 Should | NCA weights as JSON + small JS inference loop for a live band; else precomputed ensembles | Joanne shows a band from it |
| 04:00 | P2-10 Must | Precomputed playback files for the video's real run and the zoom view | files in `web/public/sim/` |
| 11:00 | P2-11 Must | Make the repo **public** (owner only), check the README renders | link works logged out |
| | P2-12 Stretch | Cross-scale check: front speed vs 2 sqrt(D r) on Jin (division on) | one figure |

## P3: Joanne (viewer, Figma, README, video)

Build from the existing HTML mockups and shared renderer (`design/shared/cellfield.js`, `ncamock.js`); deck.gl only where the zoom needs it.

| When | ID | Task | Done when |
|---|---|---|---|
| 19:45 | P3-1 Must | Team picks the starting mockup (M1-M11) at the 20:00 meeting | choice in design.md section 16 |
| 20:00 | P3-2 Must | Figma file: Draw, Upload, Forecast (curve + band + flags), Scorecard frames + a small style sheet (palette, type, honesty labels); keep it updated, it is the Figma-prize evidence | link in HACKATHON.md |
| 21:00 | P3-3 Must | Video script v1 (was due 20:00): draw tool first, then upload 3 real frames, forecast + band + flag, held-out validation, scorecard + one failure; list of footage each person must supply | `docs/video-script.md` read by team |
| 21:30 | P3-4 Must | App shell from the chosen mockup: Draw, Forecast/Upload, Scorecard tabs | builds and runs locally |
| 22:00 | P3-5 Must | Forecast view on the contract JSON (example file now, real WHAD after 00:30): observed solid, forecast dashed, 90% band, t50/t90 ranges, P(close by T), flags; colour-blind-safe | loads P1's files without edits |
| 23:30 | P3-6 Must | Draw tool UI: freehand wound, CC/C61 preset, no sliders, label "simulation, preset parameters", no band; wired to P2's worker when ready (mock until then) | a drawn wound heals |
| 05:00 | P3-7 Must | Continuous zoom: agents in, density + outline + forecast out, one time slider, same area at every zoom, "simulated cells, not tracked cells" | area readout never changes when zooming |
| 05:30 | P3-8 Must | Upload page + "try a sample" fallback (sample flow needs no backend) | sample works offline |
| **06:00** | P3-9 Must | **Video rough cut** from what exists | 2-minute draft watched by the team |
| 06:30 | P3-10 Should | Scorecard page from P1's CSV and figures | numbers match P1's tables |
| 07:00 | P3-11 Must | README (take over the draft): problem, what we built, how it works, results, datasets + licences, libraries, models/APIs, honesty notes | every Devpost field covered |
| 09:00 | P3-12 Must | Record final video (under 2:00, label anything mocked or sped up), keep a backup | uploaded |
| 10:30 | P3-13 Must | Devpost page: video, repo link, all members, how Figma was used | submitted by 11:30 |

---

## Decisions for the 20:00 meeting

1. Gate moved to **00:00** (from 19:00).
2. Video's upload run: **precomputed sample frames** (safe) or a small local Python server (live)?
3. Draw-tool engine (JS port of the agents): **Caden** (proposed).
4. Fisher-KPP / Porous-Fisher baselines move from Caden to randodeh as stretch.
5. Joanne takes over the README.
6. Starting mockup choice, and the sleep rota.
