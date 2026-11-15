# Research report: AI for Science track (Phase A idea generation, Phase B verification)

Status at 14 Nov 2026. Evidence base: about 45 scout reports. Most reading was abstract-level and many arXiv IDs are dated after our knowledge, so every citation and every "nobody has done X" claim must be verified before it goes in a pitch. Ratings called "wow" are scout judgements, not ours. One scout (big AI-lab hackathon winners) had not reported when this was written.

## 1. What we are playing for (verified against the Devpost rules and event site)
- Track: AI for Science, "use AI to speed up how we understand and design molecules, cells and materials". Prizes: 1st GBP 500, 2nd GBP 200 (Amazon vouchers); bounty "Best use of Boltz" (Boltz credits); Figma and Adaption prizes open to every track.
- Marks: scientific rigour 30, technical execution 25, path to the lab 20, novelty 15, video and answers 10. Rigour plus path to the lab is half the score; wow factor is not a criterion by itself.
- Format: 2-minute video + public repo on Devpost. Judging Sun 13:00 to 16:30, 10-minute slot (video, then 6 minutes of questions); no slides, no live demo. The video should show one real run of the whole task.
- Constraints: teams of 1 to 4 students; building starts 12:10 Sat; pre-existing projects not eligible; building closes 21:00 Sat (no overnight); submissions close 12:00 sharp Sun (video and last commit before then). `HACKATHON.md` still has the old 10:00 deadline and overnight plan; needs correcting. Conflict to confirm with organisers: site says no demo video, Devpost rules require one.
- Bounties are judged on how central the partner tool is, so a project that does not use Boltz cannot win the Boltz bounty.
- Details: `docs/event-rules.md`.

## 2. Process so far
- Setup: installed research skills (literature-review, paper-lookup, citation-management, hypothesis-generation, scientific-brainstorming, systematic-literature-review, academic-paper-review, deep-research, gap-finder) and wrote `science-gap-finder` (empirical-science version of gap-finder). Plan with a human gate between Stage A and Stage B: `docs/research-plan.md`.
- Stage A (diverge) ran in five rounds: trust/audit ideas by domain; life-through-cells; AI cellular automata (NCA); NCA industry gaps; life-science spread/recovery. All cards logged in `docs/brainstorm.md`.
- Stage B (verify) ran on the chosen ideas: `docs/stage-b-findings.md`.

## 3. Phase A summary
- Round 1 (molecules, cells, materials, cross-cutting): dominant theme was "audit where a model cannot be trusted" (virtual-cell auditor, crystal stability checker, Boltz trust meter, confidence/leakage explorer).
- Round 2 (life creation through cells): minimal cell, ALife search, AI-designed phage genomes, genetic-code recoding.
- Round 3 (AI cellular automata): learned local-rule models on real microscopy, NCA physics surrogates, growing/repairing shapes, language-to-life search.
- Round 4 (NCA industry gaps, scouts did almost no web probing so all unverified): damage-proof tiny models, self-repairing digital twins, differentiable inverse design, self-assembly, wildfire.
- Round 5 (life-science spread and recovery, real lookups): wildfire, tumour, reef, brain protein spread.
- Extra rounds: new ecology/health ideas (invasion fronts, vector-borne disease, wastewater, pollen) and new molecule ideas with Boltz/Tamarind (resistance oracle, antivenom, bee-safe pesticide).

## 4. Phase B findings by candidate
Common honest weakness for every NCA/forecasting idea: the tiny model must beat a trivial or physics baseline (copy-yesterday persistence, dilation, logistic, Fisher-Kolmogorov, a small U-Net). The defensible contribution is usually calibrated uncertainty plus an honest scorecard, not accuracy.

