# Video demo plan (2 minutes, Devpost)

Status: draft v3, Sun 15 Nov. Owner: P3 (video). The script describes the finished product: the NCA is the forecaster after the data fine-tune (P2), triage covers stalling, discolouration and abnormally fast growth, and the agent pipeline runs on Adaption fine-tunes ending in a report for doctors and researchers. Audience: doctors and assay scientists.

The video is the only demo the judges see (no slides, no live demo), so it carries every mark: rigour 30, execution 25, path to the lab 20, novelty 15, video 10. It is also how we qualify for the two open prizes (rules: "show in your presentation how you qualify"): **Best Designed AI Product (Figma)** and **Best use of Adaption**. Each gets its own short, named segment, placed next to the part of the product it built.

## Structure

The hospital runs through the whole video, not just the open and close. Every segment starts on a short hospital beat (1-3 s, under the voice-over) and then cuts to the product. Two teammates play the same characters throughout: **the patient** (dressed forearm wound) and **the clinician** (gloves, tablet). The third films.

~300 words of voice-over at about 150 words per minute. Times are targets; time the real read and trim academia or use cases first if it runs long.

| Time | Segment | Hospital beat, then product visual | Voice-over (draft) |
|---|---|---|---|
| 0:00-0:12 | **Hook** | Team walks down a hospital corridor (tracking from behind). Cut to gloved hands peeling back the patient's dressing. Ambient sound, then silence. | "When you're in a high-pressure, life-or-death situation like here, you don't have the luxury of faith. You need to know what happens next, and how sure you can be." |
| 0:12-0:22 | **The problem** | The clinician photographs the wound with the tablet. Tablet screen: a row of dated wound photos. Title: **Stitch**. | "Every dressing change, the wound is photographed, and clinics wait weeks to know if it's healing. Stitch forecasts it from the first few images." |
| 0:22-0:37 | **Tech: the NCA (hero shot)** | Match cut: push into the wound photo on the tablet, and it becomes the 3D NCA tissue. A wound is drawn, the tissue heals, one continuous zoom from single cells out to the whole wound with its forecast range. | "Inside that wound, cells are moving and dividing. Our neural cellular automaton learns the rule each cell follows, fine-tuned on real wound time-lapses, and grows the whole wound's future from it, live, in 3D." |
| 0:37-0:45 | **Figma (prize segment)** | Match cuts on the same screen: paper sketch, Figma wireframe, Figma high-fidelity frame, then the finished app on the tablet in the clinician's hand in the corridor. Corner badge: "Designed in Figma". | "We designed it in Figma, from sketch to wireframe to the finished product, to be read in seconds between patients." |
| 0:45-0:59 | **Tech: agent orchestration + triage** | The clinician walks the corridor reading the tablet. On screen: images go in, QC ticks, NCA forecast with its range, triage cards light up: **Stalling**, **Discolouration**, **Abnormally fast growth**. The clinician taps Approve. | "Then it triages, like a nurse on a busy ward. A team of agents checks every image, forecasts healing with a calibrated range, and flags stalling, discolouration and abnormally fast growth. The doctor decides." |
| 0:59-1:11 | **Adaption (prize segment)** | Adaption dashboard: Expand counter past 1,000 rows, AutoScientist run, leaderboard win rate vs base. Pipeline diagram with an Adaption badge on each agent (Intake, Triage, Reporter). Then the report: **For clinicians** view on the tablet at the bedside, **For researchers** view on a laptop in the lab. | "Every agent runs on a model we fine-tuned with Adaption, beating its base model, and it writes one report two ways: clinical language for the ward, full detail for the lab." |
| 1:11-1:32 | **Academia: evidence** | The clinician pins the patient's photo next to the forecast. Cut to a held-out wound: the range drawn ahead, the real outcome revealed inside it. Calibration figure, then the scorecard with the NCA row highlighted. The four datasets named. | "Medicine runs on evidence, so we hold Stitch to it. Every forecast is tested on wounds the model has never seen, across four public datasets. Ninety-two percent of real outcomes land inside our ninety-percent range, and the NCA matches or beats every simple baseline. Most tools measure healing after it happens; Stitch calls it ahead." |
| 1:32-1:51 | **Use cases: across the hospital** | The team walks past department signs, one per case (lower-third labels if the real signs can't be filmed): **Diabetes clinic**, **Surgical ward**, **Oncology**, **Burns and plastics**, **Research labs**. Each gets a 1 s inset of its closure curve (slow / stalled / slowed on purpose / overshoot / a plate of many wells). | "Walk any hospital and the need is everywhere: diabetic wounds that close too slowly, surgical wounds where infection stalls healing, cancer, where Stitch tells moving from multiplying, scarring, where healing goes too far, and the labs screening the drugs that treat them all." |
| 1:51-2:00 | **Close** | The clinician redresses the patient's arm; the patient nods. The team walks towards camera down the corridor. End card: Stitch logo, repo URL, team names, "Designed in Figma · Fine-tuned with Adaption", data credits (WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118; CC BY needs the credit). | "Because in here, faith isn't enough. Stitch. Know sooner. Know how sure." |

Balance: technology 49 s (NCA, agents, plus the two prize segments), academia 21 s, use cases 19 s, and the hospital story carries all of it.

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
- "the NCA beats every simple baseline": NCA vs best-baseline ratio at the headline cut-off (3.8 h), from `docs/results.md` after the fine-tune.
- "Ninety-two percent": NCA calibrated coverage on unseen WHAD wounds (0.92 today, per #135).
- "beating its base model head to head": Adaption leaderboard win rate per agent model; show the real figure on screen.
- Triage cards: one real demo wound per flag type.

## High-priority items

| # | Item | Owner | When |
|---|---|---|---|
| P0-1 | **Draw mode, NCA hero render**: `web/index.html` with draw-a-wound, continuous zoom, three.js relief. The engine is ready in `web/public/sim/js/` (engine, nca, worker, smooth). | P3 (+P2 for weights) | overnight |
| P0-2 | **Agent layer**: merge PR #69; `agent/` loop with `call_model()` and the code Critic; recorded runs on held-out WHAD wounds; Assay playback (forecast + band + triage cards + decision card + Approve). | P3 | overnight |
| P0-3 | **NCA fine-tune and re-score** so the NCA is the shipped forecaster; regenerate `docs/results.md`; send final numbers to P3. | P2 | by Sun 09:00 |
| P0-4 | **Triage in the demo run**: stall, discolouration and fast-growth flags on the Assay path, with one demo wound per flag plus one normal wound. | P1 / P3 | by Sun 09:00 |
| P0-5 | **Adaption across the pipeline**: widen design 9c from Intake only to every agent model (Intake, Triage, Reporter); Expand datasets, AutoScientist runs, leaderboard win rate vs base for each; wire them in through `call_model()`. Reporter produces the two-audience report (clinician and researcher summaries). Keep the leaderboard screenshots and run IDs for the README and Devpost. | P2 (Adaption) + P3 (wiring, report UI) | by Sun 09:00 |
| P0-6 | **Figma evidence**: one Figma Design file (not Figma Make) with pages for sketches (photos of paper sketches), wireframes and high-fidelity frames of the same screens; put the link in `HACKATHON.md` and on Devpost. The old HTML mockups don't count as Figma (archived at tag `archive/mockups-2026-11-15`). | P3 | by Sun 09:00 |
| P0-7 | **Validation + scorecard shots**: held-out reveal animation; calibration, reliability and scorecard figures restyled to the Figma design. | P1 data, P3 styling | Sun 09:00-10:00 |
| P0-8 | **Lock the script**; time the read at 1:55 max. | P3 + all | tonight |
| P1-9 | **Hospital shoot, self-shot**: cast = patient (teammate, dressed forearm), clinician (teammate, gloves, tablet), one person filming (tripod or a friend for the full-team walking shots). Get filming permission from the hospital first (usually its communications/press office), including which corridors and department signs we may film. No real patients, staff who haven't agreed, or patient screens or notes in frame. Plain clothes or gloves only, no hospital uniforms or ID badges. Props: tablet, gloves, bandage, tape. Film 2-3 takes of each shot; phone at 1080p/4K, 24-30 fps. | P3 + team | Sun, before 10:30 |
| P1-9b | **App on the tablet**: screen-record each app shot on a laptop first, then play those recordings full-screen on the tablet during the hospital shoot. No server reachable from the tablet needed. | P3 | before the shoot |
| P1-10 | **Voice-over**: one teammate reads it; record in a quiet room, 2-3 full takes, phone close to the mouth; captions burned in (judges may watch muted). | teammate | Sun 10:00 |
| P2-11 | **Backup video tonight**: screen capture of whatever runs plus a scratch voice-over. | P3 | before sleeping |
| P2-12 | Export 1080p, max 2:00, H.264; upload to Devpost with the Figma link and Adaption leaderboard link; check it plays logged out. | P3 | Sun 11:15-11:30 |

## Shot list (capture Sun 09:00-10:30)

1. Hospital beats (one session, in script order): team walking a corridor from behind, 4 s; dressing peeled back, 3 s; clinician photographs the wound with the tablet, 3 s; push-in on the tablet photo (for the match cut to the NCA), 2 s; finished app on the tablet in hand, 2 s; clinician reading the tablet while walking, then tapping Approve, 4 s; report on the tablet at the bedside, 2 s; photo pinned next to the forecast, 2 s; five department signs or corridor walk-bys, 2 s each; redressing the arm and the patient's nod, 3 s; team walking towards camera, 3 s.
2. WHAD time-lapse of one wound, 4 s.
3. Draw mode: draw stroke, 3 s; heal, 5 s; continuous zoom cells to wound, 5 s; slow orbit of the 3D relief, 3 s.
4. Figma: sketch, wireframe, hi-fi, live build of the same screen (1.5 s each, matched framing); Figma canvas zoom-out over all frames, 3 s.
5. Assay mode: drop frames, QC, NCA forecast + band, three triage cards, decision card, Approve (one take, sped up to ~13 s).
6. Adaption: Expand row counter, 2 s; AutoScientist run, 2 s; leaderboard win rate, 3 s; pipeline diagram with Adaption badges, 2 s; two-audience report, 3 s.
7. Held-out reveal: band first, then the true curve, 6 s.
8. Calibration figure, 5 s; scorecard with the NCA row highlighted, 6 s; four datasets, 3 s.
9. Five closure-curve insets for the use cases, 1 s each.
10. End card, 4 s.

## Timeline

- Sat night / overnight (off-site work allowed): P0-1 to P0-6, P0-8, P2-11; ask the hospital for filming permission.
- Sun 09:00-10:30: P0-7, screen capture, hospital shoot.
- Sun 10:30-11:15: voice-over, edit, captions.
- Sun 11:15-11:30: export, upload, submit. 12:00 hard deadline (video and last commit).

## Decided
- Hook: the original line (above). Audience: doctors and assay scientists; the hospital opening sets up both.
- The script assumes the finished product (NCA forecaster after the fine-tune; full anomaly triage; Adaption across the agent pipeline).
- Figma and Adaption each get a short named segment placed next to what they built: Figma after the visuals, Adaption after the agents, ending on the report.
- Voice-over: a teammate. Hospital footage: self-shot, the team walking through the hospital.
- The hospital runs through every segment: two teammates play the patient and the clinician, and every segment opens on a hospital beat.
