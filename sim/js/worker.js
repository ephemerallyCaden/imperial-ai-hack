// Module Web Worker around Engine. Frame = same fields as cellsim npz: occ, t_hours, wound_frac.
//   const wk = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   wk.postMessage({ type:'init', w, h, wound:Uint8Array(w*h), preset:'CC'|'C61', seed });
//   wk.postMessage({ type:'run', hoursPerFrame: 0.5 });  // also 'pause','step','preset','reset'
//   wk.onmessage = e => e.data = { type:'frame', occ:Uint8Array(h*w), t_hours, wound_frac }
import { Engine } from './engine.js';

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
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { init = m; eng = new Engine(m); running = false; post(); }
  else if (m.type === 'reset') { eng = new Engine(init); post(); }
  else if (m.type === 'preset') eng.setPreset(m.preset, m.params);
  else if (m.type === 'step') { eng.advance(m.hours || hpf); post(); }
  else if (m.type === 'run') { hpf = m.hoursPerFrame || hpf; if (!running) { running = true; loop(); } }
  else if (m.type === 'pause') { running = false; clearTimeout(timer); }
};
