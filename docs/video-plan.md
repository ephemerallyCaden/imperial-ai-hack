# Video plan: two presenters on camera + app footage

Rand + friend present on camera; the middle is app footage with voice-over. Shots: `docs/video-recording.md`. Numbers: `docs/results.md` (list below). Under 2:00, about 250 words in total.

## Structure

| Part | Time | Who | On screen | Words |
|---|---|---|---|---|
| Open | 0:00-0:18 | Rand, then friend | Rand in a corridor; cut to the WHAD time-lapse on "dish" | ~60 (written, below) |
| Draw + Assay demo | 0:13-0:50 | Friend, voice-over | Draw (draw, Run, zoom); terminal upload; mask still; Assay forecast; decision card + Approve; Why tab | ~85 |
| Does it hold? | 0:50-1:25 | Rand, voice-over | `eval/figures/video/1_forecast.png`, `2_reveal.png`, `3_scorecard.png`, `4_calibration.png`, `5_failure.png` | ~80 |
| Ops proof | 1:25-1:45 | Friend, voice-over | Ops: run log, scoreboard, adversarial 15 of 15 | ~45 |
| Close | 1:45-2:00 | Both, on camera | Faces, then end card | ~15 |

## Opening (option C, agreed)

> **Rand** (corridor): "In a hospital, a wound that won't heal can be life or death. Nobody here has the luxury of faith."
>
> **Friend** (cut to the lab or the WHAD time-lapse): "What if you could know, hours early, how a wound will heal? Treatments for diabetic wounds, cancer and scarring are all tested first on cells in a dish. Stitch forecasts how that dish will heal, and how sure it is."

Cut to the time-lapse on "dish", so the lab is on screen when Stitch is named. The hospital is the motivation; the lab is the product. The opening is about 60 words (~18 s), which leaves about 190 words for the rest.

Use cases (diabetic wounds, infection, cancer, fibrosis, drug screens) are motivation and "where next" only, with an on-screen label "next steps, not yet validated". Say Stitch *forecasts* closure. Never say it shows *why* a wound is slow, or whether cells move less or multiply less: our own identifiability test (design.md R30) shows wound area alone cannot separate the two.

## Hospital scene rules
- Don't film inside a real hospital without written permission. Use a clean corridor that looks the part, or Pexels or Pixabay stock footage.
- No patients, no identifiable staff, no NHS logos. Gloved hands plus a corridor is enough.
- The end card must say "Research use only, not for diagnosis or treatment".

## Numbers you may say (all from docs/results.md)
- 28 unseen wounds
- 90% band holds 92% of the time on unseen wounds
- 58% on a new cell type, so calibrate per cell line
- NCA trained only on simulation failed our pre-set test; fine-tuned on real frames it is within 3% of edge speed at 3.8 h and better at 1.9 h and 9.5 h
- inside the band at 15 of 16 later frames
- 82% called at the first check, 91% right vs 75% for always guessing "won't close" (replay, simulation on recorded data)
- 15 of 15 adversarial inputs handled

## Never say
"first", "clinical", "diagnosis", "predicts drug effects", "separates migration from division", "3D model", "saves N hours", "the AI decides".

## Labels on screen
- Draw: "Simulated cells, not tracked cells"
- Assay: "Recorded run" (or "Sample data" for the sample)
- Any shot above 1x: "Sped up"
- Ops: "Simulation on recorded data"
- Adversarial table: "Stub models, no real model calls"
- End card: "Research use only, not for diagnosis or treatment"

Say "a neural cellular automaton forecasts" only over the upload/sample run or the terminal shot; held-out runs in Assay show the edge-speed forecast.

## Order of work (Sun 15 Nov)
1. 08:00-09:00: write the rest of the script (~190 words after the opening); read it aloud with a timer.
2. 09:00-09:45: screen recordings, silent, 2-3 takes per shot (app: `python -m http.server 8010` from the repo root, then http://127.0.0.1:8010/web/index.html).
3. 09:45-10:15: voice-over, recorded separately (quiet room, phone 15-20 cm away, one take per paragraph).
4. 10:15-10:30: on-camera bits (landscape, eye level, facing a window, 3 takes each, look at the lens).
5. 10:30-11:10: edit; burned-in captions; labels.
6. 11:10-11:30: export 1080p H.264 under 2:00, upload as unlisted, check it plays logged out, submit on Devpost.
