# Video recording runbook (shot by shot)

For Joanne (P3), Sun 15 Nov. The video must be under 2:00 and in by 12:00. This file follows `docs/video-script-draft.md` shot for shot. Narration, guardrails and the "Do not say" list live there and in `docs/video-demo.md`. This file says what to put on screen and how to capture it.

Every number on screen must come from a repo results file. The source is given next to each one. Terminal output is shown as output, not quoted in captions.

## 0. Before you record

### 0.1 Final agent re-record (do this first; not done yet)

The Assay and Ops shots need recorded runs. This worktree has none yet (`agent/runs/` holds only `.gitkeep`), so the Assay wound list shows only the offline samples. The final runs come from one command on the submission account. It makes real model calls, so it costs money and needs a key. It has not been run for this runbook.

```bash
cd <repo root>
set -a; . ./.env; set +a            # STITCH_PROVIDER, STITCH_MODEL and the key or AWS profile
python -m agent.record --out agent/runs
```

It records `exp1_partII_C61_P1` first with both approval branches (approve and reject), then `exp1_partI_C61_P1`, `exp1_partII_C61_P2`, `exp1_partII_CC_P2` and a real-frame upload run (`agent/record.py`, `WOUNDS` and `VIDEO_UPLOAD`). It prints a JSON summary with the cost and fails if any file leaks a path, username or key. Check `"dirty": {}` before you commit the runs.

After it finishes:
- Film the first wound (`exp1_partII_C61_P1`). It is the one with an approval point.
- Read the decision, the Critic counts and the Reporter summary off the Why tab of that run. Narrate only what that run shows (`docs/video-script-draft.md`, "Checks before recording").
- Rerun `python -m agent.evaluate` if you want the "Real model" scoreboard row to use the new runs. Do not quote that row in narration either way.

### 0.2 Serve the app

From the repo root (not `web/`):

```bash
python3 -m http.server 8010 --bind 127.0.0.1
```

Open http://127.0.0.1:8010/web/index.html. Modes are hash routes:
- Assay: http://127.0.0.1:8010/web/index.html#assay
- Ops: http://127.0.0.1:8010/web/index.html#ops
- Draw: http://127.0.0.1:8010/web/index.html#draw

Hard-reload once (Ctrl Shift R) after the re-record so the new `agent/runs/index.json` is picked up.

### 0.3 Screen setup

- Browser window 1920x1080, zoom 100%, bookmarks bar hidden, no other tabs.
- Terminal: dark theme, font about 20 pt, window about 1600x900, prompt shortened (`PS1='$ '`).
- Record each shot as its own clip. Speed-ups and labels go on in the edit.
- Before the terminal shot, close other heavy jobs. See 0.4.

### 0.4 Terminal commands (verified on Sun 15 Nov, 04:16-04:25)

Run from the repo root with the agent venv. `-I` keeps Python from loading files from the current folder.

```bash
PY=~/imperial-ai-hack/wt-agent/.venv/bin/python
F="web/data/samples/sample_frame1.png web/data/samples/sample_frame2.png web/data/samples/sample_frame3.png"

# A. default forecaster (real-data NCA v3)
$PY -I data/upload.py --frames $F --interval 1 --scale 0.908 --out /tmp/stitch-video --name video_upload
$PY -I tools/show_forecast.py /tmp/stitch-video/video_upload.json

# B. edge-speed forecaster (the fallback and baseline)
$PY -I data/upload.py --frames $F --interval 1 --scale 0.908 --forecaster edge_speed --out /tmp/stitch-video --name video_edge
$PY -I tools/show_forecast.py /tmp/stitch-video/video_edge.json

# C. refusal: one blurred frame
$PY -I data/upload.py --frames web/data/samples/bad_blurred.png --interval 1 --scale 0.908 --out /tmp/stitch-video --name video_bad
```

`tools/show_forecast.py` is a 25-line printer. It turns the output JSON into a short readout. It adds no numbers of its own.

What they printed:

**A. NCA (default).** The NCA loaded fine (torch is in the venv). No fallback. 13.5 s wall time on the first run. A second run gave the same output but took 420 s, because other jobs had the machine at load 40. Record with nothing else running, or pre-run it and film only the readout.

```
forecast -> /tmp/stitch-video/video_upload.json
model:         nca_realft3
frames seen:   0 h = 1.00, 1 h = 0.90, 2 h = 0.79 (wound area vs first frame)
at 19 h:       median 0.01, 90% band 0.00 to 0.30
half closed:   7 h (90% range 5.0 to 10.0)
90% closed:    15 h (90% range 10.0 to after 19 h)
P(90% closed by 19 h): 0.782
flags:         none
QC:            flagged scale 0.908 um/px resampled; validated only at 0.454 um/px (WHAD)
schedule:      image_again next image at 3.8 h
```

It also writes three masks (`video_upload_frame1_mask.png` to `frame3`) and `video_upload_masks.npz`. The wound covers 14.9% of the first frame.

**B. Edge speed.** 1.9 s.

```
forecast -> /tmp/stitch-video/video_edge.json
model:         edge_speed
at 19 h:       median 0.03, 90% band 0.00 to 0.39
half closed:   9.09 h (90% range 3.61 to after 19 h)
90% closed:    median after 19 h (90% range from 7.26 h)
P(90% closed by 19 h): 0.236
flags:         none
schedule:      image_again next image at 3.8 h
```

**C. Refusal.** 1.2 s. Exit code 0. No forecast is made.

```
{"refused": true, "reasons": ["frame 1: out of focus (texture score 0.37 < 1.0)"]}
```

Things to know before you show these:
- **This is a pipeline demo, not validation.** The command line uses NCA models trained on all WHAD wounds, and edge speed calibrates on all of them. The sample frames come from a WHAD wound, so that wound was in training. The Assay sample (`sample_3frame`) was built with that wound left out, so its numbers differ a little. Do not caption the terminal numbers. Use the validation figures for claims.
- **The QC "flagged" line is expected.** The sample PNGs are saved at half resolution (0.908 um/px). The pipeline resamples them to WHAD's 0.454 um/px and says it is outside the validated scale. Leave it on screen. It shows the QC is honest.
- **The two forecasters disagree on this wound** (P(90% closed by 19 h) 0.782 vs 0.236). That is real output. Film only run A in the video so you do not have to explain it.
- **If the NCA ever fails** (for example, torch is missing), `data/upload.py` falls back to edge speed by itself and says so in the `notes` field ("NCA unavailable (...); edge-speed forecaster used"). The `model:` line then reads `edge_speed`. If that happens, label the shot "edge-speed fallback" and keep going.

## 1. Shots

Times match `docs/video-script-draft.md`. "Label" is the honesty chip that must be on screen. Labels in quotes are the exact on-screen text.

### Shot 1. Problem (0:00-0:10)

- **On screen:** WHAD time-lapse of one wound, hourly frames. A lab-plate shot first if you have one.
- **Source:** `web/data/samples/sample_frame1.png` to `sample_frame3.png` are real WHAD frames you can use right away. A longer time-lapse needs raw WHAD frames (not in the repo).
- **Capture:** image sequence in the editor, about 3 fps.
- **Length:** 10 s.
- **On-screen text:** "Scratch assay, MCF10A cells, WHAD (CC BY 4.0)".
- **Label:** sped up.

### Shot 2. Draw (0:10-0:22)

