# Stitch style guide (v1, 15 Nov 2026)

Figma: "Stitch-UI", page "Style guide" (variables "Stitch tokens" with CSS code syntax, text styles "Stitch/…", components Stitch/Button, Stitch/Chip, Stitch/Decision card). Use it for the web viewer in `web/`. Live specimen: `design/style-guide/index.html`. Tokens and base components: `tokens.css`. Layout and screens: Figma "Stitch-UI", page "Wireframes" (Assay v2, Ops, Draw). Decisions behind it: `docs/decisions.md` ("Glass-dish 3D look" and "UI wireframe review").

## Principles
1. **Decision first.** Every screen answers "stop, extend or image again?" before showing detail.
2. **Honest by default.** Simulated, uncalibrated, untested and recorded things say so on screen (list below).
3. **One accent.** Amber (`--accent`) means forecast, selection, focus and "needs a human". Everything else is ink on near-black.
4. **Never colour alone.** Each state also has a word, icon, hatch, dot or height.
5. **Calm default.** Secondary panels live in View ▸ Panels; the right panel has tabs (Forecast · Images · Why) under a pinned decision card.

## Colour
| Token | Value | Use |
|---|---|---|
| `--bg` | #050607 | page, 3D scene |
| `--panel` / `--panel-solid` | rgba(5,6,7,.62) / #0B0D10 | floating HUD (with blur) / menus, tables |
| `--ink` | #E8ECEF | text, observed data (17:1) |
| `--dim` | #8A949C | secondary text, axes (6.6:1) |
| `--faint` | #5C656D | decoration only (3.4:1) |
| `--accent` | #E0A458 | median, band, selection, focus, decision card (9.3:1) |

**Cell states** (do not change without re-running the colour-blindness and greyscale check): wound #0B1116 · intact #1F4F5C · leading edge #EE7F2D · new tissue #F9D6FB · dividing #FFFFFF with a dark centre dot. Lightness steps 5 / 31 / 65 / 89 / 100. Intact is 2.3:1 on the background, so never use it for text or thin lines, and give 2D swatches a hairline. Outside a box selection, cells become matte greyscale with one step per state (`--ghost-*`).

## Type
- Wordmark: condensed caps, 22 px, 0.2em tracking, plus an italic serif subtitle (M6 style).
- Kickers, buttons, tabs: condensed caps 10–11 px, 0.1–0.12em.
- Body and data: mono 12 px with tabular numbers. Captions: serif italic 10 px.
- Fallbacks: Avenir Next Condensed, then IBM Plex Sans Condensed. Charter, then Georgia. ui-monospace, then IBM Plex Mono.

## Numbers
One decimal for hours (`9.1 h`), two for probabilities (`P = 0.23`), en dash ranges (`3.6–9.1 h`), CIs in brackets (`0.92 [0.88–0.96]`). Censored values read `not reached by 19 h`, and open ends read `7.3 h – open`. Never show more precision than the tool output, because the Critic matches the decimals shown.

## Components (classes in `tokens.css`)
- **Buttons** `.st-btn`: `--primary` for the one main action per area, `--selected` / `aria-pressed` for toggles, `--icon` for icon-only buttons (aria-label plus a tooltip with the shortcut). Only transport and help are icon-only; anything with consequences gets an icon and a word. Clear appears only after a selection or a drawn wound.
- **Chips** `.st-chip` for status. `--honesty` (dashed) for required labels. `--flag` (amber) for flagged, stall or refused.
- **Panels** `.st-panel` (HUD) and `.st-panel--solid`. Key-value rows `.st-row` (label dim caps, value amber).
- **Tabs** `.st-tabs`, **menu bar** `.st-menubar`, **dropdown** `.st-dropdown` (with `kbd` shortcuts).
- **Decision card** `.st-card`:
  - `--forced` when code set the decision (refused, stall), with no LLM alternative
  - `--approved` / `--rejected` after the human acts
- **Table** `.st-table`: the shipped model's row gets `.is-shipped`.
- **Timeline** `.st-ribbon`: observed solid, then a t0 marker, then the forecast hatched. On the flag strip, an amber hatch marks the stall window.
- **Icons**: Lucide-style line icons, 14 px, stroke 2, `currentColor`.

## Charts
Observed: ink, solid 1.7 px, with a dot per image. Median: amber, dashed 4 3. **90% band: amber at 18%, only for the calibrated `data/upload.py` band.** Ensemble members: faint ink, 0.7 px. t0: dashed line labelled "forecast from here". Spatial simulator/NCA outlines are labelled "uncalibrated" and never use the band style. Charts get `role="img"` and an aria-label that states the key number.

## Required honesty labels
Simulated cells, not tracked cells · Recorded run · Sped up (speed > 1×) · Simulation on recorded data (Ops) · Simulation, preset parameters (WHAD part II fits, follow rule) (Draw) · Uncalibrated (simulator/NCA spread) · Untested ("stop, likely to close") · Research use only, not for diagnosis or treatment · Colours illustrative, not clinically calibrated (tissue tone help).

## Accessibility and motion
Focus ring: 2 px amber with a 2 px gap (`--focus`). Everything is reachable by keyboard: Space play · ←/→ step · +/− zoom · S select · Esc clear · R reset camera · ? shortcuts. The camera flies in 1.4 s (`--ease`) and panels move in 240 ms. All motion is off under `prefers-reduced-motion`.
