// node sim/js/heal_check.mjs -> 'run' with untilClosed: a follow-rule disc closes to exactly 0 and the worker reports
// closed; wounds that cannot close stop on the stall guard (no change for 12 simulated h) instead of running to the cap.
// Then the NCA closure helpers (nca.js isHealed / isStalled) on v2 and v1 rollouts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NCA, coarseGrain, isHealed, isStalled, meanRho } from './nca.js';
import { reservoirMask, PRESETS, PRESETS_FOLLOW } from './engine.js';
const W = 44, H = 32, frames = [];
globalThis.postMessage = (m) => frames.push(m); globalThis.onmessage = null; // worker globals
await import('./worker.js');
const run = (rule, inWound) => new Promise((done) => {
  const wound = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) wound[y * W + x] = inWound(x, y) ? 1 : 0;
  frames.length = 0;
  onmessage({ data: { type: 'init', w: W, h: H, wound, preset: 'CC', seed: 1, rule, smooth: false } });
  onmessage({ data: { type: 'run', hoursPerFrame: 1, untilClosed: true } });
  const wait = setInterval(() => { const f = frames.at(-1); if (f.stopped) { clearInterval(wait); done(f); } }, 5);
});
const t = (f) => `${f.t_hours.toFixed(1)} h, wound_frac ${f.wound_frac}, touches_edge ${f.touches_edge}`;

const disc = await run('follow', (x, y) => (x - 22) ** 2 + (y - 16) ** 2 < 81);
assert.equal(disc.stopped, 'closed'); assert.equal(disc.closed, true); assert.equal(disc.wound_frac, 0); assert.equal(disc.touches_edge, false);
assert.ok(disc.occ.every((v) => v === 1));
console.log(`follow disc r9: closed at ${t(disc)}`);

// whole border band empty -> no reservoir, no division: the cell count is conserved, so it can never close
const ring = await run('follow', (x, y) => x < 2 || y < 2 || x >= W - 2 || y >= H - 2);
assert.equal(ring.stopped, 'stalled'); assert.equal(ring.closed, false); assert.equal(ring.touches_edge, true);
assert.ok(Math.abs(ring.t_hours - 12) < 1e-6, `stall guard after 12 h, got ${ring.t_hours}`);
console.log(`follow, empty border band: stalled at ${t(ring)}`);

// wound at the left edge under the free rule: the gap at the border stays open (docs/sim.md boundary rule)
const edge = await run('free', (x, y) => (x - 2) ** 2 + (y - 16) ** 2 < 64);
assert.equal(edge.stopped, 'stalled'); assert.equal(edge.closed, false); assert.equal(edge.touches_edge, true);
assert.ok(edge.t_hours < 500 && edge.wound_frac > 0);
console.log(`free, disc at the left edge: stalled at ${t(edge)}`);

// the same edge wound under follow still closes (connected movers refill the border sites behind them)
const edgeF = await run('follow', (x, y) => (x - 2) ** 2 + (y - 16) ** 2 < 64);
assert.equal(edgeF.stopped, 'closed'); assert.equal(edgeF.touches_edge, true);
console.log(`follow, disc at the left edge: closed at ${t(edgeF)}`);

// without untilClosed the API is unchanged: no self-stop, frames carry closed but no stopped
frames.length = 0;
onmessage({ data: { type: 'run', hoursPerFrame: 1 } });
await new Promise((r) => setTimeout(r, 150));
onmessage({ data: { type: 'pause' } });
assert.ok(frames.length > 1 && frames.every((f) => f.closed && !f.stopped));

// NCA: run hourly frames until isHealed (every coarse cell rho >= 0.95) or isStalled (mean rho moved < 1e-4 in 12 h)
const SIM = new URL('../../web/public/sim/', import.meta.url), json = (f) => JSON.parse(readFileSync(new URL(f, SIM)));
const ncaRun = (net, p, inWound) => {
  const occ = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) occ[y * W + x] = inWound(x, y) ? 0 : 1;
  const cg = coarseGrain(occ, H, W, 2), R = coarseGrain(reservoirMask(occ, H, W), H, W, 2).rho;
  const fr = net.rollout(cg.rho, cg.h, cg.w, p.Tm, p.bias, 200, null, R), means = [];
  assert.equal(isHealed(fr[0]), false);
  for (let t = 0; t < fr.length; t++) {
    means.push(meanRho(fr[t]));
    if (isHealed(fr[t])) return { stopped: 'healed', t, mean: means[t], exact: fr[t].every((v) => v === 1) };
    if (isStalled(means)) return { stopped: 'stalled', t, mean: means[t] };
  }
  return { stopped: 'cap', t: fr.length - 1, mean: means.at(-1) };
};
const v2 = new NCA(json('nca_v2_weights.json'), json('nca_v2_weights.config.json')), v1 = new NCA(json('nca_weights.json'));
const n2 = ncaRun(v2, PRESETS_FOLLOW.CC, (x, y) => (x - 22) ** 2 + (y - 16) ** 2 < 81);
assert.equal(n2.stopped, 'healed'); assert.ok(n2.t < 60);
console.log(`NCA v2 disc r9: healed at ${n2.t} h, mean rho ${n2.mean.toFixed(5)}, exactly 1 everywhere: ${n2.exact}`);
// v1 (no source) with the whole border band empty: no reservoir, mass is conserved, so it never heals
const n1 = ncaRun(v1, PRESETS.CC, (x, y) => x < 2 || y < 2 || x >= W - 2 || y >= H - 2);
assert.equal(n1.stopped, 'stalled'); assert.equal(n1.t, 12);
console.log(`NCA v1, empty border band: stalled at ${n1.t} h, mean rho ${n1.mean.toFixed(5)}`);
assert.equal(isStalled([0.5, 0.6]), false); assert.equal(isStalled(new Array(13).fill(0.9)), true);
assert.equal(isHealed(Float32Array.of(1, 0.96)), true); assert.equal(isHealed(Float32Array.of(1, 0.75)), false);
console.log('OK');
