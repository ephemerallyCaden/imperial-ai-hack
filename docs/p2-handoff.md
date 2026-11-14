# P2 → P3 handoff: draw tool, NCA band, playback files

This is the reference for wiring P2's browser code into the viewer. All files are plain ES modules with no dependencies or build step.

| File | What it is |
|---|---|
| `sim/js/engine.js` | Cell-agent engine (JS port of `sim/cellsim.py`, statistically matched over 20 seeds) |
| `sim/js/nca.js` | NCA inference (matches torch `nca/model.py` to 3.6e-7 with the clean weights) |
| `sim/js/smooth.js` | Smoothed occupancy and wound outline (JS port of Agent 4's `sim/smooth_view.py`; exact match) |
| `sim/js/worker.js` | Module Web Worker that wraps all of the above |
| `sim/js/playback.js` | Decoder for `web/public/sim/<name>.json` |
| `nca/weights.json` | NCA weights (Agent 2, clean data, 46f5c29, sha256 `6d0fc3deecd4…`) |

**Serving:** these files are already copied under `web/`, which is where the viewer is served from:
- `web/public/sim/js/` holds `engine.js`, `nca.js`, `smooth.js`, `worker.js` and `playback.js`.
- `web/public/sim/nca_weights.json` is `nca/weights.json`.

The files import each other by relative path. Use a module worker; `file://` will not work.

`sim/js/` is the source of truth. After a change there, recopy with `cp sim/js/{engine,nca,smooth,worker,playback}.js web/public/sim/js/`.

These have been tested in Node with a stubbed worker, but not yet in a real browser.

## 1. Draw tool (worker)

**Scale:** one lattice site is one cell, `SITE_UM = 20` µm. A WHAD-sized field is **32 rows × 44 cols** (`h = 32`, `w = 44`). Grids are row-major (`i = y*w + x`).

> **The lattice is locked to the WHAD field: 32×44 sites (`FIELD_H`, `FIELD_W`) at `SITE_UM = 20`.** Scale the canvas up visually, never the lattice.
> - **Why:** under the frozen sim rules, closure speed depends on field size, because vacancies leave through the border reservoir. A 120×168 field still holds 81% of its wound at 24 h. The presets and the NCA were fitted and trained at 32×44.
> - **Other mask sizes:** a `wound` mask of any other size (for example canvas pixels) is resampled nearest-neighbour onto 32×44 in `init`, and frames then carry `resampled_from: [h, w]`. A disc drawn on 320×440 px went from 0.181 on the canvas to 0.182 on the lattice.

**Presets** (`PRESETS` in `engine.js`, from `sim/fits/whad_fits.json` → `presets.draw_tool`, Agent 1 65c035a). Each is the median of the WHAD part II fits at t0 = 10 (manual + auto), with division off:

| Preset | Tm (h) | Tm IQR | Bias | Bias IQR | n (manual) |
|---|---|---|---|---|---|
| `CC` | 0.499 | 0.40–0.62 | 0.25 | 0.25–0.45 | 7 (4) |
| `C61` | 0.477 | 0.45–0.54 | 0.352 | 0.25–0.38 | 7 (3) |

> **Under this model, the CC and C61 fits heal the same, with no visible gap.** A drawn disc starting at a wound fraction of 0.18 reaches 0.024 (CC) and 0.019 (C61) at 24 h, mean of 10 seeds (`node sim/js/draw_check.mjs`). Agent 1 gets 0.024 and 0.020. This is the honest result. Part II C61 looks slower in normalised area mostly because its wounds start larger; the absolute closure speed and the fitted Tm overlap. The presets stay exactly as fitted, with nothing tuned to create a difference. The UI choice is yours: drop the toggle, or keep it with a caption such as "the fitted conditions differ little under this model".
>
> **The CC bias of 0.25 sits on the lower edge of the fit range (0.25–0.9), so treat it as poorly identified** (Agent 1's caveat). Don't present it as a measured property of CC cells.

Show `PRESET_LABEL` = `"simulation, preset parameters (WHAD part II fits)"` (= `presets.draw_tool.label`) next to the draw tool. **Never show a band or a coverage claim on a drawn wound.** The draw tool is a simulation under a preset, not a forecast (design.md).

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
   - `Tm` and `bias` are the wound's fitted values. Alternatively pass `params: [[Tm, bias], ...]`, the fit's bootstrap members from `whad_fits.json` → `fits[pos][cutoff].members`. Member *m* then uses `params[m % n]`, so the band carries the fit uncertainty too.
   - `start` is either `{occ, h, w}`: the agent lattice from the mask, `Uint8Array(h*w)` with 1 = cell. The worker coarse-grains it by `GRAIN = 2` and takes the reservoir from its starting border band.
   - Or `start` is `{rho, h, w, R?}`: a coarse density `Float32Array(h*w)` in 0..1, used as is. `R` is the reservoir fraction and defaults to 0.
3. The reply is `{type:'band', t_hours[0..hours], q05[], q50[], q95[]}`.
   - Each quantile array holds `wound_frac` per hour, counted from the start state at index 0.
   - On bad input the reply is `{type:'band-error', error}` instead: no weights loaded, or a missing `start`, `Tm` or `bias`.

**Latency:** on 16×22, 20 members take about **1.5 s** and 50 members about 3.5 s. The worker is busy for that time, so show a loading state.

> **This band is the raw NCA ensemble and is not calibrated. Do not label it a 90% interval.** On the real WHAD wounds (16 positions, start state = mask at the cut-off, 50 members over the fit's bootstrap members), only a small fraction of the observed points fell inside q05–q95:
> - cut-off 4: 38 of 235 hourly points;
> - cut-off 10: 9 of 139.
>
> The median tracks the observed curve well: q50 MAE is about 0.003–0.08 of the field at cut-off 4, and about 0.004–0.045 at cut-off 10, mostly around 0.01. Agent 2's official `nca_ensemble` forecasts use the same construction.
>
> For a forecast band with a coverage claim, use the calibrated forecast JSON (`contracts/forecast.schema.json`, from P1's scorer). If you show this live band, caption it "NCA ensemble spread (uncalibrated)". To reproduce: `python3 sim/js/band_check.py <agent1 root> <position> <cutoff> case.json`, then `node sim/js/band_check.mjs web/public/sim/nca_weights.json case.json 50`.

```js
const weights = await (await fetch('./public/sim/nca_weights.json')).json();
wk.postMessage({ type: 'nca-load', weights });
// for an uploaded wound: occ = 32x44 lattice from its mask, Tm/bias = its fit
showSpinner();
wk.postMessage({ type: 'band', Tm, bias, hours: 24, members: 20, start: { occ, h: 32, w: 44 } });
// -> m.q05/q50/q95[k] is the wound fraction k hours after the start state
```

## 3. Playback files (`web/public/sim/<name>.json`, written by `sim/export_playback.py`)

Example: `web/public/sim/whad_partII_C61_P2.json` (Agent 4, e65e21c), 191 frames, 137 KB.

```
{ name, H, W, grain, t_hours[F], wound_frac[F], meta?,
  density: { h, w, frames: [base64 uint8, h*w row-major, round(density*255)] },
  agents: { encoding: "packbits-msb", frames: [base64 of ceil(H*W/8) bytes] },
  density_fine: { scale: 2, sigma: 2.5, h, w },            // parameters only, no frames
  outline: { units: "sites", rule: "area-matched", levels[F],
             display: { fade_from_level: 0.85, fade_to_level: 0.95, min_loop_area_sites: 4 } } }
```

- **Agents:** site `i = y*W + x` is occupied iff `(bytes[i>>3] >> (7-(i&7))) & 1`.
- **Smoothed field and outline:** the file does not store them per frame. Recompute them from the agents with `viewFrame(pb, f)`, which uses the file's `density_fine` and `outline.display` parameters. It returns `{fine, outline}` in the same shape as the draw worker's frame, so one renderer serves both. It takes about 1 ms per frame on 32×44.
- **Rendering rule:** the same as the draw tool. Draw `fine` plus `outline.display` by default, and raw agents only at deep zoom.
- **Stride:** the last frame is always included.
- **`--fine-frames`:** an `export_playback.py --fine-frames` export also stores `density_fine.frames` and `outline.frames`; you don't need them.
- **Checked against Agent 4's file:**
  - `viewFrame` reproduces the file's `outline.levels` on all 191 frames to within 5e-5, which is the file's 4-decimal rounding.
  - On an earlier export, `agentFrame` and `densityFrame` decoded exactly, and the decoded `wound_frac` equalled the file's.

```js
import { densityFrame, agentFrame, viewFrame } from './public/sim/js/playback.js';
const pb = await (await fetch('./public/sim/whad_partII_C61_P2.json')).json();
const { fine, outline } = viewFrame(pb, f);  // default view: fine.data (Uint8, fine.h x fine.w) + outline.display
const occ = agentFrame(pb, f);               // deep zoom: Uint8Array(pb.H * pb.W), 1 = cell
const rho = densityFrame(pb, f);             // coarse density (pb.density.h x w); mean(occ) == mean(rho) every frame
```

### NCA playback: `web/public/sim/whad_partII_C61_P2_nca.json` (17 KB)

This is the same wound as Agent 4's sim playback, rolled out with the NCA so the viewer can show NCA vs sim vs data on one wound.

- **Format:** Agent 4's format, density only (no `agents`, so `viewFrame` does not apply). Render `densityFrame(pb, f)` directly as the NCA field: 16×22, one density cell = 2×2 sites.
- **Start:** the observed mask at the last frame ≤ the 3.8 h cut-off (frame 3, t = 3.0 h, wound_frac 0.2124, matching the observed value), the same construction as the official forecasts.
- **Frames:** 33, one per NCA half-hour substep, from 3.0 to 19.0 h. They come from a deterministic rollout with the wound's point fit (Tm 0.310, bias 0.443; Agent 1's `fits[pos]["3.8"]`, which uses frames ≤ 3.8 h only).
- **`meta`:**
  - `observed`: the full observed curve.
  - `band`: the raw 50-member ensemble `q05`/`q50`/`q95`. It is **uncalibrated**; caption it as such.
  - also the fit, the start, and the weights sha256.
- **Decode check:** `1 - mean(densityFrame)` matches `wound_frac` to within 1.4e-4 (uint8 quantisation).
- **Result:** the NCA's MAE against observed after the cut-off is 0.017. It closes faster than the data until about 11 h, then more slowly (0.013 vs 0.002 at 19 h).
- **Fit source:** `meta.fit_source` = feature/p2-agent1 c30f6ed `sim/fits/whad_fits.json` (sha256 `97943ebccf05`).
- **Regenerate:** `python3 sim/js/band_check.py <agent1 root> exp1_partII_C61_P2 3.8 case.json`, then `node sim/js/make_nca_playback.mjs web/public/sim/nca_weights.json case.json web/public/sim/whad_partII_C61_P2_nca.json`.

### Fair NCA vs sim vs data panel (one wound)

| Layer | File | Start | Fit |
|---|---|---|---|
| Data | `meta.observed` in either file below | — | — |
| Sim (cell agents, frozen rules) | `web/public/sim/whad_partII_C61_P2_sim38.json` (116 KB, 161 frames every 0.1 h, 3.0–19.0 h, with `agents`) | observed mask at frame 3 (t = 3.0 h) | `fits[pos]["3.8"]`, Tm 0.310, bias 0.443, seed 0 |
| NCA (emulator) | `web/public/sim/whad_partII_C61_P2_nca.json` (33 frames every 0.5 h, density only) | the same mask, frame 3 | the same fit |

- **Use this pair for the panel.** Both start from the same mask and use the same fit (c30f6ed). After the cut-off, sim and NCA have nearly the same MAE against observed: 0.0172 and 0.0174 over 16 frames.
  - Both close faster than the data until about 11 h.
  - Late on, the NCA stays closer to the data than the sim: at 19 h, observed 0.002, NCA 0.013, sim 0.026.
- **Agent 4's `whad_partII_C61_P2.json` is the video's full run.** It starts at frame 0 with the older t0 = 10 fit, so don't use it in this panel.
- **sim38 decode check:** `agentFrame` matches `wound_frac` to 5e-6, `densityFrame` to 2.5e-4, and `viewFrame` reproduces `outline.levels` to 5e-5.
- **Regenerate sim38:** first run `python3 sim/js/make_sim_playback_cutoff.py <agent1 root> exp1_partII_C61_P2 3.8 sim38.npz`. Then run Agent 4's exporter, unchanged: `python3 <agent4>/sim/export_playback.py sim38.npz whad_partII_C61_P2_sim38 --agents --fine 2 --outdir web/public/sim`. The wrapper only overrides the start (frame and t_start); everything else follows Agent 4's `make_playback.py`.
