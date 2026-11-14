# Brainstorm

Track: AI for Science. Stage A pitch cards from scout rounds (abstract-level reading; verify every citation before pitching). Format: idea / first-5-seconds hook / feasibility.

## Ideas

### Round 1: trust and audit themes
- [R1-1] Virtual-cell auditor (cells). Perturbation model vs trivial baseline on real Perturb-seq. Hook: dumb baseline ties a huge model. CPU, yes.
- [R1-2] Crystal phonon-stability checker (materials). Animates AI-generated crystals collapsing, then relaxes them. Hook: crystal shaking apart, "fails about 2/3". CPU, maybe-yes.
- [R1-3] Boltz Trust Meter (molecules). Boltz affinity vs physics/docking cross-check, disagreement flagged; optional activity-cliff atom heatmap. Hook: Boltz's #1 pick is physics rank 70. Yes, uses sponsor tool.
- [R1-4] "Where does the model lie?" (cross). 3D structure coloured by confidence plus training-data leakage badge. Precomputed, maybe-yes.
- Others: uncertainty-aware perturbation prediction, virtual staining with trust meter, cell-type DNA switch, virtual-cell chat agent, PXRD-to-structure, amorphous electrolyte explorer, MOF sliders, synthesis planner, PFAS polymer replacer, D-peptide binder designer, reaction-feasibility check, hypothesis tournament, rare-disease variant viewer, materials "what if" sandbox, paper reproducibility audit.

### Round 2: life creation through cells
- [R2-A] Petri dish of life (ALife). AI searches a GPU sim for life-like creatures, VLM labels them live, click to evolve. Hook: blobs dividing and healing. Yes.
- [R2-B] Dark Genome Detective + Knockout Game (minimal cell, JCVI-syn3.0). Function prediction for unexplained genes plus gene-deletion game with essentiality predictor. Laptop, yes.
- [R2-C] Phage Forge. Evo 2 designs phage genomes, scored for viability, novelty, safety. Needs GPU/hosted Evo 2. Maybe. Biosecurity: bacteriophage only.
- [R2-D] Recoding Explorer. Shrink the genetic code 64 to about 57 codons. CPU, yes, lower novelty.
- Others: protocell pond, prebiotic reaction-network explorer, assembly-index detector, enhancer prompt, circuit stress-tester, genome guard.

### Round 3: AI cellular automata (CA)
- [R3-1] Grow it back. NCA learns tissue/colony growth rules from real time-lapse (Cell Tracking Challenge, wound-healing assays), then user draws a wound and watches it heal. Hook: real microscopy beside model prediction. Yes. Risk: say "learned surrogate", not mechanism; check prior work.
- [R3-2] NCA physics surrogate (Cahn-Hilliard, phase-field, Gray-Scott). Side-by-side solver vs NCA with speed-up and error counters, drag a defect in. Yes. Risk: "why not FNO?"
- [R3-3] Grow-a-material. NCA grows metamaterial microstructure to a painted stiffness map, then a live mechanical load test. Maybe (solver is the hard part).
- [R3-4] Describe a tissue, get a growth rule. VLM-in-the-loop search for CA rules from text (ASAL-style), then cut it and it regrows. Maybe-yes.
- [R3-5] Dial-a-phenotype / genome knobs. Slider "genome" on a trained NCA plus LLM chat mapping requests to knobs. Yes.
- [R3-6] Draw-a-shape sandbox. Draw, grow, poke holes, regrow, shareable link. Best design-prize shell. Yes. Toy risk if alone.
- [R3-7] Inverse design of local rules for a target pattern (zebrafish-style stripes), scored against a PDE or ABM. Yes. Non-unique rules.
- [R3-8] Language-to-life in Flow-Lenia ("a cell that divides"). Maybe. Weak science link.
- [R3-9] Browser NCA cell segmenter (about 10^5 parameters, runs on a phone). Yes. Competes with SAM-class tools.
- [R3-10] Learned CA from molecular simulation for mesoscale kMC. Maybe. Hard to visualise.
- Others: tumour what-if agent (overclaim risk), collective-intelligence NCA, self-replicating NCA, microstructure generator, AutomataGPT on real biology.
- Code to build on: SakanaAI/asal, google-research/self-organising-systems, Chakazul/Lenia. Flow-Lenia JAX repo URL unverified.

## Open questions
- Does judging weight the research finding or the product?
- Evo 2 hosted access / GPU availability (needed for R2-C).
- Prior art check: has anyone trained NCAs on Cell Tracking Challenge or wound-healing time-lapse (R3-1)?

## Parked
- Nothing parked yet. Human picks before Stage B.

