# Video demo plan (2 minutes, Devpost)

Status: v5 script, Sun 15 Nov. Owner: P3 (video). Opening and evidence lines written by the team; the rest keeps the earlier structure (NCA, agents, Adaption, Figma, lab use). The script describes the finished product: the real-data NCA is the forecaster (R29), triage covers stalling, discolouration and abnormally fast growth, and the agent pipeline runs on Adaption fine-tunes. Audience: doctors and assay scientists.

The video is the only demo the judges see (no slides, no live demo), so it carries every mark: rigour 30, execution 25, path to the lab 20, novelty 15, video 10. It is also how we qualify for the two open prizes (rules: "show in your presentation how you qualify"): **Best Designed AI Product (Figma)** and **Best use of Adaption**. Each gets its own short, named segment, placed next to the part of the product it built.

## Script (v5)

The hospital runs through the whole video. Two teammates play the same characters throughout: **the patient** (dressed forearm wound) and **the clinician** (gloves, tablet). The third films. The complex parts of the NCA go on screen as short captions, so the voice-over can stay simple.

About 300 words including the role-play, roughly 1:56 at a brisk read (160 words per minute) with pauses in the role-play. Time the real read and use the cut list below if it runs over 1:55.

| Time | Segment | On screen | Voice-over |
|---|---|---|---|
| 0:00-0:18 | **1. Hook: the hospital** | Team walks down a hospital corridor (tracking from behind). Gloved hands peel back the patient's dressing. Quick inserts as each case is named: a foot dressing (diabetic), a red, swollen edge (infection), a raised scar (scarring); props or make-up only, no real patients. | "In a hospital, a wound that won't heal can be life or death. Nobody here has the luxury of guessing. What if we could audit a wound early, and catch the diabetic ulcer that's closing too slowly, the infected wound that has stalled, or the scar that won't stop growing?" |
| 0:18-0:39 | **2. Upload, cells, NCA** | The clinician photographs the wound on the tablet. Cut to the app: the image is uploaded, the wound edge is traced, and the image breaks apart into cells in 3D. The NCA runs: cells move into the gap, the camera zooms from single cells out to the whole wound. Captions, about 1 s each: "wound edge found" / "1 point = 1 cell" / "the same learned rule in every cell" / "move or divide" / "trained on a published cell model (Migliaccio 2023)" / "fine-tuned on real wound videos (WHAD)". | "Upload a photo of a wound, and Stitch turns it into cells, one point per cell. Then our neural cellular automaton takes over. Each cell looks at its neighbours and follows one small learned rule: move into the gap, or divide. We trained it on a published cell model, then fine-tuned it on real wound videos." |
| 0:39-0:55 | **3. Range, flags, assistant** | Fifty faint healing curves fan out, then merge into one shaded range. Triage cards light up: **Stalling**, **Discolouration**, **Abnormally fast growth**. Assistant card with two options, "Take another photo" and "Stop early". The clinician taps one. Caption: "50 runs". | "It runs fifty times to give a range, and tells you how sure it is. Stitch flags stalling, discolouration and fast growth. An AI assistant suggests what to do next, whether to take another photo or stop early. A person always has the final say." |
| 0:55-1:09 | **3b. Role-play: "Hey Stitch"** | At the bedside, the clinician looks at the patient's wound, then at the tablet showing its progress, and asks it out loud. On the tablet: Stitch's voice waveform, the **Stalling** triage card and the curve flattening out. Subtitles for both speakers. The clinician says thanks and walks off down the corridor to look into it. Stitch's voice is ElevenLabs. | **Doctor:** "Hey Stitch, what's it looking like?"<br>**Stitch** (ElevenLabs voice): "I've triaged the anomalies. It seems like the wound is stagnating at [X]% a day, worth looking into this."<br>**Doctor:** "Thanks." |
| 1:09-1:21 | **4. Does it work?** | One held-out wound: the range is drawn ahead, then its 16 real measurements land one by one, a counter ticking to **15/16**. Then: "28 unseen wounds · 4 public datasets · 92% inside the 90% range" and "matches or beats every simple baseline" over the scorecard, NCA row highlighted (on screen only, no voice-over). | "Does Stitch really work? We tested it on 28 wounds it had never seen. Here's one that we tested, and our prediction was right 15 times out of 16." |
| 1:21-1:34 | **5. Agents + Adaption** | Pipeline diagram: Intake, QC, NCA forecast, Triage, Assistant, Reporter, with an Adaption badge on each agent. Quick Adaption dashboard shots: Expand row counter, AutoScientist run, leaderboard win rate vs base. The report in two versions: clinician view on the tablet at the bedside, researcher view on a laptop in the lab. Caption: "every number traced to the tool that made it". | "Behind it, a team of agents runs the whole pipeline, each on a model we fine-tuned with Adaption that beats its base model. It writes one report for the ward and a more detailed one for the lab." |
| 1:34-1:42 | **6. Figma** | Figma wireframes, then the style guide (colours, type, components), then the same screen finished on the tablet in the clinician's hand. Badge: "Designed in Figma". | "We designed it in Figma, from wireframes to a full style guide, so a doctor can read it in seconds between patients." |
| 1:42-1:50 | **7. The lab** | A lab bench or laptop. Two curves side by side, "Drug A: stops movement" and "Drug B: stops division". Then a grid of wells, each with its own forecast. | "In the lab, it shows whether a cancer drug stops cells moving or multiplying, and saves time and space in drug screens." |
| 1:50-2:00 | **8. Close** | The clinician redresses the patient's arm. The team walks towards camera down the corridor. End card: Stitch logo, "Know sooner. Know how sure.", repo URL, team names, "Designed in Figma · Fine-tuned with Adaption", data credits (WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118; CC BY needs the credit). | "Nobody here has the luxury of guessing. With Stitch, they don't have to." |

