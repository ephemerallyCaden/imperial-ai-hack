---
name: science-gap-finder
description: Read a scientific paper (AI for molecules, proteins, cells, materials, chemistry, biology) and surface actionable open problems - unvalidated assumptions, benchmark leakage, out-of-distribution failures, missing experimental validation, uncovered settings, and unjustified heuristics. Trigger when the user shares a paper, preprint or arXiv/bioRxiv link and asks for gaps, weaknesses, open problems, limitations, or what could be built next. Adapted from gap-finder for empirical and applied science. Do NOT use for literature surveys (use literature-review), finding papers (use paper-lookup), or writing a peer review.
---

# Science Gap Finder

Read a paper. Find where the science is thin, and which gaps a small team could attack in ~20 hours with public data, hosted models and compute credits.

Adapted from `gap-finder` (theory-oriented). Here the main evidence is empirical: benchmarks, datasets, wet-lab or simulation validation. Keep the theory probes when the paper has proofs.

A gap is valuable when: (1) the method works on a benchmark but is untested where it matters, (2) a claim is made without the evidence needed, or (3) a natural extension (new target class, new modality, new data regime) is left open. Prefer gaps with a **demoable test**.

## Two failure modes
1. **Fake gaps.** Already addressed in the appendix, supplement, a follow-up paper or a newer model release. Always check, including later versions and papers citing this one (use `paper-lookup` for citations).
2. **Trivial gaps.** "Needs more data" or "could be larger". A gap must be specific, relevant and testable.

## Step 1: Extract the skeleton
Produce a concise structured summary:
- **Claim(s):** exact headline claims, with the metric, dataset and numbers. Include prose claims ("state of the art", "generalises", "FEP-level") not backed by a table.
- **Task and system:** input, output, scientific object (protein-ligand, cell type, crystal structure...).
- **Data:** sources, size, splits, how splits were made (random, scaffold, sequence-identity, temporal, cluster), curation and filters.
- **Evaluation:** metrics, baselines, ablations, number of seeds, error bars.
- **Validation level:** none / retrospective benchmark / prospective computational / wet-lab or experimental. State which.
- **Method vs. evidence:** what the method does vs. what the experiments actually test.
- **Theory (if any):** theorems and assumptions, as in the original gap-finder.

## Step 2: Probe the evidence
1. **Leakage and split validity.** Could test items be near-duplicates of training items (sequence, scaffold, assay series, pretraining corpus)? Is the benchmark in the model's training data? Are splits stricter than the deployment setting needs?
2. **Distribution shift.** Does performance hold on new targets, chemotypes, organisms, cell lines, batches, material families, or lengths and sizes beyond the benchmark?
3. **Baselines.** Are strong, simple and recent baselines included and tuned fairly? Does a trivial baseline (similarity, mean, linear) come close?
4. **Metrics vs. real goal.** Does the metric match what a scientist needs (ranking among actives, hit rate at top 1%, calibration, early enrichment, experimental success rate) rather than correlation over a wide range?
5. **Uncertainty and calibration.** Are confidence scores validated? Do they flag failures?
6. **Statistical strength.** Seeds, confidence intervals, multiple comparisons, cherry-picked targets.
7. **Reproducibility.** Code, weights, data, versions, licences, compute needed.
8. **Experimental validation.** Where claims are about real-world effects, is there any wet-lab or physical validation? Computational-only claims about binding, function or stability are hypotheses.

## Step 3: Probe assumptions and scope
For each modelling assumption (rigid receptor, single conformer, solvent ignored, fixed protonation, static structure, bulk vs. single-cell, ideal crystal, steady state...): is it necessary, is it realistic where the method is used, and what breaks if relaxed?

If the paper has theory, also apply the original `gap-finder` probes (necessity, realism and tightness of assumptions; tightness and regime of bounds).

## Step 4: Structural gaps (the publishable/buildable kind)
- **Benchmark-reality gap:** strong benchmark numbers, untested on the realistic use case.
- **Missing modality or setting:** works for one target class, organism, material family or data type; the neighbour is open.
- **Missing validation:** computational claim never tested experimentally or against a physics-based reference.
- **Unjustified component:** a heuristic or hyperparameter that matters empirically with no explanation.
- **Failure-mode blind spot:** known categories where the model is wrong (cryptic pockets, flexible or disordered regions, metal ions, large ligands, rare cell types, defects) and no method to detect it.
- **Combination gap:** two tools (e.g. a generator and a scorer) are used separately; closing the loop is open.
- **Cost/accessibility gap:** the approach needs resources most labs lack; a cheaper approximation is open.

## Step 5: Hackathon filter
For every gap, answer:
- **Test in <20h?** Public data or benchmark available; compute via hosted tools; a small, checkable experiment.
- **Demoable?** Can the result be shown visually or as a clear before/after number?
- **Evidence strength:** counterexample or measurement we ran / reported by others / suspected only.
- **Novelty check:** searched for prior work addressing it (cite).

## Step 6: Rank and report
Output format:

### Paper skeleton
Concise Step 1 summary.

### Gaps found
For each gap:
- **What's missing:** one sentence
- **Why it matters:** one sentence
- **Evidence:** from the paper (section/table/figure) and whether we verified it
- **How hard:** easy test / moderate / hard open problem / unclear
- **Test we could run:** dataset, model/tool, metric, expected outcome that would confirm or refute the gap
- **Related work checked:** citations, and whether it is already addressed

Order by (impact x testability in 20h), best first.

### What's solid
Briefly note what the paper establishes well, so we build on it.

## Principles
- A gap with a small test we ran is worth ten suspected gaps. Prefer a concrete witness (a target, molecule, split or example where the claim fails) to a general complaint.
- Distinguish "not shown" from "shown false".
- Check appendix, supplement, code repo issues, and later papers before reporting.
- Be concrete: "assumes a rigid receptor" is weak. "Affinity benchmark uses crystal structures with bound ligand; no test on apo or cryptic-pocket targets, where the pose input is unavailable" is a gap.
- Never present model predictions as discoveries. Label hypotheses as hypotheses.

## Hand-offs
- Broader survey of a topic -> `literature-review` / `deep-research`
- Find or verify papers and citations -> `paper-lookup`, `citation-management`
- Turn a gap into testable hypotheses -> `hypothesis-generation`
- Rank candidate directions -> `scientific-brainstorming`
- Single-paper critical review -> `academic-paper-review`
- Theory-heavy paper -> original `gap-finder`
