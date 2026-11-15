// Live drawing on the Assay 3D tissue: carve a wound with the brush and watch the NCA heal it in real time.
// Model: the v2 follower NCA (web/public/sim/nca_v2_weights.json + config, sim/js/nca.js) running in its own worker
// (web/public/sim/js/live.js) on the coarse WHAD grid, under the CC / C61 follow-rule presets (engine.js PRESETS_FOLLOW).
// A drawn wound is a simulation: no band, no coverage and no forecast claim (design.md 4.2).
// Mapping: brush hit -> display hex (tissue.js height-field pick) -> the brush disk is painted at display resolution
// (every hex whose centre lies within the radius) and downsampled into the NCA state: a coarse cell is carved when
// the disk covers at least half of its hexes, and the cell under the brush centre always is -> density 0 in the worker.
// Rendering: tissue.js samples the coarse NCA density bilinearly at every display hex (DISPLAY INTERPOLATION only;
// the model grid is GRAIN x GRAIN sites = 40 µm per cell); height = that density, wound = density < WOUND_RHO.
import { PRESETS_FOLLOW, PRESET_CAPTION_FOLLOW, GRAIN, SITE_UM, FIELD_W, FIELD_H } from "../public/sim/js/engine.js";
import { coarseGrain } from "../public/sim/js/nca.js";
import { PHOTO_LABEL } from "./photo.js";

export const LIVE_LABEL = "simulation (NCA emulator, follower rule; preset parameters)";
const WOUND_RHO = 0.5, HEAL_PCT = 95;
const BRUSHES = { S: 1.5, M: 2.5, L: 4 };   // radius in sites (one site = 20 µm)
const SPEEDS = [1, 2, 4, 8];                // simulated hours per second
const STATUS = { running: "healing", paused: "paused", healed: `healed (every cell ≥ ${HEAL_PCT}% density); idle`,
  stalled: "stalled (no progress for 12 simulated h); idle", cap: "stopped at the 500 h cap", loading: "loading the NCA…" };

export function createLive(tissue, { onState } = {}) {
  const { COUNT, u: hu, v: hv } = tissue.grid, CW = FIELD_W / GRAIN, CH = FIELD_H / GRAIN;
  const worker = new Worker(new URL("../public/sim/js/live.js", import.meta.url), { type: "module" });
  const S = { preset: "CC", brush: "M", speed: 2, brushOn: true, status: "loading", t: 0, tCut: null, fromPhoto: false, open: 0, ready: false, active: false };
  const fresh = new Uint8Array(COUNT), intact = { data: new Float32Array(CW * CH).fill(1), w: CW, h: CH, perSite: 1 / GRAIN, level: WOUND_RHO, t_hours: 0 };
  let field = intact;
  // display hex -> coarse NCA cell, and hexes per cell (for the coverage downsample)
  const cellOf = new Int32Array(COUNT), cellN = new Int32Array(CW * CH), hit = new Int32Array(CW * CH);
  for (let k = 0; k < COUNT; k++) { cellOf[k] = Math.min(CH - 1, (hv[k] / GRAIN) | 0) * CW + Math.min(CW - 1, (hu[k] / GRAIN) | 0); cellN[cellOf[k]]++; }
  function carve({ k, u, v, radius }) {
    if (!S.ready) return;
    hit.fill(0); const r2 = radius * radius, cells = [cellOf[k]];
    for (let q = 0; q < COUNT; q++) if ((hu[q] - u) ** 2 + (hv[q] - v) ** 2 <= r2) hit[cellOf[q]]++;
    for (let c = 0; c < hit.length; c++) if (c !== cellOf[k] && 2 * hit[c] >= cellN[c]) cells.push(c);
    worker.postMessage({ type: "carve", cells });
  }
  const brush = () => ({ radius: BRUSHES[S.brush], onPaint: carve });
  const draw = () => { if (S.active) tissue.showLive(field, fresh); };

  worker.onmessage = ({ data: m }) => {
    if (m.type === "live-ready") { S.ready = true; if (S.active) worker.postMessage({ type: "play" }); return; }
    if (m.type === "live-error") { S.status = "error"; S.error = m.error; onState?.(S); return; }
    if (m.type !== "state") return;
    field = { ...intact, data: m.rho, t_hours: m.t_hours };   // simulated time: tissue.js counts cell ages in it
    Object.assign(S, { status: m.status, t: m.t_hours, tCut: m.t_cut, open: m.open_frac });
    draw(); onState?.(S);
  };
  const p0 = PRESETS_FOLLOW[S.preset];
  worker.postMessage({ type: "load", Tm: p0.Tm, bias: p0.bias, hoursPerSec: S.speed });

  return {
    state: S,
    start() { S.active = true; if (S.brushOn) tissue.setBrush(brush()); if (S.ready) worker.postMessage({ type: "play" }); draw(); },
    stop() { S.active = false; tissue.setBrush(null); worker.postMessage({ type: "pause" }); },
    toggle() { worker.postMessage({ type: S.status === "paused" ? "play" : "pause" }); },
    reset() { fresh.fill(0); S.fromPhoto = false; worker.postMessage({ type: "reset" }); },
    // photo outline (Uint8Array(FIELD_W*FIELD_H), 1 = wound) -> intact tissue, then carve every coarse cell at least
    // half inside the outline
    carveMask(mask) {
      if (!S.ready) return;
      fresh.fill(0); worker.postMessage({ type: "reset" });
      const { rho } = coarseGrain(mask, FIELD_H, FIELD_W, GRAIN), cells = [];
      rho.forEach((a, c) => a >= 0.5 && cells.push(c));
      S.fromPhoto = true; worker.postMessage({ type: "carve", cells }); worker.postMessage({ type: "play" });
    },
    setPreset(p) { S.preset = p; const q = PRESETS_FOLLOW[p]; worker.postMessage({ type: "preset", Tm: q.Tm, bias: q.bias }); onState?.(S); },
    setSpeed(v) { S.speed = v; worker.postMessage({ type: "speed", hoursPerSec: v }); onState?.(S); },
    setBrushSize(b) { S.brush = b; if (S.brushOn && S.active) tissue.setBrush(brush()); onState?.(S); },
    setBrushOn(on) { S.brushOn = on; tissue.setBrush(on && S.active ? brush() : null); onState?.(S); },
    dispose() { worker.terminate(); tissue.setBrush(null); },
  };
}