- Microscopy NCA (R3-1): still open as a combination (NCA on real time-lapse, benchmarked vs Fisher-KPP/ABM, with calibration). Earlier "scoops" (Richardson 2024, MNCA 2506.20486) used synthetic data only; NeuralCPM is not an NCA. Neighbours: BINNs, ME-EQL, OrgaCast (organoid diffusion forecaster). Data thin: Cell Tracking Challenge restricts non-CTC use and has no treatment arms; the wound-healing Zenodo record 21031330 is controlled access; usable: Jin 2016 scratch-assay density profiles (1D, 6 seeding densities, 0 to 48 h, 12 h steps, data licence unverified), Zenodo 4932716 (CC0 hydrogel movies, unknown frame interval, one clip per condition). No images with a drug arm. Perturbation claims are out of distribution, so no drug-effect prediction.
- NCA physics surrogate (R3-2): novelty low to moderate; arXiv 2608.30328 already compared NCA with PDE-Net/PINN/FNO on five PDEs, and the NCA loses on Allen-Cahn (0.052 vs PDE-Net 0.015). 2D Cahn-Hilliard is cheap to solve. Credible only with conservation checks, 10x+ horizons, OOD detection and solver fallback. Demand scout ranked "surrogate with receipts on PFHub benchmarks" most practical, with unverified demand.
- Life-like simulation (R2-A) and minimal cell (R2-B): R2-A is ASAL territory (needs human-validated life-likeness score); R2-B has direct prior art (mirofish-syn3a); blind recovery of Mushegian 2026's 12 gene functions is the credible test.
- Wildfire ensemble: rating 6 (4 without a calibration win). WildfireSpreadTS (CC BY 4.0, 13,607 daily images, 607 fires, 48.4 GB zip) can be streamed per fire via HTTP range requests (20 to 30 fires about 2 GB); wind-direction issue is in the loader's sin-only encoding, raw data intact; AFSeq (1,194 fires, 2023 to 2026, CC BY 4.0) is an alternative. Persistence is strong (AP 0.287 on 2021, 4-year mean 0.193); weather channels add little (0.03 AP going from 7 to 23 channels); top-AP models over-predict area 4 to 23x. Closest prior art: arXiv 2606.11676 (CNN-parameterised probabilistic CA, 6 fires, no UQ). Firebreak what-if is only a sensitivity demo; a prior paper's 89.5% reduction is in-simulator only. Same hackathon series already gave a WildFire project a prize at IC Hack 2026. Post-fire regrowth cut as too costly.
- Tumour forecaster: rating 6, up to 7 if calibrated. Glioma route is heavy and weak: LUMIERE is a 32.6 GB zip with automated masks (licence conflict: CC0 on Figshare, CC BY 4.0 + non-commercial note in paper); MU-Glioma-Post (CC BY 4.0 on TCIA, 203 patients, 11 GB, refined masks, scans about 60 to 90 days apart); growth-region Dice about 0.2; persistence strong; diffusion-model prior art (Liu TMI 2025) covers uncertainty and treatment scenarios. Better version: tumour spheroids, BioImages S-BIAD2312 (CC0, brightfield, up to 27 frames over 61 days, radiation x hyperthermia dose arms, days-to-relapse labels, one plate about 0.15 to 0.6 GB, no masks, image-to-CSV mapping unchecked).
- Reef recovery: rating 5. Real pixel-level recovery data does not exist openly; train on a small coral-algae simulator copied from open ADRIA.jl logic; validate against Cresswell et al. CC0 meta-analysis (browser download needed); NOAA CRW heat stress via ERDDAP works. Main critique: a surrogate cannot beat its teacher simulator ("CA imitating a CA"); lead with inverse design and calibration.
- Brain protein spread: rating 6. Connectome (about 58x58 regions, MIT) and Henderson alpha-synuclein data (3 time points, 16 mice) are open and small; tau data single time point; richer tau set restricted. Diffusion baseline gets r about 0.6 to 0.7 with one parameter; a 2026 graph neural network already used the same data; overfitting risk.
- Resistance oracle (Boltz): rating 8 by scout. Mutation scanning of antibiotic targets with a pocket-detachment visual, plus analogue rescue; single-mutant affinity deltas are within model noise, so validate ranking against known resistant/wild-type pairs first. Only candidate with a direct Boltz-bounty fit besides antivenom and pesticide ideas.
- Invasion front what-if (lanternfly / Asian hornet via GBIF): rating 8 by scout; small open data; must model observer effort and beat diffusion-plus-jump.
- Boltz/Tamarind facts: domains moved to boltz.com; Professional plan $0 with 200 free predictions/month; small-molecule pipeline $0.025 per molecule; Tamarind AF3-class jobs about 10 min; no hackathon credit page found, ask sponsors on site; API latency and limits unverified.

