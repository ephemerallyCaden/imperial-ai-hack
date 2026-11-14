// Web Worker wrapper. Usage (module worker):
//   const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'init', w: 200, h: 200, wound: Uint8Array, preset: 'CC', seed: 1 });
//   w.postMessage({ type: 'run', stepsPerFrame: 1 });  // 'pause', 'step', 'preset', 'reset'
//   w.onmessage = e => e.data: { type:'frame', step, grid:Uint8Array, count, woundSites }
import { Engine } from './engine.js';

let eng = null, init = null, running = false, spf = 1, timer = null;

function post() {
  const grid = eng.grid.slice();
  postMessage({ type: 'frame', step: eng.step_, grid, count: eng.count, woundSites: eng.woundSites() }, [grid.buffer]);
}
function loop() {
  if (!running) return;
  const t0 = performance.now();
  for (let i = 0; i < spf; i++) eng.step();
  post();
  // yield so pause/preset messages get processed; adapt to keep ~30 fps cap
  timer = setTimeout(loop, Math.max(0, 33 - (performance.now() - t0)));
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { init = m; eng = new Engine(m); running = false; post(); }
  else if (m.type === 'reset') { eng = new Engine(init); post(); }
  else if (m.type === 'preset') eng.setPreset(m.preset, m.params);
  else if (m.type === 'step') { eng.step(); post(); }
  else if (m.type === 'run') { spf = m.stepsPerFrame || 1; if (!running) { running = true; loop(); } }
  else if (m.type === 'pause') { running = false; clearTimeout(timer); }
};
