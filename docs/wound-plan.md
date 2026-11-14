# Wound healing project: the plain-English plan

Status: research only, nothing built yet. Facts about datasets come from research scouts and need a quick check before we rely on them. Event rules say building starts at 12:10 on Saturday and pre-existing projects are not allowed, so we should not write the model before then (ask the organisers what prep is fine).

## The idea in one paragraph
We build **ClosureCall**, a tool that watches the first part of a wound closing and predicts the rest. It tells you roughly when the wound will close, how confident it is, and which wounds look like they are going off-track. The prediction comes from a small neural network that behaves like a grid of cells, each one following the same simple local rule (a "neural cellular automaton"). We run many slightly different versions of it so the spread of answers shows how unsure it is. We always compare it against simple, well-known curves, and we say honestly when it does not win.

## Who it helps, and why
- **Lab scientists running scratch assays** (cells grown in a dish, a gap scratched across them, then photographed as the cells close the gap). Today, tools measure closure after it has happened. Nothing we found predicts it early with an honest confidence range.
- **What a prediction would change:**
  - Stop a plate early when it is clear the wound will close, or will not.
  - Flag a well that is behaving oddly (a bad scratch, damaged edge).
  - Compare treatments or dressings by "predicted time to 50% / 90% closed", with a range, instead of one end-point number.
- **Later, in clinics:** doctors already use a rule of thumb for chronic foot ulcers: if the wound area has not shrunk by about half after 4 weeks, it is unlikely to heal. That rule is a useful baseline, and a forecast from weeks 1 to 3 would be an earlier warning. But there is no open clinical data to prove it, so we make no clinical claim.
- **Savings:** we found no trustworthy figures for plate cost or machine time, so we will not quote one. We will instead simulate "how many plate-hours would stopping early have saved" on our own data and say it is a simulation.

## What the tool does
- **You give it:** the wound's size over time (as images/masks or just numbers), up to a cut-off point, plus basics like the condition tested.
- **You get, for each wound:**
  - A predicted closing curve with a 90% confidence band.
  - Time to half-closed and nearly-closed, each with a range.
  - The chance it closes by a chosen time, and the chance it stalls.
  - An "unsure, measure again" flag when the answers disagree a lot.
  - A flag when a wound strays outside its own predicted band.
- **A one-page report per plate:** a heatmap of wells, the forecast fans, and a straight scorecard against the simple baselines.
- **Two modes:** a simple one that works on any spreadsheet of wound sizes, and an image one that uses the full wound shape.
- **Wording:** research prototype, advisory only, not a medical device, no claims about drug effects or patients.

## Data we can actually use
| Dataset | What it is | Why it matters | Catch |
|---|---|---|---|
| **Fruit-fly embryo wound closing** (Zenodo 7660424) | 61 real laser wounds filmed about once a minute, with outlines of the wound. Open licence (CC BY 4.0), 199 MB. | Main dataset: real living tissue, many repeats, small enough to use. | No drug or treatment variation. Our "held-out condition" would be wound size. |
| **Scratch-assay density profiles** (Jin 2016, in the Nardini repo) | Cell density across the scratch at 5 time points, for 6 starting densities. | Lets us compare against a published model and test on a held-out density. | Only 1D profiles, so a spatial model has no edge; licence unclear (cite, do not re-host). |
| **Candidates with treatments** (Zenodo 4991621 and 21779854) | Migration experiments with drugs (mitomycin C, CK666), and two cancer cell lines with scratch outlines. | Could give real treatment arms. | Not checked yet; one needs a first-hour look. |
| Ruled out | Cell Tracking Challenge (restricted), a controlled-access wound set, huge 12 to 50 GB sets, clinical foot-ulcer image sets (single photos, no healing series). | | |

## How we will prove it works (this is where most marks are)
Judges give 30% for scientific rigour and 20% for a path to the lab, so honest testing matters more than looks.
- **Test it on wounds it has never seen**, and on one held-out condition (a held-out wound size, or a held-out starting density).
- **Compare against simple, well-known methods:** "wound stays as it is now", a straight-line extrapolation, standard growth curves (logistic, Gompertz), the Fisher-KPP model used in cell-migration papers, and the published Nardini model. We also compare the NCA with and without the many-runs ensemble.
- **Measure two things:**
  - Accuracy: error in wound size and in time-to-close.
  - Honesty: when it says "90% sure", is it right about 90% of the time? We show a calibration plot, and the width of its ranges.