- **URL:** http://127.0.0.1:8010/web/index.html#draw
- **Clicks:** `#draw` opens Assay's 3D view in live drawing ("Draw a wound · live NCA"). Press the **CC** preset and pick a brush size (S/M/L). Drag on the tissue to cut a wound: the NCA keeps running and fills the gap live, and you can keep cutting while it heals. Set speed (1/2/4/8 h/s). Wheel to zoom in on single hexes, then out to the whole field; right-drag orbits. **Reset to intact tissue** starts over. It stops by itself once every cell is back to at least 95% density.
- **Length:** cut 3 s, heal 5 s, zoom 4 s. Capture about 30 s and speed up.
- **On-screen text:** "Simulation (NCA emulator, follower rule; preset parameters)" · "Simulated cells · not tracked cells" · "No forecast". Hexes are 10 µm display samples of the NCA density, not cells.
- **Optional, wound photo:** the same **Upload images…** button that takes microscopy frames also takes one skin-wound photo (there is no separate photo button). Pick `design/prototypes/glass-dish/sample/test_skin_wound_synthetic.jpg`: Assay switches to live drawing and opens the photo. Drag a box around the wound, press **Trace outline**, and the outline is carved into the tissue and healed by the NCA. Add the on-screen text "Shape from photo; healing is a cell-culture model, not this wound". The step counter counts simulation steps, not hours: do not caption a healing time.
- **Label:** simulated · sped up.

### Shot 3a. Real pipeline in the terminal (inside 0:22-0:34, about 4 s)

This is the new shot. It shows the real Python pipeline finding the wound and forecasting.

- **On screen:** terminal from 0.4.
- **Commands:** run A, then `show_forecast.py` on its output. Type them beforehand and just press Enter on camera (or paste).
- **Length:** capture the full run (about 15 s on a quiet machine), cut the wait. Final 3-4 s: the command, then the readout.
- **On-screen text:** "data/upload.py: QC, wound mask, forecast". No numbers in the caption.
- **Label:** "Recorded terminal run" · "Sped up" (if you cut the wait, say so).

### Shot 3b. Detection (inside 0:22-0:34, about 2 s)

- **On screen:** `docs/video-assets/detection_frame1_mask.png`. It is sample frame 1 with the wound mask from run A outlined in the app's amber (#E0A458). Made with PIL from `/tmp/stitch-video/video_upload_frame1_mask.png`.
- **Capture:** still image, slow push-in in the editor.
- **Length:** 2 s.
- **On-screen text:** "Wound found by our texture segmenter (data/upload.py)".
- **Label:** real frame, WHAD.

### Shot 3c. Assay: frames, QC and forecast (0:22-0:34, the rest)

- **URL:** http://127.0.0.1:8010/web/index.html#assay
- **Clicks:** in the wound list choose the recorded run for `exp1_partII_C61_P1` (group "Recorded runs (held-out WHAD replays)"). Open the **Images** tab to show the three frames with masks and the QC chip. Then switch the wound list to **"Sample · blurred frame (refused)"** for one second to show the refusal chip. Switch back to the run. Open the **Forecast** tab. Press play and set speed to **2×** or **4×**.
- **Fallback if the re-record is not done:** use **"Sample · 3 frames (upload)"**. Its chip reads "Sample data", not "Recorded run". Then do not say "recorded run" over it.
- **Length:** about 6 s after 3a and 3b.
- **On-screen text:** "Recorded run" · "Real frames, WHAD".
- **Label:** recorded run · sped up (the timeline shows "Sped up" by itself above 1×).

### Shot 4. Decision and approval (0:34-0:46)

- **URL:** same run as 3c.
- **Clicks:** let playback run until it pauses at the approval point ("Paused at N h: the proposal needs your approval."). Hold 1 s. Click **Approve** on the decision card. The card turns to approved.
- **Length:** 12 s.
- **On-screen text:** "Agent proposal · approval needed" · "Recorded run".
- **Label:** recorded run. Narrate the decision this run shows, not a fixed one.

### Shot 5. Why and Reporter (0:46-0:54)

- **Clicks:** open the **Why** tab. Show the allowed decisions with the chosen one marked and the line "The Critic traced N numbers and removed M". Scroll down to the Reporter summary.
- **Length:** 8 s.
- **On-screen text:** "Every number traced to a tool output" · "Report written at the end of the recorded run".
- **Label:** recorded run.
- **Check:** read N and M off the screen. Do not caption a fixed count. If there is no report section, cut the last sentence of this shot's narration.

### Shot 6. Validation (0:54-1:04)

