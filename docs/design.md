# Stitch: design doc (single source of truth)

Status: v1, 14 Nov 2026. Owner: team lead. Rule: this file holds ONLY what is decided. Everything else is in section 15 (OPEN) or in research notes (`docs/research-report.md`, `docs/wound-plan.md`, `docs/papers/reading-notes.md`), which are background and do not override this file. Tags: [D] decided by the user; [F] verified fact; [DER] derived from a [D] and a [F] (confirm if wrong). Change a decision by editing here and adding a line to section 16.

## 1. Goal
- [D] Build **Stitch**, the headline product: an early wound-closure forecaster with calibrated uncertainty, stall flags (measure-again not shipped, R16) and a scorecard against simple baselines. (Name "for now"; user may rename.)
- [D] Named user in the video's first 15 s: an **assay scientist** deciding whether to stop, extend or repeat a scratch/wound-assay plate. Clinical use is a "later" slide only.
- [D] Track: **AI for Science**. Extra prizes: **Figma** (design) and **Best Use of Adaption** (9c). Event theme: agentic AI product (9b). Reply "AI on Campus" dropped. No Boltz bounty (see 15).
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
- 3 people. P1 data + segmentation + baselines + scoring. P2 cell simulator + NCA + calibration. P3 viewer + agent layer (9b, R20) + Figma + README + 2-minute video.
- Role names P1/P2/P3 are final (R12); assign people by the team.

## 4. Product spec
### 4.1 Forecaster outputs per wound [DER from section 1]
- Forecast closure curve with a calibrated 90% band; time to 50% and 90% closure with intervals; P(closes by T); stall probability and stall flag; out-of-band shown as an observation only (observed leaves its band); no measure-again flag (not shipped, R16); next step from `schedule_advice` (R19).
- Input: wound size/mask series up to a cutoff t0 (frames or CSV of relative wound area) + condition label.
- Scorecard page: model vs baselines on held-out wounds; failures shown.
### 4.2 Draw tool [D]
- User draws a freehand empty region on a confluent monolayer; simulation heals it; **no sliders**; controls = **wound shape + cell line/condition preset** only.
- [D] Presets shipped: **MCF10A control (CC) and CYR61 shRNA (C61)**, calibrated from WHAD with division OFF (mitomycin-treated assays). The draw tool runs the cell-agent engine (`sim/js/engine.js`) under the preset, labelled as a simulation; it never shows a band or coverage claim (`docs/p2-handoff.md`). Everything else (other WHAD conditions, a Jin PC-3 division-ON preset) is stretch.
### 4.3 Viewer [D]
- **One continuous zoom** (no scene switch): zoomed in shows **simulated cells**; zoomed out shows density/wound outline and the forecast with its band. All levels derive from the same state; wound area is identical at every zoom; one time slider.
- [D, R11] **Tissue rendering style:** organic irregular cells, **no outlines anywhere on the grid, no hexagons**, and smooth colour gradients between states instead of hard thresholds (leading edge = soft shaded band, new tissue = gradient with fading speckle, wound = smooth gradient darkest at the centre, dividing = pale cell with two small nuclei). State rules and non-colour cues are unchanged except the leading-edge cue (shaded band instead of an outline).
- Honesty labels [D from earlier + DER]: "simulated cells, not tracked cells"; observed vs predicted visually distinct; ensemble disagreement shown as separate trajectories; colour-blind-safe palette; keyboard zoom.
- [D, revised R13] The zoomed-in viewer is fully simulated. Real WHAD frames appear in the video's validation segment and in the upload flow (4.4), where they are shown as observed (never as simulated cells).
- [D, R11] **Tissue tone switcher ships** (light / medium / deep): a display setting that re-themes the tissue colours only (state rules and cues unchanged); it is not part of the draw tool's controls (shape + preset). This reverses the earlier 'range in mockups only' choice. Colours are illustrative, not clinically calibrated; say so in the UI help.

