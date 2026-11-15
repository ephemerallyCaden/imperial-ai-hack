// Browser port of data/segment.py (texture segmenter) + data/upload.py check_frame (QC refusal rules), issue #39.
// Plain ES module, no dependencies; runs in browsers and Node. Pixels never leave the page.
//
// Images are Float32Array grey (h*w, row-major). Float32 is kept wherever numpy keeps float32, so thresholds land on
// the same pixels as the Python pipeline (web/upload/parity.mjs checks this).
//   checkFrame(grey, h, w, scale) -> { mask: Uint8Array | null, mh, mw, focus, reasons: [string] }   (same texts as upload.py)
//   greyFromFile(file) -> { grey, h, w }   (browser only: decodes with createImageBitmap, no colour conversion)
//   rgbaFromFile(file) -> { data, h, w }   (the same decode, RGBA bytes; Assay's upload router classifies on these)

export const DOWN = 4;            // work at 1/4 resolution (0.454 um/px -> 1.8 um/px)
export const WIN = 9;             // texture window in downsampled pixels (~16 um, about one cell)
export const FRAC = 0.35;         // threshold = FRAC * p90(texture)
export const MIN_COMP = 0.01;     // keep components larger than 1% of the field
export const FOCUS_FLOOR = 1.0;   // texture_p90 below this = out of focus
export const WHAD_UM_PER_PX = 0.454;
const f32 = Math.fround;

// load_gray: RGB(A) -> mean of the 3 colour channels (grey PNGs decode to r = g = b, so this is the grey value)
export function greyFromRGBA(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = f32((data[4 * i] + data[4 * i + 1] + data[4 * i + 2]) / 3);
  return g;
}

export async function rgbaFromFile(file) {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const w = bmp.width, h = bmp.height;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0); bmp.close?.();
  return { data: g.getImageData(0, 0, w, h).data, h, w };
}
export async function greyFromFile(file) {
  const { data, h, w } = await rgbaFromFile(file);
  return { grey: greyFromRGBA(data, w, h), h, w };
}

const pyRound = x => { const r = Math.round(x); return (r - x === 0.5 && r % 2) ? r - 1 : r; };   // Python round(): half to even

// img[::DOWN, ::DOWN] of the image, after ndi.zoom(img, zoom, order=1) when zoom != 1 (only the kept pixels are computed)
function downsample(img, h, w, zoom) {
  let oh = h, ow = w, ry = 1, rx = 1;
  if (zoom !== 1) {
    oh = pyRound(h * zoom); ow = pyRound(w * zoom);
    ry = oh > 1 ? (h - 1) / (oh - 1) : 1; rx = ow > 1 ? (w - 1) / (ow - 1) : 1;   // scipy zoom, grid_mode=False
  }
  const dh = Math.ceil(oh / DOWN), dw = Math.ceil(ow / DOWN), a = new Float32Array(dh * dw);
  const px = (y, x) => (y >= 0 && y < h && x >= 0 && x < w) ? img[y * w + x] : 0;   // mode='constant', cval=0
  for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
    if (zoom === 1) { a[j * dw + i] = img[j * DOWN * w + i * DOWN]; continue; }
    const cy = j * DOWN * ry, cx = i * DOWN * rx, y0 = Math.floor(cy), x0 = Math.floor(cx), fy = cy - y0, fx = cx - x0;
    if (cy < 0 || cx < 0 || cy > h - 1 || cx > w - 1) { a[j * dw + i] = 0; continue; }   // scipy: even a rounding overshoot reads cval
    a[j * dw + i] = f32((1 - fy) * ((1 - fx) * px(y0, x0) + fx * px(y0, x0 + 1)) + fy * ((1 - fx) * px(y0 + 1, x0) + fx * px(y0 + 1, x0 + 1)));
  }
  return { a, h: dh, w: dw };
}

// scipy.ndimage.uniform_filter (size WIN, mode='reflect'): axis 0 then axis 1, running mean in double, float32 out
function uniformFilter(src, h, w, size = WIN) {
  const s1 = size >> 1, tmp = new Float32Array(h * w), out = new Float32Array(h * w);
  const line = (get, n, put) => {
    const ext = new Float64Array(n + size - 1);
    for (let k = 0; k < ext.length; k++) {
      let q = k - s1;
      while (q < 0 || q >= n) q = q < 0 ? -q - 1 : 2 * n - q - 1;   // reflect: d c b a | a b c d | d c b a
      ext[k] = get(q);
    }
    let t = 0;
    for (let k = 0; k < size; k++) t += ext[k];
    t /= size; put(0, t);
    for (let k = 1; k < n; k++) { t += (ext[k + size - 1] - ext[k - 1]) / size; put(k, t); }
  };
  for (let x = 0; x < w; x++) line(y => src[y * w + x], h, (y, v) => { tmp[y * w + x] = v; });
  for (let y = 0; y < h; y++) line(x => tmp[y * w + x], w, (x, v) => { out[y * w + x] = v; });
  return out;
}

// np.percentile(x, q), method 'linear', float32 arithmetic as numpy does for float32 input
function percentile32(x, q) {
  const s = Float32Array.from(x).sort(), n = s.length, vi = (n - 1) * (q / 100), lo = Math.floor(vi), g = vi - lo;
  const a = s[lo], b = s[Math.min(lo + 1, n - 1)], d = f32(b - a);
  return g >= 0.5 ? f32(b - f32(d * f32(1 - g))) : f32(a + f32(d * f32(g)));
}