- **Show failures:** the worst wounds and where confidence breaks down.
- **Also test the "how early can it call it" curve:** error versus how much of the wound's history it has seen (10, 20, 30, 50%).
- **A good result looks like:** on unseen wounds, the NCA ties or beats the best simple method, its 90% ranges really contain the truth about 90% of the time, and we show where it fails. If it does not beat the standard curves, we say so and lead with the confidence ranges, the "unsure" flag and the audit scorecard. That is still a useful finding.
- **Honest limits to say out loud:** with 6 densities or 61 embryos, the confidence checks themselves are rough; and on 1D profiles a spatial model has no advantage.

## Where Boltz fits (and where it does not)
Boltz predicts how a drug molecule binds a protein. A possible side test: do Boltz's predictions for wound-relevant drugs (such as EGFR or ROCK inhibitors) line up with how much each drug slows closure in a scratch assay? But binding is not the same as what a cell does, and we have not found a table of closure results per compound. So:
- If we find such a table in the first two hours, we run a small, honest test (about 15 to 25 Boltz jobs, within the free allowance) and report the result, even if it is a null.
- If not, we do not chase the Boltz prize (it rewards Boltz being central) and enter the main AI for Science track only.

## Time budget
The building closes at 21:00 on Saturday and reopens at 10:00 on Sunday, and submissions close at 12:00 sharp on Sunday. That is only about 9 hours Saturday plus 2 hours Sunday inside the building. Please confirm with the organisers whether working elsewhere overnight is allowed, and plan for the smaller number.

| Who | Job |
|---|---|
| Person 1 | Data loading, the simple baselines, the scoring code |
| Person 2 | The NCA ensemble and its calibration |
| Person 3 | The report page, the video, the public repo |

Rough timeline: hour 0 to 1, load the embryo data and run the simple baselines. Hours 1 to 3, build the NCA ensemble. Hours 3 to 5, calibrate and compare to the Jin data. Hours 5 to 8, build the report and study failures. Sunday morning, record the video, tidy the repo, and submit by 11:30 (the last code commit and video must both be before 12:00).

## The 2-minute video
- **0:00 to 0:15:** the problem, for a named user (a lab scientist deciding whether to stop a plate).
- **0:15 to 1:30:** one real run, start to finish: upload a wound series, see the forecast and its band, the stall flag, the test on unseen wounds, the scorecard against simple methods, the calibration plot, and one honest failure.
- **1:30 to 1:50:** how it is built and what was tested.
- **1:50 to 2:00:** the closest existing tools and how often ours works. Mark anything mocked or sped up.

## Checks to do first
1. Open the embryo dataset: confirm the outlines, frame counts and any extra labels.
2. Open one Jin scratch-assay file with a safe reader and confirm the times, densities and repeats.
3. Read the paper behind the treatment dataset (Zenodo 4991621): cell type, frame rate, drugs.
4. Ask the organisers: what prep is allowed, whether overnight work is allowed, Boltz credits, and the demo video rule (the site says none, the Devpost rules require a 2-minute video).
5. Do a quick literature search for "neural cellular automata" plus wound or scratch assays (earlier searches were incomplete).

## Zooming from single cells to the whole wound (added after multiscale research)
**Short answer:** yes, we can build a view that zooms from individual cells to the whole wound, but the cells you see when zoomed in will be *simulated*, because we found no open dataset with real per-cell tracks at a wound edge. We say that on screen.

**How it works: three layers that share one state**
1. **Cells (zoomed in):** a small cell simulation we write ourselves (about 100 lines). Each cell wanders with a bias toward the gap, divides only when there is room, and edge cells pull inward harder. Toggles for "leader/follower" and "purse-string" show different ways wounds close.
2. **Tissue (middle):** the same cells averaged into a density map, like a heat map of crowding.
3. **Wound (zoomed out):** the closure curve, the neural-automaton forecast and its confidence band. The automaton is trained on the cell simulation's averaged output, so zooming out should give the same answer as zooming in. We test that agreement (density profile, closure-time spread, and front speed against the standard Fisher-KPP formula 2 x sqrt(D x r)) and report it.

