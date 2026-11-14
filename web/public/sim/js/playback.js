// Decoder for web/public/sim/<name>.json written by sim/export_playback.py (Agent 4).
// Works in browsers and Node 16+ (atob is global in both).
import { fineDensity, outline, displayOutline, SMOOTH_K, SMOOTH_SIGMA } from './smooth.js';

const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// density frame f -> Float32Array(h*w) row-major, values 0..1
export function densityFrame(pb, f) {
  const b = unb64(pb.density.frames[f]), out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] / 255;
  return out;
}

// agent frame f -> Uint8Array(H*W) row-major, 1 = cell (needs the file exported with --agents)
export function agentFrame(pb, f) {
  const b = unb64(pb.agents.frames[f]), n = pb.H * pb.W, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (b[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

// smoothed field + outline for frame f, recomputed from agents with the file's parameters (Agent 4's files ship
// density_fine/outline parameters without frames). Same shape as the draw worker's frame.fine / frame.outline.
export function viewFrame(pb, f) {
  const df = pb.density_fine || {}, k = df.scale ?? SMOOTH_K, sigma = df.sigma ?? SMOOTH_SIGMA;
  const fine = fineDensity(agentFrame(pb, f), pb.H, pb.W, k, sigma), o = outline(fine, pb.wound_frac[f]);
  const data = new Uint8Array(fine.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(fine.data[i] * 255);
  return {
    fine: { scale: k, sigma, h: fine.h, w: fine.w, data },
    outline: { units: 'sites', rule: 'area-matched', level: o.level, lines: o.lines, display: displayOutline(o, pb.outline?.display) },
  };
}
