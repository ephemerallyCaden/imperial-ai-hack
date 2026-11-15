# Stitch

Early forecasts for scratch-assay wound closure, with an uncertainty band that has been checked on wounds the model never saw.

> Research prototype. Advisory only. Not a medical device. No clinical or drug-effect claims.

## Problem

Scratch (wound-healing) assays are used across cancer migration, fibrosis, wound biology and drug screening. Today's tools (TScratch, ImageJ plugins, Incucyte) **measure** closure after it has happened, so labs spend hours to days of plate and microscope time waiting to see whether a well closes. An assay scientist has no calibrated early answer to "will this well close by the end of the run, and when?"

## What we built

- **Forecaster**: from the first few hours of a time-lapse (1 to 5 frames are enough to start), Stitch forecasts the rest of the closure curve with a **90% band**, time to 50% and 90% closed with ranges, and P(closed by the end of the run).
- **Honest calibration**: every band is calibrated leave-one-wound-out, so a wound's own outcome never shapes its own forecast. On 27 unseen WHAD wounds the 90% band contains 92% of what actually happens.
- **Stall flag**: warns when a wound is unlikely to close much further (AUC 0.78-0.90, thresholds tuned on other wounds only).
- **Stop-early advice**: on held-out wounds, 82% get a call at the first check (1.9 h); 91% of those calls are right, against 75% for always saying "won't close". Every early call is "won't reach 90% closure by 19 h"; we never confidently call early closure.
- **Upload pipeline**: frames + frame interval + pixel size -> wound masks (texture segmenter) -> forecast. Refuses blank, out-of-focus or badly segmented frames, with the reason.
- **Cell-level model**: a cell-agent simulator and a neural cellular automaton (NCA) that emulates it, for the draw-a-wound view and a continuous zoom from cells to the whole wound (simulated cells, labelled as such). Fine-tuned on real WHAD frames, the NCA now matches the statistical forecaster (see Results).
- **Viewer**: _TODO (Joanne): draw tool, forecast view, upload screen, scorecard page, Figma link._

## How it works