## 5. Winner evidence (what we could verify)
- Event-specific: judges "to be added"; the same series' IC Hack 2026 winners that touch science include a wildfire-spread project (real data, Monte Carlo, validation vs real fire starts), a health triage voice agent, a clinical protocol search; earlier Imperial AI Hack winners not found.
- Protein/virtual-cell competitions (verified): winners were decided by wet-lab binding or held-out experiments; top teams optimised the scoring metric directly; hybrid/statistical approaches often beat pure end-to-end (Arc Virtual Cell Challenge); starting from a strong prior beat novelty; in a one-day Adaptyv hackathon humans and AI agents tied on hit rate but agents converged on one tool.
- General hackathon evidence: teams of 4 to 5 with aligned interests did best in a study of about 10,000 Devpost projects; judges see each team about 3 minutes and rank their top 3 (MLH guidance); organiser advice: make the repo build from a clean clone and say what is mocked.
- Gap: no verified science-hackathon winner write-ups beyond the above.

## 6. What the rules change
- Optimise for scientific rigour, path to the lab, and one real end-to-end run, not for visual polish alone.
- Always report persistence/dilation/logistic baselines and calibration; show failure cases honestly.
- Name a real user and the path from the tool to a lab or practitioner.
- Plan for a 2-minute video, a 6-minute question session, a 12:00 deadline and no overnight work; avoid pre-built models.
- If chasing the Boltz bounty, Boltz must be central; none of the spread/recovery ideas use it.

## 7. One-sentence descriptors for all ideas

### Round 1 (trust and audit)
- R1-1 Virtual-cell auditor: compare a fancy gene-perturbation model against a trivial baseline on real Perturb-seq data to show whether it learned anything.
- R1-2 Crystal phonon-stability checker: test AI-generated crystals for dynamic stability and animate the unstable ones collapsing.
- R1-3 Boltz Trust Meter: line up Boltz affinity rankings against a physics or docking cross-check and flag where they disagree.
- R1-4 "Where does the model lie?" explorer: colour a 3D structure by model confidence and flag test cases likely seen in training.
- Uncertainty-aware perturbation prediction: predict gene or drug effects per cell with a confidence map and a next-experiment suggestion.
- Virtual staining with trust meter: turn a label-free image into a stain map and highlight unreliable regions.
- Cell-type DNA switch designer: design short regulatory DNA that activates a gene only in a chosen cell type and score off-target activity.
- Virtual-cell lab chat agent: answer "what if I knock out X" by running a virtual-cell model with its baseline comparison built in.
- Powder-XRD to structure: rank candidate crystal structures from an uploaded diffraction pattern with a refinement overlay.
- Amorphous electrolyte explorer: show where universal interatomic potentials break on glassy battery electrolytes and fix them by fine-tuning.
- MOF carbon-capture sliders: edit a metal-organic framework's building blocks and see predicted CO2 uptake update with sanity checks.
- Inorganic synthesis planner: suggest a synthesis route for a target compound with confidence and literature citations.
- PFAS-free polymer finder: generate alternative polymers for a plastic to replace with predicted properties.
- D-peptide binder designer: design protease-resistant mirror-image peptide binders ranked by mirror co-folding confidence.
- Reaction reality check: score each step of an AI-proposed synthesis for feasibility and highlight steps a chemist would reject.
- Hypothesis tournament: have AI hypotheses compete in a bracket with every claim traced to sources.
- Rare-disease variant viewer: show a patient-relevant mutation on the protein with a plain-language effect and uncertainty bar.
- Materials "what if" sandbox: drag sliders on a familiar material and watch a fast learned potential respond.
- Paper reproducibility audit: check a paper's headline benchmark for train/test leakage and missing code or data.
- Chemist vs AI taste test: let the audience guess which molecule is the AI-invented one.
- Binding explainer: write a chemist-readable explanation of why a predicted complex binds.
- Activity-cliff heatmap: colour each atom of a drawn molecule by how likely a small edit there causes a large potency change.
- Binder-design race: run several design strategies against one target and compare them live.