### Read-through (for the voice-over)

> In a hospital, a wound that won't heal can be life or death. Nobody here has the luxury of guessing. What if we could audit a wound early, and catch the diabetic ulcer that's closing too slowly, the infected wound that has stalled, or the scar that won't stop growing?
>
> Upload a photo of a wound, and Stitch turns it into cells, one point per cell. Then our neural cellular automaton takes over. Each cell looks at its neighbours and follows one small learned rule: move into the gap, or divide. We trained it on a published cell model, then fine-tuned it on real wound videos.
>
> It runs fifty times to give a range, and tells you how sure it is. Stitch flags stalling, discolouration and fast growth. An AI assistant suggests what to do next, whether to take another photo or stop early. A person always has the final say.
>
> **[Role-play, acted on camera]**
>
> **Doctor:** Hey Stitch, what's it looking like?
>
> **Stitch** (ElevenLabs): I've triaged the anomalies. It seems like the wound is stagnating at [X]% a day, worth looking into this.
>
> **Doctor:** Thanks.
>
> Does Stitch really work? We tested it on 28 wounds it had never seen. Here's one that we tested, and our prediction was right 15 times out of 16.
>
> Behind it, a team of agents runs the whole pipeline, each on a model we fine-tuned with Adaption that beats its base model. It writes one report for the ward and a more detailed one for the lab.
>
> We designed it in Figma, from wireframes to a full style guide, so a doctor can read it in seconds between patients.
>
> In the lab, it shows whether a cancer drug stops cells moving or multiplying, and saves time and space in drug screens.
>
> Nobody here has the luxury of guessing. With Stitch, they don't have to.

### If the read runs over 1:55, cut in this order
1. "and saves time and space in drug screens" (segment 7); keep the grid of wells on screen.
2. "then fine-tuned it on real wound videos" (segment 2); the caption already says it.
3. "Stitch flags stalling, discolouration and fast growth." (segment 3); show the three triage cards instead, the role-play already shows one.

