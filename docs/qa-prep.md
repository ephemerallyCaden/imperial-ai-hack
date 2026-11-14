# Judge Q&A prep (6 minutes of questions after the video)

Short answers to say out loud, with the number behind each. Numbers come from `docs/results.md` (regenerated from code); if they change, update here. Marks: rigour 30, execution 25, path to the lab 20, novelty 15, video + answers 10.

## The 20-second answer to "what did you build?"
Stitch forecasts the rest of a scratch-assay wound from its first few hours, with a 90% band that really holds about 90% of the time on wounds it has never seen. An assay scientist uploads 1 to 5 frames and gets a closure curve, time to 50% / 90% closed, and a stall warning. It is a research prototype, advisory only.

## Scientific rigour (30)

**How do you know the 90% band is honest?**
Every band is leave-one-wound-out: a wound's own outcome never calibrates its own forecast. On 28 unseen WHAD wounds (56 series), 92% of future points fall inside the band (95% CI 0.88-0.96, bootstrap over wounds). Same on 24 WHiM-BC wells (0.91), 62 fly-embryo wounds (0.92), 19 Zaritsky wells (0.89).

**What are you comparing against?**
Five simple forecasters, all with the same calibration: no-change, linear, constant edge speed, logistic, Gompertz. Scored with a quantile score (a CRPS approximation from the 5/50/95% quantiles), coverage, band width, time-to-50/90% in-range, and a Brier score for "90% closed by 19 h".

**Which wins?**
On WHAD, constant edge speed (wound edge moving at a fixed speed, 2 parameters): quantile score 0.0352 vs 0.0644 for the typical-wound curve at 4 h of history. More history helps every model.

**Did you hold out anything harder than random wounds?**
Two held-out conditions. WHAD control to CYR61 knockdown: coverage 0.87-0.91 at 2-4 h, dipping to 0.79 at 6 h. WHiM-BC ordinary to stem-cell-enriched cells: it fails, 15-58% coverage. Stem-cell wounds close about twice as fast, so bands calibrated on ordinary cells do not transfer. We report that as a limit.

**Why is WHAD 9 / 28 wounds, not 16 / 104?**
We found WHAD "part II" is the same wounds as part I filmed later (same position ids, files named PartI_plus4, masks overlap with IoU 0.82-0.90). Splitting by part would test on wounds the model trained on, so we split by physical wound. 9 wounds have the authors' masks; we auto-segmented 22 more (our segmenter: IoU 0.84 part I / 0.60 part II vs manual masks, 1.8 points of wound-area error) and report manual-only results too (coverage 0.87).

**Is n big enough?**
Small. Coverage CIs are about +/-0.05 to +/-0.15. That is why we bootstrap over wounds, not frames (frames of one wound are correlated), and show the CI next to every coverage number.

**What doesn't work?**
- Calibration does not transfer to a faster-closing cell type (above).
- We tried three "measure again" signals (band width, fit error, stall ambiguity): AUC 0.46-0.73, inconsistent across cut-offs and chosen on the same data, so we do not ship that flag.
- "Two frames outside the band" does not predict a forecast going off-track.
- Time to 90% closed is often beyond the 19 h series, so many t90 ranges are open-ended.

**Why should I trust the stall flag?**
Thresholds are tuned leave-one-wound-out. AUC 0.79-0.89 across cut-offs; at 4 h it is right 62% of the time it fires and catches 77% of real stalls (13 stalls in 55 series).

**How did you pick the cut-offs?**
After 2, 4, 6 and 10 hours. Every WHAD series has the same hourly frames, so a fixed time cannot leak the outcome. On the embryo and Zaritsky sets series end near closure, so there we use fixed fractions of the median closure time instead.

## Technical execution (25)

**What's the pipeline?**
Frames -> texture segmenter (wound = low-texture region) -> wound area curve -> forecaster -> conformal band -> flags -> forecast file in a fixed JSON schema that the viewer reads. Bad inputs are refused: blank, out of focus (texture score < 1.0; real WHAD frames are >= 1.10), wound < 1% or > 70% of the field, more than 3 large wound regions, or no scale / interval.

**What does the NCA add?** (fill in after the 00:00 gate)
- If it passed: "Our neural cellular automaton ensemble, trained on our cell-agent simulator, matched the best baseline within 10% on quantile score with coverage between 85% and 95%, so it ships as the forecaster and also powers the draw tool."
- If it did not: "It did not beat a 2-parameter edge-speed model on 28 wounds, so the statistical forecaster ships and the NCA runs the draw-a-wound simulation, labelled as an emulator. We say so in the scorecard."

**Is anything live?**
Upload works end to end in Python; the web "try a sample" flow uses precomputed outputs of the same pipeline (labelled). The draw tool is a simulation with preset parameters, not a forecast, and shows no band.

**Reproducible?**
Yes: `data/fetch.py` downloads the public data, `data/build_*.py` builds the curves, `eval/forecast_baselines.py` and `eval/score_forecasts.py` produce every number, `eval/results_table.py` writes the tables.

## Path to the lab (20)

**Who uses this and what changes for them?**
An assay scientist running scratch assays. Today tools (TScratch, ImageJ plugins, Incucyte) measure closure after it happens. Stitch says early, with a calibrated range, whether a well will close by the end of the run, and flags wells likely to stall, so they can stop, extend, or repeat a plate sooner.

**What would you need to deploy it?**
Calibration data from their own microscope and cell line: our results show bands do not transfer across cell types. A few dozen wells per condition is enough to calibrate (we used 28 wounds).

**Clinical use?**
Not claimed. Clinics use a similar early rule for chronic wounds (about 50% area reduction at 4 weeks); large EHR studies predict non-healing with AUC ~0.85-0.90. We have no clinical data, so that is a future direction only.

## Novelty (15)

**Hasn't this been done?**
- Cai et al. 2025 (WHAD): segmentation and group-average closure curves, no held-out forecast, no uncertainty.
- Garcia-Moreno et al. 2024 (WHiM-BC, PWPF): deep-learning wound-progress prediction, no calibrated coverage on unseen wells that we found.
- Nardini & Gevertz 2026: PDE vs agent models on Jin PC-3 data, population level, scored by final-time error.
- NCA work on regeneration uses synthetic patterns only.
Our contribution: per-wound early forecasts with uncertainty checked on unseen wounds and held-out conditions, plus an honest scorecard against simple baselines. Do not say "first"; say "we did not find".

## Don't say
- "Predicts drug effects" or anything clinical.
- "The simulated cells are real cells" (they are labelled "simulated, not tracked").
- "First ever".
- "Identifies migration vs proliferation" (closure curves cannot separate them; WHAD wounds are mitomycin-treated).

## Numbers to remember
| | |
|---|---|
| Coverage on unseen WHAD wounds | 0.92 (0.88-0.96), target 0.90 |
| Best forecaster on WHAD at 4 h | constant edge speed, quantile score 0.0352 |
| Held-out condition, stem cells | 0.15-0.58 coverage: fails |
| Stall flag | AUC 0.79-0.89 |
| Segmenter | IoU 0.84 / 0.60, area error ~1.8 points |
| Data | 28 WHAD wounds (9 manual), 24 WHiM-BC, 62 embryo, 19 Zaritsky |
