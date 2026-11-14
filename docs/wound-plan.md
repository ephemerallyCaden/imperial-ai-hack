# Wound healing project: the plain-English plan

Status: research only, nothing built yet. Facts about datasets come from research scouts and need a quick check before we rely on them. Event rules say building starts at 12:10 on Saturday and pre-existing projects are not allowed, so we should not write the model before then (ask the organisers what prep is fine).

## The idea in one paragraph
We build **ClosureCall**, a tool that watches the first part of a wound closing and predicts the rest. It tells you roughly when the wound will close, how confident it is, and which wounds look like they are going off-track. The prediction comes from a small neural network that behaves like a grid of cells, each one following the same simple local rule (a "neural cellular automaton"). We run many slightly different versions of it so the spread of answers shows how unsure it is. We always compare it against simple, well-known curves, and we say honestly when it does not win.

## Who it helps, and why
- **Lab scientists running scratch assays** (cells grown in a dish, a gap scratched across them, then photographed as the cells close the gap). Today, tools measure closure after it has happened. Nothing we found predicts it early with an honest confidence range.
- **What a prediction would change:**
  - Stop a plate early when it is clear the wound will close, or will not.
  - Flag a well that is behaving oddly (a bad scratch, damaged edge).
  - Compare treatments or dressings by "predicted time to 50% / 90% closed", with a range, instead of one end-point number.
- **Later, in clinics:** doctors already use a rule of thumb for chronic foot ulcers: if the wound area has not shrunk by about half after 4 weeks, it is unlikely to heal. That rule is a useful baseline, and a forecast from weeks 1 to 3 would be an earlier warning. But there is no open clinical data to prove it, so we make no clinical claim.
- **Savings:** we found no trustworthy figures for plate cost or machine time, so we will not quote one. We will instead simulate "how many plate-hours would stopping early have saved" on our own data and say it is a simulation.

## What the tool does
- **You give it:** the wound's size over time (as images/masks or just numbers), up to a cut-off point, plus basics like the condition tested.
- **You get, for each wound:**
  - A predicted closing curve with a 90% confidence band.
  - Time to half-closed and nearly-closed, each with a range.
  - The chance it closes by a chosen time, and the chance it stalls.
  - An "unsure, measure again" flag when the answers disagree a lot.
  - A flag when a wound strays outside its own predicted band.
- **A one-page report per plate:** a heatmap of wells, the forecast fans, and a straight scorecard against the simple baselines.
- **Two modes:** a simple one that works on any spreadsheet of wound sizes, and an image one that uses the full wound shape.
- **Wording:** research prototype, advisory only, not a medical device, no claims about drug effects or patients.

## Data we can actually use
| Dataset | What it is | Why it matters | Catch |
|---|---|---|---|
| **Fruit-fly embryo wound closing** (Zenodo 7660424) | 61 real laser wounds filmed about once a minute, with outlines of the wound. Open licence (CC BY 4.0), 199 MB. | Main dataset: real living tissue, many repeats, small enough to use. | No drug or treatment variation. Our "held-out condition" would be wound size. |
| **Scratch-assay density profiles** (Jin 2016, in the Nardini repo) | Cell density across the scratch at 5 time points, for 6 starting densities. | Lets us compare against a published model and test on a held-out density. | Only 1D profiles, so a spatial model has no edge; licence unclear (cite, do not re-host). |
| **Candidates with treatments** (Zenodo 4991621 and 21779854) | Migration experiments with drugs (mitomycin C, CK666), and two cancer cell lines with scratch outlines. | Could give real treatment arms. | Not checked yet; one needs a first-hour look. |
| Ruled out | Cell Tracking Challenge (restricted), a controlled-access wound set, huge 12 to 50 GB sets, clinical foot-ulcer image sets (single photos, no healing series). | | |

## How we will prove it works (this is where most marks are)
Judges give 30% for scientific rigour and 20% for a path to the lab, so honest testing matters more than looks.
- **Test it on wounds it has never seen**, and on one held-out condition (a held-out wound size, or a held-out starting density).
- **Compare against simple, well-known methods:** "wound stays as it is now", a straight-line extrapolation, standard growth curves (logistic, Gompertz), the Fisher-KPP model used in cell-migration papers, and the published Nardini model. We also compare the NCA with and without the many-runs ensemble.
- **Measure two things:**
  - Accuracy: error in wound size and in time-to-close.
  - Honesty: when it says "90% sure", is it right about 90% of the time? We show a calibration plot, and the width of its ranges.
- **Show failures:** the worst wounds and where confidence breaks down.
- **Also test the "how early can it call it" curve:** error versus how much of the wound's history it has seen (10, 20, 30, 50%).
- **A good result looks like:** on unseen wounds, the NCA ties or beats the best simple method, its 90% ranges really contain the truth about 90% of the time, and we show where it fails. If it does not beat the standard curves, we say so and lead with the confidence ranges, the "unsure" flag and the audit scorecard. That is still a useful finding.
- **Honest limits to say out loud:** with 6 densities or 61 embryos, the confidence checks themselves are rough; and on 1D profiles a spatial model has no advantage.

## Where Boltz fits (and where it does not)
Boltz predicts how a drug molecule binds a protein. A possible side test: do Boltz's predictions for wound-relevant drugs (such as EGFR or ROCK inhibitors) line up with how much each drug slows closure in a scratch assay? But binding is not the same as what a cell does, and we have not found a table of closure results per compound. So:
- If we find such a table in the first two hours, we run a small, honest test (about 15 to 25 Boltz jobs, within the free allowance) and report the result, even if it is a null.
- If not, we do not chase the Boltz prize (it rewards Boltz being central) and enter the main AI for Science track only.

