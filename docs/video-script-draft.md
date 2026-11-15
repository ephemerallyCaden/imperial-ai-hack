# Video script: draft for P3 (2:00)

Draft by P1 from the real results; Joanne owns the final script (`docs/video-script.md`). Order follows design.md section 8 and 9b: **draw tool first, then Assay (real upload + agent run), then held-out validation and the scorecard with a failure, then Ops as proof**. Narration is about 300 words at roughly 2.5 words per second. Every number traces to `docs/results.md`.

| Time | Screen | Narration |
|---|---|---|
| **0:00-0:12** Problem | Lab plate, then a scratch-assay time-lapse | "Scratch assays show how cells close a wound. Today's tools tell you how a wound closed, after the run. Stitch tells you early how it will close, and how sure it is." |
| **0:12-0:30** Draw | Draw mode: draw a wound, cells close it, zoom out from cells to the density map and wound outline. Chip: "simulated cells, not tracked" | "Draw a wound and watch it heal. These cells are simulated. A neural cellular automaton, fine-tuned on real wound videos, emulates our cell model fast enough to run in the browser." |
| **0:30-0:58** Assay | Upload 3 real frames (the sample wound). QC passes; flash a blurred frame being refused. Forecast curve with 90% band. Agent timeline, decision card: "image again at 3.8 h", then approve | "Now a real experiment. Upload three frames. Stitch checks each one and refuses bad images. It finds the wound and forecasts the rest of the closure with a 90% band. The agent proposes the next step. Every number on screen comes from a tool, and a person approves anything that can't be undone." |
| **0:58-1:08** Validation | `eval/figures/video/1_forecast.png`, then `2_reveal.png` | "Here's a wound the model never saw. After 3.8 hours we forecast the rest. Here's what happened: inside the band at 15 of 16 frames." |
| **1:08-1:20** Scorecard | `3_scorecard.png` | "On 27 unseen wounds, a simple edge-speed model is hard to beat. Our automaton trained only on simulation failed our pre-set test. Fine-tuned on real frames, it passes, within 4%." |
| **1:20-1:32** Honesty | `4_calibration.png`, then `5_failure.png` | "The 90% band holds on new wounds: 92%. Not on a new cell type: 58%, so you calibrate per cell line. And it misses wounds that suddenly speed up." |
| **1:32-1:48** Ops | Ops mode: run log table, agent scoreboard vs fixed schedule and simple rules. Label: "replay on held-out wounds, simulated lab" | "In replay on held-out wounds, early calls that a wound won't close were right 91% of the time, against 75% for always guessing, freeing plate time. Every step is logged." |
| **1:48-2:00** Close | Repo link, datasets, team | "Stitch: early, honest forecasts for wound-healing assays. Research use only. Open data, open code." |

## Labels on screen (required, design.md section 11)
- Draw mode: "simulated cells, not tracked cells"; NCA output: "emulator".
- Ops scoreboard and plate-hours: "simulation on recorded data".
- Anything sped up: "2x" (or whatever is used). Recorded agent runs: "recorded run".

## Do not say
"first", "clinical", "diagnosis", "predicts drug effects", "separates migration from division", "saves N hours in labs" (only "in replay on recorded data").

## Checks before recording
- The Ops scoreboard numbers come from P3's agent replay (design.md 9b), not from this draft. Replace the 91% / 75% line if the agent replay reports different numbers, or use P1's scheduler numbers labelled as such.
- If the team switches the shipped forecaster to the real-data NCA (design.md R26, open decision), change "a simple edge-speed model is hard to beat" accordingly.
