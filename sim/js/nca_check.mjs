// node sim/js/nca_check.mjs weights.json ref.json -> max abs diff of JS rollout vs reference frames
import { readFileSync } from 'node:fs';
import { NCA } from './nca.js';
const wt = JSON.parse(readFileSync(process.argv[2])), ref = JSON.parse(readFileSync(process.argv[3]));
// config: 3rd arg (weights.config.json), else the one embedded by nca_torch_ref.py, else v1 defaults
const cfg = process.argv[4] ? JSON.parse(readFileSync(process.argv[4])) : ref.config || undefined;
const net = new NCA(wt, cfg);
for (const c of ref.cases || []) { // v2-aware reference: several (Tm, bias) incl. high and out-of-range Tm
  const fr = net.rollout(ref.frames[0], ref.h, ref.w, c.Tm, c.bias, c.frames.length - 1, null, Float32Array.from(ref.R));
  let d = 0; fr.forEach((f, t) => f.forEach((v, i) => { d = Math.max(d, Math.abs(v - c.frames[t][i])); }));
  console.log(`case Tm=${c.Tm} bias=${c.bias.toFixed(3)} (${cfg ? cfg.version : 'v1'}): maxAbsDiff ${d.toExponential(2)}`);
}
const t0 = performance.now();
const fr = net.rollout(ref.frames[0], ref.h, ref.w, ref.Tm, ref.bias, ref.frames.length - 1, null, Float32Array.from(ref.R || []));
const ms = performance.now() - t0;
let d = 0; fr.forEach((f, t) => f.forEach((v, i) => { d = Math.max(d, Math.abs(v - ref.frames[t][i])); }));
const wf = fr.map((a) => +(1 - a.reduce((s, v) => s + v, 0) / a.length).toFixed(4));
const m0 = fr[0].reduce((a, v) => a + v, 0), m1 = fr[fr.length - 1].reduce((a, v) => a + v, 0);
console.log({ maxAbsDiff: d, minRho: Math.min(...fr.flatMap((f) => [...f])), maxRho: Math.max(...fr.flatMap((f) => [...f])), massChange: +(m1 - m0).toFixed(4), msPerHour: +(ms / (fr.length - 1)).toFixed(1), wound_frac: wf.join(' ') });
const b = net.band(ref.frames[0], ref.h, ref.w, ref.Tm, ref.bias, 24, { members: 20, R: Float32Array.from(ref.R) });
console.log('band q05/q50/q95 @24h:', b.q05[24].toFixed(4), b.q50[24].toFixed(4), b.q95[24].toFixed(4));
