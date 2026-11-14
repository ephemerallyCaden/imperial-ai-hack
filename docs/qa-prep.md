# Judge Q&A prep (6 minutes of questions after the video)

Short answers to say out loud, with the number behind each. Numbers come from `docs/results.md` (regenerated from code); if they change, update here. Marks: rigour 30, execution 25, path to the lab 20, novelty 15, video + answers 10.

## The 20-second answer to "what did you build?"
Stitch forecasts the rest of a scratch-assay wound from its first few hours, with a 90% band that really holds about 90% of the time on wounds it has never seen. An assay scientist uploads 1 to 5 frames and gets a closure curve, time to 50% / 90% closed, and a stall warning. It is a research prototype, advisory only.

## Scientific rigour (30)

**How do you know the 90% band is honest?**
Every band is leave-one-wound-out: a wound's own outcome never calibrates its own forecast. On 27 unseen WHAD wounds (55 series), 92% of future points fall inside the band (95% CI 0.88-0.96, bootstrap over wounds). Same on 24 WHiM-BC wells (0.91), 62 fly-embryo wounds (0.92), 19 Zaritsky wells (0.89).

**What are you comparing against?**
Five simple forecasters, all with the same calibration: no-change, linear, constant edge speed, logistic, Gompertz. Scored with a quantile score (a CRPS approximation from the 5/50/95% quantiles), coverage, band width, time-to-50/90% in-range, and a Brier score for "90% closed by 19 h".

**Which wins?**
On WHAD, constant edge speed (wound edge moving at a fixed speed, 2 parameters): quantile score 0.0386 vs 0.0732 for the typical-wound curve at 3.8 h of history. More history helps every model.

**Did you hold out anything harder than random wounds?**
Two held-out conditions. WHAD control to CYR61 knockdown: coverage 0.92 at 3.8 h, but only 0.78 at 1.9 h. WHiM-BC ordinary to stem-cell-enriched cells: it fails, 15-58% coverage. Stem-cell wounds close about twice as fast, so bands calibrated on ordinary cells do not transfer. We report that as a limit.

**Why is WHAD 9 / 28 wounds, not 16 / 104?**
We found WHAD "part II" is the same wounds as part I filmed later (same position ids, files named PartI_plus4, masks overlap with IoU 0.82-0.90). Splitting by part would test on wounds the model trained on, so we split by physical wound. 9 wounds have the authors' masks; we auto-segmented 22 more (our segmenter: IoU 0.84 part I / 0.60 part II vs manual masks, 1.8 points of wound-area error) and report manual-only results too (coverage 0.87).

**Is n big enough?**
Small. Coverage CIs are about +/-0.05 to +/-0.15. That is why we bootstrap over wounds, not frames (frames of one wound are correlated), and show the CI next to every coverage number.

**What doesn't work?**
- Calibration does not transfer to a faster-closing cell type (above).
- We tried three "measure again" signals (band width, fit error, stall ambiguity): AUC 0.61-0.72 and inconsistent across cut-offs, even using the NCA's own ensemble spread, so we do not ship that flag.
- "Two frames outside the band" does not predict a forecast going off-track.
- Time to 90% closed is often beyond the 19 h series, so many t90 ranges are open-ended.

**Why should I trust the stall flag?**
Thresholds are tuned leave-one-wound-out. AUC 0.77-0.90 across cut-offs; at 3.8 h it is right 57% of the time it fires and catches 62% of real stalls (13 stalls in 55 series).

**How did you pick the cut-offs?**
After 1.9, 3.8, 5.7 and 9.5 hours (10/20/30/50% of the 19 h series). Every WHAD series has the same hourly frames, so a fixed time cannot leak the outcome. On the embryo and Zaritsky sets series end near closure, so there we use fixed fractions of the median closure time instead.

## Technical execution (25)

**What's the pipeline?**
Frames -> texture segmenter (wound = low-texture region) -> wound area curve -> forecaster -> conformal band -> flags -> forecast file in a fixed JSON schema that the viewer reads. Bad inputs are refused: blank, out of focus (texture score < 1.0; real WHAD frames are >= 1.10), wound < 1% or > 70% of the field, more than 3 large wound regions, or no scale / interval.

