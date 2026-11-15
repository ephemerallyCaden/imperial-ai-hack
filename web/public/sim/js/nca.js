// JS inference for Agent 2's mass-conserving density NCA (reference: nca/model.py, feature/p2-agent2).
// Weights JSON (nca/weights.json), PyTorch Linear layout weight[out][in]:
//   "l1.weight" [hidden][4*S+3], "l1.bias" [hidden], "l2.weight" [10+nh][hidden], "l2.bias" [10+nh]
// S = 2 + nh state channels [rho, R (reservoir fraction, fixed), hid...]. Input order: perception (channel*4+filter),
// 2 params (normParams), 1 noise. Output: 9 flux logits (8 NB + stay), 1 source (gated off), nh hidden delta.
// Flux capped per target so 0<=rho<=1 and mass is conserved; reservoir floor rho = max(rho, R).
// Grid: Float32Array(h*w) row-major density on the coarse grid (cellsim lattice block-mean, grain 2).

const NB = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]; // (dy,dx) = model.NB
const KERN = [
  [0, 0, 0, 0, 1, 0, 0, 0, 0],
  [-1, 0, 1, -2, 0, 2, -1, 0, 1].map((v) => v / 8),
  [-1, -2, -1, 0, 0, 0, 1, 2, 1].map((v) => v / 8),
  [1, 2, 1, 2, -12, 2, 1, 2, 1].map((v) => v / 16),
];

import { hashSeed } from './engine.js';

// = nca/model.py norm_params: log Tm mapped over [TM_MIN, TM_MAX] to [-1, 1]
// v1 (nca/weights.json): Tm in [0.05, 5]. v2 (nca/v2/weights.config.json, follower rule): tm_max from the config
// (500 h as of the retrain), division 1 with the near-cell source gate.
export const TM_MIN = 0.05, TM_MAX = 5.0;
export function normParams(Tm, bias, tmMin = TM_MIN, tmMax = TM_MAX) {
  const lo = Math.log(tmMin), hi = Math.log(tmMax);
  return [(2 * (Math.log(Tm) - lo)) / (hi - lo) - 1, 2 * bias - 1];
}

