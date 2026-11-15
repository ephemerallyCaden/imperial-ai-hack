# Stage B findings (R3-1, R3-2, R2-A, R2-B)

Source: 5 scouts, abstract-level reading, several arXiv IDs dated after our knowledge. Verify every citation and every "nobody has done X" claim against full papers before pitching.

## Verdicts
| Idea | Novelty | Credible only if | Main risk |
|---|---|---|---|
| R3-1 NCA on real microscopy | Partly open | Benchmarked vs Fisher-KPP/PDE/ABM on held-out time and condition, with calibrated uncertainty | Perturbation edits are out-of-distribution; fitted PDE may match NCA |
| R3-2 NCA physics surrogate | Low to moderate | Conservation-aware, 10x+ horizon, OOD defects, honest solver baseline, fallback to real solver when drifting | 2D Cahn-Hilliard is cheap, so speed-up claim is weak; U-Net/FNO are strong baselines |
| R2-A Petri dish of life | Low to moderate (ASAL territory) | VLM "life-likeness" validated against human raters and trivial baselines | Frozen/noise states labelled "alive" |
| R2-B Minimal cell | Low as a product (mirofish-syn3a exists) | Blind recovery of Mushegian 2026 predictions for dark genes; honest essentiality baseline | Direct prior art; syn3.0 labels nearly all essential |

## R3-1 detail (user's preferred direction)
- Prior art: Richardson 2024 (NCA on image series/PDE, doi:10.1371/journal.pcbi.1011589), NeuralCPM arXiv 2502.02129, GNN rule inference (doi:10.1371/journal.pcbi.1010477), BINNs (Lagergren 2020), MNCA arXiv 2506.20486, Nardini & Gevertz arXiv 2606.10873 (CC BY 4.0, code: github.com/johnnardini/Spatial_model_selection_UQ).
- Not found: NCA trained end-to-end on real migration/wound/colony video, benchmarked head-to-head with Fisher-KPP, ABM and video prediction, with calibration.
- Ranked gaps: (1) real-data benchmark of learned rules vs mechanistic models with held-out time/density; (2) honest uncertainty from stochastic NCA ensembles (coverage of real replicates); (3) identifiability of rules from summaries; (4) interventional prediction (needs dose/treated data, likely out of reach).
- Actually useful deliverable: per-condition inferred parameters (front speed, proliferation, diffusion) plus a held-out forecast with uncertainty, e.g. control vs treated scratch assay. Do not claim drug-effect prediction.
- Data (probed, HTTP 200): Cell Tracking Challenge Fluo-N2DL-HeLa (199 MB), DIC-C2DH-HeLa (41 MB), PhC-C2DH-U373 (43 MB), Fluo-N2DH-SIM+ (99 MB, synthetic). Licence and frame interval unverified. Zenodo "Wound Healing Assay Time-Lapse Series" (record 21031330): licence unknown.
- Code: google-research/self-organising-systems, SakanaAI/asal, chakazul/Lenia (all probed 200). A PyTorch NCA is about 100 lines; 64x64 to 128x128 trains in about 10 to 40 min on one GPU (estimate).

## R3-2 detail
- Direct prior art: arXiv 2608.30328 (NCA vs PDE-Net/PINN/FNO on 5 PDEs incl. Allen-Cahn, 2x horizon). arXiv 2610.09946 is about traffic flow, not PDE conservation. MaCE 2507.12306 (mass-conserving CA) untested on learned surrogates. arXiv 2609.39604: per-pixel accuracy hides rollout failure (96.3% cell accuracy, 18.9% rollouts completed).
- Gaps: conservation and free-energy metrics; 10-50x horizon with coarsening-law check; OOD initial conditions/defects; accuracy per parameter/FLOP; OOD detector that hands off to the real solver.

## R2-A / R2-B detail
- R2-A: ASAL (Apache-2.0, Colab available), pbt-nca (MIT), Thomick/FlowLenia (MIT). Gap: validate VLM life-likeness against human raters; compare ASAL novelty vs MSPD (2606.17091); detect collapse states.
- R2-B: muntakson/mirofish-syn3a (AGPL-3.0) already offers an LLM cell sim, FBA knockouts and a dark-gene swarm. Differentiate with a blind benchmark: recover Mushegian 2026's 12 inferred functions (doi:10.1128/msphere.00077-26); check essentiality baselines on the Syn1.0 parent. Syn3A genome: NCBI CP016816.2.

## Open verification list
- CTC and Zenodo wound-healing licences, frame intervals.
- Whether MNCA/NeuralCPM code is public; targeted bioRxiv/Scholar sweep for "neural cellular automata" + wound/colony.
- Full-text check of 2608.30328 tables; any citing work.

