# Decisions

<!-- YYYY-MM-DD HH:MM [name] Decision: what we chose. Why. Alternatives dropped. -->

## 2026-11-14 Wound healing project: design decisions (terse)
Legend: DECIDED = user said so; PROPOSED = our recommendation, not yet confirmed; OPEN = needs a check or answer.

### Scope and goal
- DECIDED: main track AI for Science; project is wound healing. Make it practical, not a toy. Biology/chemistry focus; consider Boltz.
- DECIDED: simulate at cell level with a zoom from cells to whole wound.
- PROPOSED: product = ClosureCall: early closure forecast + calibrated confidence + stall/"measure again"/out-of-band flags, from first 20-30% of a wound series. Research prototype, advisory only, no clinical or drug-effect claims.
- PROPOSED: primary user = assay scientist deciding whether to stop/extend a plate; clinical 4-week-rule is the later path and baseline, not a claim.

### Model
- PROPOSED: tiny stochastic neural cellular automaton (NCA) ensemble for uncertainty; conformal calibration over wounds on top; scalar mode (any CSV of wound size) + image/mask mode.
- PROPOSED: three linked layers: cell simulator (custom lattice agent model, ~100 lines JS) -> density map -> NCA trained on coarse-grained output -> closure curve + band. Check cross-scale agreement (density profile, closure-time spread, front speed vs Fisher-KPP 2*sqrt(D*r)).
- PROPOSED: cut vertex/cellular-Potts models, heavy desktop simulators, 3D, BINN/ME-EQL implementations.

### Data
- PROPOSED primary: Zenodo 7660424 fruit-fly embryo wounds (CC BY 4.0, 199 MB, 61 wounds, 1 frame/min, wound outlines only; cells not resolvable).
- PROPOSED second benchmark: Jin 2016 scratch profiles in Nardini repo (1D, 6 densities x 5 times; licence unclear: cite, do not re-host).
- PROPOSED cell-layer calibration: Zenodo 4991621 (MDCK monolayer, CC0, ~1.5 GB), plus small extras 5880000 (movie 5, PIV) and 4308385. Cell tracks must be extracted by us.
- DECIDED against: Cell Tracking Challenge in a public demo (needs permission); controlled-access/huge sets; clinical foot-ulcer image sets (no healing series).
- Honest claim: individual cells are simulated, not observed; wound-level curves cannot identify leader/follower vs purse-string.

### Evaluation (rubric: rigour 30, execution 25, path to lab 20, novelty 15, video/answers 10)
- PROPOSED: held-out wounds + one held-out condition (wound size or density); baselines: persistence, linear, logistic/Gompertz, Fisher-KPP/Porous-Fisher, Nardini Model 4 (reimplement), small MLP/LSTM, deterministic NCA; metrics: area and time-to-90% error, 90% coverage with CI, interval score, CRPS, reliability plot, stall/flag precision-recall, error vs fraction observed, simulated plate-hours saved; show failures.
- PROPOSED: if NCA does not beat Gompertz/Fisher-KPP, say so and lead with calibration, abstention and the audit scorecard.

### Interface
- PROPOSED: deck.gl 2D view with semantic zoom crossfade (density map + outline + forecast zoomed out; schematic cells + arrows zoomed in); one time slider; one shared state; area identical at every zoom.
- PROPOSED: Python-exported static files played back, labelled "precomputed simulation"; live in-browser NCA only as stretch.
- PROPOSED honesty UI: flat schematic cells (no fake fluorescence), "simulated cells, not tracked cells" chip, observed solid vs predicted dashed, ensemble disagreement as separate trajectories, colour-blind-safe palette, keyboard zoom. Figma file for the Best Designed prize (open to every track).

### Boltz
- PROPOSED: not central. Only run a small falsifiable Boltz test (Boltz binding vs ChEMBL potency vs scratch closure for EGFR/ROCK/FAK inhibitors, ~15-25 jobs) if a compound-labelled closure table is found in the first 2 hours. Otherwise skip the Boltz bounty and enter the main track only.

