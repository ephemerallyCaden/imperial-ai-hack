// Draw from photo (#124), carved into the live 3D tissue (live.js): a photo's wound OUTLINE becomes the cut. Not a forecast.
// Segmentation (no model): the user boxes the wound; skin colour = mean of the box border; per-pixel colour distance to
// it, Otsu threshold inside the box, largest connected component, holes filled. The shape (not its size) is fitted to
// the WHAD field. The photo is read with a local object URL and never leaves the browser. The live readout then counts
// simulation steps, not hours: the healing is a cultured-cell model, not this wound.
// (Ported from the removed Draw screen's photo view, web/draw/draw.js on main: segmentBox, photoCheck, fitToLattice.)
import { FIELD_H as H, FIELD_W as W } from "../public/sim/js/engine.js";

export const PHOTO_LABEL = "shape from photo; healing is a cell-culture model, not this wound";

export function segmentBox(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, d = img.data, W0 = img.width, dist = new Float32Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  const px = (x, y) => 4 * ((y0 + y) * W0 + (x0 + x));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { const i = px(x, y); sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
  sr /= n; sg /= n; sb /= n;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = px(x, y); dist[y * w + x] = Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb); }
  let mx = 0; for (const v of dist) if (v > mx) mx = v; mx = mx || 1;   // loop, not Math.max(...big array): stack overflow
  const hist = new Float64Array(256);   // Otsu on the distance histogram
  for (const v of dist) hist[Math.min(255, Math.floor((255 * v) / mx))]++;
  let best = 0, th = 128, wB = 0, sumB = 0, sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB || wB === dist.length) continue; sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / (dist.length - wB), b = wB * (dist.length - wB) * (mB - mF) ** 2; if (b > best) { best = b; th = t; } }
  const m = Uint8Array.from(dist, v => ((255 * v) / mx > th ? 1 : 0));
  // largest 4-connected component
  const lab = new Int32Array(w * h), sizes = [0]; let id = 0;
  for (let i = 0; i < w * h; i++) if (m[i] && !lab[i]) { id++; let c = 0; const st = [i]; lab[i] = id;
    while (st.length) { const q = st.pop(); c++; const x = q % w, y = (q / w) | 0;
      for (const r of [x > 0 && q - 1, x < w - 1 && q + 1, y > 0 && q - w, y < h - 1 && q + w]) if (r !== false && m[r] && !lab[r]) { lab[r] = id; st.push(r); } }
    sizes.push(c); }
  let keep = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[keep]) keep = k;
  const out = Uint8Array.from(lab, l => (l === keep && keep > 0 ? 1 : 0));
  // fill holes: background reachable from the box border stays background
  const seen = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) { const q = st.pop(); if (seen[q] || out[q]) continue; seen[q] = 1; const x = q % w, y = (q / w) | 0;
    if (x > 0) st.push(q - 1); if (x < w - 1) st.push(q + 1); if (y > 0) st.push(q - w); if (y < h - 1) st.push(q + w); }
  for (let i = 0; i < w * h; i++) if (!seen[i]) out[i] = 1;
  return { mask: out, w, h };
}
// Photo-type check before segmenting (thresholds from the look-dev prototype, design/prototypes/glass-dish/photo.js):
// greyscale microscopy, not skin, or no clear wound -> say so instead of tracing something meaningless.
export function photoCheck(img, seg) {
  const d = img.data; let n = 0, colourful = 0, skin = 0;
  for (let i = 0; i < d.length; i += 16) {   // every 4th pixel
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 10) continue; n++;
    if (mx - mn > 25) colourful++;
    const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b;   // YCbCr skin box
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
  }
  if (!n || colourful / n < 0.05) return "This looks like greyscale microscopy: use Upload images for cell-culture frames.";
  if (skin / n < 0.2) return "This does not look like a skin photo.";
  let a = 0; for (const v of seg.mask) a += v;
  const frac = a / ((img.width * img.height) || 1);
  if (frac < 0.002 || frac > 0.6) return "Skin, but no clear wound in that box: try a tighter box around the wound.";
  return null;
}
// shape only: bbox of the mask scaled to `fill` of the W x H field, centred -> Uint8Array(W*H), 1 = wound
export function fitToLattice(seg, fill = 0.6) {
  let x0 = seg.w, y0 = seg.h, x1 = -1, y1 = -1;
  for (let y = 0; y < seg.h; y++) for (let x = 0; x < seg.w; x++) if (seg.mask[y * seg.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const out = new Uint8Array(W * H); if (x1 < 0) return out;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((fill * W) / bw, (fill * H) / bh), ow = bw * k, oh = bh * k, ox = (W - ow) / 2, oy = (H - oh) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.floor(x0 + (x + 0.5 - ox) / k), sy = Math.floor(y0 + (y + 0.5 - oy) / k);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) out[y * W + x] = seg.mask[sy * seg.w + sx];
  }
  return out;
}

