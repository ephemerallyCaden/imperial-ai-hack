# Devpost write-up: Stitch

Track: **AI for Science**. Extra prizes: **Figma (Best-Designed)** and **Best Use of Adaption**.

Tagline: Early, honest forecasts for wound-healing assays.

Every number below comes from `docs/results.md`, `agent/results/scoreboard.md` or `agent/results/adversarial.md`.

## Inspiration

In a hospital, a wound that won't heal needs a prediction and an honest answer to one question: how sure are you? Treatments for those wounds are tested first in a dish. The scratch assay is the standard test: you scratch a line through living cells and film it closing over a day or more. Labs use it for cancer migration, fibrosis, wound biology and drug screening.

Today's tools (TScratch, ImageJ plugins, Incucyte) measure closure after it has happened. So labs spend hours to days of plate and microscope time waiting to see whether a well closes. We wanted to give the assay scientist an early answer to "will this well close by the end of the run and when?", with an uncertainty band they can trust.

We are not making clinical claims. The hospital is why it matters. The lab is the product.

## What it does

From the first few hours of a scratch-assay time-lapse (1 to 5 frames), Stitch:

- forecasts the rest of the closure curve with a **90% band**, plus time to 50% and 90% closed and the chance of 90% closure by 19 h;
- flags wells that are likely to **stall**;
- advises whether the plate can **stop early**;
- refuses blank, out-of-focus or badly segmented frames and says why.

An agent runs this at each imaging check. Code runs QC, the forecast, the stall flag and the schedule advice. Policy code lists the decisions allowed at that check. Claude picks one, explains it in plain English and hands any stop to a human for approval. A code Critic removes any number in the explanation that no tool produced. A Reporter writes a short summary at the end of each run.

The web app has three modes:

- **Assay** plays a recorded agent run: simulated cells in 3D, the closure curve with its band, the decision card with approve or reject, the images and QC plus a "Why" tab with every number traced.
- **Ops** shows the run log step by step, the agent scoreboard, the adversarial test results and the forecast evidence (scorecard, calibration, stall flag, a failure case).
- **Draw** lets you draw a wound and watch simulated cells heal it under rules fitted to real wounds. It is a simulation, not a forecast. It shows no band.

## How we built it