- **On screen:** `eval/figures/video/1_forecast.png` (5 s), then `2_reveal.png` (5 s), a cut or a fade.
- **On-screen text:** "Held-out wound: the model never saw it".
- **Number:** "inside the band at 15 of 16 later frames" is the title of `2_reveal.png`, computed by `eval/video_figures.py`. Read it off the figure; if the figure is regenerated, use its new title.
- **Label:** none beyond the figure titles (`docs/video-assets.md`).

### Shot 7. Scorecard (1:04-1:16)

- **On screen:** `eval/figures/video/3_scorecard.png`, shipped row highlighted. 12 s.
- **On-screen text:** "28 unseen wounds · 55 series" · "Quantile score, lower is better".
- **Numbers and sources:**
  - 28 wounds, 55 series: `docs/results.md`, datasets table (line 9) and coverage table (line 37).
  - Edge speed 0.0386, NCA v3 0.0397 (+3%, ratio 1.03): `docs/results.md`, headline table and gate table (lines 20, 21, 93).
  - Simulator-only NCA 0.0502 (+30%, fail): `docs/results.md` (lines 26, 88).
  - NCA better at 1.9 h and 9.5 h: `docs/results.md` gate table (9.5 h: 0.0289 vs 0.0316, line 105) and the README.

### Shot 8. Honesty (1:16-1:27)

- **On screen:** `eval/figures/video/4_calibration.png` (6 s), then `5_failure.png` (5 s).
- **On-screen text:** "Band on unseen wounds: 92% (target 90%)" · "New cell type: 58%".
- **Sources:** 92%: `docs/results.md` line 37 (0.92). 58%: `docs/results.md` line 41 (WHiM-BC ordinary to stem-cell, 0.58, "fails") and line 57 ("15-58%").

### Shot 9. Ops (1:27-1:47)

- **URL:** http://127.0.0.1:8010/web/index.html#ops
- **Clicks:** **Agent runs** tab is open by default. Scroll the run log table slowly. Click the `exp1_partII_C61_P1` run to open its steps. Scroll to the scoreboard (fixed schedule, simple rules, forecast policy). Then the adversarial table showing 15 of 15 met. Click one attack type to open its cases if there is time.
- **Length:** 20 s. Capture about 40 s and speed up.
- **On-screen text:** "Replay on held-out wounds · simulation on recorded data" · "Gain from the forecaster and policy code" · "Adversarial set: stub models, no real model calls".
- **Numbers and sources:**
  - 82% called at the first check, 91% right, 75% always "won't close": `docs/results.md` lines 69 and 72 (same with the shipped NCA v3).
  - 15 of 15 met: `agent/results/adversarial.md` line 5.
  - Scoreboard rows, if you caption them: fixed 0, simple rules 338.2, forecast policy 761.9 plate-hours over 55 wounds: `agent/results/scoreboard.md`, main table. Do not quote the "Real model" row (4 practice runs, not comparable).
- **Label:** simulation on recorded data · stub models (adversarial table) · sped up.

### Shot 10. Close (1:47-1:56, hold to 2:00)

- **On screen:** end card. Stitch wordmark, repo URL https://github.com/ephemerallyCaden/imperial-ai-hack, datasets, team.
- **Length:** 9 s, plus up to 4 s silent hold.
- **On-screen text:** "Research use only, not for diagnosis or treatment" · "Data: WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118".

## 2. Timing check

Shots 3a, 3b and 3c share 0:22-0:34 (4 s + 2 s + 6 s). If that feels rushed, drop the Images tab from 3c. The terminal and the mask image already show the frames going in. Keep the refusal flash: the narration says "refuses bad images". You can show it in the terminal (command C, 1 s) instead of the Assay sample.

## 3. Last checks before export

- Every Assay shot has "Recorded run" on screen (or "Sample data" if you used the fallback, and the narration matches).
- "Sped up" on every shot above 1×.
- No terminal numbers in captions.
- No words from the "Do not say" list in `docs/video-script-draft.md`.
- 1080p, H.264, under 2:00. Check it plays logged out.
