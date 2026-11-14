// Display smoothing for the draw tool: JS port of sim/smooth_view.py (Agent 4) so live frames match playback files.
// fineDensity: occupancy upsampled k x (nearest), Gaussian blur sigma sites (symmetric reflect at borders), 0..1.
// outline: contour at the area-matched level (fraction of fine pixels below it = wound_frac), so the outlined area
// equals the agent wound area. Polylines are flat [x0,y0,x1,y1,...] in site coords (x = col, y = row, lattice [0,W]x[0,H]).
export const SMOOTH_K = 2, SMOOTH_SIGMA = 2.5; // = Agent 4 defaults (96ef78f), same as playback files

function kernel(s) {
  const r = Math.max(1, Math.ceil(3 * s)), w = new Float64Array(2 * r + 1);
  let t = 0;
  for (let i = -r; i <= r; i++) t += (w[i + r] = Math.exp(-0.5 * (i / s) ** 2));
  for (let i = 0; i < w.length; i++) w[i] /= t;
  return { r, w };
}
const refl = (i, n) => { // numpy 'symmetric': ... b a | a b c | c b ...
  while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
  return i;
};

export function fineDensity(occ, h, w, k = SMOOTH_K, sigma = SMOOTH_SIGMA) {
  const fh = h * k, fw = w * k, { r, w: kw } = kernel(sigma * k);
  const up = new Float32Array(fh * fw);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) up[y * fw + x] = occ[((y / k) | 0) * w + ((x / k) | 0)];
  const tmp = new Float32Array(fh * fw), out = new Float32Array(fh * fw), L = kw.length;
  const ix = Int32Array.from({ length: fw + 2 * r }, (_, i) => refl(i - r, fw));
  const iy = Int32Array.from({ length: fh + 2 * r }, (_, i) => refl(i - r, fh));
  const buf = new Float32Array(Math.max(fw, fh) + 2 * r);
  for (let y = 0; y < fh; y++) {
    const row = y * fw;
    for (let i = 0; i < fw + 2 * r; i++) buf[i] = up[row + ix[i]];
    for (let x = 0; x < fw; x++) { let a = 0; for (let j = 0; j < L; j++) a += kw[j] * buf[x + j]; tmp[row + x] = a; }
  }
  for (let x = 0; x < fw; x++) {
    for (let i = 0; i < fh + 2 * r; i++) buf[i] = tmp[iy[i] * fw + x];
    for (let y = 0; y < fh; y++) { let a = 0; for (let j = 0; j < L; j++) a += kw[j] * buf[y + j]; out[y * fw + x] = a < 0 ? 0 : a > 1 ? 1 : a; }
  }
  return { data: out, h: fh, w: fw, scale: k, sigma };
}

// Hoare quickselect: reorders a so a[k] is the k-th smallest and a[0..k-1] <= a[k]; returns a[k]
function select(a, k) {
  let l = 0, r = a.length - 1;
  while (l < r) {
    const p = a[(l + r) >> 1];
    let i = l, j = r;
    while (i <= j) {
      while (a[i] < p) i++;
      while (a[j] > p) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) r = j; else if (k >= i) l = i; else break;
  }
  return a[k];
}

// marching squares on pixel centres, segments joined into polylines (open at the border, closed loops inside)
export function outline(fine, woundFrac) {
  const { data: z, h, w, scale: k } = fine, n = Math.round(woundFrac * z.length);
  if (n === 0) return { level: null, lines: [] };
  let level;
  if (n >= z.length) { let mx = -Infinity; for (const q of z) if (q > mx) mx = q; level = mx + 1e-6; }
  else { // (v[n-1] + v[n]) / 2 of the sorted values, via quickselect (O(N), no full sort)
    const v = Float32Array.from(z), vn = select(v, n);
    let lo = -Infinity; for (let i = 0; i < n; i++) if (v[i] > lo) lo = v[i];
    level = (lo + vn) / 2;
  }
  const pts = new Map(), adj = new Map();
  const edgePt = (id, i0, j0, i1, j1) => {
    if (!pts.has(id)) {
      const z0 = z[j0 * w + i0], z1 = z[j1 * w + i1], t = (level - z0) / (z1 - z0);
      pts.set(id, [(i0 + t * (i1 - i0) + 0.5) / k, (j0 + t * (j1 - j0) + 0.5) / k]);
    }
    return id;
  };
  const link = (a, b) => {
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  };
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const za = z[j * w + i], zb = z[j * w + i + 1], zc = z[(j + 1) * w + i + 1], zd = z[(j + 1) * w + i];
    const A = za > level, B = zb > level, C = zc > level, D = zd > level;
    const e = [];
    if (A !== B) e.push(edgePt(2 * (j * w + i), i, j, i + 1, j)); // top
    if (B !== C) e.push(edgePt(2 * (j * w + i + 1) + 1, i + 1, j, i + 1, j + 1)); // right
    if (D !== C) e.push(edgePt(2 * ((j + 1) * w + i), i, j + 1, i + 1, j + 1)); // bottom
    if (A !== D) e.push(edgePt(2 * (j * w + i) + 1, i, j, i, j + 1)); // left
    if (e.length === 2) link(e[0], e[1]);
    else if (e.length === 4) { // saddle: e = [T, R, B, L]
      const centre = (za + zb + zc + zd) / 4 > level;
      if (centre === A) { link(e[0], e[1]); link(e[2], e[3]); } // a,c joined: cut off b and d
      else { link(e[0], e[3]); link(e[1], e[2]); }               // cut off a and c
    }
  }
  const seen = new Set(), lines = [];
  const trace = (s) => {
    const line = [s]; seen.add(s);
    let cur = s;
    for (;;) {
      const nx = adj.get(cur).find((q) => !seen.has(q));
      if (nx === undefined) break;
      seen.add(nx); line.push(nx); cur = nx;
    }
    if (line.length > 2 && adj.get(cur).includes(s)) line.push(s); // closed loop
    if (line.length > 1) lines.push(line.flatMap((id) => pts.get(id).map((c) => Math.round(c * 100) / 100)));
  };
  for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) trace(id); // open lines from their ends first
  for (const id of adj.keys()) if (!seen.has(id)) trace(id);
  return { level, lines };
}