1. **Data -> curves.** Wound masks (authors' or our texture segmenter) give wound area per frame, relative to the first frame.
2. **Forecast.** The shipped forecaster is a constant-edge-speed model (the wound edge moves at a fitted speed: 2 parameters), chosen because it beat every alternative on held-out wounds at early cut-offs.
3. **Calibrate.** For each wound, the forecast errors of all *other* wounds are added to its forecast to form an ensemble; its quantiles are the 90% band (leave-one-wound-out conformal). Times to 50%/90% closure use the same idea on time ratios.
4. **Flag and advise.** Stall probability from the calibrated ensemble; stop-early advice from P(90% closed by 19 h).
5. **Cell layer.** A lattice cell-agent simulator (Migliaccio et al. 2023 rules plus density-dependent movement) is fitted to each wound's early frames; a mass-conserving NCA trained on 3000 simulator runs emulates it fast enough for the browser.

Every model, baseline and NCA alike, writes the same forecast file format (`contracts/forecast.schema.json`) and is scored by the same code (`eval/score_forecasts.py`).

## Results

Full tables, every split and cut-off: [`docs/results.md`](docs/results.md). Headline, unseen WHAD wounds, forecasting from the first 3.8 h of a 19 h series:

| Forecaster | Quantile score (lower is better) | 90% band coverage |
|---|---|---|
| **Edge speed + calibration** | **0.0386** | 0.92 |
| **NCA fine-tuned on real WHAD frames + calibration** | **0.0403** (+4%, passes the gate) | 0.93 |
| NCA trained on the simulator only + calibration | 0.0499 (+29%, fails) | 0.93 |
| Typical-wound curve | 0.0732 | 0.92 |

![Calibration](eval/figures/calibration.png)

- **Training on real frames is what made the NCA competitive.** Trained only on simulator output it failed our pre-set gate (29% worse than edge speed at 3.8 h). Fine-tuned on real WHAD frames, with 4 wound-level folds so every wound is forecast by a model that never trained on it, it passes 9 of 12 checks and every cut-off on unseen wounds, and is the best model of all at 9.5 h. Adding Zaritsky wells made it worse. It still under-covers the held-out condition (control to CYR61 knockdown) at the earliest and latest cut-offs.
- **Calibration does not transfer across cell types**: bands calibrated on ordinary MCF-7 cells cover only 15-58% of cancer-stem-cell wells, which close about twice as fast. Bands must be calibrated per cell line.
- **No "measure again" flag**: no signal we tried, including the NCA's own ensemble spread, predicts which forecasts will go wrong consistently (AUC 0.61-0.72, varying by cut-off), so we don't ship one.
- **Small data**: 27 WHAD wounds (9 with manual masks); coverage CIs are about +/-0.05 to +/-0.15.

## Datasets

| Dataset | Licence | Use |
|---|---|---|
| WHAD (Iheme et al. 2024), Zenodo [10.5281/zenodo.12806149](https://doi.org/10.5281/zenodo.12806149) | CC BY 4.0 | Main benchmark: MCF10A scratch assays, 9 wounds with manual masks + 22 auto-segmented |
| WHiM-BC (Garcia-Moreno et al. 2024), Zenodo [10.5281/zenodo.8131123](https://doi.org/10.5281/zenodo.8131123) | CC BY 4.0 | MCF-7 monolayer (12) vs cancer-stem-cell sphere (12) wells, held-out condition |
| Zaritsky et al. 2015, *GigaScience* 4:8, GigaDB [10.5524/100118](https://doi.org/10.5524/100118) | CC0 | Scratch-assay curves (DA3, MDCK); extra NCA fine-tuning data |
| Drosophila embryo laser wounds, Zenodo [10.5281/zenodo.7660424](https://doi.org/10.5281/zenodo.7660424) | CC BY 4.0 | Secondary calibration check (62 wounds) |
| Jin et al. 2016 PC-3 density profiles, via [jlager/BINNs](https://github.com/jlager/BINNs) | not stated; cited, not re-hosted | Simulator priors |

Derived curves in `data/processed/` are redistributed under each source's licence with attribution above. Raw data is downloaded by `data/fetch.py` and never committed.

## Repo layout

```
data/       fetch.py, build_*.py (raw -> curves), segment.py (texture segmenter), upload.py (upload pipeline)
contracts/  forecast.schema.json + validate.py (the forecast file format every model writes)
eval/       baselines, conformal forecasts, scorer, flags, scheduler, figures, results tables
sim/        cell-agent simulator, fits, JS engine
nca/        neural cellular automaton: model, training, real-data fine-tuning, gate forecasts
web/        viewer (data in web/data)
docs/       design doc, decisions, results, Q&A prep, related work
```

## Reproduce

```bash
pip install -r requirements.txt
export CLOSURECALL_DATA=/path/outside/repo      # raw data, ~4 GB
python data/fetch.py
python -I data/build_curves.py && python -I data/build_whad.py && python -I data/build_whad_auto.py && python -I data/build_whimbc.py
python eval/forecast_baselines.py                # calibrated baseline forecasts
python eval/score_forecasts.py eval/forecasts    # scorecard
python eval/flags.py && python eval/scheduler.py && python eval/results_table.py && python eval/figures.py
python -m pytest -q tests/                       # fast checks, no raw data needed
```

## Open-source libraries

numpy, scipy, pandas, matplotlib, tifffile, Pillow, jsonschema, PyTorch (NCA). _TODO (Joanne): add web libraries._

## Models / APIs

- Statistical baselines and conformal calibration: our code (`eval/`).
- Cell-agent simulator and NCA: our code (`sim/`, `nca/`), PyTorch on CPU.
- Claude (Anthropic) was used as a coding assistant. _TODO: list any LLM use in the product (e.g. cached assay-intake notes), or "none"._

## Honesty notes

- Simulated cells are labelled "simulated, not tracked".
- Wound-closure curves cannot separate cell migration from division; we do not claim to.
- All results are on recorded public data; nothing here has been tested in a lab.