### Round 4: NCA practical applications and industry gaps (UNVERIFIED: scouts did almost no web probing; all vendors, datasets, papers from memory)
- [R4-1] Damage-proof tiny segmenter: ~40 KB NCA segmenting cells/defects that keeps working when pixels/weights are "lesioned"; compare vs U-Net. Med-NCA lineage. Cells/materials. Honest risk: small CNNs may match it.
- [R4-2] Self-repairing thermal digital twin: rebuild a chip/battery temperature map after 80% of sensors are killed. Baselines: kriging, U-Net.
- [R4-3] Inverse design of grain structure / heat treatment via gradient through NCA rollout (materials). Check Mullins scaling law, Potts generator.
- [R4-4] Wildfire ensemble emulator: click ignition, 200 stochastic fronts, burn-probability map, firebreak what-if. Data: WildfireSpreadTS, Next Day Wildfire Spread (licences unverified). No molecule/cell link.
- [R4-5] Biofilm/colony growth with hidden nutrient/signal channels (cells/molecules). Real time-lapse data not found; synthetic Monod-diffusion fallback.
- [R4-6] Self-assembly inverse design: draw a target shape, learn local interaction rules, heal after damage, read out a rule table; validate against own lattice Monte Carlo (materials/molecules).
- [R4-7] ASAL-style rule discovery pointed at microstructure statistics (structure factor), gallery of discovered rules (materials).
- [R4-8] Morphogen-pattern/gene-circuit design: pick stripes/French flag, learn cell-cell signalling rule, show wiring diagram (cells/molecules). Rule interpretation is fuzzy.
- Lower: LPBF thermal-history surrogate, battery electrode transport, crack/corrosion fronts, etch profiles, urban growth, flood, pest spread, algal bloom, procedural game textures (weak science), emergent-model arithmetic (fork exp-em43), FPGA/quantised NCA, scientific image compression, sensor-network healing, swarm control.
- Dropped: epidemic contact grids, tumour growth on static spatial omics, nanoparticle formulation screener (no data).

### Round 5: life-science NCA ideas (scouts did real lookups; still verify)
- [R5-1] Wildfire ensemble emulator (user favourite). Data: WildfireSpreadTS (Zenodo 8006177, CC BY 4.0, 13,607 daily images, 607 US fires, zip 48.4 GB; known wind-direction bug in creation code); fallbacks NDWS (Kaggle), FIRMS+GRIDMET. Closest prior art: arXiv 2606.11676 (CNN-parameterised probabilistic CA, 6 fires, no calibrated ensembles). Do not claim "first". Baselines: persistence/dilation, wind-biased random CA, U-Net, ConvLSTM; report AUC-PR, area ratio, Brier, reliability, CRPS. Daily steps only; firebreak what-if is a sensitivity demo.
- [R5-2] Tumour growth forecaster (user wants kept). LUMIERE (91 GBM patients, 638 study dates, CC BY 4.0 per paper, figshare record states no licence; serial MRI + segmentations). Population-level NCA conditioned on baseline mask, ensemble of rollouts, vs Fisher-Kolmogorov baseline. Control: synthetic glioma ground truth. Treatment toggle = toy, no causal claim. No NCA tumour-forecast prior art found (shallow search). Research sandbox only, not clinical.
- [R5-3] Reef recovery emulator ("how quickly does a reef grow back after bleaching?"): scenario (heat stress DHW, depth, connectivity, herbivores, water quality) to recovery trajectory with uncertainty. Real pixel-level recovery data does not exist openly; train on a simple coral-algae simulator, validate with Cresswell et al. meta-analysis (Dryad 10.5061/dryad.rfj6q57gz, CC0) and AIMS LTMP (licence unclear). Heat forcing: NOAA CRW DHW via ERDDAP (5 km daily). Incumbents: ReefMod-GBR, ADRIA.jl (MIT). Risk: "CA imitating a CA".
- [R5-4] Post-fire forest regrowth (wildfire follow-on; MTBS severity + Landsat/Sentinel NDVI recovery). US-only data.
- [R5-5] Tau / alpha-synuclein spread on mouse connectome via graph NCA. Allen connectivity API open; real tau progression data (Zenodo 7942188, 9.4 GB) is access-restricted. Start on simulated spread; baseline network-diffusion/Fisher-Kolmogorov. No prior NCA found (shallow).
- [R5-6] Turing/stripe pattern learner that regrows after erasure (visual, low novelty). Regeneration demos (fin/planaria) likewise.
- [R5-7] Kelp collapse/recovery, biofilm antibiotic penetration, wound closure: data unconfirmed, keep as fallbacks.
- Dropped: crop pathogen lattice spread, condensates, bone remodelling, soil microbes, mangrove/seagrass as lead, mouse xenograft volumes (no spatial grid).
