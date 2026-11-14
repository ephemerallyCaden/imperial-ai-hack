# Stitch: design doc (single source of truth)

Status: v1, 14 Nov 2026. Owner: team lead. Rule: this file holds ONLY what is decided. Everything else is in section 15 (OPEN) or in research notes (`docs/research-report.md`, `docs/wound-plan.md`, `docs/papers/reading-notes.md`), which are background and do not override this file. Tags: [D] decided by the user; [F] verified fact; [DER] derived from a [D] and a [F] (confirm if wrong). Change a decision by editing here and adding a line to section 16.

## 1. Goal
- [D] Build **Stitch**, the headline product: an early wound-closure forecaster with calibrated uncertainty, stall / "measure again" flags and a scorecard against simple baselines. (Name "for now"; user may rename.)
- [D] Named user in the video's first 15 s: an **assay scientist** deciding whether to stop, extend or repeat a scratch/wound-assay plate. Clinical use is a "later" slide only.
- [D] Track: **AI for Science**. Extra prize: **Figma** (design). Reply "AI on Campus" dropped. No Boltz bounty (see 15).
- [D] Demo feature: **draw a wound on screen and watch it heal**, with a **continuous zoom** from individual (simulated) cells to the whole wound.
- Non-goals [D/DER]: clinical claims, drug-effect prediction, claims that simulated cells are observed cells, a proliferation-vs-movement inference feature.

## 2. Event constraints [F]
- Teams 1 to 4 students; one track; up to 2 bounties from own track; Figma and Adaption prizes open to every track and do not count toward the 2 (show how Figma was used in the presentation).
- Building starts 12:10 Sat 14 Nov; pre-existing projects not eligible; building closes 21:00 Sat, reopens 10:00 Sun; **submissions close 12:00 sharp Sun 15 Nov**; video and last commit must be before 12:00.
- Deliverables: Devpost project with public GitHub repo + demo video up to 2 minutes.
- Judging Sun 13:00 to 16:30, 10-minute slot: video, then 6 min judge questions; no slides, no live demo. AI for Science judged in Blackett LT3. Finals on main stage 17:00; prizes 17:30.
- AI for Science marks (0 to 3 each, weighted): scientific rigour 30, technical execution 25, path to the lab 20, novelty 15, video and answers 10.
- Prize verification afterwards: public repo, last commit before 12:00. Contact: aisociety@imperial.ac.uk. Source: `docs/event-rules.md`.

## 3. Team and roles [D]
- 3 people. P1 data + segmentation + baselines + scoring. P2 cell simulator + NCA + calibration. P3 viewer + Figma + README + 2-minute video.
- Names: OPEN (assign in 15).

## 4. Product spec
### 4.1 Forecaster outputs per wound [DER from section 1]
- Forecast closure curve with a calibrated 90% band; time to 50% and 90% closure with intervals; P(closes by T); stall probability; "uncertain, measure again" flag (wide/disagreeing ensemble); out-of-band flag (observed leaves its band).
- Input: wound size/mask series up to a cutoff t0 (frames or CSV of relative wound area) + condition label.
- Scorecard page: model vs baselines on held-out wounds; failures shown.
### 4.2 Draw tool [D]
- User draws a freehand empty region on a confluent monolayer; simulation heals it; **no sliders**; controls = **wound shape + cell line/condition preset** only.
- [D] Presets shipped: **MCF10A control (CC) and CYR61 shRNA (C61)**, calibrated from WHAD with division OFF (mitomycin-treated assays). Everything else (other WHAD conditions, a Jin PC-3 division-ON preset) is stretch.
### 4.3 Viewer [D]
- **One continuous zoom** (no scene switch): zoomed in shows **simulated cells**; zoomed out shows density/wound outline and the forecast with its band. All levels derive from the same state; wound area is identical at every zoom; one time slider.
- [D, R11] **Tissue rendering style:** organic irregular cells, **no outlines anywhere on the grid, no hexagons**, and smooth colour gradients between states instead of hard thresholds (leading edge = soft shaded band, new tissue = gradient with fading speckle, wound = smooth gradient darkest at the centre, dividing = pale cell with two small nuclei). State rules and non-colour cues are unchanged except the leading-edge cue (shaded band instead of an outline).
- Honesty labels [D from earlier + DER]: "simulated cells, not tracked cells"; observed vs predicted visually distinct; ensemble disagreement shown as separate trajectories; colour-blind-safe palette; keyboard zoom.
- [D, revised R13] The zoomed-in viewer is fully simulated. Real WHAD frames appear in the video's validation segment and in the upload flow (4.4), where they are shown as observed (never as simulated cells).
- [D, R11] **Tissue tone switcher ships** (light / medium / deep): a display setting that re-themes the tissue colours only (state rules and cues unchanged); it is not part of the draw tool's controls (shape + preset). This reverses the earlier 'range in mockups only' choice. Colours are illustrative, not clinically calibrated; say so in the UI help.

