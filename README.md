# Stitch

Early forecasts for scratch-assay wound closure, with an uncertainty band that has been checked on wounds the model never saw.

> Research prototype. Advisory only. Not a medical device. No clinical or drug-effect claims.

**Team:** Rand (data and evaluation), Caden (simulator, NCA and Adaption fine-tune), Joanne (web app, Figma design and agent layer).

## Problem

Scratch (wound-healing) assays are used across cancer migration, fibrosis, wound biology and drug screening. Today's tools (TScratch, ImageJ plugins, Incucyte) **measure** closure after it has happened, so labs spend hours to days of plate and microscope time waiting to see whether a well closes. An assay scientist has no calibrated early answer to "will this well close by the end of the run, and when?"

## What we built

- **Forecaster**: from the first few hours of a time-lapse (1 to 5 frames are enough to start), the real-data NCA forecasts the rest of the closure curve with a **90% band**, time to 50% and 90% closed with ranges, and P(closed by the end of the run).
- **Honest calibration**: every band is calibrated leave-one-wound-out, so a wound's own outcome never shapes its own forecast. On 28 unseen WHAD wounds the 90% band contains 92% of what actually happens.
- **Stall flag**: warns when a wound is unlikely to close much further (AUC 0.77-0.90, thresholds tuned on other wounds only).
- **Stop-early advice**: on held-out wounds, 82% get a call at the first check (1.9 h); 91% of those calls are right, against 75% for always saying "won't close". Every early call is "won't reach 90% closure by 19 h"; we never confidently call early closure.
- **Upload pipeline**: frames + frame interval + pixel size -> wound masks (texture segmenter) -> forecast. Refuses blank, out-of-focus or badly segmented frames, with the reason.
- **Cell-level model**: a cell-agent simulator and a neural cellular automaton (NCA) that emulates it, for the draw-a-wound view and a continuous zoom from cells to the whole wound (simulated cells, labelled as such). Fine-tuned on real WHAD frames, the NCA now matches the statistical forecaster (see Results).
- **Viewer** (`web/`): one page with three modes. **Assay** plays a recorded agent run on a wound: 3D simulated-cell field, closure curve with its 90% band, decision card with approve / reject, and the agent's summary. **Ops** shows the run log step by step, the agent scoreboard, the adversarial test results and the forecast evidence (scorecard, calibration, stall flag, failure case). **Draw** lets you draw a wound and watch simulated cells heal it under a fitted preset (no band, no forecast claim). Designed in Figma: [Stitch-UI](https://www.figma.com/design/vTCApH2oLBShNu4Oi9dsGg).
- **Agent layer** (`agent/`): at each check, code runs QC, the forecast, the stall flag and the stop-early advice; policy code lists the allowed decisions; Claude picks one and explains it; every number it writes is checked against the tool outputs (100% traced); stopping a plate needs a human. A Reporter writes a short summary per run, and an Intake helper reads the protocol text (frame interval, pixel size, condition). The plate-hour gain comes from the forecaster and the policy; the model chooses among allowed options and explains them. See `agent/README.md`.

## How it works