// Box-the-wound dialog inside `host` (Assay's notice panel): file -> photo canvas -> drag a box -> Trace.
// onMask(Uint8Array(W*H)) gets the fitted outline; the caller carves it into the live tissue.
export function photoDialog(host, file, onMask) {
  host.innerHTML = `<div class="st-kicker">Draw from photo · the photo stays in this browser tab</div>
    <canvas class="as-photo" width="420" height="300" aria-label="Photo: drag a box around the wound"></canvas>
    <p class="as-caption as-photo-hint">Drag a box around the wound, then press Trace outline.</p>
    <p class="as-caption">Only the outline is used, rescaled to the field; the wound's size, depth and tissue are not. ${PHOTO_LABEL}.</p>
    <div class="as-btns"><button class="st-btn st-btn--primary" data-photo="trace">Trace outline</button><button class="st-btn" data-photo="close">Cancel</button></div>`;
  host.hidden = false;
  const pc = host.querySelector("canvas"), pg = pc.getContext("2d"), hint = host.querySelector(".as-photo-hint");
  let img = null, box = null, drag = null;
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { const k = Math.min(pc.width / im.width, pc.height / im.height); pg.fillStyle = "#050607"; pg.fillRect(0, 0, pc.width, pc.height);
    pg.drawImage(im, 0, 0, im.width * k, im.height * k); img = pg.getImageData(0, 0, pc.width, pc.height); URL.revokeObjectURL(url); };
  im.onerror = () => { hint.textContent = "Could not read that image (PNG or JPEG)."; URL.revokeObjectURL(url); };
  im.src = url;
  const at = e => { const r = pc.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * pc.width, ((e.clientY - r.top) / r.height) * pc.height]; };
  pc.addEventListener("pointerdown", e => { if (!img) return; drag = at(e); pc.setPointerCapture(e.pointerId); });
  pc.addEventListener("pointermove", e => { if (!drag) return; const [x, y] = at(e);
    box = [Math.min(drag[0], x), Math.min(drag[1], y), Math.max(drag[0], x), Math.max(drag[1], y)].map(Math.round);
    pg.putImageData(img, 0, 0); pg.strokeStyle = "#E0A458"; pg.lineWidth = 2; pg.setLineDash([5, 3]); pg.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]); pg.setLineDash([]); });
  pc.addEventListener("pointerup", () => (drag = null));
  host.addEventListener("click", function on(e) {
    const a = e.target.closest("[data-photo]")?.dataset.photo; if (!a) return;
    if (a === "close") { host.hidden = true; host.removeEventListener("click", on); return; }
    if (!box || box[2] - box[0] < 12 || box[3] - box[1] < 12) { hint.textContent = "Draw a bigger box around the wound."; return; }
    const seg = segmentBox(img, ...box), why = photoCheck(img, seg);
    if (why) { hint.textContent = why; return; }
    const mask = fitToLattice(seg);
    if (!mask.some(Boolean)) { hint.textContent = "No outline found in that box: try a tighter box."; return; }
    host.hidden = true; host.removeEventListener("click", on); onMask(mask);
  });
}
