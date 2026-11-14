// Draw-tool engine: JS port of sim/cellsim.py (rules in docs/sim.md on feature/p2-agent1).
// Same semantics: parallel update per dt=0.1 h step, Moore 8-neighbourhood, density-dependent
// migration dt/Tm*rho^dens_exp, division dt/Td (Td=null: off), wound bias = up the gradient of
// blurred emptiness (radius blur), random-priority conflicts, reservoir band `edge` at borders.
// Grid: Uint8Array(h*w) row-major, 1 = cell. Frame = { occ, t_hours, wound_frac } (same as npz keys).
// Presets = sim/fits/whad_fits.json presets.draw_tool (Agent 1, 98dae8b refit): median fit over all WHAD positions
// at t0 = 10, division off. Draw tool only (label "simulation, preset parameters"), never for scoring.
export const PRESET_LABEL = 'simulation, preset parameters';
export const PRESETS = {
  CC: { Tm: 0.9484537290187908, Td: null, bias: 0.25 }, // n = 7
  C61: { Tm: 1.051866168904568, Td: null, bias: 0.38290860479362177 }, // n = 6
};
export const DT = 0.05; // hours per step, = cellsim.DT
export const SITE_UM = 20; // um per lattice site (one site = one cell), = cellsim.SITE_UM; WHAD field = 32x44 sites
export const FIELD_H = 32, FIELD_W = 44; // draw tool is locked to the WHAD field (presets were fitted at this size)
export const GRAIN = 2; // coarse-grain factor, = cellsim.GRAIN (WHAD: 32x44 lattice -> 16x22 density)
const DEFAULTS = { Td: null, bias: 7 / 9, dens_exp: 0.5, dt: DT, blur: 6, edge: 2 };

const NY = [-1, -1, -1, 0, 0, 1, 1, 1];
const NX = [-1, 0, 1, -1, 1, -1, 0, 1];

// splitmix32 hash of the seed so nearby seeds (0, 1, 2...) give uncorrelated streams
export function hashSeed(seed) {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0 || 1;
}
function rng(seed) {
  let s = hashSeed(seed);
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// cellsim.reservoir_mask: border-band sites (width edge) occupied at t0. occ: Uint8Array(h*w), 1 = cell.
export function reservoirMask(occ, h, w, edge = DEFAULTS.edge) {
  const m = new Uint8Array(h * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if ((y < edge || y >= h - edge || x < edge || x >= w - edge) && occ[i]) m[i] = 1;
  }
  return m;
}

export class Engine {
  // wound: Uint8Array(w*h), 1 = drawn wound (empty); everything else starts as cells.
  constructor({ w, h, wound, preset = 'CC', params = null, seed = 1 }) {
    this.w = w; this.h = h;
    this.occ = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) this.occ[i] = wound[i] ? 0 : 1;
    this.rand = rng(seed);
    this.t_hours = 0;
    this.setPreset(preset, params);
    // reservoir = border-band sites occupied at t0 (cellsim.reservoir_mask): a wound touching the edge stays open
    this.resMask = reservoirMask(this.occ, h, w, this.p.edge);
    this.res = [];
    for (let i = 0; i < w * h; i++) if (this.resMask[i]) this.res.push(i);
    this._refill();
    this.g = new Float32Array(w * h);
    const R = this.p.blur;
    this.cum = new Float64Array((w + 2 * R + 1) * (h + 2 * R + 1));
    this.best = new Float64Array(w * h);
  }

  setPreset(name, override) {
    this.p = { ...DEFAULTS, ...(PRESETS[name] || PRESETS.CC), ...(override || {}) };
  }

  _refill() {
    const { occ, res } = this;
    for (let k = 0; k < res.length; k++) occ[res[k]] = 1;
  }

  // blurred emptiness: (2r+1)^2 box mean, edge-replicated (= cellsim.box_mean), via integral image of padded array
  _blur() {
    const { w, h, occ, g, cum } = this, r = this.p.blur, k = 2 * r + 1, PW = w + 2 * r, W1 = PW + 1;
    for (let py = 0; py < h + 2 * r; py++) {
      const y = Math.min(h - 1, Math.max(0, py - r));
      let row = 0;
      for (let px = 0; px < PW; px++) {
        const x = Math.min(w - 1, Math.max(0, px - r));
        row += occ[y * w + x] ? 0 : 1;
        cum[(py + 1) * W1 + px + 1] = cum[py * W1 + px + 1] + row;
      }
    }
    const kk = k * k;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      g[y * w + x] = (cum[(y + k) * W1 + x + k] - cum[y * W1 + x + k] - cum[(y + k) * W1 + x] + cum[y * W1 + x]) / kk;
  }

  step() {
    const { w, h, occ, g, best, rand } = this, p = this.p;
    this._blur();
    const pdv = p.Td == null ? 0 : Math.min(1, p.dt / p.Td), pmb = Math.min(1, p.dt / p.Tm);
    const srcs = [], tgts = [], moves = [], keys = [];
    best.fill(2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!occ[i]) continue;
        // rho_local: occupied fraction of 3x3 block (edge-replicated -> clamp coords)
        let s = 0;
        for (let k = 0; k < 9; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + ((k / 3) | 0) - 1)), xx = Math.min(w - 1, Math.max(0, x + (k % 3) - 1));
          s += occ[yy * w + xx];
        }
        const pm = pmb * Math.pow(s / 9, p.dens_exp);
        const u = rand();
        const move = u < pm, div = !move && u < pm + pdv;
        if (!move && !div) continue;
        // central-difference gradient of g (np.gradient: one-sided at borders)
        const yl = y > 0 ? y - 1 : y, yr = y < h - 1 ? y + 1 : y, xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        const gy = (g[yr * w + x] - g[yl * w + x]) / (yr - yl || 1);
        const gx = (g[y * w + xr] - g[y * w + xl]) / (xr - xl || 1);
        const useBias = rand() < p.bias;
        let bk = -1, bs = -1;
        for (let k = 0; k < 8; k++) {
          const ny = y + NY[k], nx = x + NX[k];
          if (ny < 0 || ny >= h || nx < 0 || nx >= w || occ[ny * w + nx]) continue;
          const sc = rand() + (useBias && NY[k] * gy + NX[k] * gx > 0 ? 2 : 0);
          if (sc > bs) { bs = sc; bk = k; }
        }
        if (bk < 0) continue; // contact inhibited
        const t = (y + NY[bk]) * w + x + NX[bk], key = rand();
        if (key < best[t]) best[t] = key;
        srcs.push(i); tgts.push(t); moves.push(move); keys.push(key);
      }
    }
    for (let a = 0; a < srcs.length; a++) {
      if (keys[a] !== best[tgts[a]]) continue; // lost the conflict
      occ[tgts[a]] = 1;
      if (moves[a]) occ[srcs[a]] = 0;
    }
    this._refill();
    this.t_hours += p.dt;
  }

  // advance `hours` of simulated time (default 1 h = one recorded frame in cellsim)
  advance(hours = 1) {
    const n = Math.max(1, Math.round(hours / this.p.dt));
    for (let i = 0; i < n; i++) this.step();
  }

  get wound_frac() {
    let c = 0; for (let i = 0; i < this.occ.length; i++) c += this.occ[i];
    return 1 - c / this.occ.length;
  }
}
