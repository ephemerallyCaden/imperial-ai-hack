// node sim/js/parity.mjs [Tm] [seeds] [free|follow] -> mean/sd wound_frac at 4/12/24 h on cellsim.straight_scratch (120x160, width 30)
// Compare with the same stats from sim/cellsim.py (RNGs differ, so parity is statistical).
import { Engine } from './engine.js';
const Tm = +(process.argv[2] || 0.1), n = +(process.argv[3] || 20), rule = process.argv[4] || 'free', h = 120, w = 160, sw = 30, T = [4, 12, 24];
const wound = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = w / 2 - sw / 2; x < w / 2 + sw / 2; x++) wound[y * w + x] = 1;
const rows = [], t0 = performance.now();
for (let s = 0; s < n; s++) {
  // params = cellsim.Params defaults (bias 7/9, division off), not a draw preset
  const e = new Engine({ w, h, wound, params: { Tm, bias: 7 / 9, Td: null }, seed: s, rule }), r = [];
  for (let t = 1; t <= 24; t++) { e.advance(1); if (T.includes(t)) r.push(e.wound_frac); }
  rows.push(r);
}
const st = T.map((_, j) => { const c = rows.map((r) => r[j]), m = c.reduce((a, b) => a + b) / n;
  return `${m.toFixed(4)}±${Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)).toFixed(4)}`; });
console.log(`JS  ${rule} Tm=${Tm} n=${n} @4/12/24h:`, st.join(' '), `(${((performance.now() - t0) / n) | 0} ms/run)`);