### 4.4 Upload your own frames [D, R13; core-lite]
- Input: 1 to 5 uploaded frames (PNG/JPG/TIFF) plus frame interval and pixel scale (from the assay intake in 9b, or typed). Scope stated in the UI: phase-contrast scratch assays like WHAD (MCF10A); other microscopes or cell types are unsupported and the tool says so.
- Pipeline (deterministic, no LLM on pixels): classical texture segmenter gives the wound mask and area; the mask is the starting state of the cell-agent simulation and the NCA; the forecaster returns the closure curve with its 90% band, flags and the anomaly triage of 9b. More frames narrow the band (measured closure rate).
- A segmentation quality check (mask area vs obvious failure, blank or out-of-focus frame) must refuse or flag rather than forecast from a bad mask.
- Fallback if live processing is fragile: ship the same flow with precomputed sample frames ("try a sample") and keep the upload control. Must not delay the 19:00 forecaster gate.

## 5. Models
### 5.1 Source of truth [D]
- **Cell agents are the truth.** A simple cell-agent simulation holds cell positions and gives density and wound outline at every zoom.
- The density-field **NCA emulates the agents** (trained on their coarse-grained output) and gives fast ensemble forecasts and bands.
### 5.1b Adopted from Migliaccio et al. 2023 (Cancers 15:5284; PMID 37958456) [D, R9]
- **Cell-agent rules**: reimplement their 2D lattice rules for P2's cell-agent layer, cited: each step a cell migrates with Pm = (1/Tm)/(1/Tm+1/Td) or proliferates with Pd = (1/Td)/(1/Tm+1/Td); Tm = delta^2/D; quiescent (contact inhibition) when no empty neighbour; wound-directed bias (7 of 9 sites); periodic/refilled boundary. [DER] We extend them with density-dependent movement (Jin 2016) and freehand wound shapes; this is our change, not theirs.
- **Baseline and sanity check**: closure-rate power law alpha = a * Phi^-b with Phi = Tm/Td (a about 2e-3, b about 0.66 from extracted text; verify in the PDF) is one more baseline; Phi < about 1e-2 (their critical value) is the sanity check that division can be neglected for mitomycin-treated WHAD presets.
- **Priors**: their Table 2 (doubling times and migration times per cell line) are starting priors for presets before calibration to WHAD.
- Differences from this prior art that we claim: they calibrate fitted closure curves (r about 0.98) with no held-out forecast, no early-call, no uncertainty, no learned emulator; we forecast with calibrated bands on held-out wounds and add an NCA emulator, continuous zoom and a draw tool. Their code and data are available only on request, so we reimplement.

