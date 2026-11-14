# P2 → P3 handoff: draw tool, NCA band, playback files

This is the reference for wiring P2's browser code into the viewer. All files are plain ES modules with no dependencies or build step.

| File | What it is |
|---|---|
| `sim/js/engine.js` | Cell-agent engine (JS port of `sim/cellsim.py`, statistically matched over 20 seeds) |
| `sim/js/nca.js` | NCA inference (matches torch `nca/model.py` to 2.4e-7) |
| `sim/js/smooth.js` | Smoothed occupancy and wound outline (JS port of Agent 4's `sim/smooth_view.py`; exact match) |
| `sim/js/worker.js` | Module Web Worker that wraps all of the above |
| `sim/js/playback.js` | Decoder for `web/public/sim/<name>.json` |
| `nca/weights.json` | NCA weights (P2's branch) |

**Serving:** the viewer is served from `web/`, so copy all `sim/js/*.js` files together into one folder under `web/`, for example `web/public/sim/js/`. Copy `nca/weights.json` into `web/` too. The files import each other by relative path. Use a module worker; `file://` will not work.

## 1. Draw tool (worker)

**Scale:** one lattice site is one cell, `SITE_UM = 20` µm. A WHAD-sized field is **32 rows × 44 cols** (`h = 32`, `w = 44`). Grids are row-major (`i = y*w + x`).

> **The lattice is locked to the WHAD field: 32×44 sites (`FIELD_H`, `FIELD_W`) at `SITE_UM = 20`.** Scale the canvas up visually, never the lattice.
> - **Why:** under the frozen sim rules, closure speed depends on field size, because vacancies leave through the border reservoir. A 120×168 field still holds 81% of its wound at 24 h. The presets and the NCA were fitted and trained at 32×44.
> - **Other mask sizes:** a `wound` mask of any other size (for example canvas pixels) is resampled nearest-neighbour onto 32×44 in `init`, and frames then carry `resampled_from: [h, w]`. A disc drawn on 320×440 px went from 0.181 on the canvas to 0.182 on the lattice.

**Presets** (`PRESETS` in `engine.js`, from `sim/fits/whad_fits.json` → `presets.draw_tool`, division off):

| Preset | Tm (h) | Bias |
|---|---|---|
| `CC` | 0.792 | 0.65 |
| `C61` | 0.878 | 0.25 |

Show `PRESET_LABEL` = `"simulation, preset parameters"` next to the draw tool. **Never show a band or a coverage claim on a drawn wound.** The draw tool is a simulation under a preset, not a forecast (design.md).

**Messages to the worker:**

| Message | Effect |
|---|---|
| `{type:'init', w, h, wound, preset, seed}` | `wound`: `Uint8Array(w*h)`, 1 = drawn (empty), 0 = cells. `preset`: `'CC'` or `'C61'`. Posts frame 0. Any message sent before `init` is ignored. |
| `{type:'run', hoursPerFrame}` | Starts the loop at up to about 30 fps; default 0.5 h of sim time per frame |
| `{type:'pause'}` | Stops the loop |
| `{type:'step', hours}` | Advances once and posts one frame |
| `{type:'reset'}` | Stops and restarts from the last `init` |
| `{type:'preset', preset}` | Switches CC/C61 live |

**Frames from the worker:** `{type:'frame', w, h, t_hours, wound_frac, occ, fine, outline}`

| Field | Contents |
|---|---|
| `wound_frac` | `1 - mean(occ)`, the same definition as `whad_curves.csv` |
| `occ` | `Uint8Array(w*h)`, raw agents, 1 = cell |
| `fine` | `{scale: 2, sigma: 2.5, h: 2h, w: 2w, data: Uint8Array}`. Smoothed occupancy, `round(v*255)`, row-major. Each site is `scale × scale` fine px. |
| `outline` | `{units:'sites', rule:'area-matched', level, lines}`. `lines` is a list of flat `[x0,y0,x1,y1,...]` polylines in site coords (`x` = col, `y` = row, the lattice spans `[0,w]×[0,h]`). The outlined area equals `wound_frac`. When there is no wound, `level` is null and `lines` is empty. |

**Outline display rule (Agent 4):** draw `outline.display.lines` at alpha `outline.display.opacity`. The worker computes both, using `displayOutline()` in `smooth.js`:
- The outline fades out as `level` rises from 0.85 to 0.95. A high level means the wound has dissolved into the sheet, so there is no clear front.
- Closed loops that enclose fewer than 4 sites are dropped; these are single-site holes.

`outline.lines` keeps every loop and is the area-matched set.

`fine` and `outline` use the same parameters as Agent 4's playback files (`density_fine`, `outline`), so live and precomputed views look identical. Turn them off with `smooth:false` in `init`.

> **Rendering rule:** draw `fine` plus `outline` by default. Use raw `occ` agents only at deep zoom. The raw lattice shows scattered single-site holes after a few hours, which is the sheet thinning, not a wound front.

**Speed per frame** (0.5 h of sim time plus smoothing and outline): about 3.5 ms on 32×44, and about 35 ms on 120×160 (19k agents).

```js
const wk = new Worker(new URL('./public/sim/js/worker.js', import.meta.url), { type: 'module' });
const w = 44, h = 32, wound = new Uint8Array(w * h);           // fill 1s where the user drew (other sizes get resampled)
wk.onmessage = ({ data: m }) => {
  if (m.type === 'frame') zoomDeep ? drawAgents(m.occ, m.w, m.h)
    : drawSmooth(m.fine, m.outline.display.lines, m.outline.display.opacity);  // + m.t_hours, m.wound_frac
};
wk.postMessage({ type: 'init', w, h, wound, preset: 'CC', seed: 1 });
wk.postMessage({ type: 'run', hoursPerFrame: 0.5 });
```

## 2. NCA band (same worker, uploaded/real wounds only)

> **Use the band only for an uploaded or real WHAD wound with fitted `Tm`/`bias`. Never use it for a drawn wound.**

The band does not depend on the draw engine and does not need `init`.

1. Send `{type:'nca-load', weights}` once, with `weights` = the parsed `nca/weights.json`. The worker replies `{type:'nca-ready'}`.
2. Send `{type:'band', Tm, bias, hours: 24, members: 20, seed, start}`.
   - `Tm` and `bias` are the wound's fitted values and are required.
   - `start` is either `{occ, h, w}`: the agent lattice from the mask, `Uint8Array(h*w)` with 1 = cell. The worker coarse-grains it by `GRAIN = 2` and takes the reservoir from its starting border band.
   - Or `start` is `{rho, h, w, R?}`: a coarse density `Float32Array(h*w)` in 0..1, used as is. `R` is the reservoir fraction and defaults to 0.
3. The reply is `{type:'band', t_hours[0..hours], q05[], q50[], q95[]}`.
   - Each quantile array holds `wound_frac` per hour, counted from the start state at index 0.
   - On bad input the reply is `{type:'band-error', error}` instead: no weights loaded, or a missing `start`, `Tm` or `bias`.

**Latency:** on 16×22, 20 members take about **1.5 s** and 50 members about 3.5 s. The worker is busy for that time, so show a loading state.

```js
const weights = await (await fetch('./public/sim/nca_weights.json')).json();
wk.postMessage({ type: 'nca-load', weights });
// for an uploaded wound: occ = 32x44 lattice from its mask, Tm/bias = its fit
showSpinner();
wk.postMessage({ type: 'band', Tm, bias, hours: 24, members: 20, start: { occ, h: 32, w: 44 } });
// -> m.q05/q50/q95[k] is the wound fraction k hours after the start state
```

## 3. Playback files (`web/public/sim/<name>.json`, written by `sim/export_playback.py`)

```
{ name, H, W, grain, t_hours[F], wound_frac[F],
  density: { h, w, frames: [base64 uint8, h*w row-major, round(density*255)] },
  agents?: { encoding: "packbits-msb", frames: [base64 of ceil(H*W/8) bytes] } }
```

- **Agents:** site `i = y*W + x` is occupied iff `(bytes[i>>3] >> (7-(i&7))) & 1`. The `agents` key is only present if the file was exported with `--agents`.
- **Stride:** the last frame is always included.
- **Optional `density_fine` and `outline` keys:** written with `--fine`, and they have the same meaning as the worker's `fine` and `outline`. The file stores them per frame as `outline.levels[F]` and `outline.frames[F]`. Decode `density_fine.frames[f]` like `density.frames[f]`. The same rendering rule applies: smoothed plus outline by default, agents only at deep zoom.
- **Checked:** I exported a real 32×44 run with `sim/export_playback.py` (f5709e4) and decoded it with `playback.js`. All agent sites matched, density matched to within 1e-5 of the 0–255 value, and the decoded `wound_frac` equalled the file's.

```js
import { densityFrame, agentFrame } from './public/sim/js/playback.js';
const pb = await (await fetch('./public/sim/run_cc.json')).json();
const rho = densityFrame(pb, f);    // Float32Array(pb.density.h * pb.density.w), 0..1
const occ = agentFrame(pb, f);      // Uint8Array(pb.H * pb.W), 1 = cell
// zoom: one density cell = pb.grain x pb.grain agent sites, so mean(occ) == mean(rho) every frame
```