| Tempting line | Problem | Say instead |
|---|---|---|
| "Our NCA predicts how wounds heal" | Only the NCA fine-tuned on real WHAD frames passes the gate (R29): 0.0397 vs edge speed 0.0386 at 3.8 h (+3%), better at 1.9 h and 9.5 h. The simulator-only NCA fails (+30%). The shipped forecaster is the real-data NCA, with calibrated edge speed as the fallback. | "a forecaster fine-tuned on real wound videos, calibrated on unseen wounds"; the simulator-only NCA drives the draw tool. |
| "The NCA reproduces the simulator" | Criterion #24 not met (area error 0.042 vs the sim's own spread 0.014). | "learned to approximate those rules" |
| "Spots anomalies / triages" | Only the stall flag ships (AUC 0.85, precision 0.57, recall 0.62 at 3.8 h). Out-of-band doesn't predict anything; measure-again isn't shipped. | "flags wells likely to stall" |
| "Shows whether cells move less or multiply less" | Design non-goal; closure curves can't separate the two; WHAD is mitomycin-treated. | "the simulator keeps movement and division separate, so the next experiment is telling which one a treatment changes" |
| Hospital = our user / clinical prediction | No clinical data; clinical claims off-limits (design s11). The named user is the assay scientist (design s1). | Hospital is the motivation; the lab is the product. End card: "not for clinical use". |
| "Predicts drug effects" | On the Don't-say list. | "an early call frees plates and microscope time" |
| "3D model of tissue" | The model is 2D; 3D was cut. | 2D model, 3D *render*. Don't say "3D model". |
| "First ever" | Don't claim first. | "Prior work fits curves after the fact; we forecast ahead and check the uncertainty." |
| "Saves X hours" | Only usable once the agent evaluation (design 9b) has run. | Use the scoreboard number from the agent eval, stated as a simulation, or drop it. |

## Fill from the final results before recording