### Team and time
- PROPOSED split: P1 data/baselines/scoring; P2 NCA/calibration; P3 report UI/video/repo. Or viewer / data+models / forecast panel+design+video.
- OPEN: only ~9 h Sat (12:10-21:00) + ~2 h Sun inside the building; confirm if work elsewhere overnight is allowed.

### Event rules to obey (verified)
- Teams 1-4 students; building starts 12:10 Sat; pre-existing projects not eligible (no model code before then; ask what prep is allowed).
- Submit 2-minute video + public repo by 12:00 sharp Sun (video and last commit before 12:00). `HACKATHON.md` has the old 10:00 deadline and overnight plan: needs fixing.
- 10-minute judging slot: video, 6 min questions, no slides/live demo. Site says no demo video; Devpost rules require one: follow Devpost, confirm.

### Open checks (first hour)
1. Open 7660424 zip: masks, frame counts, metadata. 2. Open one Jin .xls with a safe reader. 3. Check 4991621 paper (cell type, frame interval, zip contents). 4. Ask organisers: prep allowed, overnight work, Boltz credits, video rule. 5. Quick literature check for NCA + wound/scratch and the 2026 audit of wound proxies. 6. deck.gl performance with a few thousand cells.

## 2026-11-14 20:15 [randodeh] Data and splits (R15 in design.md)
- DECIDED: WHAD part I and part II are the same wounds filmed consecutively; split by physical wound (leave-one-wound-out), not by part.
- DECIDED: add 22 auto-segmented WHAD MCF10A wounds (exp1 remainder + exp2) and WHiM-BC (12 monolayer + 12 sphere) as data; report manual-mask-only results too.
- DECIDED: held-out conditions = WHAD CC to C61, WHiM-BC monolayer to sphere. Gate at 00:00 Sun.
- DROPPED: HUVEC/SKOV-3 (Zenodo 21779854) and the diabetic study (19738270): only 2-4 time points per series.

## 2026-11-14 20:26 [ephemerallyCaden] Playback visuals (P2-10)
- DECIDED: sim rules frozen for gate; visuals use smoothed density + outline; vacancy spreading = sheet stretching; revisit sheet-like rule after 00:00
- DECIDED: playback layers: `density_fine` (occupancy upsampled 2x, Gaussian sigma 2.5 sites) and an area-matched outline (outlined area = wound_frac, same area at every zoom); raw agents only at deep zoom. Code in `sim/smooth_view.py`; Agent 3's worker uses the same parameters.
- DECIDED: zoom view = the real 32x44 WHAD run (exp1_partII_C61_P2); no larger synthetic field for now. Frozen rules close slower in bigger fields (same 12-site scratch, Tm 0.5, bias 0.78: area_norm at 19 h 0.19 in 44x44 vs 0.36 in 44x456; draw_tool CC preset 0.81 at 24 h in 120x168), because vacancies leave through the border reservoir.
- DECIDED: playback files carry density_fine and outline parameters (sigma, levels, display hints) but no frames; the viewer recomputes both from agents (--fine-frames to include them; sim/js/smooth.js matches sim/smooth_view.py). Outline display: opacity fades from level 0.85 to 0.95; closed loops under 4 sites of area dropped.

## 2026-11-14 22:40 [randodeh] Flags (R16 in design.md)
- DECIDED: ship the stall flag (validated). Out-of-band shown as an observation only. No measure-again flag until a signal passes (AUC > 0.7).

## 2026-11-14 22:45 [randodeh] Gate (R18 in design.md)
- DECIDED: NCA not passable at 3.8 h (29% worse than edge speed). Edge-speed + conformal ships as the forecaster; NCA = draw-tool emulator. NCA ties/beats baselines at 9.5 h. Cut-offs are 1.9/3.8/5.7/9.5 h.

## 2026-11-14 23:45 [randodeh] NCA fine-tuned on real frames (R26 in design.md)
- RESULT: real-data NCA passes the gate (9/12; 3.8 h within 4% of edge speed; best at 9.5 h). Zaritsky extra data hurt; not used.
- OPEN for P2/P3: use the real-data NCA in the upload/agent path, or keep edge speed (marginally better early, no torch).
