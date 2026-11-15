# Video demo plan (2 minutes, Devpost)

Status: draft v2, Sun 15 Nov. Owner: P3 (video). The script describes the finished product: the NCA is the forecaster after the data fine-tune (P2), and triage covers stalling, discolouration and abnormally fast growth. Audience: doctors and assay scientists.

The video is the only demo the judges see (no slides, no live demo), so it carries every mark: rigour 30, execution 25, path to the lab 20, novelty 15, video 10.

## Structure (thirds: technology / academia / use cases)

~290 words of voice-over (about 150 words per minute). Times are targets.

| Time | Segment | Visual | Voice-over (draft) |
|---|---|---|---|
| 0:00-0:12 | **Hook: hospital** | Hospital corridor, a clinician unwrapping a wound dressing (hands only, no patients or identifiable staff, no NHS branding). Monitor beeps, then silence. | "When you're in a high-pressure, life-or-death situation like here, you don't have the luxury of faith. You need to know what happens next, and how sure you can be." |
| 0:12-0:20 | **Bridge: bedside to bench** | Split cut: the dressing, then a real WHAD scratch-assay time-lapse closing. Title: **Stitch**. | "Stitch forecasts how a wound will heal from its first few hours, for the doctor at the bedside and the scientist at the bench." |
| 0:20-0:40 | **Tech 1: the NCA (hero shot)** | Draw mode in 3D (three.js relief): a freehand wound is drawn, the tissue heals, one continuous zoom from single cells out to the whole wound with its forecast band. | "At its heart is a neural cellular automaton. Every cell runs the same small learned rule, fine-tuned on real wound time-lapses, and together they predict how the whole wound closes. It runs live: draw any wound and watch it heal, from a single cell to the whole tissue." |
| 0:40-1:00 | **Tech 2: agent orchestration + triage** | Assay mode: real frames dropped in, QC ticks, NCA forecast with its band, then triage cards lighting up: **Stalling**, **Discolouration**, **Abnormally fast growth**. Decision card, human clicks Approve. Quick cut to Ops: the agent timeline and run log, "every number traced". | "Around it, a team of agents. Real frames go in, code checks them, the NCA forecasts closure with a calibrated band, and the triage agent flags anomalies: stalling, discolouration, abnormally fast growth. It proposes the next step, a human signs off, and every number traces back to the tool that made it." |
| 1:00-1:28 | **Academia: built to stand up to scrutiny** | Held-out wound: band drawn ahead, real outcome revealed inside it. Calibration/reliability figure (restyled `eval/figures/calibration.png`, `reliability.png`). Scorecard: NCA vs simple baselines, NCA row highlighted. Four dataset logos/names. One line of prior art. | "We built it to stand up to scrutiny. The cell rules come from a published model, and every forecast is tested on wounds the model has never seen, across four public datasets. Ninety-three percent of real outcomes land inside our ninety-percent band, and the NCA beats every simple baseline. Prior work measures healing after it happens. Stitch calls it ahead, and tells you how sure it is." |
| 1:28-1:53 | **Use cases** | Fast montage, one card per case, each with its closure curve (slow / stalled / slowed on purpose / overshoot / a plate of many wells). | "And it's built for the cases that matter. Diabetic wounds that close too slowly. Infected wounds where healing stalls. Cancer, where the goal flips: a good drug stops cells moving, and Stitch separates moving from multiplying. Fibrosis, where healing goes too far. And drug screens, where a forecast from the first few hours saves time and lab space." |
| 1:53-2:00 | **Close** | Back to the hospital corridor, then the end card: Stitch logo, repo URL, team names, data credits (WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118; CC BY needs the credit). | "Stitch. Know sooner. Know how sure." |

## Fill from the final scorecard before recording