### 4.4 Upload your own frames [D, R13; core-lite]
- Input: 1 to 5 uploaded frames (PNG/JPG/TIFF) plus frame interval and pixel scale (from the Intake sub-agent in 9b, or typed). Scope stated in the UI: phase-contrast scratch assays like WHAD (MCF10A); other microscopes or cell types are unsupported and the tool says so.
- Pipeline (deterministic, no LLM on pixels): classical texture segmenter gives the wound mask and area; the mask is the starting state of the cell-agent simulation and the NCA; the forecaster returns the closure curve with its 90% band, flags and the agent summary of 9b. More frames narrow the band (measured closure rate).
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
- **Gate at 00:00 Sun [D, moved from 19:00 in R15]:** NCA is "passable" if on held-out wounds its CRPS is within 10% of the best statistical forecaster AND empirical 90% coverage is between 85% and 95%. Passable: ship NCA as the forecaster. Not passable: ship the statistical forecaster as the forecaster and keep the NCA as the draw-tool emulator (labelled "emulator"). Result: not passable in R18; the NCA fine-tuned on real WHAD frames passes (R26), and which forecaster the agent path uses is open (15). Either way (P2 handoff) the draw tool runs the cell-agent engine, and the NCA band is used only on real or uploaded wounds, labelled "emulator" and uncalibrated.
### 5.4 Uncertainty [D]
- Ensemble spread + conformal calibration across wounds (leave-one-wound-out jackknife+ or split conformal across wounds; wound is the exchangeable unit). Report coverage with confidence interval, CRPS, reliability plot.

### 5.5 Contracts and defaults [D, R14; proposed by team lead, change freely]
- **Pipeline (resolves emulator vs forecaster):** frames up to t0 -> segmenter -> mask + fitted wound parameters (migration time Tm, bias) -> cell-agent sim from that start state -> NCA (trained on sim output, parameters as channels) gives the ensemble. Statistical baselines fit the area curve directly. The 19:00 gate compares the NCA ensemble with the best baseline (5.3).
- **Target:** A(t) = wound pixels / ROI pixels from masks; closure = 1 - A(t)/A(first frame). t50/t90 = first time closure crosses 50%/90% (reopening ignored after first crossing); not reached by the last usable frame = censored, report P(not closed). t0 = first 10/20/30/50% of usable frames; horizon = last usable frame (t00 to t19 for WHAD, hours).
- **Units and grid:** time in hours since first frame; lengths in um; one lattice site = one cell (~20 um, P2 confirms from WHAD nuclei); NCA density grid = coarse-grained agent counts; area-preserving resampling between mask, lattice and density grid.
- **Forecast JSON (P1 writes `contracts/forecast.schema.json`; P2 emits, P3 reads):** wound_id, model, t_hours[], area_q05[], area_q50[], area_q95[], t50 and t90 {median, q05, q95, censored_prob}, p_close_by_T, p_stall, flags[] {type, reason}, segmentation_quality, version.
- **Splits [revised R15] (unit = physical wound `posNNNN`; part I and part II of WHAD exp1/exp2 are the SAME wounds filmed consecutively, so both parts of a wound always stay in one fold):** main = leave-one-wound-out over WHAD MCF10A (9 manual-mask + 22 auto-segmented wounds; report manual-only and all); held-out condition = train CC, test C61 (and WHiM-BC monolayer to sphere). Thresholds and tuning frozen on training folds only. Report per split, never pooled only. Superseded: fold A (part I to part II) tested on the same wounds.
- **Uncertainty recipe:** 50 members; spread from bootstrap over the parameter fit plus stochastic agent/NCA noise; conformal at wound level (leave-one-wound-out jackknife+ because wounds are few) on a normalised max-over-horizon area residual; report n and Wilson CI beside coverage.
- **Draw tool:** a simulation under a preset, not a forecast; label it "simulation, preset parameters", no band or coverage claim for a drawn wound. Preset values come from the CC and C61 fits (division OFF).
- **Viewer:** at most ~20k agents in a Web Worker; deep zoom draws the agents (they are the cells); zoomed out is the coarse-grained density of the same agents, so area matches at every zoom. NCA weights ship as JSON with a small JS inference loop for the band; fall back to precomputed ensembles if too slow.
- **Upload refusal rules (4.4):** refuse or flag if mask < 1% or > 70% of the ROI, if more than 3 components exceed 5% of the ROI, if the frame is blank or out of focus (texture p90 below a floor set on WHAD), or if scale or interval is missing. Accept PNG/JPG/TIFF; scale default 0.454 um/px only if the user confirms WHAD.
- **Repo:** `data/` + `eval/` + `contracts/` (P1), `sim/` + `nca/` (P2), `web/` + `docs/` video script (P3); branches `feature/<area>-<name>`; merge to main when it builds (CLAUDE.md); NCA is tiny so CPU or free Colab GPU is enough; no data or PDFs in the repo.
- **Video:** owner P3; script draft by 20:00 Sat; record 09:00 to 11:00 Sun; submit by 11:30. Real run = upload 3 frames, forecast with band and flags, then held-out validation, then the scorecard with one failure case.

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
- [D, revised R13] Video order: **draw tool first**, then the real run: upload 3 real frames, get a forecast with its band and any flag, then show validation on a held-out wound, with the agent's decisions in Assay mode and the Ops view as proof (9b). [DER] 2 minutes, one real run on screen; label anything mocked or sped up; include the scorecard vs simple baselines and one failure case.
- [DER] Devpost needs the video and a public repo link; add all team members to the Devpost project; present how Figma was used.

