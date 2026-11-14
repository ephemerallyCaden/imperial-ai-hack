# Top 10 ideas: winner precedent x NCA research

Triage logic. Winner precedent says: named user with a concrete bottleneck, real data, honest uncertainty and null results, narrow tool, one-click sample, visible evidence trail. Imperial rubric says: scientific rigour 30, technical execution 25, path to the lab 20, novelty 15, video and answers 10; one real run on video; bounty judged on how central the partner tool is. NCA research says: the tiny local-rule model only earns its place through calibrated ensembles, damage robustness, differentiability (inverse design), or browser-size deployment, and must always beat persistence/logistic/diffusion baselines.
Data status tags: [V] verified by probe, [U] unverified. All scout claims need a quick check before building.

## 1. SpheroidTwin: relapse forecaster that knows when to say "I don't know"
- One sentence: from the first 3 to 5 frames of a tumour spheroid, an NCA ensemble forecasts the shrink-and-regrow curve and the day of relapse under a chosen radiation and heat dose, and abstains on cases it cannot call.
- User and path to the lab: radiobiologist deciding which dose combinations to test next; output is a ranked "next plates to run" list.
- Data: BioImages S-BIAD2312, CC0, up to 27 frames over 61 days, dose arms and days-to-relapse in Short_Range.csv [V]; no masks, image-to-CSV mapping unchecked [U].
- NCA role: stochastic ensemble gives the probability cloud and the abstain signal.
- 5-second moment: a spheroid shrinks under 25 Gy, the model cloud tracks it, then both regrow, with "controlled vs relapse" called live.
- Rigour test: persistence, logistic growth, Fisher-KPP; area-trajectory error, relapse-day CRPS, reliability diagram, held-out wells and plates.
- Precedent: NCypher (reports null result), Trialign (cites evidence per call).
- Risk: spheroids are near-circular so overlap gains over persistence may be small; must say "in-silico research, not clinical".

## 2. Baseline Court: an agent that puts any growth-forecast claim on trial
- One sentence: upload a time-lapse or growth table and an agent fits persistence, logistic, Fisher-KPP and a small NCA ensemble, then issues a verdict with calibration plots and "model wins / ties / loses".
- User and path to the lab: any lab or reviewer who gets a deep-learning growth prediction and wants to know if it beats a spreadsheet; works the day it ships.
- Data: spheroid set [V], Jin scratch density profiles [V, licence unverified], Zenodo hydrogel movies [V].
- NCA role: one of the contestants, not the hero; the product is the audit.
- 5-second moment: a courtroom-style scorecard where a fancy model ties a two-parameter fit.
- Rigour test: self-evident; ship the harness on three datasets.
- Precedent: Lazarus (says when it cannot reproduce), Adaptyv/Arc winners (honest statistical baselines).
- Risk: less visually flashy; needs a strong UI.

## 3. PocketScope: a 40 KB cell outliner that survives being damaged
- One sentence: a tiny browser-run NCA outlines spheroids or cells, keeps working after you wipe pixels and weights, and runs on a phone camera.
- User and path to the lab: bench scientists without GPUs and point-of-care labs; also supplies the missing masks for idea 1.
- Data: S-BIAD2312 images [V], BBBC019 DIC with manual masks, CC BY [V].
- NCA role: parameter count, local compute and self-repair are the real advantages.
- 5-second moment: erase 30% of the image and 20% of the weights; the NCA outline heals while a U-Net collapses.
- Rigour test: Dice vs a small U-Net, with size, peak memory, wall-clock and robustness reported together; time it on an actual phone.
- Precedent: one-click sample demos; tool-shaped winners.
- Risk: a small CNN may match accuracy and speed; claim robustness and size only.

## 4. Early Call: antibiotic-stress growth forecaster for resistance testing
- One sentence: forecast from the first minutes of single-cell time-lapse whether bacteria will survive an antibiotic, with calibrated confidence.
- User and path to the lab: clinical microbiology and AMR labs wanting faster susceptibility calls.
- Data: Dunlop efflux-pump antibiotic-stress time-lapse, Zenodo 4998745, CC0, 35 MB, contents (images vs traces) unverified [U]; mother-machine tracking set 11237127, CC-BY, 315 MB, no drug arm [V]; death-rate tables 6578974, CC0, no images [V].
- NCA role: a 1D NCA along the mother-machine chamber (a lane, so geometry fits); ensemble for confidence.
- 5-second moment: a clock counting minutes, with the survive/die call and confidence band firming up.
- Rigour test: logistic growth fit and a simple classifier on early growth rate; time-to-correct-call.
- Precedent: HomeReady, veTriage (triage tools with a named user).
- Risk: data contents unverified; if no images, fall back to the trace-based forecaster and lose the NCA story.

## 5. Resistance Oracle + Rescue (Boltz bounty entry)
- One sentence: scan mutations in an antibiotic target with Boltz, show the drug detaching from the pocket, then propose analogues that restore binding.
- User and path to the lab: AMR surveillance scientists triaging unknown-effect mutations; output is a shortlist for assays.
- Data: PDB structures, CARD and WHO mutation catalogue for known resistant vs wild-type pairs [U to fetch]; Boltz API test-mode keys and 200 free monthly predictions [DOCS].
- NCA role: none; this is the bounty-centrality play.
- 5-second moment: a 3D pocket where a red mutation makes the drug visibly lift away, with a per-residue heatmap.
- Rigour test: ranking accuracy against known resistant/wild-type pairs first; report where Boltz affinity fails (single-mutant deltas are near model noise).
- Precedent: Adaptyv winners validated against measurement; Harness repo (checks Boltz outputs).
- Risk: overclaiming affinity; Boltz API latency and credits unverified.