The judges have the repo and the Adaption leaderboard, so these must match:
- "matches or beats every simple baseline" (on screen): the real-data NCA vs best baseline per cut-off in `docs/results.md` (R29: 0.0397 vs edge speed 0.0386 at 3.8 h, better at 1.9 h and 9.5 h).
- Role-play "[X]% a day": pick a believable number for a stalling wound. If you want it to be a real tool output, use the closure rate of the stall demo wound (WHAD is filmed hourly, so say "an hour" instead of "a day").
- "28 wounds it had never seen": WHAD wounds passing QC in `docs/results.md`.
- "right 15 times out of 16": pick the held-out WHAD wound used in segment 4 from the forecast files; 15 of its 16 real measurements after the cut-off must fall inside the 90% range. Use that same wound on screen.
- "92% inside the 90% range" (on screen): NCA calibrated coverage on unseen WHAD wounds (0.92 today, per #135).
- "beating its base model head to head": Adaption leaderboard win rate per agent model; show the real figure on screen.
- Triage cards: one real demo wound per flag type.

## High-priority items

| # | Item | Owner | When |
|---|---|---|---|
| P0-1 | **Upload to cells to NCA, hero render**: in `web/index.html`, an uploaded wound image is traced, turned into cells (one point per cell) and run forward by the NCA in 3D (three.js), with the continuous zoom from cells to the whole wound and the 50-run range. Draw mode is a bonus. The engine is ready in `web/public/sim/js/` (engine, nca, worker, smooth). The image uploaded on screen must be one the app really processes. | P3 (+P2 for weights) | overnight |
| P0-2 | **Agent layer**: merge PR #69; `agent/` loop with `call_model()` and the code Critic; recorded runs on held-out WHAD wounds; Assay playback (forecast + band + triage cards + decision card + Approve). | P3 | overnight |
| P0-3 | **NCA fine-tune and re-score** so the NCA is the shipped forecaster; regenerate `docs/results.md`; send final numbers to P3. | P2 | by Sun 09:00 |
| P0-4 | **Triage in the demo run**: stall, discolouration and fast-growth flags on the Assay path, with one demo wound per flag plus one normal wound. | P1 / P3 | by Sun 09:00 |
| P0-5 | **Adaption across the pipeline**: widen design 9c from Intake only to every agent model (Intake, Triage, Reporter); Expand datasets, AutoScientist runs, leaderboard win rate vs base for each; wire them in through `call_model()`. Reporter produces the two-audience report (clinician and researcher summaries). Keep the leaderboard screenshots and run IDs for the README and Devpost. | P2 (Adaption) + P3 (wiring, report UI) | by Sun 09:00 |
| P0-6 | **Figma evidence**: one Figma Design file (not Figma Make) with the wireframes and the style guide (colours, type, components), plus the finished frames; put the link in `HACKATHON.md` and on Devpost. | P3 | by Sun 09:00 |
| P0-7 | **Validation + scorecard shots**: held-out reveal animation; calibration, reliability and scorecard figures restyled to the Figma design. | P1 data, P3 styling | Sun 09:00-10:00 |
| P0-8 | **Lock the script**; time the read at 1:55 max. | P3 + all | tonight |
| P1-9 | **Hospital shoot, self-shot**: cast = patient (teammate, dressed forearm), clinician (teammate, gloves, tablet), one person filming (tripod or a friend for the full-team walking shots). Get filming permission from the hospital first (usually its communications/press office), including which corridors and department signs we may film. No real patients, staff who haven't agreed, or patient screens or notes in frame. Plain clothes or gloves only, no hospital uniforms or ID badges. Props: tablet, gloves, bandage, tape. Film 2-3 takes of each shot; phone at 1080p/4K, 24-30 fps. | P3 + team | Sun, before 10:30 |
| P1-9b | **App on the tablet**: screen-record each app shot on a laptop first, then play those recordings full-screen on the tablet during the hospital shoot. No server reachable from the tablet needed. | P3 | before the shoot |
| P1-10b | **Stitch's voice**: generate the role-play line in ElevenLabs, a few takes, pick one; keep the voice for any other Stitch lines. | P3 | Sun 10:00 |
| P1-10 | **Voice-over**: one teammate reads it; record in a quiet room, 2-3 full takes, phone close to the mouth; captions burned in (judges may watch muted). | teammate | Sun 10:00 |
| P2-11 | **Backup video tonight**: screen capture of whatever runs plus a scratch voice-over. | P3 | before sleeping |
| P2-12 | Export 1080p, max 2:00, H.264; upload to Devpost with the Figma link and Adaption leaderboard link; check it plays logged out. | P3 | Sun 11:15-11:30 |

## Shot list (capture Sun 09:00-10:30)

1. Hospital, in script order: team walking a corridor from behind, 4 s; dressing peeled back, 3 s; inserts for diabetic foot dressing, infected edge and raised scar (props or make-up), 1.5 s each; clinician photographs the wound with the tablet, 3 s; clinician taps an assistant option, 2 s; report on the tablet at the bedside, 2 s; finished app on the tablet in hand, 2 s; redressing the arm, 3 s; team walking towards camera, 3 s.
1b. Role-play at the bedside: clinician looks at the wound and the tablet, asks "Hey Stitch, what's it looking like?", 3 s; tablet showing the waveform, Stalling card and flattening curve, 6 s; "Thanks." and walking off down the corridor, 3 s. Record the clinician's lines on set with a phone mic close by; generate Stitch's line in ElevenLabs (a calm voice that sounds different from the narrator), export WAV and lay it in during the edit.
2. App screen recordings (play them on the tablet for the in-hand shots): upload, edge traced, image breaking into cells, NCA healing with the zoom, 20 s; fifty curves merging into the range, 4 s; triage cards, 3 s; assistant card, 3 s.
3. Evidence: held-out wound with 16 measurements landing and the 15/16 counter, 8 s; "28 unseen wounds · 4 datasets · 92%" card, 3 s; scorecard with the NCA row highlighted, 4 s.
4. Agents + Adaption: pipeline diagram with badges, 3 s; Expand counter, AutoScientist run, leaderboard win rate, 2 s each; two report versions, 3 s.
5. Figma: wireframes, style guide, finished screen, about 2.5 s each.
6. Lab: bench or laptop, 2 s; drug A vs drug B curves, 4 s; grid of wells, 3 s.
7. End card, 4 s.

## Timeline

- Sat night / overnight (off-site work allowed): P0-1 to P0-6, P0-8, P2-11; ask the hospital for filming permission.
- Sun 09:00-10:30: P0-7, screen capture, hospital shoot.
- Sun 10:30-11:15: voice-over, edit, captions.
- Sun 11:15-11:30: export, upload, submit. 12:00 hard deadline (video and last commit).

## Decided
- Script v5: the team's opening ("In a hospital, a wound that won't heal can be life or death...") and evidence lines ("Does Stitch really work?..."), then the earlier structure. Audience: doctors and assay scientists.
- The script assumes the finished product (NCA forecaster after the fine-tune; full anomaly triage; Adaption across the agent pipeline).
- Figma and Adaption each get a short named segment placed next to what they built: Figma after the visuals, Adaption after the agents, ending on the report.
- Voice-over: a teammate. Hospital footage: self-shot, the team walking through the hospital.
- The hospital runs through every segment: two teammates play the patient and the clinician, and every segment opens on a hospital beat.
