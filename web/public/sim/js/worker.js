// Module Web Worker around Engine. Frame = same fields as cellsim npz: occ, t_hours, wound_frac.
//   const wk = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   wk.postMessage({ type:'init', w, h, wound:Uint8Array(w*h), preset:'CC'|'C61', seed });  // lattice locked to 32x44
//     optional rule:'follow' (sheet-like followers, cellsim Params.rule); default 'free' = the gate rules
//   wk.postMessage({ type:'run', hoursPerFrame: 0.5 });  // also 'pause','step','preset','reset'
//   wk.onmessage = e => e.data = { type:'frame', occ:Uint8Array(h*w), t_hours, wound_frac, fine, outline }
//   fine = { scale:k, sigma, h:h*k, w:w*k, data:Uint8Array round(smoothed occupancy*255) }   (sim/js/smooth.js,
//   outline = { units:'sites', rule:'area-matched', level, lines:[flat x,y,...], display:{opacity, lines} }  same as playback)
//   init option smooth: { k, sigma } overrides SMOOTH_K/SMOOTH_SIGMA; smooth:false turns both off.
// NCA band (#28), for UPLOADED / REAL wounds only (never for a drawn wound: design.md, draw tool = simulation, no band):
//   { type:'nca-load', weights:<nca/weights.json object> } -> { type:'nca-ready' }
//   { type:'band', Tm, bias | params:[[Tm,bias],...], hours:24, members:20, seed, start } (fitted; params = fit members,
//     member m uses params[m % n]) and start either
//     { occ:Uint8Array(h*w) agent lattice (1 = cell), h, w }  -> coarse-grained by GRAIN, R from its t0 border reservoir
//     { rho:Float32Array(h*w) coarse density, h, w, R? }     -> used as is (R defaults to 0)
//   -> { type:'band', t_hours[0..hours], q05, q50, q95 } (wound_frac per hour from the start state), or { type:'band-error', error }
//   Independent of the draw engine (no 'init' needed).
import { Engine, GRAIN, reservoirMask, FIELD_H, FIELD_W, presetLabelFor } from './engine.js';
import { NCA, coarseGrain } from './nca.js';
import { fineDensity, outline, displayOutline, SMOOTH_K, SMOOTH_SIGMA } from './smooth.js';

let nca = null;

let eng = null, init = null, running = false, hpf = 0.5, timer = null;

function post() {
  const occ = eng.occ.slice(), wf = eng.wound_frac;
  const msg = { type: 'frame', w: eng.w, h: eng.h, rule: eng.rule, label: presetLabelFor(eng.rule), occ, t_hours: eng.t_hours, wound_frac: wf }, tr = [occ.buffer];
  if (init.resampled_from) msg.resampled_from = init.resampled_from;
  const sm = init.smooth === false ? null : { k: SMOOTH_K, sigma: SMOOTH_SIGMA, ...(init.smooth || {}) };
  if (sm) {
    const f = fineDensity(eng.occ, eng.h, eng.w, sm.k, sm.sigma), o = outline(f, wf), data = new Uint8Array(f.data.length);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(f.data[i] * 255);
    msg.fine = { scale: f.scale, sigma: f.sigma, h: f.h, w: f.w, data };
    const d = displayOutline(o);
    msg.outline = { units: 'sites', rule: 'area-matched', level: o.level, lines: o.lines, display: d };
    tr.push(data.buffer);
  }
  postMessage(msg, tr);
}
function loop() {
  if (!running) return;
  const t0 = performance.now();
  eng.advance(hpf);
  post();
  timer = setTimeout(loop, Math.max(0, 33 - (performance.now() - t0)));
}
// lock the draw lattice to the WHAD field (FIELD_H x FIELD_W sites at SITE_UM): a wound mask of any other size
// (e.g. canvas pixels) is resampled nearest-neighbour onto it; frames then report resampled_from: [h, w].
function lockField(m) {
  if (m.w === FIELD_W && m.h === FIELD_H) return m;
  const wound = new Uint8Array(FIELD_W * FIELD_H);
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++)
    wound[y * FIELD_W + x] = m.wound[Math.floor(((y + 0.5) * m.h) / FIELD_H) * m.w + Math.floor(((x + 0.5) * m.w) / FIELD_W)];
  return { ...m, w: FIELD_W, h: FIELD_H, wound, resampled_from: [m.h, m.w] };
}
function band(m) {
  const st = m.start;
  if (!nca) return { type: 'band-error', error: 'send nca-load first' };
  const hasP = Array.isArray(m.params) && m.params.length > 0;
  if (!st || (!hasP && (m.Tm == null || m.bias == null))) return { type: 'band-error', error: 'band needs start and fitted Tm, bias (or params)' };
  let rho, R, h, w;
  if (st.occ) {
    const cg = coarseGrain(st.occ, st.h, st.w, GRAIN);
    ({ rho, h, w } = cg);
    R = coarseGrain(reservoirMask(st.occ, st.h, st.w), st.h, st.w, GRAIN).rho;
  } else { rho = st.rho; h = st.h; w = st.w; R = st.R || null; }
  const b = nca.band(rho, h, w, m.Tm, m.bias, m.hours || 24, { members: m.members || 20, seed: m.seed || 1, R, params: hasP ? m.params : null });
  return { type: 'band', t_hours: b.t_hours, q05: b.q05, q50: b.q50, q95: b.q95 };
}
function stop() { running = false; clearTimeout(timer); timer = null; }
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { stop(); init = lockField(m); eng = new Engine(init); post(); return; }
  if (m.type === 'nca-load') { nca = new NCA(m.weights, m.opts); postMessage({ type: 'nca-ready' }); return; }
  if (m.type === 'band') { postMessage(band(m)); return; }
  if (!eng) return; // ignore everything else until init
  if (m.type === 'reset') { stop(); eng = new Engine(init); post(); }
  else if (m.type === 'preset') eng.setPreset(m.preset, m.params);
  else if (m.type === 'step') { eng.advance(m.hours || hpf); post(); }
  else if (m.type === 'run') { hpf = m.hoursPerFrame || hpf; if (!running) { running = true; loop(); } }
  else if (m.type === 'pause') stop();
};
