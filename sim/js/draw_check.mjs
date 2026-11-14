// node sim/js/draw_check.mjs -> heal a drawn disc on a WHAD-sized 32x44 lattice (20 um sites) with each preset
import { Engine, PRESETS } from './engine.js';
const w = 44, h = 32, wound = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) wound[y * w + x] = (x - 22) ** 2 + (y - 16) ** 2 < 81 ? 1 : 0;
for (const name of Object.keys(PRESETS)) {
  const out = [], t0 = performance.now();
  for (let s = 0; s < 10; s++) {
    const e = new Engine({ w, h, wound, preset: name, seed: s }), r = [];
    for (let t = 1; t <= 24; t++) { e.advance(1); if (t % 6 === 0) r.push(e.wound_frac); }
    out.push(r);
  }
  const m = out[0].map((_, j) => (out.reduce((a, r) => a + r[j], 0) / out.length).toFixed(3));
  console.log(`${name}: wound_frac @6/12/18/24h ${m.join(' ')} (${((performance.now() - t0) / 10).toFixed(0)} ms per 24 h run)`);
}