1. **Data -> curves.** Wound masks (authors' or our texture segmenter) give wound area per frame, relative to the first frame.
2. **Forecast.** The shipped forecaster is a neural cellular automaton (NCA) fine-tuned on real WHAD frames: per-wound speed parameters are fitted from the uploaded frames, then 50 stochastic rollouts from three models. A constant-edge-speed model (2 parameters) is the automatic fallback, and the baseline every model is scored against.
3. **Calibrate.** For each wound, the forecast errors of all *other* wounds are added to its forecast to form an ensemble; its quantiles are the 90% band (leave-one-wound-out conformal). Times to 50%/90% closure use the same idea on time ratios.
4. **Flag and advise.** Stall probability from the calibrated ensemble; stop-early advice from P(90% closed by 19 h).
5. **Cell layer.** A lattice cell-agent simulator (Migliaccio et al. 2023 rules plus density-dependent movement) is fitted to each wound's early frames; a mass-conserving NCA trained on 3000 simulator runs emulates it fast enough for the browser.

Every model, baseline and NCA alike, writes the same forecast file format (`contracts/forecast.schema.json`) and is scored by the same code (`eval/score_forecasts.py`).

## Results

Full tables, every split and cut-off: [`docs/results.md`](docs/results.md). Headline, unseen WHAD wounds, forecasting from the first 3.8 h of a 19 h series:

| Forecaster | Quantile score (lower is better) | 90% band coverage |
|---|---|---|
| **Edge speed + calibration** | **0.0386** | 0.92 |
| **NCA fine-tuned on real WHAD frames + calibration** | **0.0397** (+3%; best of all models at 1.9 h and 9.5 h) | 0.92 |
| NCA trained on the simulator only + calibration | 0.0502 (+30%, fails) | 0.93 |
| Typical-wound curve | 0.0732 | 0.93 |

![Calibration](eval/figures/calibration.png)

- **Training on real frames is what made the NCA competitive.** Trained only on simulator output it failed our pre-set gate (30% worse than edge speed at 3.8 h). Fine-tuned on real WHAD frames, with 4 wound-level folds so every wound is forecast by a model that never trained on it, it passes every cut-off on unseen wounds and is the best model of all at the earliest (1.9 h) and latest (9.5 h) cut-offs. Adding Zaritsky wells made it worse. On a held-out condition (control to CYR61 knockdown) its band under-covered when calibrated on controls only; calibrating on all other known conditions fixes the late cut-offs, and uploads of an uncalibrated condition get a widened band and a flag.
- **Calibration does not transfer across cell types**: bands calibrated on ordinary MCF-7 cells cover only 15-58% of cancer-stem-cell wells, which close about twice as fast. Bands must be calibrated per cell line.
- **No "measure again" flag**: no signal we tried, including the NCA's own ensemble spread, predicts which forecasts will go wrong consistently (AUC 0.61-0.72, varying by cut-off), so we don't ship one.
- **Small data**: 28 WHAD wounds (9 with manual masks); coverage CIs are about +/-0.05 to +/-0.15.

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

## Run the app

```bash
python3 -m http.server 8010 --bind 127.0.0.1    # from the repo root
# open http://127.0.0.1:8010/web/index.html
```

No keys and no build step. Assay plays the recorded agent runs in `agent/runs/` and the samples; Upload runs the segmenter and an edge-speed forecast in the browser (the NCA forecast needs `python -I data/upload.py`). Ops shows the run log, scoreboard and forecast evidence. Draw runs the cell simulator live. three.js loads from a CDN; offline, everything but the 3D field still works.

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

numpy, scipy, pandas, matplotlib, tifffile, Pillow, jsonschema, PyTorch (NCA), anthropic (agent model calls), transformers + peft (optional, to run the Intake fine-tune locally), pytest. Web: three.js 0.170 (plain ES modules, no build step).

## Models / APIs

- Statistical baselines and conformal calibration: our code (`eval/`).
- Cell-agent simulator and NCA: our code (`sim/`, `nca/`), PyTorch on CPU.
- Claude (Anthropic) was used as a coding assistant.
- In the product, Claude (Opus 5.5) is the agent's model: it chooses among the decisions the policy code allows, explains them, writes the end-of-run summary and, without the fine-tune, reads protocol text. It never produces a number that the Critic cannot trace to a tool output, and it never raises or clears a flag. Demo runs are recorded once and played back, so viewing needs no key.
- Adaption: a small model (Qwen 3.5 0.8B) fine-tuned on our Intake task (protocol text to settings); see `data/adaption/` (win rate not yet reported).

## Honesty notes

- Simulated cells are labelled "simulated, not tracked".
- Wound-closure curves cannot separate cell migration from division; we do not claim to.
- All results are on recorded public data; nothing here has been tested in a lab.
