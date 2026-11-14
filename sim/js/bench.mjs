// node sim/js/bench.mjs  -> heals a drawn stripe on 160x160 (25.6k sites), reports sweeps/s
import { Engine } from './engine.js';
const w = 160, h = 160, wound = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 70; x < 90; x++) wound[y * w + x] = 1;
const e = new Engine({ w, h, wound, preset: 'CC' });
const a0 = e.woundSites(); const t0 = performance.now();
let s = 0; while (e.woundSites() > 0.1 * a0 && s < 2000) { e.step(); s++; }
console.log({ a0, left: e.woundSites(), sweeps: s, ms: (performance.now() - t0) | 0, cells: e.count });