**What does the NCA add?** (gate results, design.md R18 and R26)
"Trained only on our simulator, it failed our pre-set gate. Fine-tuned on real WHAD frames, with 4 wound-level folds so no wound is forecast by a model that trained on it, it passes 9 of 12 checks: at 3.8 h its quantile score is 0.0403 vs 0.0386 for edge speed (within 4%), and at 9.5 h it is the best model we have. Training on real data was the difference. Adding a second dataset (Zaritsky) made it worse, so we didn't."
_Earlier answer (simulator-only NCA):_
"Our neural cellular automaton is trained on our cell-agent simulator and given the same leave-one-wound-out calibration as the baselines. At 3.8 h it is 29% worse than the 2-parameter edge-speed model (quantile score 0.0495 vs 0.0385), so by our own pre-set gate the statistical forecaster ships. The NCA catches up with more history: by 9.5 h it ties or beats every baseline on all three splits. It matches the simulator within 7% everywhere, so its value is speed: it is the fast emulator behind the draw-a-wound tool, labelled as an emulator."
**Why not just trust the NCA's own spread?** "Uncalibrated, its 90% band covers 14% of what happens (the simulator's 21%): member spread is too small. The same conformal step brings both to 93%."

**Is anything live?**
Upload works end to end in Python; the web "try a sample" flow uses precomputed outputs of the same pipeline (labelled). The draw tool is a simulation with preset parameters, not a forecast, and shows no band.

**Reproducible?**
Yes: `data/fetch.py` downloads the public data, `data/build_*.py` builds the curves, `eval/forecast_baselines.py` and `eval/score_forecasts.py` produce every number, `eval/results_table.py` writes the tables.

## Model questions (from Caden, full answers in `docs/p2-results.md`)

**Why simulate cells at all if a curve fit wins?**
The simulator turns any wound shape into a mechanistic forecast, trains the NCA, and powers the draw tool. On area alone simple curves are strong; with more history (9.5 h) the simulator matches or beats them.

**Do control (CC) and CYR61 knockdown (C61) heal differently?**
Not clearly. C61 looks slower in normalised area, but mostly because its wounds start larger; absolute closure (1.01 vs 1.19% of field per hour) and fitted migration times (0.48 vs 0.50 h) overlap. The big effect is time (part I barely closes), not condition.

**Is cell division modelled?**
Off for WHAD: the 19 h assay is treated as migration-dominated (Migliaccio's Phi check). We have not verified it on WHAD separately, so we don't claim it.

**What does the fitted migration time Tm mean?**
It ranks wounds (part II 0.14-0.65 h vs part I 0.4-5 h) but depends on the imaged field size under our rules, so it is not a measured migration time.

## Path to the lab (20)

**Who uses this and what changes for them?**
An assay scientist running scratch assays. Today tools (TScratch, ImageJ plugins, Incucyte) measure closure after it happens. Stitch says early, with a calibrated range, whether a well will close by the end of the run, and flags wells likely to stall, so they can stop, extend, or repeat a plate sooner.

**What would you need to deploy it?**
Calibration data from their own microscope and cell line: our results show bands do not transfer across cell types. A few dozen wells per condition is enough to calibrate (we used 28 wounds).

**Could a lab actually stop plates early?** (simulation on recorded WHAD data, not a lab trial)
"With a call rule fixed in advance, 82% of held-out wounds get a call at the first check, 1.9 h in. 91% of those calls are right (95% with the real-data NCA), against 75% for always saying the wound won't close. Every early call is 'won't reach 90% closure by 19 h', so the honest use is spotting plates that won't close in this run. We never confidently call early closure, and 4 of 45 calls were wrong: wounds that did close."

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
| Best forecaster on WHAD at 3.8 h | constant edge speed, quantile score 0.0386 |
| Held-out condition, stem cells | 0.15-0.58 coverage: fails |
| Stall flag | AUC 0.77-0.90 |
| Segmenter | IoU 0.84 / 0.60, area error ~1.8 points |
| Data | 28 WHAD wounds (9 manual), 24 WHiM-BC, 62 embryo, 19 Zaritsky |
| NCA at 3.8 h | sim-only 0.0499 (fails); real-data fine-tune 0.0403 vs 0.0386 (passes, 9/12); best at 9.5 h |
| Stop early | 82% called at 1.9 h, 91% right (95% real-data NCA) vs 75% always-no; only "won't close" calls |