// right-panel controls for live drawing (Assay panel); data-live attributes are handled by assay.js
export function livePanel(S) {
  const seg = (key, opts, cur, fmt = x => x) => `<div class="st-seg">${opts.map(o => `<button class="st-btn" data-live="${key}:${o}" aria-pressed="${o === cur}">${fmt(o)}</button>`).join("")}</div>`;
  const p = PRESETS_FOLLOW, playing = S.status !== "paused" && S.status !== "loading";
  return `<div class="as-card as-live">
    <div class="st-kicker">Draw a wound · live</div>
    <div class="as-chips"><span class="st-chip st-chip--honesty">${LIVE_LABEL}</span>${S.fromPhoto ? `<span class="st-chip st-chip--honesty">${PHOTO_LABEL}</span>` : ""}</div>
    <p class="as-caption">Drag on the tissue to remove cells. Right-drag orbits, the wheel zooms. The NCA keeps running and fills the gap;
      it idles once every cell is back to ${HEAL_PCT}% density, and any new cut restarts it. Upload images also takes one
      skin-wound photo: its traced outline becomes the cut.</p>
    <div class="as-btns">
      <button class="st-btn st-btn--primary" data-live="play">${playing ? "Pause" : "Play"}</button>
      <button class="st-btn" data-live="reset">Reset to intact tissue</button>
      <button class="st-btn" data-live="brush" aria-pressed="${S.brushOn}" title="Brush · B">Brush ${S.brushOn ? "on" : "off"}</button>
    </div>
    <div class="st-row"><span>Condition preset</span>${seg("preset", ["CC", "C61"], S.preset)}</div>
    <p class="as-caption">Follow-rule presets fed to the NCA as (Tm, bias): CC Tm ${p.CC.Tm.toFixed(1)} h, bias ${p.CC.bias.toFixed(2)};
      C61 Tm ${p.C61.Tm.toFixed(1)} h, bias ${p.C61.bias.toFixed(2)}. ${PRESET_CAPTION_FOLLOW}.</p>
    <div class="st-row"><span>Brush radius</span>${seg("size", Object.keys(BRUSHES), S.brush, b => `${b} · ${Math.round(BRUSHES[b] * SITE_UM)} µm`)}</div>
    <div class="st-row"><span>Speed</span>${seg("speed", SPEEDS, S.speed, v => `${v} h/s`)}</div>
    <div class="st-row"><span>${S.fromPhoto ? "Simulation steps since the cut" : "Simulated time"}</span><span class="num as-live-t"></span></div>
    <div class="st-row"><span>Status</span><span class="as-live-status"></span></div>
    <div class="st-row"><span>Open (density &lt; ${WOUND_RHO})</span><span class="num as-live-open"></span></div>
    <p class="as-caption">No band and no forecast: a drawn wound is a simulation, not a measurement. Display interpolation: each hex
      (${SITE_UM / 2} µm) samples the NCA's coarse density (${GRAIN * SITE_UM} µm per model cell) bilinearly at its centre; a hex is a sample, not a cell.</p>
  </div>`;
}
export function liveReadouts(root, S) {
  const q = s => root.querySelector(s);
  if (!q(".as-live-t")) return;
  const since = S.tCut == null ? null : S.t - S.tCut;
  // photo shapes count NCA substeps (0.5 h each), never hours: the healing is a cell-culture model, not the photo's wound
  q(".as-live-t").textContent = S.fromPhoto ? String(Math.round((since ?? 0) * 2)) : `${S.t.toFixed(1)} h${since == null ? "" : ` · ${since.toFixed(1)} h since this cut`}`;
  q(".as-live-status").textContent = S.status === "error" ? `NCA failed to load: ${S.error}` : STATUS[S.status] || S.status;
  q(".as-live-open").textContent = `${(S.open * 100).toFixed(1)}% of the field`;
  const play = q('[data-live="play"]'); if (play) play.textContent = S.status === "paused" ? "Play" : "Pause";
}