export function randn(seed = 1) {
  let s = hashSeed(seed);
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// block-mean coarse grain, same as cellsim.coarse_grain (crops to a multiple of g)
export function coarseGrain(occ, h, w, g = 2) {
  const H = (h / g) | 0, W = (w / g) | 0, out = new Float32Array(H * W);
  for (let y = 0; y < H * g; y++) for (let x = 0; x < W * g; x++) out[((y / g) | 0) * W + ((x / g) | 0)] += occ[y * w + x];
  for (let i = 0; i < out.length; i++) out[i] /= g * g;
  return { rho: out, h: H, w: W };
}

// "Run until fully healed" for density runs (NCA). The agent sim closes exactly (every site occupied, worker `closed`);
// NCA density is continuous and approaches 1 without a guarantee of reaching it, so healed = every coarse cell has
// rho >= minRho. Default 0.95: above 0.75 (a 2x2 coarse cell missing one of its 4 lattice sites), so a healed field has
// no site-sized hole left, and below 1 so float round-off never blocks the stop.
export function isHealed(rho, { minRho = 0.95 } = {}) {
  for (let i = 0; i < rho.length; i++) if (rho[i] < minRho) return false;
  return true;
}
export function meanRho(rho) { let s = 0; for (let i = 0; i < rho.length; i++) s += rho[i]; return s / rho.length; }
// stall guard: means = meanRho per frame (one per hour from rollout); true once the last `window` frames moved mean rho
// by less than eps (default 12 frames, as the draw worker's 12 h stall window; eps 1e-4 of the field)
export function isStalled(means, { window = 12, eps = 1e-4 } = {}) {
  return means.length > window && Math.abs(means[means.length - 1] - means[means.length - 1 - window]) < eps;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export class NCA {
  // division: source gate (0 for v1 / WHAD presets: hard off; 1 for v2 follower), as nca/model.py NCA(division=...).
  // tm_min/tm_max: Tm encoding range; bias_min/bias_max (or bias: [lo, hi]): if given, Tm and bias are clipped to the
  // trained range (v2). Pass the parsed weights.config.json as the second argument; defaults = v1.
  // Clip bounds default to v1's (nca/model.py V1_CONFIG), as nca/api.py rollout always clips.
  constructor(wt, { K = 2, noise = 0.1, division = 0, tm_min = TM_MIN, tm_max = TM_MAX, bias_min = 0.25, bias_max = 0.9, bias, ...rest } = {}) {
    if (Array.isArray(bias)) [bias_min, bias_max] = bias;
    this.cfg = { tm_min, tm_max, bias_min, bias_max, ...rest };
    this.W1 = wt['l1.weight'].map((r) => Float32Array.from(r)); this.b1 = Float32Array.from(wt['l1.bias']);
    this.W2 = wt['l2.weight'].map((r) => Float32Array.from(r)); this.b2 = Float32Array.from(wt['l2.bias']);
    this.nhid = this.W1.length;
    this.nh = this.W2.length - 10;
    this.S = 2 + this.nh; // [rho, R, hid...]
    this.cin = 4 * this.S + 3;
    if (this.W1[0].length !== this.cin) throw new Error(`l1 has ${this.W1[0].length} inputs, layout needs ${this.cin}`);
    this.K = K; this.noise = noise; this.division = +division;
  }

  // network encoding of (Tm, bias) for this weights version (clipped to the trained range when the config gives one)
  normParams(Tm, bias) {
    const c = this.cfg, clip = (v, lo, hi) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
    const tm = clip(Tm, c.tm_min, c.tm_max), b = clip(bias, c.bias_min, c.bias_max);
    return normParams(tm, b, c.tm_min, c.tm_max);
  }

  // one substep (dt = 1/K h). rho, R Float32Array(h*w); hid Float32Array(nh*h*w); par [2]; rnd = N(0,1) fn or null.
  step(rho, R, hid, par, h, w, rnd = null) {
    const { S, nh, nhid, cin, K, W1, b1, W2, b2 } = this, hw = h * w;
    const ch = [rho, R]; for (let c = 0; c < nh; c++) ch.push(hid.subarray(c * hw, (c + 1) * hw));
    const inp = new Float32Array(cin), act = new Float32Array(nhid), out = new Float32Array(10 + nh);
    const room = new Float32Array(hw), want = new Float32Array(8 * hw), demand = new Float32Array(hw);
    const src = new Float32Array(hw), nhd = new Float32Array(nh * hw);
    for (let i = 0; i < hw; i++) room[i] = Math.max(0, 1 - rho[i]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let c = 0; c < S; c++) for (let f = 0; f < 4; f++) {
        let a = 0;
        for (let ky = 0; ky < 3; ky++) {
          const yy = y + ky - 1; if (yy < 0 || yy >= h) continue;
          for (let kx = 0; kx < 3; kx++) {
            const xx = x + kx - 1; if (xx < 0 || xx >= w) continue;
            a += KERN[f][ky * 3 + kx] * ch[c][yy * w + xx];
          }
        }
        inp[c * 4 + f] = a;
      }
      inp[4 * S] = par[0]; inp[4 * S + 1] = par[1]; inp[4 * S + 2] = rnd ? rnd() : 0;
      for (let j = 0; j < nhid; j++) {
        let a = b1[j]; const r = W1[j];
        for (let k = 0; k < cin; k++) a += r[k] * inp[k];
        act[j] = a > 0 ? a : 0;
      }
      for (let o = 0; o < 10 + nh; o++) {
        let a = b2[o]; const r = W2[o];
        for (let j = 0; j < nhid; j++) a += r[j] * act[j];
        out[o] = a;
      }
      let mx = -Infinity;
      for (let k = 0; k < 9; k++) { if (rnd && this.noise > 0) out[k] += this.noise * rnd(); if (out[k] > mx) mx = out[k]; }
      let sum = 0;
      for (let k = 0; k < 9; k++) { out[k] = Math.exp(out[k] - mx); sum += out[k]; }
      // want_k(i) = rho_i * frac_k * room_j, j = i + NB[k] (outside grid: room 0 = wall)
      for (let k = 0; k < 8; k++) {
        const ny = y + NB[k][0], nx = x + NB[k][1];
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
        const j = ny * w + nx, v = (rho[i] * out[k] / sum) * room[j];
        want[k * hw + i] = v; demand[j] += v;
      }
      src[i] = out[9];
      for (let c = 0; c < nh; c++) nhd[c * hw + i] = Math.tanh(hid[c * hw + i] + out[10 + c] / K);
    }
    // each target caps total inflow at its room: scale_j = room_j / demand_j if demand_j > room_j
    const scale = demand; // reuse buffer
    for (let j = 0; j < hw; j++) scale[j] = demand[j] > room[j] ? room[j] / Math.max(demand[j], 1e-12) : 1;
    const nr = Float32Array.from(rho);
    for (let k = 0; k < 8; k++) {
      const dy = NB[k][0], dx = NB[k][1], off = k * hw;
      for (let y = 0; y < h; y++) {
        const ny = y + dy; if (ny < 0 || ny >= h) continue;
        for (let x = 0; x < w; x++) {
          const nx = x + dx; if (nx < 0 || nx >= w) continue;
          const i = y * w + x, j = ny * w + nx, s = want[off + i] * scale[j];
          nr[i] -= s; nr[j] += s;
        }
      }
    }
    for (let i = 0; i < hw; i++) {
      let v = nr[i];
      if (this.division) {
        // v2 source gate: near = 3x3 max of rho at the START of the substep (incl. centre, outside = 0), so mass only
        // appears next to cells (= F.max_pool2d(rho, 3, 1, 1) in nca/model.py)
        const y = (i / w) | 0, x = i - y * w;
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; if (rho[yy * w + xx] > near) near = rho[yy * w + xx]; } }
        v += (this.division * near * sigmoid(src[i] - 3) * (1 - v)) / K;
      }
      nr[i] = Math.max(v, R[i]); // reservoir floor
    }
    return [nr, nhd];
  }

  // rollout: Float32Array frames [nFrames+1][h*w], one per hour; frame 0 = max(rho0, R). R defaults to zeros.
  rollout(rho0, h, w, Tm, bias, nFrames, rnd = null, R = null) {
    const par = this.normParams(Tm, bias), hw = h * w;
    R = R || new Float32Array(hw);
    let rho = new Float32Array(hw), hid = new Float32Array(this.nh * hw);
    for (let i = 0; i < hw; i++) rho[i] = Math.max(rho0[i], R[i]);
    const frames = [Float32Array.from(rho)];
    for (let f = 0; f < nFrames; f++) {
      for (let k = 0; k < this.K; k++) [rho, hid] = this.step(rho, R, hid, par, h, w, rnd);
      frames.push(Float32Array.from(rho));
    }
    return frames;
  }

  // stochastic ensemble -> wound_frac (= 1 - mean rho) quantile band per hour
  // params: optional [[Tm, bias], ...] fit members (e.g. bootstrap); member m uses params[m % length], else (Tm, bias)
  band(rho0, h, w, Tm, bias, nFrames, { members = 20, seed = 1, q = [0.05, 0.5, 0.95], R = null, params = null } = {}) {
    const wf = [];
    for (let m = 0; m < members; m++) {
      const [tm, b] = params && params.length ? params[m % params.length] : [Tm, bias];
      const fr = this.rollout(rho0, h, w, tm, b, nFrames, randn(seed + 7919 * m), R);
      wf.push(fr.map((a) => { let s = 0; for (const v of a) s += v; return 1 - s / a.length; }));
    }
    const key = (p) => `q${String(Math.round(p * 100)).padStart(2, '0')}`;
    const out = { t_hours: [], members: wf };
    for (const p of q) out[key(p)] = [];
    for (let t = 0; t <= nFrames; t++) {
      out.t_hours.push(t);
      const col = wf.map((r) => r[t]).sort((a, b) => a - b);
      for (const p of q) {
        const pos = p * (col.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
        out[key(p)].push(col[lo] + (col[hi] - col[lo]) * (pos - lo));
      }
    }
    return out;
  }
}
