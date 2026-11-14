# P2 → P3 handoff: draw tool, NCA band, playback files

This is the reference for wiring P2's browser code into the viewer. All files are plain ES modules with no dependencies or build step.

| File | What it is |
|---|---|
| `sim/js/engine.js` | Cell-agent engine (JS port of `sim/cellsim.py`, statistically matched over 20 seeds) |
| `sim/js/nca.js` | NCA inference (matches torch `nca/model.py` to 2.4e-7) |
| `sim/js/worker.js` | Module Web Worker that wraps both |
| `sim/js/playback.js` | Decoder for `web/public/sim/<name>.json` |
| `nca/weights.json` | NCA weights (P2's branch) |

**Serving:** the viewer is served from `web/`, so copy the four `sim/js/*.js` files together into one folder under `web/`, for example `web/public/sim/js/`. Copy `nca/weights.json` into `web/` too. The files import each other by relative path. Use a module worker; `file://` will not work.

## 1. Draw tool (worker)

**Scale:** one lattice site is one cell, `SITE_UM = 20` µm. A WHAD-sized field is **32 rows × 44 cols** (`h = 32`, `w = 44`). Grids are row-major (`i = y*w + x`).

**Presets** (`PRESETS` in `engine.js`, from `sim/fits/whad_fits.json` → `presets.draw_tool`, division off):

| Preset | Tm (h) | Bias |
|---|---|---|
| `CC` | 0.792 | 0.65 |
| `C61` | 0.878 | 0.25 |

Show `PRESET_LABEL` = `"simulation, preset parameters"` next to the draw tool, and no band from the presets themselves.

**Messages to the worker:**

| Message | Effect |
|---|---|
| `{type:'init', w, h, wound, preset, seed}` | `wound`: `Uint8Array(w*h)`, 1 = drawn (empty), 0 = cells. `preset`: `'CC'` or `'C61'`. Posts frame 0. Any message sent before `init` is ignored. |
| `{type:'run', hoursPerFrame}` | Starts the loop at up to about 30 fps; default 0.5 h of sim time per frame |
| `{type:'pause'}` | Stops the loop |
| `{type:'step', hours}` | Advances once and posts one frame |
| `{type:'reset'}` | Stops and restarts from the last `init` |
| `{type:'preset', preset}` | Switches CC/C61 live |

**Frames from the worker:** `{type:'frame', w, h, occ: Uint8Array(w*h) (1 = cell), t_hours, wound_frac}`. `wound_frac` is `1 - mean(occ)`, the same definition as `whad_curves.csv`.

**Speed:** a 24 h run on 32×44 takes about 30 ms, so frame rate is not a concern.

```js
const wk = new Worker(new URL('./public/sim/js/worker.js', import.meta.url), { type: 'module' });
const w = 44, h = 32, wound = new Uint8Array(w * h);           // fill 1s where the user drew
wk.onmessage = ({ data: m }) => {
  if (m.type === 'frame') draw(m.occ, m.w, m.h, m.t_hours, m.wound_frac);
  if (m.type === 'band') showBand(m);                           // section 2
};
wk.postMessage({ type: 'init', w, h, wound, preset: 'CC', seed: 1 });
wk.postMessage({ type: 'run', hoursPerFrame: 0.5 });
```

## 2. NCA band (same worker)

1. Send `{type:'nca-load', weights}` once, with `weights` = the parsed `nca/weights.json`. The worker replies `{type:'nca-ready'}`. A `band` request sent before this is ignored.
2. Send `{type:'band', hours: 24, members: 20, Tm, bias, seed}`. `Tm` and `bias` default to the current preset. The band starts from the **current** drawn grid: it coarse-grains by `GRAIN = 2` to 16×22 and uses the starting border reservoir.
3. The reply is `{type:'band', t0_hours, t_hours[0..hours], q05[], q50[], q95[]}`.
   - Each quantile array holds `wound_frac` per hour.
   - Index 0 is the start of the forecast, at absolute time `t0_hours`.

**Latency:** on 16×22, 20 members take about **1.5 s** and 50 members about 3.5 s. The worker is busy for that time, so show a loading state and pause the run first.

```js
const weights = await (await fetch('./public/sim/nca_weights.json')).json();
wk.postMessage({ type: 'nca-load', weights });
// later, e.g. on a "forecast" button:
wk.postMessage({ type: 'pause' });
showSpinner();
wk.postMessage({ type: 'band', hours: 24, members: 20 });
// -> m.q05/q50/q95[k] is the wound fraction at t0_hours + m.t_hours[k]
```

## 3. Playback files (`web/public/sim/<name>.json`, written by `sim/export_playback.py`)

```
{ name, H, W, grain, t_hours[F], wound_frac[F],
  density: { h, w, frames: [base64 uint8, h*w row-major, round(density*255)] },
  agents?: { encoding: "packbits-msb", frames: [base64 of ceil(H*W/8) bytes] } }
```

- **Agents:** site `i = y*W + x` is occupied iff `(bytes[i>>3] >> (7-(i&7))) & 1`. The `agents` key is only present if the file was exported with `--agents`.
- **Stride:** the last frame is always included.
- **Checked:** I exported a real 32×44 run with `sim/export_playback.py` (f5709e4) and decoded it with `playback.js`. All agent sites matched, density matched to within 1e-5 of the 0–255 value, and the decoded `wound_frac` equalled the file's.

```js
import { densityFrame, agentFrame } from './public/sim/js/playback.js';
const pb = await (await fetch('./public/sim/run_cc.json')).json();
const rho = densityFrame(pb, f);    // Float32Array(pb.density.h * pb.density.w), 0..1
const occ = agentFrame(pb, f);      // Uint8Array(pb.H * pb.W), 1 = cell
// zoom: one density cell = pb.grain x pb.grain agent sites, so mean(occ) == mean(rho) every frame
```
