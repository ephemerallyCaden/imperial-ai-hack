// Check for the live NCA worker (live.js): intact tissue is healed at t = 0; a carved disk opens cells, heals to
// isHealed (every coarse cell >= 0.95) and idles; carving while paused stays paused; reset restores intact tissue.
// Runs the worker module in node with postMessage / fetch stubbed.   node sim/js/live_check.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { PRESETS_FOLLOW } from './engine.js';

const out = [];
globalThis.postMessage = (m) => out.push(m); globalThis.onmessage = null;
const PUB = new URL('../../web/public/sim/', import.meta.url);   // weights live next to the browser copy
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(readFileSync(fileURLToPath(new URL(String(u).split('/').pop(), PUB)))) });
const { HEAL_RHO } = await import('./live.js');
const { isHealed, isStalled } = await import('./nca.js');
const send = (data) => globalThis.onmessage({ data });
const last = () => out.filter((m) => m.type === 'state').at(-1);
const until = async (f, ms = 60000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
let fails = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };

ok(isHealed(new Float32Array(4).fill(0.951)) && !isHealed(Float32Array.from([1, 0.94])), 'isHealed threshold 0.95');
ok(isStalled(new Array(13).fill(0.5)) && !isStalled(new Array(12).fill(0.5)) && !isStalled([...new Array(12).fill(0.5), 0.5002]), 'isStalled: 12 h window, eps 1e-4');
for (const p of ['CC', 'C61']) {
  out.length = 0;
  await send({ type: 'load', Tm: PRESETS_FOLLOW[p].Tm, bias: PRESETS_FOLLOW[p].bias, hoursPerSec: 400 });
  const ready = out.find((m) => m.type === 'live-ready');
  ok(ready && ready.h === 16 && ready.w === 22, `${p}: live-ready on the 16x22 WHAD grid`);
  send({ type: 'play' }); ok(last().status === 'healed' && last().t_hours === 0, `${p}: intact tissue is healed at t = 0`);
  const cells = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 22; x++) if ((x - 10.5) ** 2 + (y - 7.5) ** 2 < 16) cells.push(y * 22 + x);
  send({ type: 'pause' }); send({ type: 'carve', cells });
  ok(last().status === 'paused' && cells.every((i) => last().rho[i] === 0) && last().open_frac > 0, `${p}: carve while paused sets density 0 in ${cells.length} cells and stays paused`);
  send({ type: 'play' }); ok(last().status !== 'healed', `${p}: play restarts healing`);
  const t0 = performance.now();
  await until(() => ['healed', 'stalled', 'cap'].includes(last().status));
  const s = last(), dt = s.t_hours - s.t_cut;
  ok(s.status === 'healed' && s.min_rho >= HEAL_RHO && s.open_frac === 0, `${p}: healed to closure, min density ${s.min_rho.toFixed(3)}`);
  ok(dt > 10 && dt < 60, `${p}: ${dt.toFixed(1)} simulated h from cut to healed (${(performance.now() - t0).toFixed(0)} ms wall at 400 h/s)`);
  send({ type: 'carve', cells: [5 * 22 + 5] }); await until(() => last().t_hours > s.t_hours);
  ok(last().t_cut === s.t_hours, `${p}: a new cut after healing restarts the run (t_cut ${last().t_cut})`);
  await until(() => last().status === 'healed');
  send({ type: 'reset' }); ok(last().t_hours === 0 && last().open_frac === 0 && last().t_cut === null, `${p}: reset to intact tissue`);
}
console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);
