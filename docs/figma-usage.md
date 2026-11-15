# How we used Figma (evidence for Best-Designed)

File: **Stitch-UI**, https://www.figma.com/design/vTCApH2oLBShNu4Oi9dsGg

We designed every screen in Figma before writing the viewer. The Figma file has two pages: **Wireframes** (layout and behaviour) and **Style guide** (colour, type and components). The web app in `web/` was built from both. Screenshots of the frames are in `figma-shots/` next to the repo (not committed).

## Frames on the Wireframes page

| Frame | What it decides | Screenshot |
|---|---|---|
| **Assay · v2 (menu bar + calm default)** | The main screen. A menu bar (File, View, Analysis, Help), the three mode tabs, honesty chips along the top ("Recorded run", "Simulated cells · not tracked cells", "Sample data"), the cell field in the middle, a "Scales" strip with three zooms, a timeline at the bottom (observed solid, t0 marker, forecast hatched) and a right panel with a pinned decision card above three tabs. | `assay_v2.png` |
| **Assay · v1 (dense, for comparison)** | The first version, with every panel open at once. We kept it next to v2 to show why we moved secondary panels into View ▸ Panels and put the decision first. | (in the file) |
| **Menu bar spec (all screens)** | Every menu item and shortcut: File (new analysis, open images, try a sample, open held-out wound, export forecast and run log), View (panels, camera, tissue tone, selection look), Analysis (run forecast, select area, compare with baselines, stall flag details), Help (shortcuts, how the forecast works, limitations, data sources). | `menubar.png` |
| **Assay right panel · Images tab** | Uploaded frames with the mask outline in amber, the QC refuse-or-flag rules with their values plus the Intake extraction shown next to the protocol text it came from. | `panel_images.png` |
| **Assay right panel · Why tab** | Why the agent proposed this decision, with each number and the tool it came from ("every number traced"). Also the run steps from QC to human approval. | `panel_why.png` |
| **Right panel · refused state** | What the panel shows when code refuses the data: a forced decision card ("Data refused · ask a human"), the refusal reasons quoted from `upload.py`. Then what to do next. No forecast, no band. | `panel_refused.png` |
| **Decision card · after Approve / after Reject** | The two states after the human acts: approved (logged, playback continues on the approved branch, undo for 10 s) and rejected (optional reason, playback switches to the recorded rejected branch). | `decision_after.png` |
| **Ops · Agent runs tab** | Run log table, a step trace for the selected run, a Critic box (numbers in reply, traced, removed), the adversarial table grouped by attack type, the agent scoreboard, the stop-early rule and the list of decisions the agent may propose. | `ops_agent_runs.png` |
| **Ops · Forecast evidence tab** | Split and cut-off switches, the forecast scorecard with the shipped model marked, coverage by cut-off, quantile reliability, band narrowing per check, the stall flag numbers and a slot for the failure case. | `ops_forecast_evidence.png` |
| **Draw (explore) · 1440** | Draw tool and Heal, the two presets (MCF10A control, CYR61 knocked down), magnification buttons, a field readout, a "This preset assumes" box, non-colour cues for cell states and a first-time hint. Chips say "Simulation, preset parameters" and "Not a forecast · no band · no agent". | `draw.png` |
| **Wireframe components** | Buttons (default, primary, selected), the dashed honesty chip, the menu item and the icon set used in every frame. | `components.png` |

## The Style guide page

The Style guide page has four poster boards: **Dark**, two alternative palettes and a palette reference. Each board shows the colour palette, buttons, type, chips and other parts. The **Dark** board is the one we shipped. Its values are Figma variables ("Stitch tokens", with CSS code syntax), plus text styles and components for the button, chip and decision card.

## How the design drove the build

- **Tokens.** `web/tokens.css` comes straight from the style guide: surfaces (`--bg` #050607, `--panel`), text (`--ink`, `--dim`, `--faint` with contrast ratios), the one amber accent (`--accent` #E0A458) for forecast, selection, focus and "needs a human", the five cell-state colours (checked for colour blindness and greyscale), chart styles, type, spacing and motion. The same file holds the base components named after the Figma components: `.st-btn`, `.st-chip`, `.st-card` (with `--forced`, `--approved` and `--rejected` states), `.st-tabs`, `.st-menubar`, `.st-dropdown`, `.st-table` and `.st-ribbon`. The style guide's written rules are in `web/vendor-design/style-guide-README.md`.
- **Modes.** `web/index.html` and `web/app.js` build the menu bar and the Assay / Ops / Draw tabs from the menu bar spec. Each mode follows its frame:
  - `web/assay/` follows Assay v2 and the right-panel frames: pinned decision card, Forecast / Images / Why tabs (`panel.js`), the refused state, the approve and reject states with undo, the Scales strip and the timeline (`timeline.js`).
  - `web/ops/` follows the two Ops frames: Agent runs (`ops.js`) and Forecast evidence (`evidence.js`).
  - `web/draw/` follows the Draw frame: presets, magnification, field readout, preset assumptions and the first-time hint.
- **Honesty labels.** The chips in the frames became required labels in code: "Recorded run", "Simulated cells, not tracked cells", "Sped up" (shown by the timeline whenever speed is above 1x), "Simulation on recorded data" and "Untested" for "stop, likely to close".

## What changed in code compared with the frames

- **Light wireframes, dark build.** The frames are greyscale wireframes on a light background. The build uses the Dark style-guide board.
- **The cell field is 3D.** The Assay frame shows a flat lattice. In code the field is a three.js scene of simulated cells, one column per lattice site, with an orbit camera (`web/assay/tissue.js`). It is still labelled as simulated.
- **The shipped forecaster changed.** The frames name edge speed as the shipped forecaster. After the frames were drawn, the real-data NCA passed our gate and became the forecaster in the upload and agent path (design.md R29). The code does not hard-code a model name: it shows whatever model the forecast file names.
- **Real data instead of placeholders.** The Ops frames had dashes and rows marked "illustrative". The code reads every number from files under `agent/` and `web/ops/evidence.json`. It shows "not available" if a file is missing.
- **Scoreboard rows renamed.** The frame's "Stitch agent / Always continue / Stall rule only" became "Fixed schedule / Simple rules / Forecast policy (code; replay model, no LLM)", plus a real-model row. The new names make clear that the plate-hour gain comes from the forecaster and the policy code, not from the LLM.
- **Additions not in the frames.** An Investigator table in Ops (hypotheses, not causes). A Reporter section in the Why tab (the summary written at the end of a recorded run). The Why tab's run steps became a per-check agent timeline built from the run log.
- **Images tab for replays.** Held-out WHAD replays have no raw frames in the repo, so the Images tab says so instead of showing thumbnails. Uploads and samples show their frames and masks as in the frame.
