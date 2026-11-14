// node sim/js/band_check.mjs weights.json case.json [members] -> NCA band from a real WHAD start state vs observed curve
import { readFileSync } from 'node:fs';
import { NCA, coarseGrain } from './nca.js';
import { reservoirMask, GRAIN } from './engine.js';
const net = new NCA(JSON.parse(readFileSync(process.argv[2]))), c = JSON.parse(readFileSync(process.argv[3]));
const members = +(process.argv[4] || 50), hours = Math.ceil(c.observed.at(-1)[0]);
const cg = coarseGrain(c.occ, c.h, c.w, GRAIN), R = coarseGrain(reservoirMask(c.occ, c.h, c.w), c.h, c.w, GRAIN).rho;
const t0 = performance.now();
const b = net.band(cg.rho, cg.h, cg.w, c.Tm, c.bias, hours, { members, R, params: c.params });
const ms = performance.now() - t0;
let inside = 0, n = 0;
console.log(`${c.position} cut ${c.cutoff} (frame ${c.frame}) ${c.h}x${c.w}, ${members} members, ${c.params ? c.params.length + ' fit members' : 'point fit'}, ${ms | 0} ms`);
console.log('  dt_h  observed   q05    q50    q95');
for (const [dt, y] of c.observed) {
  const k = Math.round(dt); if (k > hours) continue;
  const ok = y >= b.q05[k] - 1e-4 && y <= b.q95[k] + 1e-4; if (k > 0) { n++; inside += ok; }
  console.log(`  ${String(k).padStart(4)}  ${y.toFixed(4)}   ${b.q05[k].toFixed(4)} ${b.q50[k].toFixed(4)} ${b.q95[k].toFixed(4)} ${ok ? '' : ' <- outside'}`);
}
console.log(`  inside 90% band: ${inside}/${n}`);