### Round 2 (life creation through cells)
- R2-A Petri dish of life: search a GPU simulator for life-like creatures, label them with a vision model, and let users click to evolve them.
- R2-B Dark Genome Detective + Knockout Game: predict functions for the unexplained genes of the smallest synthetic cell and let users delete genes to see predicted growth.
- R2-C Phage Forge: use a genome language model to design bacteriophage genomes scored for viability, novelty and safety.
- R2-D Recoding Explorer: shrink the genetic code from 64 toward 57 codons and show which genes break or survive.
- Protocell pond: simulate a primordial pond where an AI tunes conditions until self-replicating vesicles appear.
- Prebiotic reaction-network explorer: grow a network of sugars and amino acids from a few simple molecules and highlight autocatalytic loops.
- Assembly-index life detector: score a molecule's construction complexity to ask whether it looks made by life.
- Enhancer Prompt: generate DNA switches for a cell type from a handful of example enhancers.
- Circuit stress-tester: mutate a designed gene circuit over generations and show when its function decays.
- Genome Guard: screen AI-designed sequences for hazards by function or embedding similarity, using benign proxies only.
- Minimal-genome trimming oracle: predict which bacterial genome regions can be deleted.
- Starvation-proof synthetic cell designer: optimise a simulated bottom-up synthetic cell's resource parameters.

### Round 3 (AI cellular automata)
- R3-1 Grow it back: train a neural cellular automaton on real cell time-lapse to forecast growth and heal a user-drawn wound.
- R3-2 NCA physics surrogate: replace a slow materials simulation with a tiny learned rule shown side by side with error and speed counters.
- R3-3 Grow-a-material: grow a metamaterial lattice from a painted stiffness map and test it under a live mechanical load.
- R3-4 Describe a tissue, get a growth rule: let a vision-language agent search for local rules that grow a text-described form.
- R3-5 Dial-a-phenotype: put sliders on a trained automaton's learned "genome" and drive it with a language chat.
- R3-6 Draw-a-shape sandbox: draw a shape, watch cells grow it, damage it and watch it regrow.
- R3-7 Inverse pattern design: search for local cell rules that grow a target pattern such as zebrafish stripes.
- R3-8 Language-to-life in Flow-Lenia: type a behaviour such as "a cell that divides" and find a continuous automaton that does it.
- R3-9 Browser cell segmenter: a roughly 100k-parameter automaton that outlines cells on a phone.
- R3-10 Molecular-simulation CA: learn automaton rules from small molecular simulations to generate large lattices.
- Tumour what-if agent, collective-intelligence automaton, self-replicating automaton, microstructure generator, AutomataGPT on biology: see `docs/brainstorm.md`.

### Round 4 (NCA industry gaps, unverified)
- R4-1 Damage-proof tiny segmenter: a roughly 40 KB model that keeps outlining cells or defects after pixels and weights are wiped.
- R4-2 Self-repairing thermal twin: rebuild a chip or battery temperature map after most sensors are killed.
- R4-3 Grain-structure inverse design: find the heat-treatment schedule that produces a painted grain pattern by differentiating through the model.
- R4-4 Wildfire ensemble emulator: click an ignition point and watch many stochastic fire fronts form a burn-probability map.
- R4-5 Biofilm growth with hidden nutrient channels: grow a colony and display the learned nutrient-depletion zone.
- R4-6 Self-assembly rule designer: draw a target shape and learn the local interaction table that grows and repairs it.
- R4-7 Rule discovery for microstructure statistics: search rule space for automata whose patterns match a target structure factor.
- R4-8 Morphogen-pattern designer: learn cell-to-cell signalling rules that make stripes or a French-flag pattern and show them as a wiring diagram.
- Additive-manufacturing thermal history, battery electrode transport, crack and corrosion fronts, etch profiles, urban growth, flood, pest spread, algal bloom, game textures, arithmetic-learning automata, quantised/FPGA automata, scientific image compression, sensor-network healing, swarm control: see `docs/brainstorm.md`.

