# Video script: draft for P3 (under 2:00)

Rand (P1) wrote the first draft from the real results. P3 revised it on Sun 15 Nov to add the agent layer. Joanne owns the final script (`docs/video-script.md`). The order follows design.md sections 8 and 9b: **Draw first, then Assay (a recorded agent run), then held-out validation and the scorecard with a failure, then Ops as proof**. Every number comes from `docs/results.md`, `agent/results/scoreboard.md` or `agent/results/adversarial.md`. The claim guardrails in `docs/video-demo.md` apply to every line.

Narration is about 290 words. At 2.5 words per second that is about 1:56, so the read must not go slower than that.

| Time | Screen | On-screen text | Narration |
|---|---|---|---|
| **0:00-0:10** Problem | Lab plate, then a scratch-assay time-lapse (WHAD frames, hourly) | "Scratch assay, MCF10A cells, WHAD (CC BY 4.0)" · "Sped up" | "Scratch assays show how cells close a wound. Today's tools measure closure after the run. Stitch tells you early how it will end and how sure it is." |
| **0:10-0:22** Draw | Draw mode: draw a wound, press Heal, cells close it. Zoom from single cells out to the whole wound. | "Simulated cells, not tracked cells" · "Simulation, preset parameters (WHAD part II fits)" · "Not a forecast · no band" · "Sped up" | "Draw a wound and watch it heal. These cells are simulated. They follow rules fitted to real wound videos. They run live in the browser." |
| **0:22-0:34** Assay: frames and forecast | Assay mode, recorded run on the sample wound. Three real frames with their masks (Images tab). QC passes. Flash the blurred sample being refused. Forecast curve with its 90% band. | "Recorded run" · "Sped up" · "Real frames, WHAD" | "Now a real experiment. Three frames go in. Code checks each one and refuses bad images. A neural cellular automaton, fine-tuned on real wound videos, forecasts the rest of the closure with a 90% band." |
| **0:34-0:46** Assay: decision and approval | Decision card appears. Playback pauses at the approval point. Cursor clicks Approve. Card turns to "Approved". | "Agent proposal · approval needed" · "Recorded run" | "Code lists the decisions allowed at this check. Claude picks one and explains why. Anything that stops a plate waits for a person. Playback pauses here until someone approves." |
| **0:46-0:54** Assay: Why and Reporter | Why tab: allowed decisions, the chosen one marked, "The Critic traced N numbers and removed 0". Scroll to the Reporter summary at the end of the run. | "Every number traced to a tool output" · "Report written at the end of the recorded run" | "Claude never makes a number. A code Critic removes any figure no tool produced. At the end, a short report sums up the run." |
| **0:54-1:04** Validation | `eval/figures/video/1_forecast.png`, then `2_reveal.png` | "Held-out wound: the model never saw it" | "Here's a wound the model never saw. After 3.8 hours we forecast the rest. Here's what happened: inside the band at 15 of 16 later frames." |
| **1:04-1:16** Scorecard | `eval/figures/video/3_scorecard.png` (the shipped row highlighted) | "28 unseen wounds · 55 series" · "Quantile score, lower is better" | "On 28 unseen wounds, a simple edge-speed model is hard to beat. Our automaton trained only on simulation failed our pre-set test. Fine-tuned on real frames, it comes within 3% at 3.8 hours and does better at 1.9 and 9.5 hours. That's the model Stitch uses." |
| **1:16-1:27** Honesty | `eval/figures/video/4_calibration.png`, then `5_failure.png` | "Band on unseen wounds: 92% (target 90%)" · "New cell type: 58%" | "The 90% band holds on new wounds: 92%. Not on a new cell type: 58%, so you calibrate per cell line. And it misses wounds that suddenly speed up." |
| **1:27-1:47** Ops | Ops mode, Agent runs tab: the run log table scrolls; click the run to show its steps. Then the scoreboard (fixed schedule, simple rules, forecast policy). Then the adversarial table with "14 of 14 met". | "Replay on held-out wounds · simulation on recorded data" · "Gain from the forecaster and policy code" · "Adversarial set: stub models, no real model calls" | "Every step is logged. In replay on held-out wounds, 82% of wounds got a call at the first check. 91% of those calls were right, against 75% for always guessing 'won't close'. That gain comes from the forecaster and the policy. The model only chooses among allowed options and explains them. We also attacked it ourselves: 14 of 14 bad inputs were handled as expected." |
| **1:47-1:56** Close | End card: Stitch wordmark, repo URL, datasets, team | "Research use only, not for diagnosis or treatment" · "Data: WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118" | "Stitch: early, honest forecasts for wound-healing assays. Open data, open code." |

The last 4 seconds (1:56-2:00) are spare. Leave them as a silent hold on the end card. Or use them if the read runs long.

## Labels on screen (required, design.md section 11 and the style guide)
- Draw mode: "Simulated cells, not tracked cells" and "Simulation, preset parameters". Draw runs the cell-agent engine (`sim/js/engine.js`) under a preset. It shows no band and makes no forecast claim.
- Assay: "Recorded run" on every Assay shot. "Sped up" whenever playback speed is above 1x (the timeline shows this chip itself).
- Ops scoreboard and stop-early numbers: "Simulation on recorded data".
- Adversarial table: "Stub models, no real model calls" (that is how `agent/results/adversarial.md` was run).
- End card: "Research use only, not for diagnosis or treatment".

## Do not say
"first", "clinical", "diagnosis", "predicts drug effects", "separates migration from division", "3D model", "saves N hours in labs" (only "in replay on recorded data"), "the AI decides" (code sets the options; the model picks one and explains).

## Checks before recording
- **Which run to film.** Use a run from the final re-record (`python -m agent.record --out agent/runs`). The 0:34 shot needs a run with an approval point, recorded with `--both-branches`. Narrate the decision the run actually shows; do not name a decision in the voice-over that the run does not make.
- **Critic count.** Read the traced and removed counts off the Why tab of the run you film. Do not put a fixed count in the captions.
- **Reporter.** The Why tab only shows the report section if the run log has one. Check the filmed run has it; if not, cut the last sentence of 0:46-0:54.
- **Stop-early numbers.** 82% / 91% / 75% are from `docs/results.md` ("Can a scientist stop the plate early?"), held-out WHAD, edge speed. They are the same with the shipped NCA v3 (45 of 55 called at 1.9 h, 91% right). They are not the real-model row of the scoreboard, which is 4 practice runs and is not comparable.
- **Do not quote real-model plate-hours.** The real-model row in `scoreboard.md` is a small practice sample until the final re-record replaces it.
- **Shipped forecaster.** The real-data NCA v3 is the forecaster in the upload and agent path (design.md R29). Edge speed is the fallback and the baseline. The scorecard line follows the guardrail table in `docs/video-demo.md`.
