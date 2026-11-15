// Local edge speed of a closing wound (#117). Plain ES module, no dependencies; works in browsers and Node.
//
// edgeSpeed(prev, cur, h, w, dtHours, umPerPx) -> { sites, meanUmH, perimeterUm, areaUm2, slowest, units }
//   prev, cur: wound masks (Uint8Array h*w, 1 = wound / no cells) at two consecutive frames, dtHours apart.
//   Speed at each leading-edge site of `cur` = its distance to the nearest cell of `prev`, minus the 1 px every edge
//   pixel has to its own neighbouring cell (so a still front reads 0) = how far the front moved
//   since the previous frame, along its normal, with no cell tracking) / dtHours. umPerPx null -> px/h, and units says so.
//   sites: [{i, x, y, v}] for every cur wound pixel with a cell 4-neighbour. slowest: the slowest edge segment
//   ({x, y, v, n}: the centre and mean speed of the SEG_PX-wide window of edge sites with the lowest mean speed).
// stallSpeed(areaCutUm2, perimeterCutUm, cutH, horizonH) -> µm/h (or px/h)
//   The existing stall rule (eval/flags.py: "closes less than 10% more after the cut-off") as a front speed: closing
//   10% of the cut-off area by the horizon needs a mean edge speed of 0.1 * A / ((T - t) * P). Below it = stall pace.
//   No new threshold: it is the area rule divided by the perimeter.

export const STALL_FRACTION = 0.1;   // = eval/flags.py stall truth (< 10% more closure after the cut-off)
const SEG_PX = 6;                     // window (edge sites) for the slowest segment
const SMOOTH_PX = 3;                  // smoothing radius along the front (px)

// Euclidean distance (px) from every pixel to the nearest cell (mask 0) pixel: exact 2-pass Felzenszwalb transform.
export function distToCells(mask, h, w) {
  const INF = 1e20, f = new Float64Array(Math.max(h, w)), d = new Float64Array(Math.max(h, w));
  const v = new Int32Array(Math.max(h, w)), z = new Float64Array(Math.max(h, w) + 1), g = new Float64Array(h * w);
  const dt1 = (n) => {                              // 1-D squared distance transform of f[0..n) into d
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      while ((s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    dt1(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(w); for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

export function edgeSites(mask, h, w) {
  const s = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    if ((x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) || (y > 0 && !mask[i - w]) || (y < h - 1 && !mask[i + w])) s.push({ i, x, y });
  }
  return s;
}

export function edgeSpeed(prev, cur, h, w, dtHours, umPerPx = null) {
  const k = umPerPx || 1, dist = distToCells(prev, h, w), sites = edgeSites(cur, h, w);
  // an edge pixel is >= 1 px from the previous cells even if the front did not move: displacement = dist - 1
  for (const s of sites) s.v = (Math.max(0, dist[s.i] - 1) * k) / dtHours;
  // pixel displacements are whole-ish numbers, so a slow front reads 0 or 1 px per frame pair; average each site with
  // the edge sites within SMOOTH_PX along the front to get sub-pixel speeds (the mean over all sites is unchanged in spirit)
  const raw = sites.map((s) => s.v);
  for (let a = 0; a < sites.length; a++) {
    let t = 0, n = 0;
    for (let b = 0; b < sites.length; b++)
      if ((sites[a].x - sites[b].x) ** 2 + (sites[a].y - sites[b].y) ** 2 <= SMOOTH_PX * SMOOTH_PX) { t += raw[b]; n++; }
    sites[a].v = t / n;
  }
  let area = 0; for (let i = 0; i < h * w; i++) area += cur[i];
  const mean = sites.length ? sites.reduce((a, s) => a + s.v, 0) / sites.length : null;
  return { sites, meanUmH: mean, perimeterUm: sites.length * k, areaUm2: area * k * k, slowest: slowestSegment(sites),
           units: umPerPx ? 'µm/h' : 'px/h (no pixel scale)' };
}

// Order edge sites along the front (nearest-neighbour walk), then take the SEG_PX window with the lowest mean speed.
function slowestSegment(sites) {
  if (sites.length < 2) return sites.length ? { x: sites[0].x, y: sites[0].y, v: sites[0].v, n: 1 } : null;
  const left = sites.slice(), path = [left.pop()];
  while (left.length) {
    const p = path[path.length - 1];
    let b = 0, bd = Infinity;
    for (let j = 0; j < left.length; j++) { const d = (left[j].x - p.x) ** 2 + (left[j].y - p.y) ** 2; if (d < bd) { bd = d; b = j; } }
    if (bd > 8) break;                        // gap: another loop of the front; segments stay within one loop
    path.push(left.splice(b, 1)[0]);
  }
  const n = Math.min(SEG_PX, path.length);
  let best = null;
  for (let a = 0; a + n <= path.length; a++) {
    const win = path.slice(a, a + n), v = win.reduce((s, p) => s + p.v, 0) / n;
    if (!best || v < best.v) best = { x: win[n >> 1].x, y: win[n >> 1].y, v, n };
  }
  return best;
}

export function stallSpeed(areaCutUm2, perimeterCutUm, cutH, horizonH) {
  if (!(perimeterCutUm > 0) || !(horizonH > cutH)) return null;
  return (STALL_FRACTION * areaCutUm2) / ((horizonH - cutH) * perimeterCutUm);
}

// Sequential colour, slow = hot (--cell-edge orange) -> fast = pale ink, so the slow part of the front stands out
// against the dark tissue. t = v / vMax, clamped.
export function speedColour(v, vMax) {
  const t = Math.max(0, Math.min(1, v / (vMax || 1)));
  const hot = [238, 127, 45], cool = [232, 236, 239];       // --cell-edge, --ink
  return hot.map((c, k) => Math.round(c + (cool[k] - c) * t));
}
