// JS inference for Agent 2's mass-conserving density NCA (reference: nca/model.py, feature/p2-agent2).
// Weights JSON (nca/weights.json), PyTorch Linear layout weight[out][in]:
//   "l1.weight" [hidden][4*S+3], "l1.bias" [hidden], "l2.weight" [10+nh][hidden], "l2.bias" [10+nh]
// S = 1 + nh state channels (rho + hidden). Input order: perception (channel-major, 4 filters each),
// 2 params (normParams), 1 noise. Output: 9 flux logits (8 NB + stay), 1 source, nh hidden delta.
// Grid: Float32Array(h*w) row-major density on the coarse grid (cellsim lattice block-mean, grain 4).

const NB = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]; // (dy,dx) = model.NB
const KERN = [
  [0, 0, 0, 0, 1, 0, 0, 0, 0],
  [-1, 0, 1, -2, 0, 2, -1, 0, 1].map((v) => v / 8),
  [-1, -2, -1, 0, 0, 0, 1, 2, 1].map((v) => v / 8),
  [1, 2, 1, 2, -12, 2, 1, 2, 1].map((v) => v / 16),
];

export function normParams(Tm, bias) { return [Math.log(Tm) / 2 + 1.5, bias * 2 - 1]; }

export function randn(seed = 1) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// block-mean coarse grain, same as cellsim.coarse_grain (crops to a multiple of g)
export function coarseGrain(occ, h, w, g = 4) {
  const H = (h / g) | 0, W = (w / g) | 0, out = new Float32Array(H * W);
  for (let y = 0; y < H * g; y++) for (let x = 0; x < W * g; x++) out[((y / g) | 0) * W + ((x / g) | 0)] += occ[y * w + x];
  for (let i = 0; i < out.length; i++) out[i] /= g * g;
  return { rho: out, h: H, w: W };
}

const softplus = (x) => (x > 20 ? x : Math.log1p(Math.exp(x)));

export class NCA {
  constructor(wt, { K = 2, edge = 1, noise = 0.1 } = {}) {
    this.W1 = wt['l1.weight'].map((r) => Float32Array.from(r)); this.b1 = Float32Array.from(wt['l1.bias']);
    this.W2 = wt['l2.weight'].map((r) => Float32Array.from(r)); this.b2 = Float32Array.from(wt['l2.bias']);
    this.nhid = this.W1.length;
    this.nh = this.W2.length - 10;
    this.S = 1 + this.nh;
    this.cin = 4 * this.S + 3;
    if (this.W1[0].length !== this.cin) throw new Error(`l1 has ${this.W1[0].length} inputs, layout needs ${this.cin}`);
    this.K = K; this.edge = edge; this.noise = noise;
  }

  // one substep (dt = 1/K h). rho Float32Array(h*w), hid Float32Array(nh*h*w), par [2]. rnd = N(0,1) fn or null.
  step(rho, hid, par, h, w, rnd = null) {
    const { S, nh, nhid, cin, K, W1, b1, W2, b2 } = this, hw = h * w;
    const ch = [rho]; for (let c = 0; c < nh; c++) ch.push(hid.subarray(c * hw, (c + 1) * hw));
    const inp = new Float32Array(cin), act = new Float32Array(nhid), out = new Float32Array(10 + nh);
    const nr = new Float32Array(hw), nhd = Float32Array.from(hid), sent = new Float32Array(8 * hw);
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
      const r = rho[i];
      let keep = (r * out[8]) / sum; // stay share
      for (let k = 0; k < 8; k++) {
        const ny = y + NB[k][0], nx = x + NB[k][1];
        const nbr = ny < 0 || ny >= h || nx < 0 || nx >= w ? 1 : rho[ny * w + nx]; // outside = full: no border flux
        const share = (r * out[k]) / sum, s = share * (1 - nbr);
        sent[k * hw + i] = s;
        keep += share - s; // blocked share stays
      }
      nr[i] = keep + (softplus(out[9] - 3) * (1 - r)) / K;
      for (let c = 0; c < nh; c++) nhd[c * hw + i] += out[10 + c] / K;
    }
    // inflow: cell i receives sent_k from (y-dy, x-dx)
    for (let k = 0; k < 8; k++) {
      const dy = NB[k][0], dx = NB[k][1], off = k * hw;
      for (let y = 0; y < h; y++) {
        const sy = y - dy; if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x++) {
          const sx = x - dx; if (sx < 0 || sx >= w) continue;
          nr[y * w + x] += sent[off + sy * w + sx];
        }
      }
    }
    const e = this.edge;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      nr[i] = y < e || y >= h - e || x < e || x >= w - e ? 1 : Math.min(1, Math.max(0, nr[i]));
    }
    return [nr, nhd];
  }

  // rollout: returns Float32Array frames [nFrames+1][h*w] (frame 0 = input), one frame per hour
  rollout(rho0, h, w, Tm, bias, nFrames, rnd = null) {
    const par = normParams(Tm, bias);
    let rho = Float32Array.from(rho0), hid = new Float32Array(this.nh * h * w);
    const frames = [Float32Array.from(rho)];
    for (let f = 0; f < nFrames; f++) {
      for (let k = 0; k < this.K; k++) [rho, hid] = this.step(rho, hid, par, h, w, rnd);
      frames.push(Float32Array.from(rho));
    }
    return frames;
  }

  // stochastic ensemble -> wound_frac (= 1 - mean rho) quantile band per hour
  band(rho0, h, w, Tm, bias, nFrames, { members = 20, seed = 1, q = [0.05, 0.5, 0.95] } = {}) {
    const wf = [];
    for (let m = 0; m < members; m++) {
      const fr = this.rollout(rho0, h, w, Tm, bias, nFrames, randn(seed + 7919 * m));
      wf.push(fr.map((a) => { let s = 0; for (const v of a) s += v; return 1 - s / a.length; }));
    }
    const out = { t_hours: [], members: wf };
    for (const p of q) out[`q${String(Math.round(p * 100)).padStart(2, '0')}`] = [];
    for (let t = 0; t <= nFrames; t++) {
      out.t_hours.push(t);
      const col = wf.map((r) => r[t]).sort((a, b) => a - b);
      for (const p of q) {
        const pos = p * (col.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
        out[`q${String(Math.round(p * 100)).padStart(2, '0')}`].push(col[lo] + (col[hi] - col[lo]) * (pos - lo));
      }
    }
    return out;
  }
}