### 5.2 Movement and multiplication [D, confirmed R7]
- Both terms exist in the simulation: movement (cells move/flux into the gap) and multiplication (division adds cells). [DER] NCA update = mass-conserving flux term (movement) + non-negative source/sink head (multiplication/death).
- Density-dependent movement is required (Jin 2016: effective diffusivity rises with starting density) [F].
- No inference of movement-vs-multiplication from real data; no sliders. WHAD wounds were mitomycin-treated, so closure there is movement only [F]; Jin data allow both [F].
### 5.3 NCA vs statistical forecaster [D]
- Primary model: density-field NCA ensemble (stochastic, energy-score/CRPS-style training; mass-conserving; parameters broadcast as channels).
- Baselines (all evaluated): persistence; linear healing-rate extrapolation; logistic; Gompertz; Fisher-KPP / Porous-Fisher; Nardini Model 4 (reimplement; repo unlicensed); small MLP/LSTM on scalar features; deterministic NCA ablation.
- **Gate at 19:00 Sat [D]:** NCA is "passable" if on held-out wounds its CRPS is within 10% of the best statistical forecaster AND empirical 90% coverage is between 85% and 95%. Passable: ship NCA as the forecaster. Not passable: ship the statistical forecaster as the forecaster and keep the NCA as the draw-tool emulator (labelled "emulator").
### 5.4 Uncertainty [D]
- Ensemble spread + conformal calibration across wounds (leave-one-wound-out jackknife+ or split conformal across wounds; wound is the exchangeable unit). Report coverage with confidence interval, CRPS, reliability plot.

## 6. Data
### 6.1 Data scope [D, R2 + R8]
- **Main real-data benchmark: WHAD MCF10A** [D]. Annotated: MCF10A experiment 1 (16 positions: CC control 7, C61 = CYR61 shRNA 6, N61 2, NC 1) + MCF7 (3 positions: LacZ 2, SEMA6D 1). Hourly, 20 usable frames (t00 to t19); wound masks from the authors.
- **WHAD unannotated MCF10A: auto-segmented by P1, scope = experiment 1 remainder + experiment 2 only** [D]. Exclude experiment 3 and MCF7.
- **Jin 2016 profiles** (+ SDs) [D]: PC-3, 6 starting densities (10,000 to 20,000 cells/well), 3 replicates, 38 columns of 50 um, counts at 0/12/24/36/48 h; proliferation allowed. Cite the paper; do not re-host (supplement licence unclear).
- **Zaritsky 2015** [D]: second test set for held-out treatment (growth factor HGF/SF and Met inhibitor PHA665752; DA3 and MDCK cells; 4 to 6 replicates per condition). Conditional: P1 verifies frame interval, image access and masks in the first hour; if unusable, drop it and record that here.
- **In core scope as secondary data** [D, R8]: fruit-fly embryo set (Zenodo 7660424), WHiM-BC (Zenodo 8131123; also prior art to read), MDCK strip movies (Zenodo 4991621). [DER] Priority if time runs short: WHAD + Jin first, then Zaritsky and the embryo set, then WHiM-BC and MDCK.
- Out: Cell Tracking Challenge data (restricted use).

### 6.2 Facts that bind the design [F]
- WHAD: Zenodo 12806149 (CC BY 4.0; code repo MIT); MCF10A and MCF7; phase contrast, 0.454 um/pixel, 1920x1440, hourly for 48 or 72 h; **mitomycin C blocks proliferation**; genetic conditions, not drugs; masks cover only 19 of 104 positions.
- Every 21-image position has an all-zero last image (t20): **drop it**.
- Do not use MCF10A experiment 3 until its mixed recordings are sorted (frame numbering jumps between runs).
- Part I vs part II of MCF10A exp 1/2 differ strongly (part I wounds stall or close slowly; part II close): batch effect confounds condition.
- Classical segmenter (texture; wound = low-texture region; threshold 0.35 x the 90th percentile of texture; clean-up) gets mean IoU about 0.74 and wound-area error about 1.8 points of field on annotated frames (tuned in-sample; held-out by part: part I IoU 0.85, part II 0.62, area error 2.1 and 1.5 points). Segmentation error must be carried into forecast uncertainty.
- Cells are visible in WHAD at native resolution (nuclei and nucleoli) but the monolayer is dense; no cell tracks provided.
### 6.3 Storage [DER]
- Extracted subset at `~/whad-data` (16+3 annotated positions, 1.2 GB) and `~/whad-data-staging` (8 unannotated MCF10A exp2 positions). Outside the repo; never commit data or PDFs. Disk is about 96% full. Checksum of `whad_camad.zip` verified.

