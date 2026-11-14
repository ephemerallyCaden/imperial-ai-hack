// Module Web Worker around Engine. Frame = same fields as cellsim npz: occ, t_hours, wound_frac.
//   const wk = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   wk.postMessage({ type:'init', w, h, wound:Uint8Array(w*h), preset:'CC'|'C61', seed });
//   wk.postMessage({ type:'run', hoursPerFrame: 0.5 });  // also 'pause','step','preset','reset'
//   wk.onmessage = e => e.data = { type:'frame', occ:Uint8Array(h*w), t_hours, wound_frac }
// NCA band (#28), for UPLOADED / REAL wounds only (never for a drawn wound: design.md, draw tool = simulation, no band):
//   { type:'nca-load', weights:<nca/weights.json object> } -> { type:'nca-ready' }
//   { type:'band', Tm, bias, hours:24, members:20, seed, start } with fitted Tm/bias (required) and start either
//     { occ:Uint8Array(h*w) agent lattice (1 = cell), h, w }  -> coarse-grained by GRAIN, R from its t0 border reservoir
//     { rho:Float32Array(h*w) coarse density, h, w, R? }     -> used as is (R defaults to 0)
//   -> { type:'band', t_hours[0..hours], q05, q50, q95 } (wound_frac per hour from the start state), or { type:'band-error', error }
//   Independent of the draw engine (no 'init' needed).
import { Engine, GRAIN, reservoirMask } from './engine.js';
import { NCA, coarseGrain } from './nca.js';

let nca = null;

let eng = null, init = null, running = false, hpf = 0.5, timer = null;

function post() {
  const occ = eng.occ.slice();
  postMessage({ type: 'frame', w: eng.w, h: eng.h, occ, t_hours: eng.t_hours, wound_frac: eng.wound_frac }, [occ.buffer]);
}
function loop() {
  if (!running) return;
  const t0 = performance.now();
  eng.advance(hpf);
  post();
  timer = setTimeout(loop, Math.max(0, 33 - (performance.now() - t0)));
}
function band(m) {
  const st = m.start;
  if (!nca) return { type: 'band-error', error: 'send nca-load first' };
  if (!st || m.Tm == null || m.bias == null) return { type: 'band-error', error: 'band needs start and fitted Tm, bias' };
  let rho, R, h, w;
  if (st.occ) {
    const cg = coarseGrain(st.occ, st.h, st.w, GRAIN);
    ({ rho, h, w } = cg);
    R = coarseGrain(reservoirMask(st.occ, st.h, st.w), st.h, st.w, GRAIN).rho;
  } else { rho = st.rho; h = st.h; w = st.w; R = st.R || null; }
  const b = nca.band(rho, h, w, m.Tm, m.bias, m.hours || 24, { members: m.members || 20, seed: m.seed || 1, R });
  return { type: 'band', t_hours: b.t_hours, q05: b.q05, q50: b.q50, q95: b.q95 };
}
function stop() { running = false; clearTimeout(timer); timer = null; }
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { stop(); init = m; eng = new Engine(m); post(); return; }
  if (m.type === 'nca-load') { nca = new NCA(m.weights, m.opts); postMessage({ type: 'nca-ready' }); return; }
  if (m.type === 'band') { postMessage(band(m)); return; }
  if (!eng) return; // ignore everything else until init
  if (m.type === 'reset') { stop(); eng = new Engine(init); post(); }
  else if (m.type === 'preset') eng.setPreset(m.preset, m.params);
  else if (m.type === 'step') { eng.advance(m.hours || hpf); post(); }
  else if (m.type === 'run') { hpf = m.hoursPerFrame || hpf; if (!running) { running = true; loop(); } }
  else if (m.type === 'pause') stop();
};
