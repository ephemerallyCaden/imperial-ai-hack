// Final tissue look for every 2D view in web/draw (Caden's pick, from the 3D prototype URL
// design/prototypes/glass-dish/index.html?pal=C68B6E,B3122E,FFD2C6,FFFFFF,24120F&bg=120A09&mat=toon&age=skin&hshift=8).
// 2D port: palette, skin age ramp (ageSkin), cool hue shift (coolShift, 8 deg x darkness toward 240), and a 3-step toon
// shade (70/150/255, as the prototype's MeshToon gradientMap). Lighting has no 2D equivalent. Colours are illustrative.
export const PAL = { intact: [0xC6, 0x8B, 0x6E], edge: [0xB3, 0x12, 0x2E], fresh: [0xFF, 0xD2, 0xC6], dividing: [255, 255, 255],
  wound: [0x24, 0x12, 0x0F], bg: [0x12, 0x0A, 0x09] };
export const EDGE_CSS = '#B3122E', BG_CSS = '#120A09';
const TOON = [70 / 255, 150 / 255, 1];

const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// oldest tissue: intact x 0.45, nudged 15% toward the wound colour (the ramp's darkest stop = original tissue)
export const OLD = lerp(PAL.intact.map((v) => v * 0.45), PAL.wound, 0.15);

// skin age ramp: new tissue -> intact over the first 30% of age, then intact -> OLD
export function ageColour(t) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.3 ? lerp(PAL.fresh, PAL.intact, t / 0.3) : lerp(PAL.intact, OLD, (t - 0.3) / 0.7);
}

// as a colour darkens (relative to `ref`), turn its hue toward 240 deg by up to `deg` x darkness, the shortest way round
export function coolShift(rgb, ref = PAL.intact, deg = 8) {
  const dark = Math.max(0, Math.min(1, 1 - lum(rgb) / lum(ref)));
  if (!dark) return rgb;
  let [r, g, b] = rgb.map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return rgb;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  const delta = ((240 - h + 540) % 360) - 180; h = (h + Math.sign(delta) * Math.min(Math.abs(delta), deg * dark) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

export const toon = (v) => (v < 1 / 3 ? TOON[0] : v < 2 / 3 ? TOON[1] : TOON[2]) * (v > 0.02 ? 1 : 0);

const rnd = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// per-site age: steps since the site filled in; sites occupied at the start are original tissue (the darkest stop)
export class Age {
  constructor(n) { this.born = new Int32Array(n).fill(-1); this.prev = null; this.step = 0; this.frames = 0; }
  reset(occ) { this.born.fill(-1); this.prev = occ ? Uint8Array.from(occ) : null; this.step = 0; }
  update(occ, totalFrames) {
    if (this.prev) for (let i = 0; i < occ.length; i++) if (occ[i] && !this.prev[i]) this.born[i] = this.step;
    this.prev = Uint8Array.from(occ); this.step++; this.frames = totalFrames || this.step;
  }
  t(i) {   // 0 = just filled in, 1 = original tissue
    if (this.born[i] < 0) return 1;
    return (this.step - this.born[i]) / (Math.max(60, 0.6 * this.frames) + 25);
  }
  colour(i) { const j = 0.92 + 0.16 * rnd(i); return ageColour(this.t(i)).map((v) => Math.min(255, v * j)); }   // subtle unevenness, fixed per site
}

// final pixel: wound floor -> tissue colour by a toon-stepped occupancy, then the cool shift
export function shade(base, v) { return coolShift(lerp(PAL.wound, base, toon(v))); }
