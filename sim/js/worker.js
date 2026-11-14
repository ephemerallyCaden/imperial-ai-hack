// Module Web Worker around Engine. Frame = same fields as cellsim npz: occ, t_hours, wound_frac.
//   const wk = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   wk.postMessage({ type:'init', w, h, wound:Uint8Array(w*h), preset:'CC'|'C61', seed });
//   wk.postMessage({ type:'run', hoursPerFrame: 0.5 });  // also 'pause','step','preset','reset'
//   wk.onmessage = e => e.data = { type:'frame', occ:Uint8Array(h*w), t_hours, wound_frac }
// NCA band (#28): { type:'nca-load', weights:<nca/weights.json object> } then
//   { type:'band', hours:24, members:20, Tm, bias } -> { type:'band', t_hours, q05, q50, q95 } (wound_frac)
//   band starts from the CURRENT agent grid, coarse-grained by 4 (cellsim grain); R = coarse-grained t0 reservoir.
import { Engine } from './engine.js';
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
function stop() { running = false; clearTimeout(timer); timer = null; }
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { stop(); init = m; eng = new Engine(m); post(); return; }
  if (m.type === 'nca-load') { nca = new NCA(m.weights, m.opts); postMessage({ type: 'nca-ready' }); return; }
  if (!eng) return; // ignore everything else until init
  if (m.type === 'reset') { stop(); eng = new Engine(init); post(); }
  else if (m.type === 'preset') eng.setPreset(m.preset, m.params);
  else if (m.type === 'step') { eng.advance(m.hours || hpf); post(); }
  else if (m.type === 'run') { hpf = m.hoursPerFrame || hpf; if (!running) { running = true; loop(); } }
  else if (m.type === 'band') {
    if (!nca) return;
    const cg = coarseGrain(eng.occ, eng.h, eng.w, 4), R = coarseGrain(eng.resMask, eng.h, eng.w, 4).rho;
    const b = nca.band(cg.rho, cg.h, cg.w, m.Tm ?? eng.p.Tm, m.bias ?? eng.p.bias, m.hours || 24, { members: m.members || 20, seed: m.seed || 1, R });
    postMessage({ type: 'band', t0_hours: eng.t_hours, t_hours: b.t_hours, q05: b.q05, q50: b.q50, q95: b.q95 });
  }
  else if (m.type === 'pause') { running = false; clearTimeout(timer); }
};