## Round 2 corrections and practicality findings (full-text verified by scout; still verify)
- Richardson 2024 and MNCA used SYNTHETIC data only (Gray-Scott, emoji, own simulator, synthetic BBBC031). They are not real-time-lapse scoops. NeuralCPM used one real video, qualitatively, and is a Potts-model Hamiltonian, not an NCA. R3-1 (NCA on real time-lapse with calibrated uncertainty, benchmarked vs Fisher-KPP/ABM) remains open as of the sweep. bioRxiv keyword search was not done.
- arXiv 2608.30328 (NCA PDE stepping): synthetic Gaussian random fields, 2x horizon. NCA LOSES on Allen-Cahn (rel. l2 0.052 vs PDE-Net 0.015) and loses to FNO on advection at T=1000. Its Tables 4 and 7 disagree. Novelty for R3-2 is weaker. Remaining gaps: conservation metrics, 10x+ horizon, OOD initial conditions, solver hand-off.
- Datasets: Zenodo 21031330 (wound-healing series) is controlled access, unusable. Cell Tracking Challenge restricts non-CTC use, no treatment arms. Usable: Nardini repo `WH_data` (Jin 2016 PC-3 scratch assay, 6 seeding densities, 1D density profiles at 0 to 2 days; licence of data unverified, repo has no licence); Zenodo 4932716 (CC0, ~23 MB hydrogel/substrate movies; frame interval unknown); Zenodo 12735408 (CC0 wound-closure tables with drug arm, unopened). No dataset has a drug arm with images.
- Nearly all prior-art repos have no licence (reimplement, don't copy). Exception: DaddarioLuigi/MNCA (MIT, third-party).
- Practicality (imaging): value is early outcome forecast from first 20 to 30% of frames, outlier-well QC, per-condition parameters. Must beat logistic/Fisher-KPP baseline; cell-therapy QC out of reach. No verified user demand beyond review papers; one wet-lab conversation would help.
- Practicality (surrogates): R3-2 ranked most practical as a "surrogate with receipts": physics audit (mass conservation, energy decay, t^(1/3) coarsening), OOD detector with fallback to the real solver, export to PRISMS-PF/FiPy-style input, grounded in PFHub benchmarks. Caveat: 2D Cahn-Hilliard is cheap; real value is 3D, elasticity, CALPHAD, large sweeps. R2-B ranked second as a benchmark harness; R2-A has no identified practical user. Demand claims are unverified.

## Round 5 Stage B (wildfire, tumour, reef, brain spread): real lookups, scout-rated wow factor
| Idea | Wow | Data readiness | Closest prior art | Biggest risk |
|---|---|---|---|---|
| Wildfire ensemble | 6/10 (4 if no calibration win) | Good: WSTS zip 48.4 GB supports HTTP range streaming; 20-30 fires ~2 GB; wind bug is loader-only (sin-only encoding, use raw degrees) | arXiv 2606.11676 (CNN-parameterised CA, 6 fires, per-fire refit, no UQ), WildfireSpreadBench 2609.22191, UQ paper 2605.03148 | Beats persistence/dilation at 24h? Daily steps only; weather 27 km; firebreak = sensitivity demo |
| Tumour forecaster | 6/10 (7 if well calibrated) | Heavy: LUMIERE zip 32.6 GB, no masks-only file, automated masks only; MU-Glioma-Post (CC BY 4.0, 203 pts, refined masks, ~11 GB) recommended primary, LUMIERE external test | Liu et al. TMI 2025 treatment-aware diffusion with uncertainty (so "no prior art" is false); Lipkova 2019 Bayesian FK | Persistence wins; weak labels; clinical overclaiming |
| Reef recovery | 5/10 | Weak: only Cresswell CC0 table (browser download needed), NOAA DHW ERDDAP recipe works; AIMS licence/API unconfirmed | ADRIA.jl (MIT) / ReefMod-GBR are the incumbents | "CA imitating a CA"; lead with inverse design + calibration vs Cresswell |
| Brain protein spread | 6/10 | Small and open: connectome ~116 nodes (MIT), Henderson alpha-syn 3 time points, 16 mice; tau set single time point | MERCON 2026 GATv2+GRU on same data (supervised, no ensemble) | Overfitting; diffusion baseline r~0.6-0.7 with one parameter |
Corrections: LUMIERE Figshare records say CC0, paper/Crossref say CC BY 4.0 plus "non-commercial use only" note (earlier "no licence" note was wrong). Wow ratings are the scouts' judgements, not ours.