### 6.4 Source notes for colleague-reported data (checked 14 Nov; scope decided in 6.1)
- **Zaritsky et al. 2015** (GigaDB 10.5524/100118, GigaScience doi 10.1186/s13742-015-0049-6; paper CC BY, data under the CC0 waiver per the paper): 31 time-lapse wound-healing experiments, 2 cell lines, 6 conditions with 4 to 6 replicates each: DA3 mouse mammary cells (21: control 6, +HGF/SF 5, PHA665752 Met inhibitor 4, PHA + HGF/SF 6) and MDCK (10: control 5, +HGF/SF 5). Raw images at The Cell: an Image Library (groups 45451 DA3 and 44501 MDCK); processed monolayer contours, motion fields and scripts in GigaDB; github.com/gigascience/paper-zaritsky2015. Frame interval, image size, total size and whether proliferation was blocked: not verified. Treatment arms (growth factor, inhibitor) with replicates would make a stronger held-out-condition test than genetic knockdowns confounded by plate part. Colleague note says 19 have processed masks (not verified).
- **WHiM-BC** (Zenodo 8131123, CC BY 4.0, 843 MB): MCF-7 monolayer (12 wells; frames at 0, 3, 6, 9, 12, 24, 27 h; 127 images) and MCF-7 spheres (12 wells; 0 to 15 h; 126 images); only about 7 time points per well. Linked paper and code: Garcia-Moreno et al. 2024 (Comput Biol Med, doi 10.1016/j.compbiomed.2024.108890), "Predicting Wound Healing Progress Framework" (PWPF), repo github.com/frangam/wound-healing (Python, no licence). This is direct prior art for deep-learning wound-progress forecasting; read and cite; do not claim first.
- Zenodo 21779854 (HUVEC / SKOV-3 scratch frames, wound-gap polygons, CC BY 4.0; image zip 3.7 GB) and Zenodo 19738270 (diabetic-rat keratin-TMAO dressing study; scratch table with 24 h closure only) were already assessed: limited use.
- Fruit-fly embryo set (Zenodo 7660424): the record lists 61 sequences (colleague note says 62); 1 frame/min, about 120 frames, 128x128 crops at about 9.2 um/pixel, wound outlines; colleagues called it the main dataset; R8 decided WHAD is main and the embryo set is secondary.

## 7. Evaluation protocol [D]
- Splits: hold out whole plate parts (part I vs part II) and a held-out condition (CYR61 shRNA vs control); no random wound split.
- Early-call protocol: forecast from the first 10, 20, 30, 50% of frames; report error vs fraction observed.
- Metrics: wound-area error at horizon; time-to-90%-closure error; 90% coverage with Wilson CI; mean interval width; interval score; CRPS; reliability plot; stall and flag precision/recall; simulated plate-hours saved (stated as simulation); failure analysis (worst wounds, where coverage collapses, rollout drift).
- Include a visit-deletion / thinning robustness test and report segmentation-error propagation [DER from 6.2].
- If the NCA does not tie the best baseline, say so (section 5.3 gate).
- State out loud: few conditions/wounds make coverage CIs wide; Jin data are 1D profiles.

## 8. Video and submission
- [D, revised R13] Video order: **draw tool first**, then the real run: upload 3 real frames, get a forecast with its band and any flag, then show validation on a held-out wound. [DER] 2 minutes, one real run on screen; label anything mocked or sped up; include the scorecard vs simple baselines and one failure case.
- [DER] Devpost needs the video and a public repo link; add all team members to the Devpost project; present how Figma was used.

## 9. Stack and repo [D]
- Python/PyTorch for data, segmentation, cell agents, NCA, baselines, evaluation; TypeScript web viewer (deck.gl/WebGL); cell simulation in a Web Worker; small NCA exported for the draw tool; static exported files for playback.
- Public GitHub repo, MIT licence; no raw data, no PDFs committed; reimplement code from papers with no licence.

