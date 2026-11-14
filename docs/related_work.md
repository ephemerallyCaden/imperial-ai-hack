# Related work and closest existing tools

Notes for the README and the video's "closest existing tools" slot. Checked 14 Nov 2026 by web search; abstracts only, not full papers.

## Tools scientists use today: they measure, they don't forecast

| Tool | What it does | Gap ClosureCall fills |
|---|---|---|
| TScratch (curvelet edge detection, GUI) | Measures open wound area per image | No forecast, no uncertainty |
| ImageJ/Fiji macros; Wound Healing Size Tool plugin | Area, coverage, mean scratch width per image, high-throughput | No forecast |
| RQSA (Robust Quantitative Scratch Assay) | Wound boundary with statistical measurement error | Error on the measurement, not on the future |
| Cellular Growth Analyzer (Java) | Easier automated scratch analysis | No forecast |
| Incucyte scratch-wound module (commercial) | Live imaging + wound metrics | Not checked in detail; no forecasting found |

Caveat worth quoting: the choice of analysis software changes experimental outcomes, and the assay is poorly standardised (Comparison of in vitro scratch wound assay experimental procedures, PubMed 36647554).

## Research closest to ours

- **Nardini & Gevertz, arXiv:2606.10873 (June 2026).** Compares mean-field PDEs, a PDE with cell pulling and a time delay, and agent-based models on public PC-3 wound data (the Jin data we use). ABC for parameters and uncertainty; model selection by information criteria and out-of-sample forecasting. Finding: the mean-field PDE was often selected over the true generating ABM; on real data the pulling + delay PDE fit best but with high parameter uncertainty.
  - **How we differ:** they select between mechanistic models at the population level; we forecast individual wounds from an early cut-off and test whether the 90% ranges really hold 90% of the time on held-out wounds.
  - **Consistent with our result:** simple models are hard to beat.
- **Lagergren, Nardini et al. 2020 (BINNs, PLOS Comp Biol).** Biologically-informed neural networks learn diffusion/growth terms from the same Jin profiles. A learned-mechanism approach, not a per-wound forecaster.
- **2013 continuum-model study (intestinal epithelium).** Early gap area predicts total closure time roughly linearly, but equal areas with different shapes close at different rates. Supports using the early part of the curve, and suggests shape (image mode) can add information.
- **ANN on scratch assays (cisplatin-resistant ovarian cancer, 2021).** Predicts migration measures, not closure time, no calibrated uncertainty.

## Neural cellular automata

No published NCA trained on real wound or scratch-assay data was found. NCA work on regeneration (Mordvintsev et al. growing/repairing patterns; Horibe, Walker & Risi 2021 soft-robot regrowth; Hartl, Levin & Pio-Lopez 2024 review) uses synthetic patterns. Claim carefully: "to our knowledge, first NCA tested on real wound-closure time-lapses", not "first ever".

## Our positioning in one line

Existing tools measure closure after it happens; research models explain it at the population level. ClosureCall forecasts each wound early, with ranges that are checked to hold on wounds the model never saw.
