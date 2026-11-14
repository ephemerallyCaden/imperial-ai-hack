// Draw-tool engine: JS port of sim/cellsim.py (rules in docs/sim.md on feature/p2-agent1).
// Same semantics: parallel update per dt=0.1 h step, Moore 8-neighbourhood, density-dependent
// migration dt/Tm*rho^dens_exp, division dt/Td (Td=null: off), wound bias = up the gradient of
// blurred emptiness (radius blur), random-priority conflicts, reservoir band `edge` at borders.
// Grid: Uint8Array(h*w) row-major, 1 = cell. Frame = { occ, t_hours, wound_frac } (same as npz keys).
// Presets are PLACEHOLDERS until #23 (fit Tm/bias per wound) lands.

export const PRESETS = {
  CC: { Tm: 1.0, Td: 20, bias: 7 / 9 },
  C61: { Tm: 2.0, Td: 20, bias: 7 / 9 },
};
const DEFAULTS = { Td: null, bias: 7 / 9, dens_exp: 0.5, dt: 0.1, blur: 6, edge: 2 };

const NY = [-1, -1, -1, 0, 0, 1, 1, 1];
const NX = [-1, 0, 1, -1, 1, -1, 0, 1];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
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
    this._refill();
    this.g = new Float32Array(w * h);
    this.cum = new Float32Array((w + 1) * (h + 1));
    this.best = new Float64Array(w * h);
  }

  setPreset(name, override) {
    this.p = { ...DEFAULTS, ...(PRESETS[name] || PRESETS.CC), ...(override || {}) };
  }

  _refill() {
    const { w, h, occ } = this, e = this.p.edge;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (y < e || y >= h - e || x < e || x >= w - e) occ[y * w + x] = 1;
  }

  // blurred emptiness: box mean over (2r+1)^2, edge-replicated (clamped), via integral image
  _blur() {
    const { w, h, occ, g, cum } = this, r = this.p.blur, k = 2 * r + 1, W1 = w + 1;
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += occ[y * w + x] ? 0 : 1;
        cum[(y + 1) * W1 + x + 1] = cum[y * W1 + x + 1] + row;
      }
    }
    const S = (y0, x0, y1, x1) => cum[y1 * W1 + x1] - cum[y0 * W1 + x1] - cum[y1 * W1 + x0] + cum[y0 * W1 + x0];
    // replicate edges by clamping window and weighting: approximate with clamped window mean
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        g[y * w + x] = S(y0, x0, y1, x1) / ((y1 - y0) * (x1 - x0));
      }
    }
    return k;
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