**What is real and what is simulated**
- Real: wound outlines over time (fruit-fly embryo set, 61 wounds), cell density across a scratch (Jin 2016), and tissue-level movement of cells (MDCK monolayer data).
- Simulated: individual cells, their paths and divisions. Wound-level curves cannot tell leader/follower from purse-string, so we do not claim to identify the mechanism.
- The fruit-fly images are about 9 micrometres per pixel and show a myosin signal, so single cells cannot be seen in them.

**Data to calibrate the cell layer (all unverified in detail; none gives ready-made cell tracks)**
- Best: Zenodo 4991621 (MDCK monolayer migration, CC0, about 1.5 GB: movies, kymographs, velocity versus density). Use it to set cell speed and how crowding slows cells. Tracks would have to be extracted ourselves.
- Small extras: Zenodo 5880000 movie 5 (88 MB, E-cadherin cell shapes) plus a velocity-field file (about 155 MB); Zenodo 4308385 (226 MB, speed and directionality across cell types).
- Do not use Cell Tracking Challenge data in a public demo without permission.

**How to show it (browser)**
- Tool: deck.gl in a 2D view. Its zoom number drives a crossfade: zoomed out shows the density map, wound outline and forecast panel; zoomed in shows schematic cells with arrows and the leading edge.
- Cheapest honest route: run the automaton in Python, export small files, play them back in the viewer labelled "precomputed simulation". A live in-browser automaton is a stretch.
- Honesty touches: flat schematic cell glyphs (no fake fluorescence), a chip saying "simulated cells, not tracked cells" when zoomed in, observed outlines solid and predicted ones dashed, ensemble disagreement shown as separate trajectories, colour-blind-safe palette, keyboard zoom.
- One time slider drives every scale, and the wound area is the same number at every zoom.

**Minimum impressive version (about 8 build hours)**
- One real wound series; zoom from the closure curve with its band down to migrating, dividing schematic cells; a time slider; honest labels; one failure case shown.
- Cut: vertex and cellular-Potts models, the heavy desktop simulators, 3D, Boltz.
- Stretch: live in-browser automaton, a "what if the wound were bigger" slider, per-cell trails, plate-to-well-to-cell navigation.

**Split of work (3 people):** viewer (deck.gl zoom, layers, labels); data, cell simulation, coarse-graining and the automaton (Python); forecast panel, Figma design, accessibility and the 2-minute video. Figma is also a separate prize open to every track (show how you used it).

**New checks:** frame rate and pixel size in the MDCK sets; whether cells can be tracked from the movies; what is inside the large zip files; check deck.gl performance with a few thousand cells; confirm what prep the organisers allow.

## Anchor paper for the simulated cell layer: Jin et al. 2016 (PMID 26646767, doi 10.1016/j.jtbi.2015.10.040)
- What it says (abstract, via Europe PMC; not full text): scratch-assay closure speed depends strongly on how crowded the cells are at the start. Fitting the standard Fisher-Kolmogorov model gives cell diffusivity D and proliferation rate lambda that change with starting density, so the model's assumption of constants is wrong. The Porous-Fisher model (cell flux rises with local density) gives estimates that vary less, so it describes the experiments better.
- What we take from it for the cell simulator: make cell movement density-dependent (more crowding, more spreading), not a fixed random walk. Fit D and lambda separately per starting density and report how much they drift; that drift is itself a result to show.
- Test it gives us: hold out one starting density, calibrate on the others, and check that the cell simulation and the automaton both predict the held-out profile and closure time. Compare Fisher-Kolmogorov vs Porous-Fisher vs our cell model vs the automaton.
- Caveats: the Elsevier supplement licence is unclear (cite the paper, do not re-host the .xls files); the data are 1D density profiles, so this anchors the density-level behaviour, not the shape of individual cells.

## Extension: a "how it works" readout (movement vs multiplication) and where it applies
Idea (from the team): besides forecasting closure, split each wound's closure into how much comes from cells moving and how much from cells multiplying. This is what makes the tool useful beyond one assay: different diseases and drugs stall different parts of healing. The use cases below are the team's; none is validated by our data or by the research so far, so they go on the "path to the lab" slide as applications, not as claims.

**What the readout is:** per wound or well, an estimate of cell movement (diffusivity D) and cell multiplication (rate lambda), with intervals, plus a plain flag: "movement-limited", "multiplication-limited", "both" or "cannot tell".