## 6. Resistance Spread Playground (Boltz feeding an NCA)
- One sentence: turn predicted mutation effects into a fitness parameter and let an NCA ensemble show how resistance could spread across a hospital ward or farm map under different dosing policies, labelled as a scenario.
- User and path to the lab: stewardship teams exploring "what if" policies; the Boltz half supplies the lab path.
- Data: as idea 5 plus a synthetic contact map [explicitly illustrative].
- NCA role: spatial spread ensemble with policy sliders.
- 5-second moment: a ward map changing colour as a mutant takes over, with the molecular pocket inset.
- Rigour test: sensitivity analysis only; compare to a well-mixed SIR baseline; no prediction claims.
- Precedent: bridges Boltz-centrality with the winner-favoured "story".
- Risk: binding affinity is not fitness, so a sceptical judge will say toy; use only if idea 5 works first.

## 7. FireLine: calibrated fire forecasts that tell you when to trust them
- One sentence: a stochastic NCA ensemble produces burn-probability maps on held-out fires with an area-ratio and reliability scorecard, plus a firebreak sensitivity brush.
- User and path to practice: fire-service planners; not a lab, so the "path to the lab" criterion fits poorly.
- Data: WildfireSpreadTS CC BY 4.0, 48.4 GB zip streamable per fire [V]; AFSeq CC BY 4.0 [V, size unknown].
- NCA role: cheap, calibratable ensemble.
- 5-second moment: a named fire (e.g. Bear 2020) with 50 fronts and a reliability dial; persistence shown beside it.
- Rigour test: persistence/dilation, wind-biased CA, U-Net, ConvLSTM; Brier, ECE, CRPS, area ratio; held-out years.
- Precedent: a WildFire project already won at IC Hack 2026; differentiate by calibration.
- Risk: ties persistence; firebreak is only a sensitivity demo.

## 8. Seed Detective: infer where a brain pathology started
- One sentence: given a pathology pattern across brain regions, a differentiable graph NCA infers the most likely seed region and the spread pace, with an ensemble of alternatives.
- User and path to the lab: neurodegeneration labs choosing injection sites for the next cohort.
- Data: Allen connectome matrices, MIT [V]; Henderson alpha-synuclein at 1, 3, 6 months, 16 mice [V]; tau data single time point [V].
- NCA role: differentiability turns the forward model into an inverse tool; ensemble gives seed posterior.
- 5-second moment: a glass brain where candidate origins light up and narrow as months are added.
- Rigour test: network diffusion and Fisher-Kolmogorov baselines; recover the known striatal injection from simulated and real data; leave-animal-out.
- Precedent: honest falsifiable inverse problem; a 2026 graph network used the same data, so novelty is the inverse use plus calibration.
- Risk: tiny data (16 mice); overfitting.

## 9. ReefRx: the cheapest way to help a reef recover
- One sentence: given a heat-stress scenario, an NCA emulator forecasts coral recovery with uncertainty and uses gradients to find the cheapest restoration pattern.
- User and path to practice: reef managers; validation against real recovery rates.
- Data: Cresswell et al. CC0 meta-analysis (browser download) [V], NOAA DHW via ERDDAP [V], ADRIA.jl MIT parameters [V].
- NCA role: differentiable surrogate for inverse design; the teacher simulator is open and small.
- 5-second moment: drag a heat-wave slider, reef bleaches, then drag restoration "seeds" and watch the recovery fan tighten.
- Rigour test: fit to Cresswell recovery-vs-loss relation; coverage of the uncertainty band on held-out trajectories; simulator vs NCA fidelity out of distribution.
- Risk: "a cellular automaton imitating a cellular automaton"; lead with inverse design.

## 10. Trap Planner: where to put the next surveillance trap
- One sentence: an ensemble forecasts where the spotted lanternfly or Asian hornet spreads next, corrects for observer effort, and recommends the trap sites that most shrink the uncertainty.
- User and path to practice: state plant-health agencies and beekeeper networks.
- Data: GBIF occurrences, 80,711 lanternfly and 490,304 hornet records [V]; licences per record.
- NCA role: grid ensemble plus active-learning style trap placement.
- 5-second moment: a map of a decade of spread, then click a trap and watch the uncertainty cone shrink.
- Rigour test: diffusion-plus-jump baseline; observer-effort correction; held-out later years.
- Risk: presence-only bias (forecasts where people look).

## Ranking by expected Imperial score (judgement, not evidence)
| Rank | Idea | Why |
|---|---|---|
| 1 | 1 SpheroidTwin (with 3 as its segmenter) | Real dose arms, falsifiable, lab-linked, honest abstention |
| 2 | 5 Resistance Oracle + Rescue | Only direct Boltz-bounty play, strong visual, clear lab path |
| 3 | 2 Baseline Court | Fits winner pattern of honesty, immediately useful, cheap |
| 4 | 8 Seed Detective | Falsifiable inverse problem, small open data |
| 5 | 4 Early Call | Real user, but data contents unverified |
| 6 | 7 FireLine | Best data, but crowded and poor lab-path fit |
| 7 | 9 ReefRx | Good story, weak data, "toy imitating a toy" risk |
| 8 | 10 Trap Planner | Strong demo, biased data |
| 9 | 6 Resistance Spread Playground | Cool, overclaim risk |
| 10 | 3 PocketScope standalone | Best as a component of 1 |

Natural combinations: 1+3 (forecaster with its own tiny segmenter), 1+2 (forecaster plus audit), 5+6 (Boltz core with spread scenario). Keep to the 4-person, 20-hour budget: at most one primary and one component.