The judges have the repo, so these lines must match `docs/results.md` after the fine-tune:
- "the NCA beats every simple baseline": the NCA vs best-baseline ratio at the headline cut-off (3.8 h).
- "Ninety-three percent": NCA calibrated coverage on unseen WHAD wounds (0.93 today).
- Triage cards: one real demo wound per flag type (stalling, discolouration, fast growth).
- Ops tiles: traced-number share and any agent-eval numbers shown on screen.

## High-priority items

| # | Item | Owner | When |
|---|---|---|---|
| P0-1 | **Draw mode, NCA hero render**: `web/index.html` with draw-a-wound, continuous zoom, three.js relief. The engine is ready in `web/public/sim/js/` (engine, nca, worker, smooth). | P3 (+P2 for weights) | overnight |
| P0-2 | **Agent layer**: merge PR #69; `agent/` loop with `call_model()` and the code Critic; recorded runs on held-out WHAD wounds; Assay playback (forecast + band + triage cards + decision card + Approve); Ops run log. | P3 | overnight |
| P0-3 | **NCA fine-tune and re-score** so the NCA is the shipped forecaster; regenerate `docs/results.md`; send the final numbers to P3 for the script. | P2 | by Sun 09:00 |
| P0-4 | **Triage in the demo run**: stall, discolouration and fast-growth flags on the Assay path, with one demo wound per flag plus one normal wound. | P1 / P3 | by Sun 09:00 |
| P0-5 | **Validation + scorecard shots**: held-out reveal animation; calibration, reliability and scorecard figures restyled to the Figma design (mockups archived at tag `archive/mockups-2026-11-15`). | P1 data, P3 styling | Sun 09:00-10:00 |
| P0-6 | **Lock the script**; time the read at 1:55 max. | P3 + all | tonight |
| P1-7 | **Hospital B-roll**: licensed stock (Pexels/Pixabay) or self-shot (corridor, gloved hands, a dressing on a teammate's arm). No patients, no identifiable staff, no NHS branding. | P3 | Sun 09:00 |
| P1-8 | **Voice-over**: one teammate's read, ElevenLabs as backup; captions burned in (judges may watch muted). | P3 | Sun 10:00 |
| P1-9 | **Figma moment** (2 s: Figma frame to built screen) for Best Designed; **Adaption** 2 s if that fine-tune is entered. | P3 | edit |
| P2-10 | **Backup video tonight**: screen capture of whatever runs plus a scratch voice-over. | P3 | before sleeping |
| P2-11 | Export 1080p, max 2:00, H.264; upload to Devpost; check it plays logged out. | P3 | Sun 11:15-11:30 |

## Shot list (capture Sun 09:00-10:30)

1. Hospital corridor wide, 3 s; gloved hands and a dressing close-up, 4 s; corridor bookend, 2 s.
2. WHAD time-lapse of one wound, 5 s.
3. Draw mode: draw stroke, 3 s; heal, 6 s; continuous zoom cells to wound, 6 s; slow orbit of the 3D relief, 4 s.
4. Assay mode: drop frames, QC, NCA forecast + band, three triage cards, decision card, Approve (one take, ~15 s, sped up to fit).
5. Ops: agent timeline and run log, 4 s.
6. Held-out reveal: band first, then the true curve, 6 s.
7. Calibration figure, 5 s; scorecard with the NCA row highlighted, 6 s; four datasets, 3 s.
8. Five use-case cards, ~4-5 s each.
9. End card, 4 s.

## Timeline

- Sat night / overnight (off-site work allowed): P0-1, P0-2, P0-3, P0-6, P2-10.
- Sun 09:00-10:30: P0-4, P0-5, capture, B-roll.
- Sun 10:30-11:15: voice-over, edit, captions.
- Sun 11:15-11:30: export, upload, submit. 12:00 hard deadline (video and last commit).

## Decided
- Hook: the original line (above). Audience: doctors and assay scientists; the hospital opening sets up both.
- The script assumes the finished product (NCA forecaster after the fine-tune; full anomaly triage).

## Open
1. Voice: a teammate or ElevenLabs.
2. Hospital footage: stock or self-shot.