1. **Data to curves.** We used public data: WHAD (MCF10A cells, CC BY 4.0), WHiM-BC (MCF-7 cells), a fruit-fly embryo wound set and Zaritsky 2015. Wound masks (the authors' or our own texture segmenter) give wound area per frame.
2. **Forecaster.** A neural cellular automaton (NCA) fine-tuned on real WHAD frames. Each wound's own speed is fitted from the uploaded frames, then 50 stochastic rollouts give the spread. A two-parameter edge-speed model is the fallback and the baseline everything is scored against.
3. **Calibration.** Leave-one-wound-out conformal calibration: a wound's own outcome never shapes its own band.
4. **Cell layer.** A lattice cell-agent simulator based on published rules (Migliaccio et al. 2023), fitted to WHAD. It drives the Draw mode and the simulated cells in Assay.
5. **Agent layer** (`agent/`). A hand-written loop so every step is logged and the policy, Critic and human approval sit inside it. All model calls go through one `call_model()` wrapper. Runs are recorded once and played back, so viewing needs no API key.
6. **Evaluation.** One scorer for every model, a pre-set gate for the NCA, a replay of held-out wounds as a simulated lab plus an adversarial test set.
7. **Design.** We designed the screens and a style guide in Figma first, then built `web/` from them. Details in `docs/figma-usage.md`.

## Results

On 28 unseen WHAD wounds (55 series), forecasting from the first 3.8 h of a 19 h series:

| Forecaster | Quantile score (lower is better) | 90% band coverage |
|---|---|---|
| Edge speed + calibration | 0.0386 | 0.92 |
| NCA fine-tuned on real frames + calibration (shipped) | 0.0397 (+3%) | 0.92 |
| NCA trained on the simulator only + calibration | 0.0502 (+30%, failed our gate) | 0.93 |

- The fine-tuned NCA is the best model of all at 1.9 h and 9.5 h.
- The 90% band holds on unseen wounds: 92%.
- It does not hold on a new cell type: 58% on cancer-stem-cell wells, so bands must be calibrated per cell line.
- Stall flag at 3.8 h: AUC 0.85, precision 0.57, recall 0.62.
- Stop early (simulation on recorded data): 82% of held-out series get a call at the first check (1.9 h). 91% of those calls are right, against 75% for always saying "won't close". Every early call is "won't close"; it never confidently calls early closure.
- Agent replay (simulation, offline replay model, simulated human approves every proposal): the forecast policy saves 761.9 plate-hours over 55 wounds, against 338.2 for a simple stall rule and 0 for a fixed schedule. That gain comes from the forecaster and the policy code. The model chooses among allowed options and explains them.
- The Critic traced 100% of the numbers in the agent's explanations.
- Adversarial set: 14 of 14 expected outcomes met (prompt injection, bad frames, decompression bombs, out-of-scope requests, untraced numbers). This was run with stub models, not a real model.

## Challenges we ran into

- **Simple models are strong.** Our first NCA, trained only on simulator output, was 30% worse than a two-parameter edge-speed model. We kept the gate we set before scoring. It only passed once we fine-tuned it on real frames.
- **The same wounds filmed twice.** WHAD part II turned out to be the same wounds as part I, filmed later. We had to split by physical wound, which cut our manually annotated wounds from 16 to 9.
- **Bands that don't transfer.** Calibration on ordinary MCF-7 cells fails on faster-closing stem-cell wells. We report it instead of hiding it.
- **The stall flag is often wrong.** In replay, about half of stall stops were on wounds that kept closing. The flag only asks a human; it never stops a plate by itself.
- **Keeping the LLM honest.** We had to make sure the model could not invent a number, raise a flag or stop a plate. Code sets the options and the Critic checks every number.

## Accomplishments that we're proud of

- An uncertainty band that holds on wounds the model never saw, checked leave-one-wound-out. It does not transfer to a new cell type (58% on WHiM-BC) and we show that.
- A neural cellular automaton that passes a gate we set before seeing the results. It is the best model at the earliest and latest cut-offs.
- Failures shown on screen: the cell-type failure, the stall flag's error rate and a worst-case wound.
- An agent where every number on screen is traced to a tool. A person approves anything that cannot be undone.
- A design-first build: Figma frames and a style guide, then code that follows them.

## What we learned

- Calibration matters more than the model. Raw NCA bands covered only 10-17% of the future; the conformal step is what makes them honest.
- Wound-area curves cannot tell cell movement apart from cell division. We tested this on Jin 2016 data: full density profiles can, closure curves can't. So we don't claim it.
- Agents are most useful when code does the science and the model chooses and explains.

## What's next

- Calibrate for more cell lines and microscopes, starting with the cancer-stem-cell case that fails today.
- Test in a real lab: let a scientist use the stop-early advice on live plates.
- Applications we have not validated: slow-healing diabetic wounds, infected wounds that stall, cancer migration assays, fibrosis and drug screens where an early call frees plates and microscope time.
- Experiments that measure movement and division separately, so the simulator can tell which one a treatment changes.

## Built with

Python, NumPy, SciPy, pandas, PyTorch, matplotlib, tifffile, Pillow, jsonschema, pytest, three.js, JavaScript (ES modules), Claude (Anthropic) as the agent's model, Adaption (fine-tune), Figma.

**Adaption:** we fine-tuned a small open model on our Intake task: reading a protocol paragraph and returning the frame interval, pixel size, condition and scope checks. The training data is 1,500 templated rows. The real test set is 30 open-access Methods paragraphs that were never trained on. Fine-tune trained; results in `data/adaption`.

## Links

- Repo: https://github.com/ephemerallyCaden/imperial-ai-hack
- Figma: https://www.figma.com/design/vTCApH2oLBShNu4Oi9dsGg
- Video: TBD

Research prototype. Advisory only. Not for diagnosis or treatment.
