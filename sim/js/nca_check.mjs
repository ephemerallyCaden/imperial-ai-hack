// node sim/js/nca_check.mjs weights.json ref.json -> max abs diff of JS rollout vs reference frames
import { readFileSync } from 'node:fs';
import { NCA } from './nca.js';
const wt = JSON.parse(readFileSync(process.argv[2])), ref = JSON.parse(readFileSync(process.argv[3]));
const net = new NCA(wt);
const t0 = performance.now();
const fr = net.rollout(ref.frames[0], ref.h, ref.w, ref.Tm, ref.bias, ref.frames.length - 1);
const ms = performance.now() - t0;
let d = 0; fr.forEach((f, t) => f.forEach((v, i) => { d = Math.max(d, Math.abs(v - ref.frames[t][i])); }));
const wf = fr.map((a) => +(1 - a.reduce((s, v) => s + v, 0) / a.length).toFixed(4));
console.log({ maxAbsDiff: d, msPerHour: +(ms / (fr.length - 1)).toFixed(1), wound_frac: wf.join(' ') });
const b = net.band(ref.frames[0], ref.h, ref.w, ref.Tm, ref.bias, 24, { members: 20 });
console.log('band q05/q50/q95 @24h:', b.q05[24].toFixed(4), b.q50[24].toFixed(4), b.q95[24].toFixed(4));
