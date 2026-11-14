// node sim/js/bench.mjs -> straight scratch 120x160 like cellsim.straight_scratch, and a 150x150 (22k) run
import { Engine } from './engine.js';
for (const [h, w, sw, Td] of [[120, 160, 30, null], [150, 150, 30, 20]]) {
  const wound = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = w / 2 - sw / 2; x < w / 2 + sw / 2; x++) wound[y * w + x] = 1;
  const e = new Engine({ w, h, wound, preset: 'CC', params: { Tm: 0.1, Td } });
  const t0 = performance.now(), out = [];
  for (let k = 0; k < 24; k++) { e.advance(1); if (k % 4 === 3) out.push(+e.wound_frac.toFixed(3)); }
  console.log(`${w}x${h} Td=${Td}: ${(performance.now() - t0) | 0} ms/24h`, out.join(' '));
}