**Where it could apply (applications, unvalidated)**
- Diabetic and chronic wounds: patient-derived cells that close scratches slowly could be classed as moving less or multiplying less, pointing to different treatments.
- Infected wounds: test which step stalls under infection-related signals (for example inflammatory signals).
- Cancer: drugs that block cell movement but not multiplication behave differently from the reverse; the split shows it directly. Caveat: scratch-assay migration is only a proxy for spread of cancer.
- Fibrosis and scarring: check whether a treatment calms over-active repair.
- Drug screening: many treatments side by side; mechanism per video plus an early closure forecast saves time and lab space.

**The honest catch: the split can be hard to identify.** Closure curves alone mix the two (front speed depends on D and lambda together, roughly 2 x sqrt(D x lambda)), and a separate 2025 weak-form paper (PMID 41150696) notes scratch closure mixes migration and proliferation. Correction after reading Nardini and Gevertz (arXiv 2606.10873) in full: on the Jin data their migration and proliferation rates (rm, rp) had fairly compact credible intervals; the parameters that were poorly identified were the pulling probability and the delay (a1, partly a0), and their fitted rm and rp rose with starting density (Jin 2016's drift). So the split may be recoverable for simple mechanisms but not for fancier ones; we still test it on simulated wounds and report "cannot tell" where it fails.

**How we make the split credible**
- Use a proliferation-blocked arm as ground truth: Zenodo 4991621 includes mitomycin C data (MDCK; unchecked). If the model, given only closure data, attributes the control-vs-mitomycin difference to multiplication, that is a real validation. Same logic for the CK666 arm (blocks a migration mechanism).
- Use density profiles (shape of the front, not just area) and the cell simulator to break the trade-off; report profile-likelihood or ABC intervals.
- Test on simulated wounds where we know D and lambda: recover them, and show where recovery fails.
- Keep the split a hypothesis-generator for the lab: "run a proliferation-block control next".

**Added to the evaluation:** recovery error and coverage for D and lambda on simulated wounds; agreement with the mitomycin and CK666 arms; fraction of wounds flagged "cannot tell".
**Added to the open checks:** confirm what is inside the 4991621 zips (cell type, frame interval, whether mitomycin vs control are paired); look for any open scratch-assay set with diabetic or patient-derived cells, infection or fibrosis conditions (none found so far).

## Training defaults to start from (from a training-recipe scan; spot-check before relying)
- Start from Growing-CA / Mixtures-of-NCA settings: grid 35x35 to 64x64; 6-16 channels; hidden width 128; 35-96 steps; Adam, lr about 1e-3; batch 8-32; sample pool 600-1024 to keep long rollouts stable; fire-rate mask 0.5; parameters (D, lambda) broadcast as extra input channels.
- Teacher data: about 200 simulated realisations (Mixtures-NCA tissue) up to about 350 trajectories per setting (traffic NCA); a few hundred runs per setting across the parameter sweep.
- Cell-number conservation: use a flux-form "donate then collect" update for movement (exactly conserves mass, no extra parameters); add non-negative source and sink heads for division and death.
- Ensembles: stochastic latent per step trained with an energy score or CRPS on coarse summaries (edge profile, density per bin, area vs time), checked with rank histograms; conformal wrapper on closure curves. No NCA paper was found using these losses, so this is our own design.
- Inversion for the movement-vs-proliferation readout: simulation-based inference (sbi, Apache-2.0) on summary statistics with simulation-based calibration checks; inspect the joint posterior for the D-lambda trade-off.
- Starter code: PWhiddy PyTorch Growing-CA (Apache-2.0) and NCAtorch (MIT) as references; re-implement rather than copy repos with no licence.

## Facts added after reading the papers in full (details in docs/papers/reading-notes.md)
- Jin data as used by Nardini and Gevertz: 6 seeding densities (10K to 20K), 5 times (0, 0.5, 1, 1.5, 2 days), 37 spatial bins of 50 um, 3 replicates averaged. Their forecasts fit times 1 to 4 and score only the final-time MSE; no coverage, no baselines. Credible intervals are for parameters, not forecasts. Our calibration test is therefore a real gap.
- Their ABM (reusable, reimplement): 74x60 lattice, 25 um spacing, Gillespie updates, migration rate rm in [0,0.25] with a pulling probability, proliferation rate rp in [0,5] into empty neighbours, a logistic time delay; fitted PDE point estimates rise with density (for example 12K: rm 0.033, rp 1.457).
- Early forecasting limit (Nardini 2021): learned equations fail when only the first 10% of a logistic-like curve is seen (diverge), plateau wrongly at 20%, and work from about 25% on; the data must pass the inflection point. Our early-call claim must say how early it really works and test it.
- Clinical baselines (read in full): Sheehan 2003 cut-off 53% area reduction at 4 weeks (derived from the same data, not external): sensitivity 91%, specificity 58%, PPV 58%, NPV 91%, healing 58% vs 9% above/below; Warriner 2011: among ulcers already at least 50% reduced by week 4 and unhealed, 52% still failed by week 12; second-stage rule is 90% reduction by week 8 (sensitivity 66%, specificity 71%, NPV 82%, PPV 51%); Cardinal 2009: 72% of venous ulcers fit an exponential decay (median r2 0.87). Never quote 52% as "all foot ulcers".
- Conformal (Portela 2025): intervals cover observed variables at observed times only, so it does not validate forecast coverage; calibrate across wounds (leave-one-wound-out jackknife+ or split conformal across wounds), and note split conformal is inefficient below about 20 observations.
- Visit-schedule robustness (2026 Research Square audit, abstract only): deleting one visit changed event status in some scenarios; include a visit-deletion and image-scale test.

## Jin 2016 confirmed from the full paper (user-supplied PDF)
- PC-3 cells, 96-well IncuCyte plates, 6 starting densities (10,000 to 20,000 cells per well), 3 replicates each, manual cell counts in 38 columns of 50 um at 0, 12, 24, 36 and 48 h; images were taken every 2 h but only these 5 times were counted. Carrying capacity 1.7e-3 cells/um^2; doubling times 10.8 to 15.8 h.
- Fisher-Kolmogorov fits: diffusivity D rose about 3x (roughly 250 to 1030 um^2/h) and proliferation rate lambda rose about 45% (0.044 to 0.064 per hour) with starting density; Porous-Fisher D was far more stable. So our cell simulator should use density-dependent movement and we should show the fitted drift.
- Replicate SDs exist in the supplement (6 files), giving a real replicate-variance reference for the calibration test; licence terms unclear, so cite and do not re-host.

## New candidate dataset: WHAD (Wound Healing Assay Dataset), Zenodo 12806149 (CC BY 4.0; code repo leonardo-iheme/whad_camad_datasets, MIT)
- The GitHub repo is code plus one sample frame and mask only; the data are in one 12.6 GB zip (about 17 GB unpacked) that also holds CAMAD (3D adhesion/motility; irrelevant). Do not download the whole zip.
- Listing read by HTTP range requests (no download of the data): WHAD has 5,510 image frames (about 2.8 MB each, 15 GB uncompressed), 104 assay folders (72 MCF10A, 32 MCF7), 234 imaging positions, and 1,206 mask files (about 22% of frames, so masks are partial; check which frames).
- Time series: most positions have 19 to 25 frames, some 48 to 52, a few 1 to 2. Frame interval and what each condition is are not stated in the repo; file names suggest genetic perturbations (for example CYR61 knockdown vs control in MCF10A, SEMA6D in MCF7). Read the dataset paper (Iheme et al. 2024) or the Zenodo record for the interval, conditions and masking protocol.
- Why it matters: it may be the best open 2D set found for real-cell wound closure with conditions and replicates; one position is about 60 MB, so a few positions can be extracted by range request. Caveat: unchecked frame interval, partial masks, and conditions are knockdowns, not drugs.
- Use: image-NCA benchmark and held-out-condition test (knockdown vs control), complementing the embryo set (61 wounds, no conditions) and Jin (1D, 6 densities).

- Prior art on WHAD (read in full): Cai et al. 2025 (Regen Ther) segment WHAD wounds with UNet++ and fit the group-average closure curve (frame ID as input) with random forest, SVR, ARIMA and TCN (random forest MAE 0.48% for MCF7, 1.73% for MCF10A). It is not per-wound forecasting: no held-out wounds, no uncertainty, no condition arm. Cite it and use "per-wound, early, calibrated, held-out knockdown vs control" as our difference. See docs/papers/reading-notes.md.
- WHAD record pages give only: genetically modified MCF10A and MCF7 cells, phase-contrast time-lapse, CC BY 4.0, alpha version; the interval and condition list are in a login-gated Word document (IEEE DataPort) or the IEEE Data Descriptions paper (doi 10.1109/ieeedata.2024.3481394), neither read yet.

## WHAD details from the dataset paper (open access, doi 10.1109/ieeedata.2024.3481394)
- WHAD = 11 experiments, 5,490 frames, MCF10A and MCF7, imaged every hour for 48 or 72 h at 0.454 um per pixel (cells resolvable), manual wound polygons on the frames up to closure (so series are 19 to 25 annotated frames).
- Conditions are genetic: MCF10A control, NICD overexpression, CYR61 shRNA, NICD + CYR61 shRNA; MCF7 control, SEMA6D, LacZ, SEMA6D overexpression. Held-out-condition tests are therefore knockdown/overexpression vs control, not drugs.
- IMPORTANT: all wounds were pretreated with mitomycin C (2 h, 10 ug/mL) to block proliferation, so WHAD closure is migration-only. The same is true of the MDCK strip data (Zenodo 4991621). Consequences: (a) WHAD cannot test the proliferation half of the movement-vs-multiplication readout; (b) it gives a clean way to calibrate migration alone (and density-dependent movement), and Jin 2016 (proliferation allowed, doubling time 11 to 16 h) then adds the proliferation rate; (c) the cell simulator should have a "no division" mode matching WHAD and a "division on" mode matching Jin; (d) a model that attributes WHAD closure to proliferation is wrong, which is a built-in check.
- No login was needed: the paper is open access. IEEE DataPort has no Google sign-in (IEEE account only), and we do not need its Word documentation now.

## WHAD label coverage (from the dataset's annotation spreadsheet): the important limit
- Raw hourly time-lapse exists for about 104 positions (MCF10A 72, MCF7 32; roughly 3 to 7 videos per condition per experiment), but wound outlines were annotated for only 19 positions (427 frames): MCF10A exp1 only (control CC 7, CYR61 shRNA 6, N61 2, NC 1) and 3 MCF7 positions.
- A knockdown-vs-control held-out test with hand labels is therefore small (7 control and 6 CYR61-knockdown positions, about 20 hourly frames each). To use the other ~85 positions we must segment wounds ourselves (train a small segmenter on the 427 labelled frames, or a classical texture-based method), at the cost of build time and segmentation error that must be propagated into the forecast.
- Frame coverage: closure curves are available only while annotated; all positions are migration-only (mitomycin C). The CAMAD supplements are irrelevant here.
- Decision input: if build time is tight, use the 19 annotated positions as the real-image benchmark (clearly labelled as small) plus the embryo set (61 wounds) and Jin 1D profiles; treat the auto-segmented remainder as a stretch.

## WHAD local copy and first look (14 Nov 2026; data only, no model code written)
- The user downloaded whad_camad.zip (12.6 GB); its MD5 (901e5d13dfd45d55fd13c086db106ef8) matches Zenodo. Only the 19 annotated WHAD positions were extracted (331 images, 404 masks, 0.9 GB) into ~/whad-data (outside the repo, not committed); the disk is 96% full (about 21 GB free), so the full unpack (about 17 GB) was avoided.
- Masks are 1440x1920 binary PNGs (0 and 255); treating 0 as wound gives plausible closing curves. 20 mask frames per position against 21 image frames (t00 to t20, hourly).
- Wound area fraction of the field, first to last annotated frame (16 positions with plain masks; 3 MCF7 positions use a different mask naming and were not read): MCF10A exp1 part I: stalls or slow (C61 positions about 0.29 to 0.31 flat; CC 0.24 to 0.30 falling slowly; NC 0.33 to 0.14; N61 0.28 to 0.21). Part II: closes (C61 0.31, 0.27, 0.23 to 0.10, 0.00, 0.08; CC 0.24, 0.13, 0.14, 0.22 to 0.10, 0.01, 0.01, 0.01; N61 0.20 to 0.01).
- Reading (preliminary): initial wound size varies 0.13 to 0.33 of the field, some positions barely close (a real "stall" case) and others close fully; the knockdown (C61) vs control (CC) difference looks smaller than the part I vs part II difference, so any knockdown-vs-control held-out test is confounded by plate/part (batch effect) and needs care (hold out whole parts, or condition on part). This also gives us natural stall and fast-close examples for the abstain/flag logic.
