# Devpost text: draft for P3 (#44)

Draft by P1. Joanne owns the final page. Every number comes from `docs/results.md`, `agent/results/*.md` or `docs/video-assets.md` (sources in the last section). Honesty rules (design.md 11): never say "first", "clinical", "diagnosis", "predicts drug effects" or "separates migration from division". Items in [brackets] are for P2/P3 to fill or confirm.

---

**Tagline:** Early, honest forecasts for wound-healing assays.

## Inspiration
Scratch assays (cells grow back into a scratched gap) are used across cancer migration, fibrosis and wound biology. Today's tools measure closure after it has happened, so a lab waits hours to days of microscope time to learn whether a well closes. We wanted an early answer, plus an honest statement of how sure we are.

## What it does
Upload 1 to 5 frames from the start of a time-lapse, with the frame interval and pixel size. Stitch:
- **checks every frame** and refuses blank, out-of-focus or badly segmented images, with the reason
- **finds the wound** and forecasts the rest of the closure curve with a **90% band**, times to 50% and 90% closed, and P(90% closed by 19 h)
- **flags stalls** and advises whether to keep imaging or stop early
- runs an **agent** that proposes the next step. Every number it shows is traced to a tool output, and a person approves anything that can't be undone.

Three modes:
- **Assay:** upload or try a sample, then forecast, then the decision card.
- **Ops:** the agent's run logs, its scoreboard, and the forecast evidence.
- **Draw:** draw a wound and watch simulated cells close it.

## How we built it
- **Data:** five open datasets.
  - WHAD MCF10A time-lapses: the main benchmark, 28 wounds, 55 series.
  - WHiM-BC MCF-7: ordinary vs stem-cell-enriched wells.
  - Drosophila embryo laser wounds and Zaritsky scratch assays: secondary checks.
  - Jin 2016 PC-3 density profiles: used for the simulator.
- **Segmentation:** a texture segmenter turns frames into wound masks, and the refusal rules sit on top of it.
- **Forecaster:** a mass-conserving **neural cellular automaton (NCA)** that emulates our cell-agent simulator, then fine-tuned on real WHAD frames. Training used 4 wound-level folds, so no wound is ever forecast by a model that trained on it. It takes the wound's speed parameters, fitted from the uploaded frames, runs 50 stochastic rollouts over 3 models, and falls back to a 2-parameter edge-speed model automatically.
- **Calibration:** leave-one-wound-out conformal. Other wounds' errors form each wound's 90% band, so a wound's own outcome never shapes its own forecast.
- **A pre-registered gate:** a model ships only if its quantile score (a CRPS approximation) is within 10% of the best simple model and its band coverage is between 0.85 and 0.95.
- **Agent:**
  - A Claude lead agent works inside code-enforced policy: refusals and stall flags force "ask a human".
  - A plain-code Critic removes any number it can't trace to a tool output.
  - Every run is logged and replayed on held-out wounds.
- **Front end:** plain ES modules in the browser, with a design system made in Figma. [P3: Figma file link and how Figma was used: style guide, wireframes, components]

## Results (held-out data)
- **The band is honest on new wounds.** On 28 WHAD wounds the model never saw, the 90% band contains 92% of what actually happened.
- **The neural model earns its place.**
  - Trained only on simulation, the NCA failed our own gate: it scored 30% worse than edge speed at 3.8 h.
  - Fine-tuned on real frames, it passes at every cut-off on unseen wounds. It scores 0.0397 vs edge speed's 0.0386 at 3.8 h, and it is the best model of all at the earliest check (1.9 h: 0.0530 vs 0.0562) and the latest (9.5 h).
- **Stopping early:** in replay on held-out wounds, 82% get a call at the first check (1.9 h). 91% of those calls are right, against 75% for always guessing "won't close".
- **Stall flag:** AUC 0.77 to 0.90 across the checks.
- **Agent safety:** in our adversarial test set (stub models, inputs written by us), 14 of 14 expected outcomes were met. The set covers prompt injection in protocol text, metadata and image files; bad frames; and planted numbers.

## What doesn't work (we say it plainly)
- **New cell types:** the band does not transfer. Calibrated on ordinary MCF-7 cells, it covers only 15 to 58% of the stem-cell-enriched wells' future. Stitch must be calibrated per cell line.
- **Stall flag precision:** when it fires, it is right only 48 to 75% of the time. That's why it asks a human and never stops a plate on its own.
- **Movement vs division:** wound area alone cannot separate the two. Fitting a reaction-diffusion model, full density profiles pin down both parameters, but closure curves leave them uncertain by 2 to 63 times. We make no claim either way.
- **Sudden speed-ups:** Stitch misses wounds that are slow at first and then suddenly speed up.

## Challenges we ran into
- **Leakage hunting:**
  - WHAD's "part II" videos turned out to be the same physical wounds as part I, so we split by physical wound.
  - One folder spliced two microscope positions together, so we excluded it from scoring for every model.
  - Picking NCA checkpoints on the test fold was leakage, so we use final weights only.
- **A held-out condition was under-covered:** coverage was 0.72 on CYR61 knockdown at 9.5 h. Calibrating on all other known conditions fixed it (0.90). Uploads with an unknown condition get a widened band and a warning flag.

## Accomplishments that we're proud of
- **We set a gate in advance, failed it, and fixed the model with real data.** We didn't move the gate.
- **The whole benchmark rebuilds from a fresh clone** with byte-identical outputs.

## What we learned
- A 2-parameter model is very hard to beat on small biological datasets. Calibration matters more than model size.
- Saying where a model fails (new cell types, stalls) made the product more useful, not less.

## What's next
- Calibrate on a lab's own microscope and cell line. Our results suggest a few dozen wells per condition is enough (we used 28 wounds).
- Validate on more cell types and assay conditions.
- [P2: Adaption fine-tune for the Intake step, if it ships]

## Built with
Python, NumPy, SciPy, pandas, PyTorch, matplotlib, Pillow, tifffile, JSON Schema, JavaScript (ES modules), Claude (Anthropic) [P3: add web libraries and any partner tools used]

**Research use only. Not for diagnosis or treatment.**

---

## Number sources (for the P1 check, #110)
| Claim | Source |
|---|---|
| 28 wounds, 55 series; 92% coverage | results.md, calibration table (WHAD loo_all, 3.8 h) |
| 0.0397 vs 0.0386; 1.9 h 0.0530 vs 0.0562; best at 9.5 h | results.md, gate table (NCA real-data v3) |
| sim-only NCA +30% | results.md, gate table (NCA sim-trained 3.8 h, ratio 1.30) |
| 82% / 91% / 75% | results.md, "Can a scientist stop the plate early?" |
| stall AUC 0.77-0.90; right 48-75% when it fires | results.md, flags + "What does not work" |
| 15-58% on stem-cell-enriched wells | results.md, "What does not work" |
| CYR61 0.72 -> 0.90 | design.md R28 (rest_to_C61, NCA 9.5 h) |
| identifiability 2-63x | design.md R30 (D 9-63x, r 2-39x) |
| adversarial 14/14 | agent/results/adversarial.md |
