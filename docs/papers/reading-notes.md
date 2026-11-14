# Reading notes (papers read in full text via Firefox/Playwright and scout notes, 14 Nov 2026)
Terse notes; full texts are not stored (copyright). Figures/tables that were images could not be read. Verify numbers in the paper before quoting.

## Nardini and Gevertz, arXiv 2606.10873 (CC BY 4.0), "Spatial Model Selection and UQ: Continuous vs Discrete Wound Healing Models"
- Four lattice ABMs vs four mean-field PDEs fitted by ABC (10^4 uniform prior samples, keep MSE <= 1.25 x min, 90% HPD intervals). Data: Jin 2016 PC-3, 6 densities, 5 times (0 to 2 days), 37 bins, 3 replicates averaged. ABM: 74x60 lattice, 25 um, Gillespie, pulling and logistic delay; ranges rm [0,0.25], p_pull [0,1], rp [0,5], a0 [-20,20], a1 [0,40].
- Results: PDEs and ABMs recover parameters comparably (ABM intervals wider); PDE wins AIC on 6 of 8 synthetic datasets; on real data PDE model 4 wins AIC at 5 of 6 densities; PDE 0.028 s vs ABM 37 s per simulation.
- Forecast: fit times 1 to 4, score MSE at time 5 only; parameter intervals are not propagated; no coverage, no baselines.
- Corrections: AIC 720 vs 842.4 are different prior-sample sizes (10^6 vs 10^4), not an inconsistency; migration and proliferation rates (rm, rp) were fairly well identified; pulling and delay were not. Code: github.com/johnnardini/Spatial_model_selection_UQ (licence not stated).

## Lagergren et al. 2020, PLoS CB (BINNs, CC BY), doi 10.1371/journal.pcbi.1008462
- Same Jin data. Neural network with learned diffusion D(u), growth G(u) and delay T(t); showed a delay term fixes high-density discrepancy; guided model beats FKPP and Porous-FKPP on 5 of 6 densities (AIC). No uncertainty quantification, no held-out-time test, in-sample AIC. Protocol: 20 restarts, Adam, early stop 5000 epochs.

## Nardini et al. 2021, arXiv 2011.08255 (equation learning from stochastic ABMs)
- Learns ODEs from averaged ABM runs; 10 to 25 runs suffice; learned model beats mean-field as clustering grows. Early-data limit: with 10% of the curve the fit diverges, 20% plateaus wrongly, 25% test MSE 0.0021, 50% 0.0002; needs data past the inflection point. Learned equations do not extrapolate; no spread/calibration.

## MNCA, Milite, Caravagna, Sottoriva, arXiv 2506.20486 (CC BY 4.0)
- Each cell draws one of K=5 rules (Gumbel-Softmax); optional noise; 35x35 grid, 6 channels, hidden 128, Adam 1e-3, 800 epochs, 200 simulated tissues, MSE loss. Synthetic only (own simulator, emoji, synthetic BBBC031); the Visium claim in the text is unsupported. Table 2: KL 0.018 (MNCA) vs 2.057 (NCA); ABC baseline has better Border-W (0.054 vs 0.184). No official code link; no calibration or conservation test.

## NeuralCPM, Minartz et al., arXiv 2502.02129
- Cellular Potts with learned (neural) Hamiltonian, not an NCA; persistent contrastive divergence; real data = six final aggregates plus one shared time-lapse (Toda 2018), validation only; up to about 100 cells; no division; assumes equilibrium. No code link in the text.

## Richardson et al. 2024, PLoS CB 20(4):e1011589 (CC BY)
- NCA with fixed 3x3 kernels, hidden channels, stochastic update mask; Euclidean loss best; synthetic only (Gray-Scott, emoji); extrapolates 2x in time; rules non-unique; regeneration and real data are future work. Code: github.com/AlexDR1998/NCA (TensorFlow; licence not in text).

## Portela, Banga, Matabuena 2025, PLoS CB 21(5):e1013098 (CC BY), conformal UQ for dynamic models
- Jackknife+ based CUQDyn1/2; intervals for observed variables at observed times only; coverage stated qualitatively; split conformal inefficient for n<20. Data/code on Zenodo 10.5281/zenodo.13644869 (licence of code not seen). Not a forecasting guarantee.

## Clinical anchors
- Sheehan 2003 (Diabetes Care 26:1879): 203 of 276 analysed; cut-off 53% reduction at 4 weeks; sens 91, spec 58, PPV 58, NPV 91; healing 58% above vs 9% below.
- Warriner 2011 (Int Wound J 8:632, PMC7950518): 120 DFUs already at least 50% reduced at week 4; 52% unhealed at week 12; 90% reduction by week 8 rule: sens 66, spec 71, NPV 82, PPV 51.
- Cardinal 2009 (BMC Dermatol 9:2): 338 venous ulcers; 72% fit exponential decay; median healing rate 29.5x larger for fits.
- 2026 Research Square audit (doi 10.21203/rs.3.rs-10420381/v1, not peer reviewed): only the abstract was captured; failure-mode audit on small image sets, not a prognosis benchmark.

