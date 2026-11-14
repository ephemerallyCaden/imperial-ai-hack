# Boltz-central biology and chemistry ideas (synthesised from earlier research; data claims marked [U] need verification)

Design rules from the evidence:
- Rubric: scientific rigour 30, technical execution 25, path to the lab 20, novelty 15, video and answers 10. Bounty: judged on how central Boltz is, with public repo and last commit before 12:00 Sun.
- Winner precedent: protein/chemistry competitions were decided by measured binding; top teams optimised the scoring metric directly and used strong priors; the Boltz-related hackathon repo that checked Boltz-2 outputs was built around an honest verification harness; Boltz-2 interface confidence (ipSAE) was the selection metric in the Adaptyv one-day hackathon.
- Boltz facts (as of the scout check, partly unverified): API model boltz-2.1, structure+binding job (`ligand_protein_binding`, one small-molecule binder per job, <=128 heavy atoms, ideally <=56), outputs binding_confidence and optimization_score in the API (raw log-IC50 only in the open-source CLI), 200 free predictions/month, $0.025 per molecule in the small-molecule pipeline, roughly 60 s per prediction, test-mode keys; Tamarind hosts Boltz, BoltzGen, Chai, gnina, DiffDock, ESM, ProteinMPNN. Ask sponsors for credits.
- Budget reality: tens to low hundreds of jobs, not thousands. Design every idea around a small, labelled validation set (known actives, decoys, measured KDs) rather than a big screen.

## 1. Boltz Court: when to trust a Boltz prediction, tested on wet-lab data
- One sentence: calibrate Boltz confidence and affinity outputs against measured binding data, then ship a "trust score" that tells designers which predictions to believe.
- User and path to the lab: protein designers choosing which sequences to order; output is a ranked order list with expected hit rate.
- Data: public Adaptyv competition results (EGFR rounds, TREM2, Nipah) with measured KD [U: confirm sequences and KDs are downloadable]; known binder/non-binder pairs from the literature.
- Boltz role: central; generate structures and confidence for every sequence, compare with measured outcomes, add a docking or ESM cross-check as a second opinion.
- Rigour test: AUROC and precision at top-k for ipSAE/ipTM/binding_confidence vs measured binding, reliability diagram, comparison with a trivial baseline (sequence similarity to a known binder).
- 5-second moment: a scatter where Boltz's top pick turns out not to bind, and a traffic light that predicted it.
- Precedent: Harness repo (verifies Boltz outputs), Adaptyv/Arc winners (honest metrics), Lazarus.

## 2. Kinase Resistance Atlas (oncology version of the Resistance Oracle)
- One sentence: show how clinically known EGFR mutations (for example T790M and C797S) change where a drug sits in the pocket, rank mutants by predicted binding against published potencies, and propose analogues that restore binding.
- User and path to the lab: cancer-genomics and medicinal chemistry teams triaging variants of unknown effect; output is a shortlist for assays.
- Data: published mutant IC50 values (ChEMBL, literature) for a handful of drugs and EGFR variants [U: assemble a 20 to 40 point validation table]; PDB complexes of EGFR with osimertinib and others.
- Boltz role: central; structure plus binding for each wild-type and mutant pair.
- Rigour test: rank correlation between predicted binding and published potency, with honest failure cases (single-mutant effects are near model noise).
- 5-second moment: a 3D pocket where the C797S mutation visibly pushes the drug away, with a mutation heatmap along the sequence.
- Alternative target set: bacterial antibiotic-resistance enzymes from CARD.
- Risk: affinity deltas for point mutants may not rank correctly; report it.

## 3. Bee-safe pesticide check
- One sentence: compare predicted binding of neonicotinoid-type pesticides to the pest receptor and the honeybee receptor and flag poor selectivity before a compound reaches testing.
- User and path to the lab: agrochemical regulators and formulators; output is a selectivity ranking for assay prioritisation.
- Data: nicotinic receptor binding-protein structures with bound neonicotinoids [U], pesticide toxicity tables (for example ECOTOX/PPDB) [U].
- Boltz role: central; ligand-protein binding for pest vs bee proteins across 20 to 40 compounds.
- Rigour test: does predicted selectivity rank known bee-toxic vs bee-safe compounds? Use a soluble binding protein, not the membrane receptor, and say so.
- 5-second moment: side-by-side pockets and a selectivity bar that flags a banned compound.
- Risk: weak receptor structures; keep it a prioritisation tool.

