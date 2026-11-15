// Spot-check for #117: mean edge speed x perimeter ~ -dA/dt on one recorded wound (sim playback, follow rule).
//   node web/edge/check_edge.mjs [step_frames]
import { readFileSync } from 'node:fs';
import { viewFrame } from '../public/sim/js/playback.js';
import { edgeSpeed, stallSpeed } from './edge_speed.js';
const pb = JSON.parse(readFileSync(new URL('../public/sim/whad_partII_C61_P2_sim38_follow.json', import.meta.url)));
const step = +(process.argv[2] || 20), SITE_UM = 20;
const mask = (f) => { const { fine, outline } = viewFrame(pb, f), m = new Uint8Array(fine.h * fine.w);
  for (let i = 0; i < m.length; i++) m[i] = outline.level != null && fine.data[i] / 255 < outline.level ? 1 : 0;
  return { m, h: fine.h, w: fine.w, um: SITE_UM / fine.scale }; };
console.log('t_h   mean_um_h  perim_um  vP_um2_h  -dA/dt_um2_h  ratio  slowest(x,y,v)');
const rat = [];
for (let f = step; f < pb.t_hours.length; f += step) {
  const a = mask(f - step), b = mask(f), dt = pb.t_hours[f] - pb.t_hours[f - step];
  const e = edgeSpeed(a.m, b.m, b.h, b.w, dt, b.um);
  let A0 = 0; for (const x of a.m) A0 += x; A0 *= a.um ** 2;
  const dA = (A0 - e.areaUm2) / dt, vp = e.meanUmH * e.perimeterUm;
  if (e.sites.length) rat.push(vp / dA);
  console.log(pb.t_hours[f].toFixed(1).padEnd(5), (e.meanUmH ?? 0).toFixed(2).padStart(9), e.perimeterUm.toFixed(0).padStart(9),
    vp.toFixed(0).padStart(9), dA.toFixed(0).padStart(12), (vp / dA).toFixed(2).padStart(6), e.slowest ? `${e.slowest.x},${e.slowest.y},${e.slowest.v.toFixed(1)}` : '-');
}
const s = rat.slice().sort((x, y) => x - y);
console.log('median ratio vP / (-dA/dt):', s[s.length >> 1].toFixed(2), `(n=${s.length})`);
const c = mask(pb.t_hours.findIndex((t) => t >= 3.8)); const e0 = edgeSpeed(c.m, c.m, c.h, c.w, 1, c.um);
console.log('stall pace at 3.8 h (10% of the cut-off area by 19 h):', stallSpeed(e0.areaUm2, e0.perimeterUm, 3.8, 19).toFixed(2), 'um/h');