## Not accessed (blocked, not bypassed)
- Jin et al. 2016 on ScienceDirect (human check); Bobadilla 2019 and Royal Society Open Science 2018 (Cloudflare). User can download in a browser on the Imperial network; drop in /tmp/papers/inbox/.

## Jin, Shah, Penington, McCue, Chopin, Simpson 2016, J Theor Biol 390:136 (PDF read in full via the user's Imperial download; doi 10.1016/j.jtbi.2015.10.040)
- Experiment: PC-3 prostate cancer cells; IncuCyte ZOOM, 96-well ImageLock plates, WoundMaker scratch repeated 20 times, two washes, 100 uL fresh medium. Seeded at 10,000, 12,000, 14,000, 16,000, 18,000, 20,000 cells per well, grown overnight before scratching. Images every 2 hours for 48 hours; n=3 identically prepared replicates per density.
- Data extraction: each image cut into 39 columns of 50 um (38 used), cells counted manually per column (positions x = 25, 75, ..., 1925 um), mean and SD over replicates at t = 0, 12, 24, 36, 48 h only (so the 5-time-point limit comes from manual counting, not imaging). Carrying capacity K = 1.7e-3 cells/um^2. Mean and SD profiles are in Supplementary Material Documents 2 to 7 (6 files); the PDF states no licence for them (Elsevier). No raw images are provided in the supplement.
- Fisher-Kolmogorov fits (Table 1, least squares over a D-lambda error surface; checked with MATLAB Levenberg-Marquardt): D (um^2/h) about 310, 250, 720, 570, 760, 1030 for 10K to 20K (with intervals of tens to hundreds); lambda (/h) 0.044, 0.044, 0.048, 0.049, 0.054, 0.064; doubling time 15.75 to 10.83 h. So D varies about 310% and lambda about 45% across starting densities; the authors conclude FK (constant D, lambda) does not describe the process. Reading of garbled table digits: verify against the PDF before quoting.
- Porous-Fisher fits (Table 2): D about 1300 to 3000 um^2/h (wide intervals), lambda the same as FK, so D varies far less; the match to data is judged excellent; the authors say Porous-Fisher describes the experiments better (D = D0 (C/K)^m form).
- Takeaways for us: (1) confirms density dependence of effective spreading, so the cell simulator needs density-dependent movement; (2) lambda rises with density in the fits, which is itself puzzling and worth showing as a drift; (3) the 5 manual-count profiles per density, 3 replicates (SD available) give the replicate variance that a calibration test needs, but only 6 densities; (4) doubling times of 11 to 16 h set the proliferation scale for the simulator.
- Open: Elsevier terms for reusing the supplement data; do not re-host files, cite the paper.

## WHAD record pages (Zenodo 12806149 and IEEE DataPort 10.21227/f77j-j355)
- Zenodo page: version 1.0.0-alpha (24 Jul 2024), CC BY 4.0, description only points to the GitHub repo; authors at Izmir Institute of Technology (Iheme, Onal, Erdem, Ucar, Yalcin-Ozuysal, Pesen-Okvur, Toreyin, Unay); funded by TUBITAK. No frame interval or condition list.
- IEEE DataPort abstract: WHAD = time-lapse phase-contrast wound healing assays of genetically modified MCF10A and MCF7 cells (plus CAMAD: MDA-MB-231 and RAW264.7 on various substrates), with annotations. A Word documentation file ("WHAD_CAMAD_Dataset_Instructions.docx") sits behind an IEEE DataPort login (not accessed). A dataset paper exists as IEEE Data Descriptions doi 10.1109/ieeedata.2024.3481394 (not read).

## Cai, Li, Shi, Cai, Zhou 2025, Regenerative Therapy (PMC12528918, CC BY-NC-ND): "Modeling epithelial wound closure dynamics with AI: A comparative study across cell types"
- Uses WHAD (MCF7 and MCF10A). Segmentation: UNet++ with attention and multi-scale input vs Otsu (80:20 train-validation split). Closure percent = (A0 - At)/A0 per frame.
- Temporal modelling is on the frame-wise MEAN closure curve of each cell type, with frame ID as input: polynomial, random forest, SVR, ARIMA(1,1,1), TCN. Split is 80/20 over time points of the mean curve. Reported: RF MAE 0.48% and R2 0.968 (MCF7), MAE 1.73% and R2 0.872 (MCF10A); TCN MCF7 MAE 1.67%, R2 0.698; ARIMA test R2 negative (-0.227, -0.298) with MAE 4.06% and 13.52%.
- Reading: this is curve-fitting of the group-average trajectory, not per-wound early forecasting; no held-out wounds, no uncertainty or calibration, no knockdown-vs-control test. The authors list as limitations the small number of temporal frames and lack of stage labels. A useful published comparator and the likely scooping risk for "AI closure forecasting on WHAD", but our per-wound, calibrated, early-call, held-out-condition framing is not covered. Note licence is NC-ND: cite, do not reproduce.
- Also found: LILAC (Kim et al., PNAS 2025, PMC11873959, CC BY): Siamese network predicting temporal ordering/time difference of longitudinal images, applied to wound healing among other tasks (r = 0.875 with time interval); not a forecaster.