## 4. Mirror Court: replicating and extending the D-peptide Boltz ranking claim
- One sentence: reproduce a recent claim that Boltz-2 mirror co-folding confidence ranks D-peptide binders better than sequence likelihood, test it on an independent set, and apply it to a new target.
- User and path to the lab: peptide therapeutics groups that need protease-resistant binders; output is a ranked design list.
- Data: the 31-complex benchmark from arXiv 2609.36057 [U: confirm availability and licence].
- Boltz role: central; the mirror trick is a coordinate reflection plus Boltz-2 confidence.
- Rigour test: replicate the headline ranking, then report where it fails.
- Precedent: Lazarus (says when a result does not reproduce).
- Risk: only 18 affinity points in the original; statistics are weak.

## 5. Decoy Court: does Boltz affinity enrich real drugs for a neglected-disease target?
- One sentence: test whether Boltz binding scores separate known active compounds from property-matched decoys for a parasite target, then rank approved drugs for repurposing with an honest enrichment curve.
- User and path to the lab: neglected-disease drug groups; output is a short list of approved drugs to assay.
- Data: ChEMBL actives for one target and DUD-E-style decoys [U]; a PDB structure of the target.
- Boltz role: central; about 100 to 200 molecules per run to stay within free credits.
- Rigour test: enrichment factor and AUROC against a baseline such as gnina or a fingerprint similarity model.
- 5-second moment: an enrichment curve where known actives rise above decoys, next to a 3D docked pose.
- Risk: false positives; Boltz affinity is not validated on novel targets.

## 6. Plastic-eater triage
- One sentence: rank PET-degrading enzyme variants by predicted binding of a PET oligomer and flag the variants predicted to lose the active-site fit.
- User and path to the lab: enzyme engineers choosing variants to express.
- Data: variant activity tables from the literature (for example FAST-PETase and related) [U]; PDB structures.
- Boltz role: central; structure plus ligand placement for each variant.
- Rigour test: rank agreement with reported activity; binding is not catalysis, so say so.
- Risk: weak proxy for activity.

## 7. Toxin-neutraliser shortlist (antivenom angle)
- One sentence: design or screen binders against a snake three-finger toxin and score the complexes per species with a trust gate from idea 1.
- User and path to the lab: toxinologists and antivenom developers; output is a candidate shortlist.
- Data: UniProt and PDB toxins and known neutralising nanobodies [U].
- Boltz role: BoltzGen or Boltz-2 complex prediction.
- Rigour test: recover known neutralisers from decoys before claiming new ones.
- Risk: scope; biosecurity framing must be neutralisation only; no wet lab.

## 8. Optional hybrid: Boltz on the molecule, a spheroid forecaster on the cell
- One sentence: show a drug-target binding result from Boltz next to a tumour-spheroid response forecast, explicitly as two separate evidence panels and not as a causal link.
- Why only optional: binding affinity does not predict cell response, so any claimed link would look like a toy. Use only if idea 1 or 2 works and the spheroid forecaster (earlier ideas) is already built.

## Ranking by expected Imperial score (judgement)
| Rank | Idea | Why |
|---|---|---|
| 1 | 1 Boltz Court | Rigour first, Boltz central, measured wet-lab ground truth if the data is downloadable |
| 2 | 2 Kinase Resistance Atlas | Strong visual, known literature potencies, clear lab path |
| 3 | 5 Decoy Court | Honest enrichment test, small budget |
| 4 | 4 Mirror Court | Replication story, weak statistics |
| 5 | 3 Bee-safe pesticide check | Crisp narrative, weaker validation |
| 6 | 7 Toxin-neutraliser | Emotional weight, highest scope risk |
| 7 | 6 Plastic-eater triage | Weak proxy |
| 8 | 8 Hybrid | Overclaim risk |

Natural combination: 1 + 2 (a trust gate that decides which Resistance Atlas predictions to believe).

## Verify first (about 1 hour of scout work)
- Boltz API: current endpoints, limits, latency, whether affinity values are exposed, cost per job; any Boltz credits for the event.
- Adaptyv public datasets: are sequences and measured KDs downloadable, with licences.
- EGFR mutant potency table (ChEMBL or papers) and PDB complexes.
- Nicotinic binding-protein structures and toxicity tables for idea 3.
- D-peptide benchmark availability for idea 4.