## Time budget
The building closes at 21:00 on Saturday and reopens at 10:00 on Sunday, and submissions close at 12:00 sharp on Sunday. That is only about 9 hours Saturday plus 2 hours Sunday inside the building. Please confirm with the organisers whether working elsewhere overnight is allowed, and plan for the smaller number.

| Who | Job |
|---|---|
| Person 1 | Data loading, the simple baselines, the scoring code |
| Person 2 | The NCA ensemble and its calibration |
| Person 3 | The report page, the video, the public repo |

Rough timeline: hour 0 to 1, load the embryo data and run the simple baselines. Hours 1 to 3, build the NCA ensemble. Hours 3 to 5, calibrate and compare to the Jin data. Hours 5 to 8, build the report and study failures. Sunday morning, record the video, tidy the repo, and submit by 11:30 (the last code commit and video must both be before 12:00).

## The 2-minute video
- **0:00 to 0:15:** the problem, for a named user (a lab scientist deciding whether to stop a plate).
- **0:15 to 1:30:** one real run, start to finish: upload a wound series, see the forecast and its band, the stall flag, the test on unseen wounds, the scorecard against simple methods, the calibration plot, and one honest failure.
- **1:30 to 1:50:** how it is built and what was tested.
- **1:50 to 2:00:** the closest existing tools and how often ours works. Mark anything mocked or sped up.

## Checks to do first
1. Open the embryo dataset: confirm the outlines, frame counts and any extra labels.
2. Open one Jin scratch-assay file with a safe reader and confirm the times, densities and repeats.
3. Read the paper behind the treatment dataset (Zenodo 4991621): cell type, frame rate, drugs.
4. Ask the organisers: what prep is allowed, whether overnight work is allowed, Boltz credits, and the demo video rule (the site says none, the Devpost rules require a 2-minute video).
5. Do a quick literature search for "neural cellular automata" plus wound or scratch assays (earlier searches were incomplete).

## Zooming from single cells to the whole wound (added after multiscale research)
**Short answer:** yes, we can build a view that zooms from individual cells to the whole wound, but the cells you see when zoomed in will be *simulated*, because we found no open dataset with real per-cell tracks at a wound edge. We say that on screen.

**How it works: three layers that share one state**
1. **Cells (zoomed in):** a small cell simulation we write ourselves (about 100 lines). Each cell wanders with a bias toward the gap, divides only when there is room, and edge cells pull inward harder. Toggles for "leader/follower" and "purse-string" show different ways wounds close.
2. **Tissue (middle):** the same cells averaged into a density map, like a heat map of crowding.
3. **Wound (zoomed out):** the closure curve, the neural-automaton forecast and its confidence band. The automaton is trained on the cell simulation's averaged output, so zooming out should give the same answer as zooming in. We test that agreement (density profile, closure-time spread, and front speed against the standard Fisher-KPP formula 2 x sqrt(D x r)) and report it.

**What is real and what is simulated**
- Real: wound outlines over time (fruit-fly embryo set, 61 wounds), cell density across a scratch (Jin 2016), and tissue-level movement of cells (MDCK monolayer data).
- Simulated: individual cells, their paths and divisions. Wound-level curves cannot tell leader/follower from purse-string, so we do not claim to identify the mechanism.
- The fruit-fly images are about 9 micrometres per pixel and show a myosin signal, so single cells cannot be seen in them.

**Data to calibrate the cell layer (all unverified in detail; none gives ready-made cell tracks)**
- Best: Zenodo 4991621 (MDCK monolayer migration, CC0, about 1.5 GB: movies, kymographs, velocity versus density). Use it to set cell speed and how crowding slows cells. Tracks would have to be extracted ourselves.
- Small extras: Zenodo 5880000 movie 5 (88 MB, E-cadherin cell shapes) plus a velocity-field file (about 155 MB); Zenodo 4308385 (226 MB, speed and directionality across cell types).
- Do not use Cell Tracking Challenge data in a public demo without permission.

**How to show it (browser)**
- Tool: deck.gl in a 2D view. Its zoom number drives a crossfade: zoomed out shows the density map, wound outline and forecast panel; zoomed in shows schematic cells with arrows and the leading edge.
- Cheapest honest route: run the automaton in Python, export small files, play them back in the viewer labelled "precomputed simulation". A live in-browser automaton is a stretch.
- Honesty touches: flat schematic cell glyphs (no fake fluorescence), a chip saying "simulated cells, not tracked cells" when zoomed in, observed outlines solid and predicted ones dashed, ensemble disagreement shown as separate trajectories, colour-blind-safe palette, keyboard zoom.
- One time slider drives every scale, and the wound area is the same number at every zoom.

**Minimum impressive version (about 8 build hours)**
- One real wound series; zoom from the closure curve with its band down to migrating, dividing schematic cells; a time slider; honest labels; one failure case shown.
- Cut: vertex and cellular-Potts models, the heavy desktop simulators, 3D, Boltz.
- Stretch: live in-browser automaton, a "what if the wound were bigger" slider, per-cell trails, plate-to-well-to-cell navigation.

**Split of work (3 people):** viewer (deck.gl zoom, layers, labels); data, cell simulation, coarse-graining and the automaton (Python); forecast panel, Figma design, accessibility and the 2-minute video. Figma is also a separate prize open to every track (show how you used it).

**New checks:** frame rate and pixel size in the MDCK sets; whether cells can be tracked from the movies; what is inside the large zip files; check deck.gl performance with a few thousand cells; confirm what prep the organisers allow.