// local std of the z-scored downsampled image (texture), as in segment() / texture_p90()
function texture(a, h, w) {
  const n = a.length;
  let s = 0; for (let i = 0; i < n; i++) s += a[i];
  const mean = f32(s / n);
  let v = 0; for (let i = 0; i < n; i++) { const d = f32(a[i] - mean); v += f32(d * d); }
  const den = f32(f32(Math.sqrt(v / n)) + f32(1e-6));
  const z = new Float32Array(n), z2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { z[i] = f32(f32(a[i] - mean) / den); z2[i] = f32(z[i] * z[i]); }
  const m = uniformFilter(z, h, w), m2 = uniformFilter(z2, h, w), tex = new Float32Array(n);
  for (let i = 0; i < n; i++) tex[i] = f32(Math.sqrt(Math.max(f32(m2[i] - f32(m[i] * m[i])), 0)));
  return tex;
}

// ---------- binary morphology, 4-connected cross, border_value = 0 (scipy defaults) ----------
function erode(m, h, w) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] && x > 0 && m[i - 1] && x < w - 1 && m[i + 1] && y > 0 && m[i - w] && y < h - 1 && m[i + w] ? 1 : 0;
  }
  return o;
}
function dilate(m, h, w) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0;
  }
  return o;
}
const repeat = (f, m, h, w, n) => { for (let k = 0; k < n; k++) m = f(m, h, w); return m; };

// 4-connected flood fill labelling; returns { lab: Int32Array (0 = background), sizes: [size of label 1..n] }
function label(m, h, w) {
  const lab = new Int32Array(m.length), sizes = [], stack = new Int32Array(m.length);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    const id = sizes.length + 1; let top = 0, n = 0; stack[top++] = s; lab[s] = id;
    while (top) {
      const i = stack[--top], x = i % w; n++;
      if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[top++] = i + 1; }
      if (i >= w && m[i - w] && !lab[i - w]) { lab[i - w] = id; stack[top++] = i - w; }
      if (i + w < m.length && m[i + w] && !lab[i + w]) { lab[i + w] = id; stack[top++] = i + w; }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

// binary_fill_holes: background not 4-connected to the image border becomes foreground
function fillHoles(m, h, w) {
  const bg = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) bg[i] = m[i] ? 0 : 1;
  const { lab } = label(bg, h, w), outside = new Set();
  for (let x = 0; x < w; x++) { outside.add(lab[x]); outside.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { outside.add(lab[y * w]); outside.add(lab[y * w + w - 1]); }
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] || !outside.has(lab[i]) ? 1 : 0;
  return o;
}

// segment() on an already downsampled image; tex passed in so texture_p90 and segment share one computation
function segmentTex(tex, h, w, frac = FRAC) {
  const thr = f32(f32(frac) * percentile32(tex, 90));
  let m = new Uint8Array(tex.length);
  for (let i = 0; i < m.length; i++) m[i] = tex[i] < thr ? 1 : 0;
  m = repeat(dilate, repeat(erode, m, h, w, 2), h, w, 2);   // binary_opening, iterations=2
  m = repeat(erode, repeat(dilate, m, h, w, 4), h, w, 4);   // binary_closing, iterations=4
  m = fillHoles(m, h, w);
  const { lab, sizes } = label(m, h, w);
  if (sizes.length) for (let i = 0; i < m.length; i++) m[i] = lab[i] && sizes[lab[i] - 1] >= MIN_COMP * m.length ? 1 : 0;
  return m;
}

// numpy float32 std (two-pass), only used for the blank test
function std32(x) {
  let s = 0; for (let i = 0; i < x.length; i++) s += x[i];
  const mu = s / x.length; let v = 0;
  for (let i = 0; i < x.length; i++) v += (x[i] - mu) ** 2;
  return Math.sqrt(v / x.length);
}

const fmt = (x, d) => x.toFixed(d);

// data/upload.py check_frame: same refusal rules and reason texts
export function checkFrame(grey, h, w, scale) {
  if (std32(grey) < 1e-3) return { mask: null, mh: 0, mw: 0, focus: null, reasons: ["blank frame"] };
  const zoom = Math.abs(scale - WHAD_UM_PER_PX) > 0.05 * WHAD_UM_PER_PX ? scale / WHAD_UM_PER_PX : 1;
  const d = downsample(grey, h, w, zoom), tex = texture(d.a, d.h, d.w), reasons = [];
  const focus = percentile32(tex, 90);
  if (focus < FOCUS_FLOOR) reasons.push(`out of focus (texture score ${fmt(focus, 2)} < ${FOCUS_FLOOR.toFixed(1)})`);
  const m = segmentTex(tex, d.h, d.w);
  let on = 0; for (const v of m) on += v;
  const frac = on / m.length;
  if (frac < 0.01) reasons.push(`no wound found (${fmt(100 * frac, 1)}% of the field < 1%)`);
  else if (frac > 0.70) reasons.push(`wound covers ${fmt(100 * frac, 0)}% of the field (> 70%): probably not a scratch assay`);
  const big = label(m, d.h, d.w).sizes.filter(s => s > 0.05 * m.length).length;
  if (big > 3) reasons.push(`${big} separate wound regions > 5% of the field (> 3)`);
  return { mask: m, mh: d.h, mw: d.w, focus, frac, reasons };
}
