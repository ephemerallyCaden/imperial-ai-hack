// Draw-tool engine: JS port of sim/cellsim.py (rules in docs/sim.md on feature/p2-agent1).
// Same semantics: parallel update per dt=0.1 h step, Moore 8-neighbourhood, density-dependent
// migration dt/Tm*rho^dens_exp, division dt/Td (Td=null: off), wound bias = up the gradient of
// blurred emptiness (radius blur), random-priority conflicts, reservoir band `edge` at borders.
// Grid: Uint8Array(h*w) row-major, 1 = cell. Frame = { occ, t_hours, wound_frac } (same as npz keys).
// Presets = sim/fits/whad_fits.json presets.draw_tool (Agent 1, aed3174): median of WHAD part II fits at cut-off 9.5 h
// (manual + auto), division off. Draw tool only, never for scoring. Label = presets.draw_tool.label.
export const PRESET_LABEL = 'simulation, preset parameters (WHAD part II fits)';
export const PRESETS = {
  CC: { Tm: 0.4815544732805177, Td: null, bias: 0.25 }, // n 7 (4 manual); Tm IQR 0.39-0.63, bias IQR 0.25-0.57
  C61: { Tm: 0.4805468482096445, Td: null, bias: 0.362584527178654 }, // n 7 (3 manual); Tm IQR 0.44-0.53, bias IQR 0.29-0.41
};
// rule 'follow' presets = sim/fits/whad_fits_follow.json presets.draw_tool (Agent 1, 490b4c7, feature/p2-v2-sim; sha256
// b5859c8c0993): part II medians at cut-off 9.5 h under rule = "follow". Tm is ~9x the free-rule value: never mix the sets.
// Caption (Agent 1): bias is not identified from these data; Tm carries the signal.
export const PRESET_LABEL_FOLLOW = 'simulation, preset parameters (WHAD part II fits, follow rule)';
export const PRESET_CAPTION_FOLLOW = 'bias not identified from these data; Tm carries the signal';
export const PRESETS_FOLLOW = {
  CC: { Tm: 4.2867591533230405, Td: null, bias: 0.7541227302000011 }, // n 7 (4 manual); Tm IQR 4.06-7.34, bias IQR 0.64-0.90
  C61: { Tm: 4.707304000226463, Td: null, bias: 0.5330060647425588 }, // n 7 (3 manual); Tm IQR 4.42-5.04, bias IQR 0.43-0.66
};
// demo default (user decision, recorded on #68 as an open departure from the pre-declared criterion)
export const DEFAULT_RULE = 'follow';
export const presetsFor = (rule) => (rule === 'follow' ? PRESETS_FOLLOW : PRESETS);
export const presetLabelFor = (rule) => (rule === 'follow' ? PRESET_LABEL_FOLLOW : PRESET_LABEL);
export const presetCaptionFor = (rule) => (rule === 'follow' ? PRESET_CAPTION_FOLLOW : null);
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
  // rule: 'follow' (DEFAULT since the v2 decision, #68) or 'free' (the pre-registered gate rules; 'frozen' = alias).
  // 'follow' (cellsim Params.follow, feature/p2-follower): a mover that is
  // Moore-connected to the reservoir through occupied sites pulls the chain behind it, so its source stays occupied;
  // movers on islands leave a vacancy as before. Fixed at construction (preset switches keep it). params.follow = true
  // is accepted as an alias.
  constructor({ w, h, wound, preset = 'CC', params = null, seed = 1, rule = DEFAULT_RULE }) {
    this.w = w; this.h = h;
    this.occ = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) this.occ[i] = wound[i] ? 0 : 1;
    this.rand = rng(seed);
    this.t_hours = 0;
    this.follow = (rule === 'follow' || !!(params && params.follow)) && !(params && params.follow === false);
    this.rule = this.follow ? 'follow' : 'free'; // = cellsim Params.rule names; picks the matching preset set
    this.setPreset(preset, params);
    // reservoir = border-band sites occupied at t0 (cellsim.reservoir_mask): a wound touching the edge stays open
    this.resMask = reservoirMask(this.occ, h, w, this.p.edge);
    this.res = [];
    for (let i = 0; i < w * h; i++) if (this.resMask[i]) this.res.push(i);
    this._refill();
    if (this.follow) { this.conn = Uint8Array.from(this.resMask); this._growConnected(); }
    this.g = new Float32Array(w * h);
    const R = this.p.blur;
    this.cum = new Float64Array((w + 2 * R + 1) * (h + 2 * R + 1));
    this.best = new Float64Array(w * h);
  }

  setPreset(name, override) {
    const set = presetsFor(this.rule);
    this.p = { ...DEFAULTS, ...(set[name] || set.CC), ...(override || {}) };
  }

  // cellsim.grow_connected: conn &= occ, then extend to every occupied site Moore-connected to it (conn only grows)
  _growConnected() {
    const { w, h, occ, conn } = this, q = this._q || (this._q = new Int32Array(w * h));
    let tail = 0;
    for (let i = 0; i < w * h; i++) { if (!occ[i]) conn[i] = 0; else if (conn[i]) q[tail++] = i; }
    for (let head = 0; head < tail; head++) {
      const i = q[head], x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 8; k++) {
        const ny = y + NY[k], nx = x + NX[k];
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (occ[j] && !conn[j]) { conn[j] = 1; q[tail++] = j; }
      }
    }
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
      if (moves[a] && !(this.follow && this.conn[srcs[a]])) occ[srcs[a]] = 0; // follow: connected source stays filled
    }
    this._refill();
    if (this.follow) this._growConnected();
    this.t_hours += p.dt;
  }

  // advance `hours` of simulated time (default 1 h = one recorded frame in cellsim)
  advance(hours = 1) {
    const n = Math.max(1, Math.round(hours / this.p.dt));
    for (let i = 0; i < n; i++) this.step();
  }

  get occupied() { // integer site count: closed iff occupied === w*h (no float compare)
    let c = 0; for (let i = 0; i < this.occ.length; i++) c += this.occ[i];
    return c;
  }

  get wound_frac() { return 1 - this.occupied / this.occ.length; }

  // wound touches the field edge: some border-band site was empty at t0, so the reservoir is smaller than the band
  get touches_edge() {
    const { w, h } = this, e = this.p.edge;
    return this.res.length < w * h - Math.max(0, w - 2 * e) * Math.max(0, h - 2 * e);
  }
}
