// Draw from photo (P3-29 #124): classify an uploaded photo and roughly outline a skin wound. Runs in the browser only;
// the photo is never uploaded. Heuristics, not a trained model:
//   microscopy  little colour anywhere (phase contrast is greyscale) -> route to the Assay upload instead
//   wound       enough skin-coloured pixels (YCbCr skin rule) plus one compact region redder/darker than that skin
//   skin        skin found but no clear wound region
//   other       neither
const MAXW = 160;   // analyse at most 160 px wide (fast, and smooths texture)

export async function loadPhoto(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAXW / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s));
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
  return { bmp, w, h, px: g.getImageData(0, 0, w, h).data };
}

const median = a => { if (!a.length) return 0; const b = Float32Array.from(a).sort(); return b[b.length >> 1]; };

function otsu(vals) {   // threshold that best splits vals into two groups
  let lo = Infinity, hi = -Infinity; for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-6) return hi; const B = 64, hist = new Float64Array(B);
  for (const v of vals) hist[Math.min(B - 1, ((v - lo) / (hi - lo) * B) | 0)]++;
  let sum = 0; for (let i = 0; i < B; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, bi = 0;
  for (let i = 0; i < B; i++) { wB += hist[i]; if (!wB) continue; const wF = vals.length - wB; if (!wF) break; sB += i * hist[i];
    const d = sB / wB - (sum - sB) / wF, v = wB * wF * d * d; if (v > best) { best = v; bi = i; } }
  return lo + (bi + 1) / B * (hi - lo);
}

function morph(m, w, h, grow) {   // one 3x3 dilate (grow) or erode step on a 0/1 mask
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let any = 0, all = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy, v = xx >= 0 && yy >= 0 && xx < w && yy < h ? m[yy * w + xx] : 0; any |= v; all &= v; }
    o[y * w + x] = grow ? any : all;
  }
  return o;
}

function largestComponent(m, w, h) {   // keep the biggest 4-connected blob, then fill its holes
  const lab = new Int32Array(m.length), q = new Int32Array(m.length); let best = 0, bestN = 0, id = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue; id++; let n = 0, qh = 0, qt = 0; q[qt++] = s; lab[s] = id;
    while (qh < qt) { const p = q[qh++]; n++; const x = p % w, y = (p / w) | 0;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const r = yy * w + xx; if (m[r] && !lab[r]) { lab[r] = id; q[qt++] = r; } } }
    if (n > bestN) { bestN = n; best = id; }
  }
  const out = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) out[i] = lab[i] === best ? 1 : 0;
  const bg = new Uint8Array(m.length); let qh = 0, qt = 0;   // flood the outside from the border; anything unreached is a hole
  for (let i = 0; i < m.length; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !out[i]) { bg[i] = 1; q[qt++] = i; } }
  while (qh < qt) { const p = q[qh++], x = p % w, y = (p / w) | 0;
    for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const r = yy * w + xx; if (!out[r] && !bg[r]) { bg[r] = 1; q[qt++] = r; } } }
  for (let i = 0; i < m.length; i++) if (!bg[i]) out[i] = 1;
  return { mask: out, n: out.reduce((s, v) => s + v, 0) };
}

export function analyse({ w, h, px }) {
  const N = w * h, Y = new Float32Array(N), Cb = new Float32Array(N), Cr = new Float32Array(N), skin = new Uint8Array(N);
  let colourful = 0;
  for (let i = 0; i < N; i++) {
    const r = px[4 * i], g = px[4 * i + 1], b = px[4 * i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 40 && (mx - mn) / mx > 0.15) colourful++;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b; Cb[i] = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b; Cr[i] = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
    skin[i] = Y[i] > 40 && Cr[i] > 133 && Cr[i] < 180 && Cb[i] > 77 && Cb[i] < 135 ? 1 : 0;
  }
  const colourFrac = colourful / N, skinFrac = skin.reduce((s, v) => s + v, 0) / N;
  const stats = { colourFrac: +colourFrac.toFixed(2), skinFrac: +skinFrac.toFixed(2) };
  if (colourFrac < 0.05) return { kind: 'microscopy', stats };
  if (skinFrac < 0.2) return { kind: 'other', stats };
  // wound score: redder (Cr) and darker (Y) than the typical skin pixel
  const sk = []; for (let i = 0; i < N; i++) if (skin[i]) sk.push(i);
  const mCr = median(sk.map(i => Cr[i])), mY = median(sk.map(i => Y[i]));
  const score = new Float32Array(N); for (let i = 0; i < N; i++) score[i] = (Cr[i] - mCr) + 0.35 * (mY - Y[i]);
  const thr = Math.max(otsu(score), 10);   // at least 10 units redder/darker than skin, so plain skin never passes
  let m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = score[i] > thr ? 1 : 0;
  m = morph(morph(m, w, h, false), w, h, true);                                 // open: drop specks
  m = morph(morph(morph(morph(m, w, h, true), w, h, true), w, h, false), w, h, false);   // close: join the region
  const { mask, n } = largestComponent(m, w, h), frac = n / N;
  stats.woundFrac = +frac.toFixed(3);
  // skin tone = median colour of skin pixels well away from the wound
  const near = morph(morph(morph(mask, w, h, true), w, h, true), w, h, true), tone = [[], [], []];
  for (let i = 0; i < N; i++) if (skin[i] && !near[i]) for (let c = 0; c < 3; c++) tone[c].push(px[4 * i + c]);
  const skinRGB = tone.map(median);
  if (frac < 0.005 || frac > 0.6) return { kind: 'skin', stats, skinRGB };
  return { kind: 'wound', stats, skinRGB, mask, w, h };
}

export function outline(mask, w, h) {   // boundary pixels of the mask (the rough edge drawn on the preview)
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) pts.push([x, y]);
  }
  return pts;
}