## 9. Stack and repo [D]
- Python/PyTorch for data, segmentation, cell agents, NCA, baselines, evaluation; browser viewer in plain ES modules (three.js/WebGL; deck.gl replaced in R21); cell simulation in a Web Worker; small NCA exported for the draw tool; static exported files for playback.
- Public GitHub repo, MIT licence; no raw data, no PDFs committed; reimplement code from papers with no licence.

## 9b. Agent layer [D, R20; replaces the R10 LLM roles]
- [D] The product is agentic (event theme). The team agreed; P3 builds it.
- [D, kept from R10] Code does the science. The LLM plans, picks tools and explains; it never makes a number and never raises or clears a flag. Plain-code policy decides every action; a human approves anything that cannot be undone (stopping a plate). Research use only.
- [D, R21, R23] Back end: a Python script runs the agent and records each run to `agent/runs/<run_id>.jsonl` (code in a new `agent/` folder, owner P3); the UI plays the runs back. At an approval point playback pauses and the click picks which recorded branch plays; both branches are recorded, approve first, for the video run(s) only; other replay runs use the simulated human who always approves. A FastAPI server is added only if a live run is wanted. The public repo and the video need no keys (R10 rule).
- [D, R22] Agent loop: hand-written, not the SDK Tool Runner, so each step is logged, decisions are set by code, the Critic and human approval sit inside the loop, and `call_model()` stays a plain messages call that works with any provider. Each run has a maximum number of steps and a token budget (constants in `agent/config.py`); a run that hits either stops and is logged as such.
- [D, R21] Every model call goes through one `call_model()` wrapper, so the provider can be swapped in one file. Credentials, account IDs and profile names stay in local config (`.env`, git-ignored, or local cloud config), never in the repo. If the account changes before submission, the video runs are re-recorded on the new one.
- **Who decides what** [D, R24, R27]: code runs the fixed steps in order (QC, forecast, flags and schedule, simulation) at each check. Code then works out which decisions are allowed (below). A refusal forces "data refused, ask a human" and a fired stall flag forces "stall flagged, ask a human"; the LLM cannot propose anything else over them. Otherwise the LLM lead agent takes the open choices among the allowed decisions: whether to investigate, which decision to propose, when to ask a human, and how to explain the result. Policy code checks every proposal before it is shown. Helpers and the existing code they call:
  - **Intake** [optional]: runs only on uploads that come with protocol text. It extracts frame interval and pixel scale (used by `data/upload.py`) and condition CC or C61 (used by `sim/upload.py`), and checks scope: a cell line other than MCF10A, or no mitomycin, means "outside the validated scope" (seeding density and mitomycin change no output, because the start lattice is fully confluent and division is off). The extraction is shown next to the source text for review (R10 safeguard). Model: the 9c fine-tune if it passes, else Claude.
  - **QC and forecast:** `data/upload.py` (`check_frame`, `run`): frame checks, the 5.5 refusal rules, segmentation and the calibrated edge-speed forecast with its 90% band (P1's leave-one-wound-out conformal; the shipped forecaster, R18). Only this band is called "90%".
  - **Flags and schedule:** stall from `eval/flags.py` thresholds (truth: less than 10% more closure after the cut-off). Out-of-band is an observation only. Measure-again is not shipped (R16). The stop or continue call comes from `data/upload.py` `schedule_advice` (the upload JSON `schedule` field).
  - **Simulation:** `sim/upload.py` (`forecast_upload`): simulator ensemble from the wound mask, with the NCA labelled "emulator" (R18). Its bands are raw ensemble spreads, uncalibrated (raw coverage 0.07 to 0.24, `docs/p2-results.md`); they are never labelled "90%" or used for decisions.
  - **Investigator** [D, should]: when a wound goes off track, reruns the simulation with other starting conditions and ranks them by fit. Shown as hypotheses, never as causes. Needs a new `sim/` helper from P2: the simulator has no starting-density setting yet (`mask_to_lattice` fills every non-wound site), and the test wounds with a known cause come from the same helper.
  - **Critic** [D, R23, R27]: plain code, not the LLM. A number counts as traced if it matches a tool output in the run log, or an allowlisted constant with its unit or context, after rounding to the decimals shown (percentages compared as fractions). Allowlist (in `agent/config.py`), each with its unit: 90% band level, 50% and 90% closure, the 19 h horizon, the cut-offs 1.9/3.8/5.7/9.5 h, the scheduler thresholds 0.1 and 0.9, and the scoreboard cost units (as cost units only). Untraced numbers are removed and counted. Text may say "90%" about a band only for the `data/upload.py` band.
  - **Reporter:** plain-English summary and the decision card.
- Decisions the agent can propose [D, R23, R27]: continue; stall flagged, ask a human; data refused, ask a human; image again at the next check ("more frames will narrow the band", backed by the band-width-per-check results); and, from `schedule_advice`, **stop, unlikely to close** when P(90% closed by 19 h) is at most 0.1 (held-out WHAD: right 89% of the time, against 73% for always saying no) and **stop, likely to close** when it is at least 0.9. The second has never fired on a held-out WHAD wound, so it is shown as "untested" and never presented as a demonstrated capability.
- **Run log and monitoring** [DER]: one record per agent step and tool call (inputs as fingerprints, outputs, model version, tokens, cost, time), linked by a run ID. The UI reads the same log. Monitored: coverage against the 90% target, flag rates, refusals, tool errors, human overrides, cost per run. External tracing (Langfuse, Phoenix or SDK OpenTelemetry) is optional, for debugging.
- **Agent evaluation** [D, R23, R27]: replay held-out wounds at the four checks (1.9/3.8/5.7/9.5 h, as `eval/scheduler.py` does; forecasts exist only there) as a simulated lab. Assumption, stated with the results: a simulated human approves every proposal. Three policies:
  - Fixed schedule: image to the 19 h horizon; never stop early.
  - Simple rules: stop when the stall flag fires; otherwise continue.
  - Agent: the decisions above.
  Definitions: plate-hours saved = horizon minus stop time, summed over wounds (stated as simulation). Wrong stall stop = stopped as stalled but the `eval/flags.py` stall truth is false. Wrong closure call = called "unlikely to close" but reached 90% by 19 h, or "likely to close" but did not. Missed stall = stall truth is true and the wound was never stopped. Missed non-closer = did not reach 90% by 19 h and was never called. Also reported: how many held-out wounds stall and how many do not reach 90% (73%, R19). Relative costs, stated as assumptions: 1 image = 1, 1 plate-hour = 5, with a sensitivity check at 1 plate-hour = 2 and 20. Other measures: frames used, share of numbers traced (target 100%), guardrail triggers, cost per run, and hypothesis accuracy on synthetic wounds with a known cause only if the Investigator is built. Run once early for a baseline and again before the video is recorded.
- **Adversarial test set** [D, R25, R27, should]: 10 to 15 deliberately bad inputs run through the same replay, each scored against its expected outcome: prompt injection in protocol text or file metadata (treated as data); blank or blurred frames and masks over 70% (refused by the 5.5 rules); a wrong pixel scale (resampled and flagged, as `check_frame` does); out-of-scope requests such as molecule design or clinical questions (refused and logged); a reply with a number no tool produced (removed by the Critic). Frames out of order are included only if P1 adds an order check; otherwise that case is dropped. Shown as one Ops table: expected outcome met or missed, per attack type. Inputs are written by us and stay inside the repo; no real systems are targeted.
- **Security and guardrails** [DER]: text inside files and protocols is data, never instructions; a fixed tool list; tools have no network access; no secrets in the model's context; uploads checked for type, size and dimensions before the 5.5 rules; model and data files checked against stored fingerprints; the run log is append-only; out-of-scope requests (molecule design, clinical questions) are refused and logged.
- **Ethics and legality** [DER]: intended-purpose statement in the UI and README ("research use only, not for diagnosis or treatment"; clinical use would bring medical-device rules into scope, so it is out of scope); dataset licences and credits as in section 6; simulated cells labelled; failures shown (section 11).
- **UI** [D, R22, R27]: one app, three modes. Build order: Assay, then Ops, then Draw polish. Ops minimum: run log table and agent scoreboard; monitoring tiles are cut first. Draw: cell-agent simulation (`sim/js/engine.js`) under a preset, no band, no LLM agent. Assay: recorded runs on held-out WHAD wounds and the precomputed "try a sample" files (a live upload needs the optional FastAPI server); viewer, decision card, short agent timeline, approve or reject. For the video, an upload of real frames is run offline through the script and recorded, so R13 still holds. Ops: full run log, monitoring tiles, agent scoreboard. The video shows Assay, then Ops as proof.
- Add-on if time [D]: notifications (FYI, heads-up, action needed) so scientists need not watch the plate. With no reply the agent only does things that can be undone.

## 9c. Adaption fine-tune [D, R20, R27; owner P2; go or no-go by 03:00 Sun]
1. Task [open, P2 decides; see 15]: protocol paragraph to the Intake fields that feed code (frame interval, pixel scale, condition) plus the scope checks (9b). It has clear right answers, so the win rate means something.
2. Test set first: real Methods paragraphs, labelled by hand and never trained on. Four papers will not give 20 to 30 (and Migliaccio is a modelling paper), so widen the sources to other open-access scratch-assay papers (only open-access text is committed) or lower the target. Record the final count.
3. Training data: Adaption Invent and Expand to at least 1,000 rows (`instruction_dataset`) with varied wording, missing fields and unit variants. Run with `estimate=True` first to check credits and time.
4. Train: AutoScientist, `training_method="instruction"`, a small base model (for example Qwen 3.5 0.8B or Gemma 3 4B), with `target_win_rate` and `max_iterations` set.
5. Evaluate on the real test set: accuracy per field (interval, scale, condition, scope) against the base model and against Claude, plus the win rate. Ship it only if it beats the base model on the real set.
6. Prize evidence: leaderboard screenshot, dataset and run IDs, and the eval table in the README.
7. Wire-up: Intake calls the fine-tuned model if Adaption can serve it (check), otherwise run it locally; Claude is the fallback.

## 10. Schedule [D / F]
- Now: Sat afternoon. **Gate: 00:00 Sun** (section 5.3; moved in R15). Building closes 21:00 Sat. **Team will keep working elsewhere overnight [D]** (rules not yet confirmed; see 15). Submissions close 12:00 Sun; plan to submit by 11:30.

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
3b. [conditional: only if the agent layer is running by 06:00 Sun] Agent run on a held-out wound: lead agent calls the sub-agents, every number traced, decision card shown, run log in the Ops view, agent vs fixed-schedule scoreboard (9b).
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

Open from R20 (agent layer):
- Forecaster on the agent and upload path after R26: calibrated edge speed (current; slightly better at 1.9 to 5.7 h, no torch needed) or the real-data NCA (best at 9.5 h). Owners P2 and P3.
- Adaption task (9c step 1): Intake settings (proposed) or another task. Owner P2.

Resolved (P3): recorded runs use P3's own model account; no spending cap, with per-run step and token limits instead (9b). Credentials stay in local config only (R21).

Still to confirm: overnight work and the demo/video rule with organisers (P3 emails aisociety@imperial.ac.uk); 5.5 defaults are proposals until the team accepts them.

## 15c. Known risks [DER]
- Time: 3 people, large scope; cut order if late = agent extras (notifications, Investigator, adversarial set, live run; see the agent-layer risk below), secondary datasets, Zaritsky, upload live processing (keep sample fallback), then draw-tool polish. Never cut the held-out scorecard.
- NCA may not pass the gate: statistical forecaster ships (5.3).
- Small evaluation sets (19 annotated positions): wide coverage CI, weak conformal; report honestly.
- WHAD cannot calibrate division (mitomycin); division comes from priors and Jin.
- Segmentation error (IoU ~0.74, part II 0.62) propagates to start states and labels.
- Cell agents are a model: always label "simulated cells, not tracked cells".
- No live demo: the video's real run must work first time; keep a recorded backup.
- Agent layer (R20): new scope late in the event. Cut order inside it: notifications, Investigator, live run, external tracing. Never cut: the recorded agent run with its run log and the 100% traced-numbers check.
- LLM output: may misread a protocol or phrase a decision badly. Mitigations: the Critic, schema-checked tool inputs, code-set decisions, human approval.
- Model refusals: the Claude safety filters include a biology category, so lab prompts could be declined. Handle refusals and record runs early.
- Prompt injection through uploaded files or protocol text: treated as data only (9b); test it with one hostile sample file.
- Adaption: training time and credits unknown; the base model may already do well; the fine-tune ships only if it beats the base on real paragraphs (9c).
- Coordination: unmerged `feature/data-baselines` also edits HACKATHON.md; mockup choice and Figma authentication pending.

## 15b. Colleague workspace tasks (requested by user; assigned by role)
- P1 (data/eval): verify Zaritsky 2015 file sizes, frame interval and masks (GigaDB + Cell Image Library); read WHiM-BC paper and PWPF repo (Garcia-Moreno 2024) for baselines/metrics; confirm the 61 vs 62 embryo count; wrap the Jin profiles from the BINNs numpy file with a documented loader; own the upload pipeline (4.4): frames to mask to simulator start state, with bad-mask refusal.
- P2 (model): implement the cell-agent simulation with density-dependent movement and optional division; reimplement Fisher-KPP / Porous-Fisher baselines; mass-conserving NCA prototype.
- P3 (viewer/video): three.js continuous-zoom prototype from a fake agent cloud; Figma flows for the draw tool; README skeleton; upload screen and sample-frame fallback (4.4).

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
- R14 (14 Nov): risks and implementation contracts added (5.5, 15c): pipeline, target definition, splits, uncertainty recipe, JSON forecast contract, upload refusal rules, repo ownership, video plan. Proposed defaults.
- R15 (14 Nov, P1, team said go ahead): WHAD part II = same wounds as part I (same pos ids, files named PartI_plus4, mask IoU 0.82-0.90 between last part I and first part II frame); so 9 physical annotated wounds, not 16, and fold A is dropped. Data added: 22 more WHAD MCF10A wounds auto-segmented (segmenter IoU 0.84 part I / 0.60 part II, matches 6.2), WHiM-BC monolayer 12 + sphere 12 wells (0-27 h, author masks). HUVEC/SKOV-3 (Zenodo 21779854) and diabetic (19738270) have only 2-4 time points: not used. Splits = leave-one-wound-out + CC to C61 + WHiM-BC monolayer to sphere. Gate moved to 00:00. Team plan and GitHub issues: docs/team-plan.md.
- R16 (14 Nov, P1): flags evaluated leave-one-wound-out on WHAD (eval/flags.py, eval/results/flags.csv). Stall ships (AUC 0.79-0.89, precision 0.50-0.80, recall 0.62-0.77; threshold in eval/results/flag_thresholds.json). Out-of-band (2 frames outside band) does not predict an off-track forecast (fires 2-3 of 55): shown as an observation, not a prediction. Measure-again has no validated signal (AUC 0.46-0.73, inconsistent across cut-offs): not shipped; the NCA ensemble spread is tested against the same check.
- R17 (14 Nov, P1): WHAD cut-offs aligned with the NCA files to 2, 4, 6, 10 h (same frames seen by every model); scorer accepts fold names loo / B_CC_to_C61 and looks up physical wounds. Dry-run gate 22:40: NCA ensemble FAILS (4 h: quantile score 0.082 vs edge speed 0.035; coverage 0.11, band width 0.06) because its band has no conformal step (5.4).
- R18 (14 Nov, gate, P1 scored P2's files): WHAD cut-offs back to 1.9/3.8/5.7/9.5 h (P2's gate files use them; R17's 2/4/6/10 superseded). Gate compares against statistical baselines only. **NCA not passable at the headline cut-off** (loo_all 3.8 h: 0.0495 vs edge speed 0.0385, ratio 1.29, coverage 0.93); passes 4/12 (all splits at 9.5 h, CC_to_C61 5.7 h); simulator 3/12; NCA within 7% of the simulator. Per 5.3: calibrated edge-speed forecaster ships for forecasts; NCA ships as the draw-tool emulator, labelled 'emulator'. Raw NCA/sim coverage 0.14/0.21, calibrated 0.93. Tables: docs/results.md.
- R19 (14 Nov, P1): scheduler / stop-early simulation (eval/scheduler.py): rule P(90% closed by 19 h) <= 0.1 or >= 0.9 at 1.9/3.8/5.7/9.5 h. 82% of held-out WHAD wounds called at 1.9 h, 89% right vs 73% majority; all calls are 'won't close'. Upload JSON gains a `schedule` field (call or next check time).
- R20 (14 Nov, team agreed): the product is agentic. 9b replaces the R10 LLM roles: a lead agent and helpers that call existing code (`data/upload.py`, `eval/flags.py`, `sim/upload.py`), recorded runs, a run log with monitoring, agent replay evaluation, security, ethics and legality rules, and a three-mode UI (to confirm). P3 builds it. 9c adds the Adaption fine-tune plan (P2). Notifications are an add-on. Open choices listed in 15; new risks in 15c.
- R21 (14 Nov, P3): agent back end = recording script first (FastAPI only for a live run); all model calls behind one `call_model()` wrapper, credentials only in local config, video runs re-recorded on the final account; web viewer uses three.js (deck.gl dropped); Investigator is a should.
- R22 (14 Nov, P3): hand-written agent loop (per-step logging, code-set decisions, Critic and human approval inside the loop, provider-agnostic `call_model()`); three UI modes confirmed, build order Assay, Ops, Draw polish, Ops minimum = run log table + scoreboard, monitoring tiles cut first; scoreboard costs 1 image = 1, 1 plate-hour = 5, sensitivity at 2 and 20.
- R23 (14 Nov, P3): playback pauses at approvals, both branches recorded (approve first); Assay = recorded held-out runs + samples, video upload recorded offline; agent adds two early stops beyond the stall rule (first set at 0.95 / 0.05, then aligned to P1's scheduler thresholds 0.9 / 0.1, R19); simulated human always approves in replay; definitions of plate-hours saved, wrong stop and missed stall, plus the count of held-out wounds that stall; Critic is code with a constants allowlist and a rounding rule; code in `agent/`, runs in `agent/runs/`; synthetic known-cause wounds from a `sim/` helper (P2).
- R24 (14 Nov, P3, simplification): code runs the fixed steps, the LLM takes the open choices; Intake optional (uploads with protocol text); approval branches recorded for the video run(s) only; "right helper chosen" metric cut; evaluation run twice (baseline, before the video) instead of on every change; hypothesis accuracy only if the Investigator is built.
- R25 (14 Nov, P3): adversarial test set added to the agent evaluation (should): 10 to 15 cases across injection, bad frames, out-of-scope requests and untraced numbers, reported as caught/missed in Ops. No adversarial reviewer agent (R10 exclusion stands).
- R26 (14 Nov, P1, issues #60-#66): NCA fine-tuned on real WHAD frames (nca/real_data.py, nca/finetune_real.py: from nca/weights.pt, 800 steps, flips, final weights, no test-fold checkpoint selection; 4 folds = crc32(wound) % 4; nca/forecast_realft.py: each series forecast by the fold model that never trained on its wound, real-mask starts, P1 conformal). **Gate: passes 9/12 incl. every loo_all cut-off; 3.8 h 0.0403 vs edge speed 0.0386 (ratio 1.04, cov 0.93); best of all models at 9.5 h (0.0291).** Fails CC_to_C61 at 1.9/9.5 h (cov 0.78-0.79) and loo_manual 1.9 h. Real + Zaritsky (6 wells with usable labels) is worse (3/12). NCA spreads do not give a consistent measure-again signal (AUC 0.56-0.72). Per 5.3 the real-data NCA is passable; which forecaster the upload/agent path uses is P2/P3's call (edge speed is still marginally better at 1.9-5.7 h and needs no torch). Data fix: WHAD exp1/part_II/NC/P3 spliced two positions; fixed in data/build_whad_auto.py and excluded from scoring for every model until P2 refits it. Limitation: the calibration pool for a wound uses other folds' models, which may have seen that wound.
- R27 (14 Nov, P3, addressing P2's PR review): stall scored on the flags.py truth, plus wrong closure call, missed stall and missed non-closer; adversarial expected outcomes match the code (wrong scale flagged; out-of-order only with a P1 order check); simulator and NCA bands labelled uncalibrated, only the data/upload.py band called 90%; Draw = cell-agent engine under a preset, no band, no agent; "likely to close" stop marked untested; live calls from schedule_advice, replay at the four checks; Intake limited to fields that feed code plus scope checks, extraction shown next to the source; Investigator needs a new sim/ helper; refusal and stall force their decisions; Critic constants matched with units; per-run step and token limits; 3b conditional (06:00 Sun); 9c go or no-go by 03:00 Sun.