## 9b. LLM roles [D, R10]
- Principle: deterministic code does the science; the LLM never forecasts and never produces a number. LLM output ships as cached JSON (run offline with the Claude API on the demo inputs; no live API call and no keys in the repo).
- **Assay intake**: pasted protocol text to a structured config (cell line, seeding density, mitomycin yes/no, scratch tool, imaging interval, plate part). Code maps the config to a preset and applies rules (mitomycin means division off; Phi = Tm/Td < about 1e-2 check) and checks consistency; the LLM extraction is shown next to the source text for review.
- **Anomaly triage**: code detects suspicious wounds first (observed leaves its 90% band, stall probability above threshold, flat area over a stated window, blank or out-of-focus frames); the LLM then reads the flagged wound's curve summary, metadata and (optionally) frame overlays and writes a short triage note with candidate causes (for example plate-part batch effect, edge damage, debris) labelled as hypotheses. It never raises or clears a flag by itself. Thresholds are set by P2/P1 and recorded here once chosen (OPEN).
- Not included: Reviewer 2 audit, report/caption writer, segmentation QC as a separate role, free-form chat.

## 10. Schedule [D / F]
- Now: Sat afternoon. **Gate: 19:00 Sat** (section 5.3). Building closes 21:00 Sat. **Team will keep working elsewhere overnight [D]** (rules not yet confirmed; see 15). Submissions close 12:00 Sun; plan to submit by 11:30.

## 11. Honesty rules [D]
- Research prototype, advisory only; no clinical or drug-effect claims.
- Simulated cells are labelled as simulated; closure cannot identify movement vs division mechanisms from wound curves alone.
- Report negative results and failure cases.

## 12. Applications slide (not claims) [D]
- Diabetic/chronic wounds, infected wounds, cancer migration assays, fibrosis/scarring and drug screening are "path to the lab" applications; none is validated by our data.

## 13. Prior art to cite [F]
- Cai et al. 2025 (Regen Ther): WHAD segmentation + group-mean closure-curve regression, no held-out wounds or uncertainty. Nardini and Gevertz (arXiv 2606.10873): Jin-data PDE vs ABM, forecasts scored by final-time MSE only. MNCA (2506.20486), NeuralCPM (2502.02129), Richardson 2024: synthetic-only NCA/CPM work. Clinical baselines: Sheehan 2003 (53% area reduction at 4 weeks), Warriner 2011, Cardinal 2009.
- Berezo et al. 2022 (Adv Wound Care; 1,220,576 wounds, gradient-boosted trees, AUC 0.85 for 4/8/12-week non-healing; proprietary EHR data) and Dallmann et al. 2025 (Adv Wound Care; 620,356 wounds, AUC 0.90 after 4 weeks and 0.92 after 5 weeks, changes in wound dimensions most influential): clinical EHR-scale prior art for early healing prediction.
- Do not claim "first".

## 14. Acceptance criteria [DER]
1. Draw a wound in the viewer, watch it heal, zoom continuously from cells to wound.
2. Forecast with calibrated band on a held-out real WHAD wound; scorecard vs baselines.
2b. Upload 1 to 5 real frames and get a forecast with band from the same pipeline (or a precomputed sample if live processing fails).
3. Gate result recorded (passable or not) with numbers.
4. Public repo, 2-minute video, Devpost submitted before 12:00 Sun.

