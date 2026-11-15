# Video demo plan (2 minutes, Devpost)

Status: draft, Sat 14 Nov. Owner: P3 (video). Every number in the script comes from `docs/results.md` / `docs/p2-results.md`; if those change, change this file.

Why it matters: the video is 10% of the marks directly, but it is the only demo the judges see (no slides, no live demo), so it also carries rigour (30), execution (25), path to the lab (20) and novelty (15). Judges then get 6 minutes of questions. Anything we overclaim in the video gets questioned there (see `docs/qa-prep.md`, "Don't say").

## Structure (thirds: technology / academia / use cases)

~280 words of voice-over (about 150 words per minute). Times are targets.

| Time | Segment | Visual | Voice-over (draft) | Marks served |
|---|---|---|---|---|
| 0:00-0:12 | **Hook: hospital** | Hospital corridor, gloved hands changing a dressing (hands only, no patients, no faces, no NHS logos). Sound: monitor beeps, then silence. | "In a hospital, you don't have the luxury of faith. When a wound won't heal, every decision needs a prediction, and an honest answer to one question: how sure are you?" | video |
| 0:12-0:20 | **Bridge to the lab** | Cut to real WHAD phase-contrast frames (time-lapse of a scratch closing). Caption: "Scratch assay, MCF10A cells, WHAD (CC BY 4.0)". | "Treatments for those wounds are tested first in a dish: a scratch through living cells, filmed for a day. Stitch forecasts how it ends from the first four hours." | path to lab |
| 0:20-0:37 | **Tech 1: the NCA (hero shot)** | Draw mode: a finger/cursor draws a freehand wound; the tissue heals; one continuous zoom from single simulated cells out to the whole wound with its outline. Rendered in three.js as a lit relief. Chip on screen: "Simulated cells, NCA emulator". | "Draw any wound and watch it heal. Every cell follows local rules from a published cell model. Our neural cellular automaton learned to approximate those rules, so the whole tissue runs live in your browser, from one cell to the whole wound." | novelty, execution |
| 0:37-0:55 | **Tech 2: agent orchestration** | Assay mode: three real frames dropped in, then QC ticks, then a forecast curve with its 90% band, then a stall flag, then a decision card "Stop: predicted not to close", then a human clicks Approve. Quick cut to Ops: run log scrolling, "Numbers traced" tile, adversarial caught/missed table (real values from the agent eval, P1-8; placeholders until then). | "Three real frames go in. Code checks them, forecasts closure with a 90% band and flags a likely stall. The agent decides what to propose: stop this plate early. A human approves. And the agent never makes up a number: a critic deletes any figure no tool produced." | execution |
| 0:55-1:28 | **Academia: does it hold?** | Held-out wound: forecast band drawn ahead, real outcome revealed inside it. Then the reliability/calibration figure (`eval/figures/calibration.png`, restyled). Then the gate table with one row highlighted. Then the failure: WHiM-BC stem-cell wells falling below the band, captioned "fails: recalibrate". One line of prior art on screen. | "We tested on twenty-eight wounds the model never saw. Ninety-three percent of what happened landed inside our ninety-percent band, and it held on three more public datasets. We set a bar for our own NCA before scoring. At four hours a two-parameter model beats it, so that is what ships; by nine and a half hours the NCA ties or beats every baseline. Where it fails, on faster cancer stem cells, we show it." | rigour, novelty |
| 1:28-1:53 | **Use cases: where next** | Fast montage, one card per use case, each with a stylised closure curve (slow / stalled / slowed on purpose / overshoot / many wells). Corner label: "Next steps, not yet validated". | "Where next: diabetic wounds that close slowly. Infected wounds where healing stalls. Cancer, where you want closure to slow down. Fibrosis, where healing goes too far. And drug screens, where an early call frees plates and microscope time. The simulator keeps movement and division separate, so the next experiment is telling which one a treatment changes." | path to lab |
| 1:53-2:00 | **Close** | Back to the hospital corridor, then the end card: Stitch logo, repo URL, team names, "Research prototype, not for clinical use. Data: WHAD, WHiM-BC, Zenodo 7660424, GigaDB 100118." | "Stitch. Know sooner. Know how sure." | video |

Alternative hook lines (pick one):
- "In a hospital, guessing isn't an option. You need a prediction, and you need to know how far to trust it."
- "Here, nobody runs on faith. They run on evidence, and on knowing how much the evidence can be trusted."

## Claim guardrails (read before editing the script)

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

## High-priority items (blocking the video)

