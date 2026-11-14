// NCA playback (#29, NCA half): roll the NCA from a real WHAD start state and write a density-only playback file in
// Agent 4's format (sim/export_playback.py; no agents key) so the viewer can show NCA vs sim vs data on one wound.
//   python3 sim/js/band_check.py <agent1 root> <position> <cutoff> case.json
//   node sim/js/make_nca_playback.mjs weights.json case.json out.json [members=50]
// Frames: deterministic rollout (stochastic=false) with the point fit (Tm, bias), one frame per NCA substep (1/K h),
// from the cut-off start state to the last observed time. meta.band: raw ensemble quantiles (fit members x NCA noise),
// NOT calibrated (see docs/p2-handoff.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NCA, coarseGrain, normParams } from './nca.js';
import { reservoirMask, GRAIN } from './engine.js';

const [wPath, cPath, out, mArg] = process.argv.slice(2);
const wRaw = readFileSync(wPath), net = new NCA(JSON.parse(wRaw)), c = JSON.parse(readFileSync(cPath));
const members = +(mArg || 50), hours = Math.round(c.observed_all.t_hours.at(-1) - c.t_start);
const cg = coarseGrain(c.occ, c.h, c.w, GRAIN), R = coarseGrain(reservoirMask(c.occ, c.h, c.w), c.h, c.w, GRAIN).rho;
const hw = cg.h * cg.w, par = normParams(c.Tm, c.bias);

// deterministic rollout, recording every substep
let rho = new Float32Array(hw), hid = new Float32Array(net.nh * hw);
for (let i = 0; i < hw; i++) rho[i] = Math.max(cg.rho[i], R[i]);
const frames = [Float32Array.from(rho)], t = [c.t_start];
for (let s = 1; s <= hours * net.K; s++) {
  [rho, hid] = net.step(rho, R, hid, par, cg.h, cg.w, null);
  frames.push(Float32Array.from(rho)); t.push(c.t_start + s / net.K);
}
const mean = (a) => a.reduce((x, v) => x + v, 0) / a.length;
const b64 = (f) => Buffer.from(Uint8Array.from(f, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))).toString('base64');
const band = net.band(cg.rho, cg.h, cg.w, c.Tm, c.bias, hours, { members, R, params: c.params });
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const pb = {
  name: out.split('/').pop().replace(/\.json$/, ''), H: c.h, W: c.w, grain: GRAIN,
  t_hours: t.map((x) => Math.round(x * 1000) / 1000),
  wound_frac: frames.map((f) => Math.round((1 - mean(f)) * 1e5) / 1e5),
  density: { h: cg.h, w: cg.w, frames: frames.map(b64) },
  meta: {
    model: 'nca', mode: 'deterministic rollout (no noise), point fit', position: c.position,
    cutoff_hours: c.cutoff, start_frame: c.frame, t_start: c.t_start, Tm: c.Tm, bias: c.bias,
    fit: 'sim/fits/whad_fits.json fits[position][cutoff] (Agent 1; frames <= cutoff only)',
    weights: { file: 'nca/weights.json', sha256_12: createHash('sha256').update(wRaw).digest('hex').slice(0, 12) },
    start: 'observed mask at the last frame <= cutoff -> 32x44 lattice (start_state.mask_to_lattice) -> density, grain 2',
    band: { calibrated: false, note: 'raw NCA ensemble spread: fit bootstrap members x NCA noise; NOT a 90% interval',
            members, t_hours: band.t_hours.map((k) => c.t_start + k), q05: band.q05.map(r4), q50: band.q50.map(r4), q95: band.q95.map(r4) },
    observed: c.observed_all,
  },
};
writeFileSync(out, JSON.stringify(pb));
console.log(`${out}: ${frames.length} frames ${t[0]}-${t.at(-1)} h, ${(JSON.stringify(pb).length / 1024) | 0} KB`);