### Round 5 and later (life science, real lookups)
- R5-1 Wildfire ensemble emulator: calibrated stochastic burn-probability maps on real fire data with a firebreak sensitivity demo.
- R5-2 Tumour forecaster: forecast the next-visit tumour mask as an ensemble probability cloud, benchmarked against persistence and Fisher-Kolmogorov; best built on spheroid time-lapse with dose arms.
- Spheroid relapse forecaster (S-BIAD2312): from the first 3 to 5 frames of a tumour spheroid, forecast its shrinkage, regrowth and relapse day under radiation and heat doses.
- R5-3 Reef recovery emulator: turn a heat-stress scenario into a coral recovery curve with an uncertainty band.
- R5-4 Post-fire regrowth: extend a fire model to vegetation recovery using burn severity and satellite vegetation indices (cut for scope).
- R5-5 Brain protein spread: ensemble forecasts of tau or alpha-synuclein spreading across a mouse connectome from a chosen seed region.
- R5-6 Turing-pattern learner: learn local rules from stripe or spot images and regrow patterns after erasure.
- R5-7 Fallbacks: kelp collapse, biofilm antibiotic penetration, wound closure.
- Invasion-front what-if: forecast where the spotted lanternfly or Asian hornet spreads next, with surveillance-trap what-ifs.
- Wastewater early warning: reconstruct county outbreak maps when sampling sites are removed.
- Pollen forecast: show a calibrated range for daily pollen peaks across Europe.
- Mosquito spread: forecast which European communes the tiger mosquito colonises next, with a climate dial.
- White-nose syndrome, avian flu, bark beetle, knotweed, kelp, algal bloom: spread forecasts with unverified or weaker data.
- Resistance oracle: scan antibiotic-target mutations with Boltz and show the drug detaching, then propose analogues that restore binding.
- Antivenom triage: shortlist designed binders for snake toxins with predicted complex confidence per species.
- Bee-safe pesticide check: compare a pesticide's predicted binding to pest versus honeybee receptors.
- Plastic-eater triage: rank enzyme variants by predicted binding to a plastic oligomer.
- Neglected-disease repurposing screen: rank approved drugs against a parasite target structure.
- Rare-disease variant viewer and allergen epitope masker: structure-based variant or epitope displays (crowded, weak Boltz fit).

## 8. Open items before committing
- Verify: S-BIAD2312 image-to-CSV mapping and segmentation ease; Jin 2016 and LUMIERE licence terms; AFSeq size; Boltz API latency and credits; Cresswell table (download in a browser); ADRIA parameter tables.
- Ask organisers: demo video vs live presentation, whether prepared data pipelines count as pre-existing work, Boltz credits and bounty criteria, judges.
- Fix `HACKATHON.md` (deadline 12:00, no overnight, 1 to 4 students, 2-minute video).
- Decide the primary project using rigour, path to the lab, and Boltz-bounty fit in addition to wow factor.

## 9. Addendum: big AI-lab hackathon winners (science, bio, health), scout report received after the main write-up
Evidence is from organiser posts, LinkedIn/X posts and READMEs; demo videos were not watched, so "first seconds" are inferred. Unverified items are marked.
- Built with Claude: Life Sciences (Jul 2026): NCypher (research-track winner; triages non-coding DNA variants in paediatric glioma, MCP tool plus Agent Skill, reports its own null result p=0.4, reproducibility notebook and CI, 3-minute video); Lazarus (build-track winner; rebuilds dead research repos and says when it cannot reproduce a result); Trialign (Gladstone prize; cancer trial matcher with live ClinicalTrials.gov data, cites the criterion behind each match, labelled synthetic sample patient).
- Built with Opus 4.6 (Feb 2026): PostVisit.ai 3rd place (plain-language visit explainer by a cardiologist). Opus 4.7 (Apr 2026): MedKit 1st (voice clinic for doctor training by a physician). OpenAI Build Week (Jul 2026): veTriage 1st (veterinary triage already piloted by a vet with no coding background), Pulse 2nd (cardiac-arrest resuscitation listener). Abridge x Anthropic healthcare hack (Jul 2026): HomeReady 1st of 113 projects in 12 hours.
- Gemini 3 Kaggle (Dec 2025 submissions): 50 winners, 47 solo; science-flavoured ones include genomic discovery, molecule identification and physics-lab agents (details unverified).
- No verified science winners found for Mistral, NVIDIA, AGI House, lablab.ai, Encode, Hack Nation.
- Patterns (scout judgement unless cited): domain experts with a named user and a concrete bottleneck beat pure developers; winners show uncertainty and failures openly; live or real data with verifiable sources; one-click sample data; single-purpose tools, not platforms; deterministic code around LLMs; speed was not the constraint.
- Implication for us: a domain-grounded, honest, narrow tool with a named user and a visible evidence ledger fits both these winners and the Imperial rubric (rigour 30, path to the lab 20). Pure model-vs-baseline demos with no user story did not appear among verified winners.
- Unverified: two further Life Sciences winners, the Codex hackathon science winner, and actual demo openings (NCypher https://youtu.be/0EQfVwYXFG8, Trialign https://youtu.be/RlR9nHIMiyA).