| # | Item | Why it blocks | Owner | When |
|---|---|---|---|---|
| P0-1 | **Draw mode with the NCA hero render**: `web/index.html` with draw-a-wound, continuous zoom, three.js relief, "simulated / emulator" chip. Engine already exists in `web/public/sim/js/` (engine, nca, worker, smooth). | Our main visual; nothing to film yet (no `web/index.html` on main). | P3 (+P2 for NCA weights) | overnight |
| P0-2 | **Agent layer minimum**: merge PR #69; `agent/` loop with `call_model()`, code Critic; **one recorded run** on a held-out WHAD wound that ends in a stall flag or early stop, both approval branches recorded; Assay playback (forecast + band + decision card + Approve); Ops run-log table + traced-% tile. | The whole "orchestration" third. Today it exists only as a design doc. | P3 | overnight |
| P0-3 | **Pick the demo wound**: a held-out WHAD wound where the scheduler (`eval/scheduler.py`) makes a stop call and the outcome lands inside the band. Same wound for the Assay run and the validation reveal. | Script and shots depend on it. | P1 | tonight |
| P0-4 | **Validation + scorecard shots**: restyle `eval/figures/calibration.png`, `reliability.png`, `worst_wounds.png` and the gate table to the app's design (m8/m9 mockups); one held-out reveal animation. | Rigour third. | P1 data, P3 styling | Sun 09:00 |
| P0-5 | **Lock the script** against `docs/results.md` (numbers) and the guardrails above; time the voice-over read at 1:55 max. | Everything else is cut to it. | P3 + all review | tonight |
| P1-6 | **Hospital B-roll**: licensed stock (Pexels/Pixabay licence) or self-shot (corridor + gloved hands + a dressing on a teammate's arm). No patients, no identifiable staff, no NHS branding. If generated with fal, keep it non-identifying and never mix it with data shots. | Hook and close. | P3 | Sun 09:00 |
| P1-7 | **Voice-over**: one human read (preferred for judges) or ElevenLabs (partner tool) as a backup; captions burned in (judges may watch muted). | | P3 | Sun 10:00 |
| P1-8 | **Agent eval numbers** (plate-hours saved, wrong stops, missed stalls, adversarial caught/missed). Needed only if the script quotes them. | Ops shot content. | P3 / P1 | Sun 10:00 |
| P1-9 | **Figma moment** (2 s: Figma frame to built screen) for Best Designed. **Adaption**: 2 s only if the 9c fine-tune passed. | Cross-cutting prizes need to see it. | P3 | edit |
| P2-10 | **Backup video tonight**: screen capture of whatever runs plus a scratch voice-over, so we can submit something if Sunday goes wrong. | Insurance. | P3 | before sleeping |
| P2-11 | Edit + export (1080p, ≤ 2:00, H.264); upload to Devpost/YouTube; check it plays logged out. | | P3 | Sun 11:15-11:30 |

## Shot list (capture Sun 09:00-10:30)

1. Hospital corridor wide, 3 s; gloved hands + dressing close-up, 4 s; corridor (bookend), 2 s.
2. WHAD time-lapse of one wound, 8 s (from raw frames, hourly, speeded up; label "sped up").
3. Draw mode: draw stroke, 3 s; heal at speed, 6 s; continuous zoom cells to wound, 6 s; slow orbit of the relief, 3 s.
4. Assay mode: drop 3 frames, QC, forecast + band, stall flag, decision card, Approve click (one take, ~15 s, sped up to fit; label "sped up").
5. Ops: run log scroll + traced-% tile + adversarial table, 4 s.
6. Held-out reveal: band first, then the true curve drawn in, 6 s.
7. Calibration figure, 5 s; gate table row highlight, 5 s; WHiM-BC failure, 5 s.
8. Five use-case cards, ~4 s each.
9. End card, 4 s.

Labels on screen wherever they apply: "simulated cells", "emulator", "sped up", "recorded run", "not for clinical use".

## Timeline

- Sat night: P0-3, P0-5, P2-10. Overnight (off-site work allowed): P0-1, P0-2.
- Sun 09:00-10:30: capture (shot list), P0-4, P1-6.
- Sun 10:30-11:15: voice-over, edit, captions.
- Sun 11:15-11:30: export, upload, submit. 12:00 hard deadline (video and last commit).

## Open decisions

1. Hook line: the original, or one of the alternatives above.
2. Voice: a teammate or ElevenLabs.
3. Hospital footage: stock or self-shot.
4. Framing: for AI for Science judges, lead with "agentic forecasting for wound-healing assays" rather than "orchestration framework"; the agent is how the science gets used, not the science.
