# Video demo plan (2 minutes, Devpost)

Status: draft v3, Sun 15 Nov. Owner: P3 (video). The script describes the finished product: the NCA is the forecaster after the data fine-tune (P2), triage covers stalling, discolouration and abnormally fast growth, and the agent pipeline runs on Adaption fine-tunes ending in a report for doctors and researchers. Audience: doctors and assay scientists.

The video is the only demo the judges see (no slides, no live demo), so it carries every mark: rigour 30, execution 25, path to the lab 20, novelty 15, video 10. It is also how we qualify for the two open prizes (rules: "show in your presentation how you qualify"): **Best Designed AI Product (Figma)** and **Best use of Adaption**. Each gets its own short, named segment, placed next to the part of the product it built.

## Structure

~290 words of voice-over at about 150 words per minute. Times are targets; time the real read and trim academia or use cases first if it runs long.

| Time | Segment | Visual | Voice-over (draft) |
|---|---|---|---|
| 0:00-0:12 | **Hook: hospital** | Self-shot: our team walking through a hospital corridor (tracking shot from behind or the side), then a close-up of gloved hands at a wound dressing. No patients, no patient screens or notes in frame. Ambient hospital sound, then silence. | "When you're in a high-pressure, life-or-death situation like here, you don't have the luxury of faith. You need to know what happens next, and how sure you can be." |
| 0:12-0:19 | **Bridge: bedside to bench** | Split cut: the dressing, then a real WHAD scratch-assay time-lapse closing. Title: **Stitch**. | "Stitch forecasts how a wound will heal from its first few hours, for doctors and scientists alike." |
| 0:19-0:34 | **Tech: the NCA (hero shot)** | Draw mode in 3D (three.js relief): a freehand wound is drawn, the tissue heals, one continuous zoom from single cells out to the whole wound with its forecast band. | "At its heart is a neural cellular automaton: every cell runs one small learned rule, fine-tuned on real wound time-lapses, and together they predict how the whole wound closes. Draw any wound and watch it heal, live." |
| 0:34-0:43 | **Figma (prize segment)** | Four match cuts on the same screen position: paper sketch, Figma wireframe, Figma high-fidelity frame, the live build. Then the Figma canvas zooms out to show every frame at once. Corner badge: "Designed in Figma". | "We designed every screen in Figma, from first sketch to wireframe to the finished product, so the science reads at a glance." |
| 0:43-0:56 | **Tech: agent orchestration + triage** | Assay mode: real frames dropped in, QC ticks, NCA forecast with its band, then triage cards lighting up: **Stalling**, **Discolouration**, **Abnormally fast growth**. Decision card; a human clicks Approve. | "Around it, a team of agents. Frames go in, code checks them, the NCA forecasts with a calibrated band, and triage flags stalling, discolouration and abnormally fast growth. A human signs off." |
| 0:56-1:08 | **Adaption (prize segment)** | Adaption dashboard: dataset Expand counter climbing to 1,000+ rows, AutoScientist training run, leaderboard win rate vs base model. Then the pipeline diagram with an Adaption badge on each agent node (Intake, Triage, Reporter). End on the report: two panels, **For clinicians** and **For researchers**, every number underlined as traced. | "Each agent runs on a model we fine-tuned with Adaption, beating its base model head to head. The pipeline ends in one report, written for both the doctor and the researcher." |
| 1:08-1:32 | **Academia: built to stand up to scrutiny** | Held-out wound: band drawn ahead, real outcome revealed inside it. Calibration/reliability figure (restyled `eval/figures/calibration.png`, `reliability.png`). Scorecard: NCA vs simple baselines, NCA row highlighted. The four datasets named. | "And it stands up to scrutiny. The cell rules come from a published model, and every forecast is tested on wounds the model has never seen, across four public datasets. Ninety-three percent of real outcomes land inside our ninety-percent band, and the NCA beats every simple baseline. Prior work measures healing after it happens; Stitch calls it ahead." |
| 1:32-1:52 | **Use cases** | Fast montage, one card per case, each with its closure curve (slow / stalled / slowed on purpose / overshoot / a plate of many wells). | "It's built for the cases that matter: diabetic wounds that close too slowly, infected wounds that stall, cancer, where a good drug stops cells moving and Stitch separates moving from multiplying, fibrosis, where healing goes too far, and drug screens, where an early forecast saves time and lab space." |
| 1:52-2:00 | **Close** | Back to the team in the hospital corridor (walking towards camera), then the end card: Stitch logo, repo URL, team names, "Designed in Figma · Fine-tuned with Adaption", data credits (WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118; CC BY needs the credit). | "Stitch. Know sooner. Know how sure." |

Balance: technology 49 s (NCA, agents, plus the two prize segments that show how it was built), academia 24 s, use cases 20 s plus the hospital framing.

## Fill from the final results before recording

The judges have the repo and the Adaption leaderboard, so these must match:
- "the NCA beats every simple baseline": NCA vs best-baseline ratio at the headline cut-off (3.8 h), from `docs/results.md` after the fine-tune.
- "Ninety-three percent": NCA calibrated coverage on unseen WHAD wounds (0.93 today).
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
| P1-9 | **Hospital footage, self-shot**: the team walking through the hospital, plus the gloved-hands dressing close-up (a teammate's arm). Get filming permission from the hospital first (usually its communications/press office); no patients, staff who haven't agreed, patient screens or notes in frame. Film 2-3 takes of each shot; phone at 1080p/4K, 24-30 fps, steady walk. | P3 + team | Sun, before 10:30 |
| P1-10 | **Voice-over**: one teammate reads it; record in a quiet room, 2-3 full takes, phone close to the mouth; captions burned in (judges may watch muted). | teammate | Sun 10:00 |
| P2-11 | **Backup video tonight**: screen capture of whatever runs plus a scratch voice-over. | P3 | before sleeping |
| P2-12 | Export 1080p, max 2:00, H.264; upload to Devpost with the Figma link and Adaption leaderboard link; check it plays logged out. | P3 | Sun 11:15-11:30 |

## Shot list (capture Sun 09:00-10:30)

1. Self-shot hospital: team walking down a corridor, tracking from behind, 4 s; gloved hands and a dressing close-up, 4 s; team walking towards camera (bookend for the close), 3 s.
2. WHAD time-lapse of one wound, 4 s.
3. Draw mode: draw stroke, 3 s; heal, 5 s; continuous zoom cells to wound, 5 s; slow orbit of the 3D relief, 3 s.
4. Figma: sketch, wireframe, hi-fi, live build of the same screen (1.5 s each, matched framing); Figma canvas zoom-out over all frames, 3 s.
5. Assay mode: drop frames, QC, NCA forecast + band, three triage cards, decision card, Approve (one take, sped up to ~13 s).
6. Adaption: Expand row counter, 2 s; AutoScientist run, 2 s; leaderboard win rate, 3 s; pipeline diagram with Adaption badges, 2 s; two-audience report, 3 s.
7. Held-out reveal: band first, then the true curve, 6 s.
8. Calibration figure, 5 s; scorecard with the NCA row highlighted, 6 s; four datasets, 3 s.
9. Five use-case cards, ~4 s each.
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