## 15. OPEN (not decided)
Resolved by the user on 14 Nov (R12):
- Product name: Stitch (final).
- Overnight work outside the building: allowed (user decision; the organisers' data.js says building closes 21:00 Sat, so keep commits and video inside the 12:00 Sun cutoff either way).
- Demo: do a live demo if time allows, not required. The 2-minute video stays the submission.
- Cell-simulator parameters: taken from the training data (calibration on WHAD), not from the literature priors alone.
- Anomaly-detector thresholds and the LLM prompt/output schema: set by testing against the training wounds.
- Role names: as written in section 3. Figma owner: P3.
- Boltz: not used; bounty not pursued.
- Jin supplement licence: the team has permission to use it. Still cite Jin 2016; the BINNs repo numpy copy has no licence, so do not re-host it.

Still open: none.

## 15b. Colleague workspace tasks (requested by user; assigned by role)
- P1 (data/eval): verify Zaritsky 2015 file sizes, frame interval and masks (GigaDB + Cell Image Library); read WHiM-BC paper and PWPF repo (Garcia-Moreno 2024) for baselines/metrics; confirm the 61 vs 62 embryo count; wrap the Jin profiles from the BINNs numpy file with a documented loader; own the upload pipeline (4.4): frames to mask to simulator start state, with bad-mask refusal.
- P2 (model): implement the cell-agent simulation with density-dependent movement and optional division; reimplement Fisher-KPP / Porous-Fisher baselines; mass-conserving NCA prototype.
- P3 (viewer/video): deck.gl continuous-zoom prototype from a fake agent cloud; Figma flows for the draw tool; README skeleton; upload screen and sample-frame fallback (4.4).

## 16. Decision log
- R1 (14 Nov): headline = forecaster; user = assay scientist; 3 people; prizes AI for Science + Figma (+ AI on Campus mention, later dropped).
- R2: name Stitch (for now); AI on Campus dropped; data = WHAD annotated + WHAD unannotated MCF10A + Jin; MDCK stretch.
- R3: zoom continuous, zoomed-in = simulated cells; model = density-field NCA ensemble; uncertainty = ensemble + conformal over wounds; user wants draw-a-wound wow feature.
- R4: cell agents are truth, NCA emulates; draw tool controls = shape + preset; readout secondary (later revised); video = draw tool first, then real validation.
- R5: evaluation = hold out plate parts + a condition; fallback = validate NCA vs statistical forecaster, push NCA if passable, else statistical + NCA emulator; stack = Python/PyTorch + TS viewer.
- R6: no sliders in draw tool; readout = no inference, integrate movement and multiplication as model terms; passable = CRPS within 10% and coverage 85 to 95%; gate 19:00; overnight work elsewhere = yes.
- R7 (14 Nov): both movement and multiplication terms confirmed; draw tool = MCF10A control + CYR61 shRNA presets only; real WHAD frames only in the video's validation segment; user supplied colleagues' extra data sources (6.4) instead of answering the segmentation-scope question.
- R8 (14 Nov): main benchmark = WHAD MCF10A; Zaritsky 2015 = second test set with held-out treatment, conditional on a first-hour verification; embryo set, WHiM-BC and MDCK strip movies in core as secondary data; auto-segmentation scope = MCF10A exp1 remainder + exp2.
- R9 (14 Nov): adopt all three parts of Migliaccio 2023 (agent rules, Phi power-law baseline and sanity check, Table 2 priors).
- R10 (14 Nov): LLM roles = assay intake (protocol text to config) + anomaly triage (code flags, LLM explains with hypotheses); Claude API run offline, outputs cached; Reviewer 2, report writer and segmentation QC not included. UI direction: journal-figure look, realistic tissue palette, full-bleed canvas with collapsible panels, skin-tone range shown in mockups only; five mockups built in design/mockups (selection pending).
- R11 (14 Nov): tissue tone switcher ships (display setting); starting-point mockup not yet chosen: user will supply one more reference/mockup to build before choosing among M1 to M5.
- R11b (14 Nov): tissue rendering = no outlines, no hexagons, gradient state blends; shared renderer rewritten (design/shared/cellfield.js v2); mockups M1 to M5 being updated; M6 night-plate in progress.
- R12 (14 Nov): open list closed: name Stitch final; overnight work allowed; live demo optional; simulator parameters from training data; anomaly thresholds by testing; roles kept; Boltz not used; Jin supplement permission granted.
- R13 (14 Nov): upload promoted to core-lite (4.4): 1 to 5 frames in, classical segmenter to start state, forecast with band out; no LLM on pixels; sample-frame fallback; video real run uses it. Reason: without user input the forecaster has no path to the lab.
