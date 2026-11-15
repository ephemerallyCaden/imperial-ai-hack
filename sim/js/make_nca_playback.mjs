// NCA playback (#29, NCA half): roll the NCA from a real WHAD start state and write a density-only playback file in
// Agent 4's format (sim/export_playback.py; no agents key) so the viewer can show NCA vs sim vs data on one wound.
//   python3 sim/js/band_check.py <agent1 root> <position> <cutoff> case.json
//   node sim/js/make_nca_playback.mjs weights.json case.json out.json [members=50] [weights.config.json (v2)]
// Frames: deterministic rollout (stochastic=false) with the point fit (Tm, bias), one frame per NCA substep (1/K h),
// from the cut-off start state to the last observed time. meta.band: raw ensemble quantiles (fit members x NCA noise),
// NOT calibrated (see docs/p2-handoff.md); members = 0 writes no band.
// Assay 3D cases (sim/js/assay_nca_case.py): the case gives a coarse start `rho` + `R` (h, w still the lattice size)
// instead of the `occ` lattice, and
// `until_healed`, so the rollout runs until healed / stalled / max_hours (nca.js rolloutUntilHealed) instead of to the
// last observed time.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NCA, coarseGrain, rolloutUntilHealed } from './nca.js';
import { reservoirMask, GRAIN } from './engine.js';

const [wPath, cPath, out, mArg, cfgPath] = process.argv.slice(2);
const cfg = cfgPath ? JSON.parse(readFileSync(cfgPath)) : undefined;
const wRaw = readFileSync(wPath), net = new NCA(JSON.parse(wRaw), cfg), c = JSON.parse(readFileSync(cPath));
const wRule = cfg && cfg.follow ? 'follow' : 'free';
if (c.fits && wRule !== c.fits.rule) throw new Error(`weights rule ${wRule} != fits rule ${c.fits.rule}: pass the matching weights.config.json / fits file`);
const members = +(mArg ?? 50);
// coarse start: given (Assay case: rho + R on the coarse grid) or coarse-grained from the occ lattice
const cg = c.rho ? { rho: Float32Array.from(c.rho), h: c.h / GRAIN, w: c.w / GRAIN } : coarseGrain(c.occ, c.h, c.w, GRAIN);
const R = c.rho ? Float32Array.from(c.R) : coarseGrain(reservoirMask(c.occ, c.h, c.w), c.h, c.w, GRAIN).rho;

// deterministic rollout, recording every substep: until healed / stalled / max_hours, or (no early stop) to the last
// observed time
const r = rolloutUntilHealed(net, cg.rho, R, cg.h, cg.w, c.Tm, c.bias, c.until_healed ? { maxH: c.max_hours ?? 200 }
  : { maxH: Math.round(c.observed_all.t_hours.at(-1) - c.t_start), minRho: Infinity, stallH: Infinity });
const frames = r.frames, t = r.t.map((x) => c.t_start + x), stopped = c.until_healed ? r.stopped : null, hours = Math.ceil(r.t.at(-1));
const mean = (a) => a.reduce((x, v) => x + v, 0) / a.length;
const b64 = (f) => Buffer.from(Uint8Array.from(f, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))).toString('base64');
const band = members > 0 ? net.band(cg.rho, cg.h, cg.w, c.Tm, c.bias, hours, { members, R, params: c.params }) : null;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const pb = {
  name: out.split('/').pop().replace(/\.json$/, ''), H: c.h, W: c.w, grain: GRAIN,
  t_hours: t.map((x) => Math.round(x * 1000) / 1000),
  wound_frac: frames.map((f) => Math.round((1 - mean(f)) * 1e5) / 1e5),
  density: { h: cg.h, w: cg.w, frames: frames.map(b64) },
  meta: {
    model: 'nca', version: cfg ? cfg.version : 'v1', rule: cfg && cfg.follow ? 'follow' : 'free', fits: c.fits,
    mode: 'deterministic rollout (no noise), point fit', position: c.position,
    cutoff_hours: c.cutoff, start_frame: c.frame, t_start: c.t_start, Tm: c.Tm, bias: c.bias,
    fit: `${c.fits ? c.fits.file : 'sim/fits/whad_fits.json'} fits[position][cutoff] (Agent 1; frames <= cutoff only)`,
    weights: { file: cfg ? 'nca/v2/weights.json' : 'nca/weights.json', sha256_12: createHash('sha256').update(wRaw).digest('hex').slice(0, 12) },
    start: c.start_source || 'observed mask at the last frame <= cutoff -> 32x44 lattice (start_state.mask_to_lattice) -> density, grain 2',
    ...(stopped ? { stopped, until: 'healed (every coarse cell >= 0.95), stalled (hourly mean density moved < 1e-4 over 12 h) or max_hours' } : {}),
    ...(band ? { band: { calibrated: false, note: 'raw NCA ensemble spread: fit bootstrap members x NCA noise; NOT a 90% interval',
            members, t_hours: band.t_hours.map((k) => c.t_start + k), q05: band.q05.map(r4), q50: band.q50.map(r4), q95: band.q95.map(r4) } } : {}),
    observed: c.observed_all,
  },
};
writeFileSync(out, JSON.stringify(pb));
console.log(`${out}: ${frames.length} frames ${t[0]}-${t.at(-1)} h${stopped ? ` (${stopped})` : ''}, wound_frac ${pb.wound_frac[0]} -> ${pb.wound_frac.at(-1)}, ${(JSON.stringify(pb).length / 1024) | 0} KB`);
