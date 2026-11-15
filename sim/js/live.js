// Live NCA worker for drawing on the 3D tissue (web/assay/live.js): the v2 follower NCA (nca.js, the same weights and
// config as the band) runs continuously on the coarse WHAD grid; carving edits its state while it runs.
// Simulation only: no band, no coverage and no forecast for a drawn wound (design.md 4.2, docs/p2-handoff.md).
//   const wk = new Worker(new URL('./live.js', import.meta.url), { type: 'module' });
//   wk.postMessage({ type:'load', Tm, bias })        -> fetches nca_v2_weights(.config).json, intact tissue, paused
//   { type:'carve', cells:[coarse index, ...] }      -> rho = 0 there (also R = 0: a carved border cell is no longer
//                                                       reservoir, as Engine's t0 rule), hidden channels zeroed;
//                                                       restarts a healed or stalled run unless the user paused it
//   { type:'play' } | { type:'pause' } | { type:'reset' } (intact tissue, t = 0, paused)
//   { type:'preset', Tm, bias }                      -> new (Tm, bias) from the next substep on
//   { type:'speed', hoursPerSec }                    -> simulated hours per wall-clock second
//   posts { type:'live-ready', h, w } then { type:'state', rho:Float32Array(h*w), h, w, t_hours, t_cut, status, min_rho, open_frac }
//   t_cut = t_hours of the first cut since the field was last intact or healed (null before any cut)
//   status: 'running' | 'paused' | 'healed' (isHealed) | 'stalled' (isStalled: mean density moved < 1e-4 over STALL_H
//   simulated hours) | 'cap' (MAX_H)
import { NCA, coarseGrain, isHealed, meanRho, isStalled } from './nca.js';
import { FIELD_H, FIELD_W, GRAIN, reservoirMask } from './engine.js';

export const HEAL_RHO = 0.95, STALL_H = 12, MAX_H = 500;
const H = FIELD_H / GRAIN, W = FIELD_W / GRAIN, HW = H * W, TICK_MS = 33;
// reservoir = border band occupied at t0 (Engine reservoirMask on the intact lattice, coarse-grained like worker.js band)
const R0 = coarseGrain(reservoirMask(new Uint8Array(FIELD_H * FIELD_W).fill(1), FIELD_H, FIELD_W), FIELD_H, FIELD_W, GRAIN).rho;
const idle = (st) => st === 'healed' || st === 'stalled' || st === 'cap';

let nca = null, par = null, rho, R, hid, t = 0, tCut = null, status = 'paused', userPaused = true, hps = 2, timer = null, acc = 0;
let means = [];   // stall guard: mean density at every simulated hour since the run (re)started

function intact() {
  rho = new Float32Array(HW).fill(1); hid = new Float32Array(nca.nh * HW); R = R0.slice();
  t = 0; tCut = null;
}
function stats() {
  let mn = 1, mass = 0, open = 0;
  for (let i = 0; i < HW; i++) { const v = rho[i]; if (v < mn) mn = v; mass += v; if (v < 0.5) open++; }
  return { mn, mass, open: open / HW };
}
function post(s = stats()) {
  const r = rho.slice();
  postMessage({ type: 'state', rho: r, h: H, w: W, t_hours: t, t_cut: tCut, status, min_rho: s.mn, open_frac: s.open }, [r.buffer]);
}
function resetStall() { means = [meanRho(rho)]; }
function tick() {
  timer = null;
  if (status !== 'running') return;
  acc += (hps * TICK_MS) / 1000;
  const dt = 1 / nca.K; let s = null;
  while (acc >= dt - 1e-9 && status === 'running') {
    acc -= dt;
    [rho, hid] = nca.step(rho, R, hid, par, H, W, null);
    t += dt;
    s = stats();
    if (Math.abs(t - Math.round(t)) < 1e-9) means.push(s.mass / HW);
    if (isHealed(rho, { minRho: HEAL_RHO })) status = 'healed';
    else if (isStalled(means, { window: STALL_H })) status = 'stalled';
    else if (t >= MAX_H) status = 'cap';
  }
  if (s) post(s);   // only when the NCA stepped: the hex resample runs at the NCA step rate
  if (status === 'running') timer = setTimeout(tick, TICK_MS);
}
function run() { if (status === 'running') return; status = 'running'; acc = 0; resetStall(); if (!timer) timer = setTimeout(tick, TICK_MS); }
function pause() { status = 'paused'; clearTimeout(timer); timer = null; }

onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    try {
      const [wt, cfg] = await Promise.all(['../nca_v2_weights.json', '../nca_v2_weights.config.json'].map((p) => fetch(new URL(p, import.meta.url)).then((r) => r.json())));
      nca = new NCA(wt, cfg); par = nca.normParams(m.Tm, m.bias); hps = m.hoursPerSec || hps; intact();
      postMessage({ type: 'live-ready', h: H, w: W }); post();
    } catch (e) { postMessage({ type: 'live-error', error: e.message }); }
    return;
  }
  if (!nca) return;
  if (m.type === 'carve') {
    if (tCut == null || idle(status)) tCut = t;
    for (const i of m.cells) if (i >= 0 && i < HW) { rho[i] = 0; R[i] = 0; for (let c = 0; c < nca.nh; c++) hid[c * HW + i] = 0; }
    if (userPaused) post(); else { run(); resetStall(); post(); }
  } else if (m.type === 'play') { userPaused = false; if (isHealed(rho, { minRho: HEAL_RHO })) { status = 'healed'; post(); return; } run(); }
  else if (m.type === 'pause') { userPaused = true; pause(); post(); }
  else if (m.type === 'reset') { userPaused = true; pause(); intact(); post(); }
  else if (m.type === 'preset') par = nca.normParams(m.Tm, m.bias);
  else if (m.type === 'speed') hps = m.hoursPerSec;
};
