# Video assets: held-out validation + scorecard (P1 → P3)

For the part of the 2-minute video after the upload demo (design.md section 8: "held-out validation, then the scorecard with one failure case"). About **30-35 seconds**. All figures are 1920x1080 in `eval/figures/video/` (regenerate: `python eval/video_figures.py`). Numbers trace to `docs/results.md`.

The example wound (`exp1_partII_CC_P2`, a WHAD control wound) is the same wound as the "try a sample" upload in `web/data/samples/`, so the video can follow one wound from upload to validation.

| # | Seconds | Show | Say (suggested, about 2.5 words per second) |
|---|---|---|---|
| 1 | 5 | `1_forecast.png` | "Here's a wound the model has never seen. After 3.8 hours, Stitch forecasts the rest, with a 90% band." |
| 2 | 5 | `2_reveal.png` (cut or fade from 1) | "Here's what actually happened: inside the band at 15 of 16 later frames." |
| 3 | 8 | `3_scorecard.png` | "Across 27 unseen wounds, a simple edge-speed model is hard to beat. Our neural cellular automaton, trained only on simulation, failed our pre-set test. Fine-tuned on real frames, it matches it, and beats it at the earliest forecast." |
| 4 | 7 | `4_calibration.png` | "The band is honest: about 90% on new wounds and a new condition. But not on a new cell type: 58%. So Stitch must be calibrated per cell line, and we say so." |
| 5 | 6 | `5_failure.png` | "And here's where it fails: a wound that's slow at first, then suddenly speeds up." |

## On-screen labels (honesty rules, design.md section 11)
- Every figure is real held-out data: no label needed beyond the titles already in the figures.
- If the video shows NCA output elsewhere, label it "model forecast"; simulated cells are labelled "simulated, not tracked".
- Do not say "first", "clinical", "predicts drug effects", or "separates migration from division".

## Numbers you may want in captions
| Claim | Number | Source |
|---|---|---|
| Band holds on unseen wounds | 92% (target 90%) | results.md, headline |
| Edge speed vs fine-tuned NCA (v3) | 3.8 h: 0.0386 vs 0.0397 (+3%); 1.9 h: 0.0562 vs 0.0530 (NCA better) | results.md, gate table |
| Simulator-only NCA | 0.0499 (+29%, failed) | results.md, gate table |
| New cell type | 58% coverage | results.md, calibration |
| Stop-early calls | 82% called at 1.9 h, 91% right (95% with real-data NCA) vs 75% always-no | results.md, stop early |
| Stall flag | AUC 0.77-0.90 | results.md, flags |
