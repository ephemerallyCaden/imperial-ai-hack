# Stitch UI mockups: shared brief (14 Nov 2026)

Goal: five rendered mockups of the Stitch main screen as starting points. All five share content and the same simulated cell field; they differ only in design. User-chosen direction: **journal-figure look** (academic, rigorous, clean, professional), **realistic tissue palette**, **full-bleed canvas with collapsible panels**, **skin-tone range shown in mockups only**. Product facts: `docs/design.md`. Research behind this brief: journal visual language, interaction patterns, tissue colour rules (scout reports, 14 Nov).

## What every mockup must render (1440 x 900 viewport, one screen)
1. **Full-bleed simulation canvas** using `design/shared/cellfield.js` (call `CellField.render(canvas, {tone, seed, progress, r, ...})`; read the file; do not change its rules; choose `r`, `progress`, wound position). Everything on it is SIMULATED.
2. **Honesty chip, always visible:** "SIMULATED CELLS - not tracked cells" (words, not an icon). Also a live **scale bar** ("100 um") and zoom readout ("20x").
3. **Magnification ladder** (Cells / Colony / Wound / Field), current stop highlighted; a **minimap** (about 160 px) with the wound outline and a viewport rectangle.
4. **Draw tool UI:** tool button "Draw wound" (active), "Heal" (primary action), "Clear wound"; a faint dashed ghost stroke with the hint "Draw a wound here" is acceptable on one variant. Controls are ONLY wound shape and preset: a two-option segmented control "Preset: MCF10A control (CC) | CYR61 shRNA (C61)". NO sliders.
5. **Collapsible side panel** (320 px open, shown open; show the collapse affordance) containing: (a) **State legend with rules** - the five states from `CellField.RULES` with swatches in the active tone, rule text and the non-colour cue; (b) **Forecast summary** (time to 90% closure "17.5 h (90% interval 15.0 to 21.0)", P(close by 24 h) "0.93", stall flag "Stall unlikely (P = 0.08)", ensemble flag "Ensemble spread: moderate"); (c) **mini scorecard** (booktabs style: Model | CRPS | 90% coverage | n; rows NCA ensemble, Gompertz, Fisher-KPP, Persistence), labelled "Illustrative values, not results".
6. **Bottom dock (about 112 px):** transport (play/pause, step back/forward, speed 0.5x 1x 2x 4x), **one scrubber** at t = 14 h of 20 h with a solid line labelled "t0 = forecast origin" at 6 h; observed/simulated history solid, forecast hatched; above or beside it the **forecast ribbon chart**: wound area (% of initial) vs time (h), observed line (ink, solid), predicted median (dashed blue), 50% and 90% bands, optional faint ensemble members; axis labels with units; t0 dashed rule.
7. **Header:** wordmark "Stitch" (provisional), subtitle "Wound-closure forecaster - research prototype". Source line near the bottom/canvas: "Source: simulated cell agents, MCF10A-CC preset; not tracked cells. Values illustrative." A small "?" help affordance with the shortcut hint (Space play, arrows step, +/- zoom).
8. Caption conventions: figure-style captions "Figure 1 | ..." where it fits the variant; units and "n =" everywhere.

## Tokens (from research; adjust within the variant, keep the spirit)
- Neutrals: ink #1F2328 / #1A1A1A, secondary #5B6370, tertiary #8A919B, hairline #D9DCE0, panel #F6F7F8, page #FFFFFF or warm paper variants. Canvas frame 1px #8A919B.
- Data lines (colour-blind safe): observed ink solid; predicted #2F5D8A dashed; 90% band #2F5D8A at 15% opacity (50% band 28%); baselines grey. Flags: violet #5B4B8A with words, never alarm red (wound colours are red-brown). Focus ring 2px #2F5D8A.
- Type (macOS system, no web fonts): serif `Charter, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`; sans `-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`; mono `ui-monospace, "SF Mono", Menlo, monospace`. Tabular numerals on all numbers. Small caps only for kickers. Scale: title 28/1.2 serif 600, section 20, body 15/1.55, UI label 13 sans 500, caption 12.5/1.45, axis tick 11, mono readout 12.
- Layout: spacing 4/8/12/16/24/32/48; hairline rules 0.5-1px; radius 0-2px; NO shadows (1px border for floating items); no glassmorphism, gradients, neon, emoji, pills, KPI tiles, ALL-CAPS headings; chrome greyscale so the simulation is the only saturated element.
- Accessibility: contrast 3:1 for controls and graphical objects, 4.5:1 for text, 24 px minimum targets, no colour-only cues, visible focus, reduced-motion note.

## Tissue colour rules (implemented in cellfield.js; reproduce in the legend)
Precedence: dividing > leading edge > new tissue > intact; wound = empty site. Tones: light, medium, deep (muted derivations anchored loosely on Monk tones; illustrative; say so in the README).
| State | Rule | Cue |
|---|---|---|
| Dividing | divided this step | dark centre dot |
| Leading edge | >= 1 empty neighbour and moved last step | outline on wound-facing sides |
| New tissue | re-occupied within the last 10 steps, now behind the front | fine stipple |
| Intact | no empty neighbour (contact-inhibited, resting) | flat fill |
| Wound | empty site | flat, no outline |
Overlays: ensemble spread = dotted slate contours (#4A5A6A); stall = violet diagonal hatch (#5B4B8A, 35%) plus a text badge.

## Deliverables per mockup (folder `design/mockups/mN-name/`)
- `index.html` (self-contained; loads `../../shared/cellfield.js`; reads `?tone=light|medium|deep`; deterministic; no network; system fonts only).
- `preview.png` (1440x900 primary tone), plus `tone-light.png`, `tone-medium.png`, `tone-deep.png` (same layout, 1440x900).
- `README.md` (max 12 lines): concept in one sentence, what differs from the others, the primary tone, type stack, three strengths, three risks.
- Render with Playwright Firefox (Python, `-I`, scripts outside the mockup folder, e.g. /tmp/mockup-scripts/). LOOK at your screenshots (Read the PNG) and iterate at least twice: fix overlaps, clipped text, weak hierarchy, low contrast, anything that reads as a generic dashboard.
- Do not edit `design/shared/cellfield.js` or other mockups' folders. Report back: file paths and a 5-line design rationale.

## The five variants (all inside the chosen direction)
- **M1 Plate** (primary tone: light). Classic journal page: warm-white #FCFCFA, serif headings, hairline rules, figure captions with "Figure 1 |", right docked panel. The most conservative, Nature-like.
- **M2 Atlas** (primary tone: medium). Warm paper #FBF8F1, specimen-plate feel: numbered callouts (1 to 5) with thin leader lines on the canvas pointing to a dividing cell, the leading edge, new tissue, the wound and intact tissue, matched to a numbered legend in a margin column (Tufte-style sidenotes), small-caps kickers.
- **M3 Workbench** (primary tone: deep). Cooler white/grey #F6F7F8 panels, sans-dominant (serif only for the title), floating tool strip on the canvas, dense booktabs table, mono readouts; still no shadows or rounded cards.
- **M4 Minimal** (primary tone: light-to-medium). Most restrained: canvas dominates; panel collapsed to a 48 px rail with the legend shown as a slim overlay key at one corner; magnification ladder on the left; hairlines only; the forecast ribbon in the dock is the sole data graphic. Shows how little chrome is needed.
- **M5 Figure panels** (primary tone: medium). Canvas plus an open drawer styled as a journal figure with lettered sub-panels a (forecast ribbon), b (reliability diagram with the 90% diagonal and counts), c (scorecard), d (flag timeline), each with a caption; the canvas shows a three-step zoom strip (x1, x10, x40 cell-level crops of the same field) in a corner to explain continuous zoom.
