// 3D tissue field for Assay, in the approved glass-dish final look (web/vendor-design/look.js, a byte copy of
// design/prototypes/glass-dish/look.js: toon rig + material, cool hue shift, skin age ramp): hex columns, colour = state
// and cell age, height = state as in the mockup (wound 0.08 floor, leading edge <= 0.6, new tissue 0.7 -> 1, intact ~1).
// Box-select keeps the selection in colour and drops the rest to matte greyscale (one grey step per state).
// setHeat: the mockup's age heatmap overlay (look.js heatColour) on non-wound hexes; colour = simulated cell age, not a measurement.
// The field is MODELLED, never tracked cells: a precomputed v2 NCA density playback (web/public/sim/nca_follow_*.json,
// density only; setPlayback swaps it without rebuilding the scene) or a cell-agent playback (agents), and the frame shown
// is the playback frame whose wound area best matches the area curve at time t. Live drawing (web/assay/live.js) feeds
// the same columns from the live NCA instead (showLive) and paints through setBrush.
// DISPLAY INTERPOLATION: the hexes are a display grid, DISPLAY_K per lattice site along x (10 µm hexes, about the M10
// mockup's density), independent of the model grid. Each hex samples its source density field bilinearly at its centre
// (NCA playback and live: the coarse NCA density; agent playback: the smoothed fine density, smooth.js). A hex is a
// sample, not one cell.
// Performance: two InstancedMeshes (colour + matte grey); per frame only the height entry of each instance matrix is
// written in place, colours only when the field changes, nothing is allocated in the frame loop.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { viewFrame, densityFrame } from "../public/sim/js/playback.js";
import { outline as areaOutline, displayOutline } from "../public/sim/js/smooth.js";
import { edgeSpeed, stallSpeed } from "../edge/edge_speed.js";
import { FINAL, HMAX as HMAX_MOCKUP, HEIGHT, colHeight, addLights, colGeo as hexGeo, makeColumnMaterial, makeAgeRamp, cellColour, HEAT_STOPS, heatColour } from "../vendor-design/look.js";

export const SITE_UM = 20;                               // one lattice site = one cell = 20 µm (docs/p2-handoff.md)
export const DISPLAY_K = 2;                              // display hexes per lattice site along x
// colours from tokens.css (--cell-*, --scene-bg, final skin look #131), read once at import; hex = fallback if missing
const tok = (name, hex) => { let v = ""; try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch { /* no DOM */ } return /^#[0-9a-f]{6}$/i.test(v) ? v : hex; };
const hexNum = (h) => parseInt(h.slice(1), 16);
const PAL = { intact: hexNum(tok("--cell-intact", "#C68B6E")), edge: hexNum(tok("--cell-edge", "#B3122E")),
  fresh: hexNum(tok("--cell-new", "#FFD2C6")), wound: hexNum(tok("--cell-wound", "#24120F")) };
const SCENE_BG = hexNum(tok("--scene-bg", "#120A09"));
const DARK = { wound: 0.0, intact: 0.010, edge: 0.045, fresh: 0.11 };                // tokens.css --ghost-* (linear)
export const STATE_LABEL = { wound: "Wound", intact: "Intact", edge: "Leading edge", fresh: "New tissue" };
const STALL = { stalled: 0xFF2D2D, moving: 0xE8ECEF, dim: 0.18 };   // edge-stall overlay: edges slower than stall pace red
const STATES = ["wound", "intact", "edge", "fresh"];     // state codes 0..3
const HY = Math.sqrt(3) / 2, S = 0.5;                    // S = world units per lattice site
// height of density 1: the mockup's column proportions (look.js HMAX per 0.5 world units of hex spacing) at this hex spacing
const HMAX = HMAX_MOCKUP * (S / DISPLAY_K) / 0.5;
// age heatmap legend swatch: look.js HEAT_STOPS left = newest (bright) -> right = oldest, as in the mockup's legend
export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.slice().reverse().map(c => "#" + c.getHexString()).join(",")})`;

export function createTissue(host, pb0, { onSelection, onHover } = {}) {
  let pb = pb0;
  // ---------- display hex grid over the true W x H site field (pointy-top hexes, odd rows shifted half a hex) ----------
  const FW = pb.W, FH = pb.H, DX = 1 / DISPLAY_K, DZ = DX * HY;   // hex spacing in sites
  const NX = Math.round(FW / DX), NY = Math.floor(FH / DZ), COUNT = NX * NY;
  const X0 = -FW * S / 2, Z0 = -FH * S / 2;
  const hu = new Float32Array(COUNT), hv = new Float32Array(COUNT), wx = new Float32Array(COUNT), wz = new Float32Array(COUNT);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i; hu[k] = (i + 0.25 + (j & 1) * 0.5) * DX; hv[k] = (j + 0.5) * DZ + (FH - NY * DZ) / 2;
    wx[k] = X0 + hu[k] * S; wz[k] = Z0 + hv[k] * S;
  }
  const nb = new Int32Array(6 * COUNT).fill(-1);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const n = (j & 1) ? [[i - 1, j], [i + 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
      : [[i - 1, j], [i + 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]];
    n.forEach(([a, b], q) => { if (a >= 0 && b >= 0 && a < NX && b < NY) nb[6 * (j * NX + i) + q] = b * NX + a; });
  }
  // nearest display hex to a point in site units (row first, then column within the row)
  const hexAt = (u, v) => {
    const j = Math.min(NY - 1, Math.max(0, Math.round((v - hv[0]) / DZ)));
    const i = Math.min(NX - 1, Math.max(0, Math.round(u / DX - 0.25 - (j & 1) * 0.5)));
    return j * NX + i;
  };

  // ---------- sampling a source field onto the hexes (bilinear; taps cached per field shape) ----------
  const tapCache = new Map();
  function taps(fw, fh, perSite) {
    const key = `${fw}x${fh}@${perSite}`; if (tapCache.has(key)) return tapCache.get(key);
    const idx = new Int32Array(4 * COUNT), wt = new Float32Array(4 * COUNT);
    for (let k = 0; k < COUNT; k++) {
      const cx = Math.min(fw - 1, Math.max(0, hu[k] * perSite - 0.5)), cy = Math.min(fh - 1, Math.max(0, hv[k] * perSite - 0.5));
      const x0 = Math.min(fw - 2, Math.floor(cx)), y0 = Math.min(fh - 2, Math.floor(cy)), fx = cx - x0, fy = cy - y0;
      idx.set([y0 * fw + x0, y0 * fw + x0 + 1, (y0 + 1) * fw + x0, (y0 + 1) * fw + x0 + 1], 4 * k);
      wt.set([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], 4 * k);
    }
    const t = { idx, wt }; tapCache.set(key, t); return t;
  }
  // field = { data (typed array), w, h, perSite (field cells per lattice site), norm (data value of density 1) }
  function sample(field, out) {
    const { idx, wt } = taps(field.w, field.h, field.perSite), d = field.data, s = 1 / (field.norm || 1);
    for (let k = 0, q = 0; k < COUNT; k++, q += 4) out[k] = (wt[q] * d[idx[q]] + wt[q + 1] * d[idx[q + 1]] + wt[q + 2] * d[idx[q + 2]] + wt[q + 3] * d[idx[q + 3]]) * s;
    return out;
  }
  // frame = { dens, wound, state } per hex; fresh = was wound in `ref` (playback frame 0, or live: ever carved)
  function classify(fd, ref) {
    const st = fd.state || new Uint8Array(COUNT);
    for (let k = 0; k < COUNT; k++) {
      if (fd.wound[k]) { st[k] = 0; continue; }
      let e = 0; for (let q = 6 * k; q < 6 * k + 6; q++) if (nb[q] >= 0 && fd.wound[nb[q]]) { e = 1; break; }
      st[k] = e ? 2 : ref[k] ? 3 : 1;
    }
    fd.state = st; return fd;
  }

  // ---------- per-frame data from the playback (cached): density per hex + wound mask at the outline level ----------
  // agent playback: smoothed fine density + its area-matched outline (viewFrame). Density-only (NCA) playback: the coarse
  // density sampled bilinearly, wound/outline at the area-matched level of that density (the same rule as smooth.js), so
  // the open area shown equals the frame's wound_frac either way. area = wound_frac relative to the playback's frame 0.
  let cache = new Map(), wf0 = 1, f0 = null;
  function frameData(f, ref) {
    if (cache.has(f)) return cache.get(f);
    let dens, o;
    if (pb.agents) {
      const v = viewFrame(pb, f); o = v.outline;
      dens = sample({ data: v.fine.data, w: v.fine.w, h: v.fine.h, perSite: v.fine.scale, norm: 255 }, new Float32Array(COUNT));
    } else {
      const rho = densityFrame(pb, f), { h, w } = pb.density, perSite = w / pb.W;
      dens = sample({ data: rho, w, h, perSite }, new Float32Array(COUNT));
      const ol = areaOutline({ data: rho, h, w, scale: perSite }, pb.wound_frac[f]);
      o = { level: ol.level, display: displayOutline(ol, pb.outline?.display) };
    }
    const level = o.level == null ? -1 : o.level, wound = new Uint8Array(COUNT);
    for (let k = 0; k < COUNT; k++) wound[k] = dens[k] < level ? 1 : 0;
    const d = { f, dens, wound, outline: o.display, t: pb.t_hours[f], wf: pb.wound_frac[f], area: pb.wound_frac[f] / wf0 };
    if (ref) classify(d, ref);
    cache.set(f, d); return d;
  }
  // frame whose wound area (relative to its own start) best matches `area` (relative to the wound's first frame)
  function frameForArea(area) {
    let best = 0, bd = Infinity;
    for (let f = 0; f < pb.wound_frac.length; f++) { const d = Math.abs(pb.wound_frac[f] / wf0 - area); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  // ---------- renderer / scene ----------
  const canvas = document.createElement("canvas"); canvas.className = "tissue-canvas"; host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SCENE_BG);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 1.0; controls.maxDistance = 80; controls.maxPolarAngle = Math.PI * 0.49;
  addLights(scene, FINAL.mat);   // toon rig: hemisphere 0.4, key 1.25, fill 0.3

  // ---------- graph space: floor grid every 100 µm, box, rulers ----------
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const frame = new THREE.Group(); scene.add(frame);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.28 });
  const faint = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.08 });
  const seg = (pts, m = lineMat) => frame.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), m));
  const xa = X0 - 1, xb = -X0 + 1, za = Z0 - 1, zb = -Z0 + 1, top = HMAX * 1.25;
  const step = (100 / SITE_UM) * S, grid = [];
  for (let x = xa; x <= xb + 1e-6; x += step) grid.push(V(x, 0, za), V(x, 0, zb));
  for (let z = za; z <= zb + 1e-6; z += step) grid.push(V(xa, 0, z), V(xb, 0, z));
  seg(grid, faint);
  seg([V(xa, 0, za), V(xb, 0, za), V(xb, 0, za), V(xb, 0, zb), V(xb, 0, zb), V(xa, 0, zb), V(xa, 0, zb), V(xa, 0, za),
    V(xa, 0, za), V(xa, top, za), V(xb, 0, za), V(xb, top, za), V(xa, 0, zb), V(xa, top, zb),
    V(xa, top, za), V(xb, top, za), V(xa, top, za), V(xa, top, zb)]);
  const walls = []; for (let h = 0; h <= top; h += HMAX / 4) walls.push(V(xa, h, za), V(xb, h, za), V(xa, h, za), V(xa, h, zb));
  seg(walls, faint);
  function label(text, p, size = 0.5, color = "#8a949c", group = frame) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 64;
    const g = c.getContext("2d"); g.font = "28px ui-monospace, Menlo, monospace"; g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, 4, 32);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sp.scale.set(size * 8, size, 1); sp.position.copy(p); sp.center.set(0, 0.5); group.add(sp); return sp;
  }
  for (let k = 0; k * step <= xb - xa + 1e-6; k += 2) label(`${k * 100}`, V(xa + k * step, 0, zb + 0.9), 0.4);
  label("x (µm)", V(0, 0, zb + 1.9), 0.5, "#e8ecef");
  for (let k = 0; k * step <= zb - za + 1e-6; k += 2) label(`${k * 100}`, V(xb + 0.6, 0, za + k * step), 0.4);
  label("y (µm)", V(xb + 1.6, 0, 0), 0.5, "#e8ecef");
  for (let q = 0; q <= 4; q++) label((q / 4).toFixed(2), V(xa - 0.2, q * HMAX / 4, za), 0.4).center.set(1, 0.5);
  label("density", V(xa - 0.2, top + 0.6, za), 0.5, "#e8ecef").center.set(1, 0.5);

  // ---------- columns: coloured + matte greyscale (outside a selection) ----------
  // the mockup's hex prism and proportions: radius 0.55 x hex spacing, turned 30 deg (look.js colGeo)
  const colGeo = hexGeo(0.55 * DX * S);
  const cols = new THREE.InstancedMesh(colGeo, makeColumnMaterial(FINAL.mat, FINAL.hshift), COUNT);
  const dull = new THREE.InstancedMesh(colGeo, new THREE.MeshLambertMaterial(), COUNT);
  cols.frustumCulled = dull.frustumCulled = false;   // one draw each; the instance bounds never need computing
  scene.add(cols, dull);
  const col = new THREE.Color();
  for (const m of [cols, dull]) m.setColorAt(0, col);   // allocates instanceColor
  const cm = cols.instanceMatrix.array, dm = dull.instanceMatrix.array, cc = cols.instanceColor.array, dc = dull.instanceColor.array;
  const rnd = Float32Array.from({ length: COUNT }, (_, k) => ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1);  // fixed shade jitter
  const hNow = new Float32Array(COUNT).fill(0.5), inSelA = new Uint8Array(COUNT).fill(1);
  const GREY = STATES.map(s => DARK[s]);
  const ramp = makeAgeRamp(PAL, 60);   // skin age ramp; original tissue (age Infinity) gets its darkest stop
  const tgt = new Float32Array(COUNT), age = new Float32Array(COUNT);   // target height (x HMAX) and age per hex
  const lastS = new Uint8Array(COUNT).fill(255), lastAge = new Float32Array(COUNT).fill(NaN);   // state + age each colour was written for

  // ---------- cell age = steps since the hex stopped being wound; never wound = original tissue (age Infinity) ----------
  // playback: born = first frame a hex is no longer wound after being wound (display mask), found by walking the frames in
  // order up to the latest one shown; once set it holds for every later frame, so seeking back stays right. span 0.6 x frames.
  // live: born = the step its NCA density is first back at the wound level after its latest carve; step = field.step when
  // the caller passes one (e.g. NCA substeps), else the count of distinct NCA states received. span 60 steps.
  let SPAN_PB = 60; const SPAN_LIVE = 60;
  const bornPb = new Int32Array(COUNT).fill(-1), woundSeen = new Uint8Array(COUNT); let bornTo = -1;
  function bornUpTo(f) {
    for (let g = bornTo + 1; g <= f; g++) {
      const w = frameData(g, f0.wound).wound;
      for (let k = 0; k < COUNT; k++) if (w[k]) woundSeen[k] = 1; else if (woundSeen[k] && bornPb[k] < 0) bornPb[k] = g;
    }
    bornTo = Math.max(bornTo, f);
  }
  const bornLive = new Int32Array(COUNT).fill(-1); let liveSteps = 0, liveData = null;
  // (re)start on a playback: frame cache, frame 0, cell ages and the wound centre for the camera presets
  let woundC = new THREE.Vector3();
  function load(p) {
    if (p.W !== FW || p.H !== FH) throw new Error(`playback ${p.name} is ${p.H}x${p.W} sites, the 3D field is ${FH}x${FW}`);
    pb = p; cache = new Map(); wf0 = pb.wound_frac[0] || 1;
    f0 = frameData(0, null); classify(f0, f0.wound);
    SPAN_PB = Math.max(60, 0.6 * pb.wound_frac.length); bornPb.fill(-1); woundSeen.fill(0); bornTo = -1;
    let sx = 0, sz = 0, n = 0; for (let k = 0; k < COUNT; k++) if (f0.wound[k]) { sx += wx[k]; sz += wz[k]; n++; }
    woundC = n ? new THREE.Vector3(sx / n, 0, sz / n) : new THREE.Vector3();
  }
  load(pb);

  // model outline (area-matched contour, smooth.js rule)
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.8 });
  const outlineGroup = new THREE.Group(); scene.add(outlineGroup);
  const siteToWorld = (x, y) => V(X0 + x * S, HMAX * 0.9, Z0 + y * S);
  function drawOutline(disp) {
    outlineGroup.children.forEach(c => c.geometry.dispose()); outlineGroup.clear();
    outlineMat.opacity = 0.8 * (disp?.opacity ?? 0);
    if (!disp || disp.opacity <= 0.05 || !disp.lines.length) return;
    for (const l of disp.lines) {
      const pts = []; for (let i = 0; i + 1 < l.length; i += 2) pts.push(siteToWorld(l[i], l[i + 1]));
      outlineGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outlineMat));
    }
  }

  let sel = null, cur = null, moving = true, heat = false;   // heat: age heatmap overlay on non-wound hexes (look.js heatColour)
  // ---------- edge-stall overlay: front speed from the real wound's area change (prev = the frame matching the area dt
  // hours earlier); the hex grid is read as a rectangle (10 µm hexes), edges below the stall pace (eval/flags.py rule) red ----------
  let stall = null, stallOpts = null;
  const HEX_UM = SITE_UM * DX;
  function computeStall() {
    if (!stallOpts || !cur?.wound) { stall = null; return; }
    const m0 = frameData(frameForArea(stallOpts.prevArea), f0.wound).wound, m1 = cur.wound;
    const e = edgeSpeed(m0, m1, NY, NX, stallOpts.dtHours, HEX_UM);
    const front = new Float32Array(COUNT).fill(NaN); for (const p of e.sites) front[p.i] = p.v;
    let wn = 0; for (let k = 0; k < COUNT; k++) wn += m1[k];
    const pace = stallSpeed(wn * HEX_UM * HEX_UM * HY, e.sites.length * HEX_UM, stallOpts.cutH, stallOpts.horizonH);
    const v = new Float32Array(COUNT).fill(NaN); let edges = 0, slow = 0;
    for (let k = 0; k < COUNT; k++) {
      if (m1[k]) continue; let b = Infinity;
      for (let q = 6 * k; q < 6 * k + 6; q++) { const m = nb[q]; if (m >= 0 && !Number.isNaN(front[m])) b = Math.min(b, front[m]); }
      if (b < Infinity) { v[k] = b; edges++; if (pace != null && b < pace) slow++; }
    }
    stall = { v, pace, stalledFrac: edges ? slow / edges : 0 };
  }
  const liveFd = { dens: new Float32Array(COUNT), wound: new Uint8Array(COUNT), state: new Uint8Array(COUNT) };   // reused per live step
  // full write: instance placement + membership (colour mesh inside the selection, grey mesh outside) + colours
  function writeAll() {
    for (let k = 0; k < COUNT; k++) {
      const on = inSelA[k], o = 16 * k, h = Math.max(0.03, hNow[k]) * HMAX;
      for (const [m, mine] of [[cm, on], [dm, !on]]) {
        m.fill(0, o, o + 16); m[o + 15] = 1;
        if (mine) { m[o] = 1; m[o + 5] = h; m[o + 10] = 1; m[o + 12] = wx[k]; m[o + 14] = wz[k]; }
      }
    }
    dull.visible = !!sel; cols.instanceMatrix.needsUpdate = dull.instanceMatrix.needsUpdate = true;
    writeColours();
  }
  // colours (look.js cellColour, or heatColour under the age heatmap), only for hexes whose state or age changed since
  // they were last written (setHeat clears lastAge so every hex is rewritten once)
  function writeColours() {
    const st = cur.state;
    for (let k = 0; k < COUNT; k++) {
      const s = st[k], a = age[k]; if (s === lastS[k] && a === lastAge[k]) continue;
      lastS[k] = s; lastAge[k] = a;
      const o = 3 * k, g = GREY[s] * (s === 1 ? 0.85 + 0.3 * rnd[k] : 1);
      if (stall) { const v = stall.v[k]; if (!Number.isNaN(v)) col.setHex(stall.pace != null && v < stall.pace ? STALL.stalled : STALL.moving); else { cellColour(col, STATES[s], a, rnd[k], ramp); col.multiplyScalar(STALL.dim); } }
      else if (heat && s !== 0) heatColour(col, a, ramp); else cellColour(col, STATES[s], a, rnd[k], ramp);
      cc[o] = col.r; cc[o + 1] = col.g; cc[o + 2] = col.b; dc[o] = dc[o + 1] = dc[o + 2] = g;
    }
    cols.instanceColor.needsUpdate = dull.instanceColor.needsUpdate = true;
  }
  // mockup heights by state: wound floor, leading edge at most 0.6 (lower where the density is), healed tissue 0.7 -> 1
  // over its first 25 steps, then intact x (0.92 + 0.16 rnd)
  function writeTargets() {
    const st = cur.state, d = cur.dens;
    for (let k = 0; k < COUNT; k++) {
      const s = st[k];
      tgt[k] = s === 0 ? HEIGHT.wound : s === 2 ? Math.max(HEIGHT.wound, Math.min(HEIGHT.edge, d[k])) : colHeight(age[k] < 25 ? "fresh" : "intact", age[k], rnd[k]);
    }
  }
  // per frame: ease heights toward their targets, write only the height entry; stop once settled
  function ease(dt) {
    const a = Math.min(1, dt * 6); let mx = 0;
    for (let k = 0; k < COUNT; k++) {
      const e = tgt[k] - hNow[k]; if (e > mx) mx = e; else if (-e > mx) mx = -e;
      hNow[k] += e * a; const h = (hNow[k] < 0.03 ? 0.03 : hNow[k]) * HMAX;
      (inSelA[k] ? cm : dm)[16 * k + 5] = h;
    }
    cols.instanceMatrix.needsUpdate = dull.instanceMatrix.needsUpdate = true;
    moving = mx > 1e-3;
  }
  function show(fd, born, now, span) {
    cur = fd; if (span !== ramp.span) { ramp.span = span; lastAge.fill(NaN); }
    for (let k = 0; k < COUNT; k++) age[k] = born[k] >= 0 && born[k] <= now ? now - born[k] : Infinity;
    writeColours(); writeTargets(); moving = true;
  }

  // ---------- picking: march the ray down through the height field (no mesh raycast) ----------
  const ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), topPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HMAX);
  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
  }
  function floorHit(e) { setRay(e); const p = new THREE.Vector3(); return ray.ray.intersectPlane(floor, p) ? p : null; }
  const inField = (u, v) => u >= 0 && v >= 0 && u <= FW && v <= FH;
  function pick(e) {   // -> hex k under the pointer (top of its column), or -1
    setRay(e);
    if (!ray.ray.intersectPlane(floor, pB)) return -1;
    if (!ray.ray.intersectPlane(topPlane, pA)) pA.copy(pB);
    for (let s = 0; s <= 32; s++) {
      const t = s / 32, x = pA.x + (pB.x - pA.x) * t, y = pA.y + (pB.y - pA.y) * t, z = pA.z + (pB.z - pA.z) * t;
      const u = (x - X0) / S, v = (z - Z0) / S; if (!inField(u, v)) continue;
      const k = hexAt(u, v); if (y <= Math.max(0.03, hNow[k]) * HMAX + 1e-6) return k;
    }
    const u = (pB.x - X0) / S, v = (pB.z - Z0) / S; return inField(u, v) ? hexAt(u, v) : -1;
  }

  // ---------- tools: one slot, "select" (drag a box on the floor) or a brush ----------
  // brush = { radius (sites), onPaint({ k, u, v, radius }) }. While on, left drag / one finger paints and the orbit
  // moves to right drag / two fingers (wheel still zooms).
  const selMesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0a458 })); scene.add(selMesh);
  const ring = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0a458 })); ring.visible = false; scene.add(ring);
  let tool = null, brush = null, dragStart = null, painting = false, lastK = -1;
  function setTool(t, b = null) {
    tool = t; brush = t === "brush" ? b : null; painting = false; dragStart = null; ring.visible = false; lastK = -1;
    controls.enabled = t !== "select";
    controls.mouseButtons.LEFT = brush ? -1 : THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = brush ? THREE.MOUSE.ROTATE : -1;   // right drag = box zoom
    controls.touches.ONE = brush ? -1 : THREE.TOUCH.ROTATE;
    canvas.style.cursor = t ? "crosshair" : "";
    if (brush) {   // ring built once per brush; it only moves afterwards
      const pts = []; for (let a = 0; a < 48; a++) { const th = a / 48 * 2 * Math.PI; pts.push(V(Math.cos(th) * brush.radius * S, 0, Math.sin(th) * brush.radius * S)); }
      ring.geometry.dispose(); ring.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
  }
  function drawSelBox() {
    selMesh.geometry.dispose();
    if (!sel) { selMesh.geometry = new THREE.BufferGeometry(); return; }
    const y = 0.05, { x0, z0, x1, z1 } = sel, h = top * 0.8;
    selMesh.geometry = new THREE.BufferGeometry().setFromPoints([V(x0, y, z0), V(x1, y, z0), V(x1, y, z0), V(x1, y, z1), V(x1, y, z1), V(x0, y, z1), V(x0, y, z1), V(x0, y, z0),
      V(x0, 0, z0), V(x0, h, z0), V(x1, 0, z0), V(x1, h, z0), V(x1, 0, z1), V(x1, h, z1), V(x0, 0, z1), V(x0, h, z1)]);
  }
  function setSel(s) {
    sel = s; for (let k = 0; k < COUNT; k++) inSelA[k] = !sel || (wx[k] >= sel.x0 && wx[k] <= sel.x1 && wz[k] >= sel.z0 && wz[k] <= sel.z1) ? 1 : 0;
    drawSelBox(); writeAll();
  }
  function selStats() {
    if (!sel) return null;
    const c = { intact: 0, edge: 0, fresh: 0, wound: 0 }; let n = 0, h = 0;
    for (let k = 0; k < COUNT; k++) if (inSelA[k]) { c[STATES[cur.state[k]]]++; n++; h += cur.dens[k]; }
    if (!n) return null;
    return { w_um: Math.round((sel.x1 - sel.x0) / S * SITE_UM), d_um: Math.round((sel.z1 - sel.z0) / S * SITE_UM),
      sites: n, open: c.wound / n, density: h / n, counts: c };
  }
  const emitSel = () => onSelection && onSelection(selStats());
  function hover(e, k) {
    if (!onHover) return;
    if (k < 0) return onHover(null);
    const r = canvas.getBoundingClientRect(), i = k % NX, j = (k / NX) | 0;
    onHover({ i, j, x_um: Math.round(hu[k] * SITE_UM), y_um: Math.round(hv[k] * SITE_UM), state: STATES[cur.state[k]], density: cur.dens[k], px: e.clientX - r.left, py: e.clientY - r.top });
  }
  function paint(e) {
    const k = pick(e); ring.visible = k >= 0;
    if (k >= 0 && k !== lastK) ring.position.set(wx[k], Math.max(0.03, hNow[k]) * HMAX + 0.02, wz[k]);
    if (k >= 0 && painting && k !== lastK) brush.onPaint({ k, u: hu[k], v: hv[k], radius: brush.radius });
    lastK = k; return k;
  }
  let zoomDrag = null;
  const onDown = e => {
    if (brush && e.button === 0) { painting = true; lastK = -1; canvas.setPointerCapture(e.pointerId); paint(e); return; }
    if (!brush && e.button === 2) { zoomDrag = floorHit(e); return; }
    if (tool === "select") dragStart = floorHit(e);
  };
  const onMove = e => {
    if (zoomDrag) {
      const p = floorHit(e); if (!p) return;
      sel = { x0: Math.min(zoomDrag.x, p.x), x1: Math.max(zoomDrag.x, p.x), z0: Math.min(zoomDrag.z, p.z), z1: Math.max(zoomDrag.z, p.z) };
      drawSelBox(); return;
    }
    if (tool === "select" && dragStart) {
      const p = floorHit(e); if (!p) return;
      sel = { x0: Math.min(dragStart.x, p.x), x1: Math.max(dragStart.x, p.x), z0: Math.min(dragStart.z, p.z), z1: Math.max(dragStart.z, p.z) };
      drawSelBox(); return;
    }
    hover(e, brush ? paint(e) : pick(e));
  };
  const onUp = () => {
    painting = false;
    if (zoomDrag) { zoomDrag = null; const b = sel; sel = null; drawSelBox(); if (b && b.x1 - b.x0 >= 0.5 && b.z1 - b.z0 >= 0.5) zoomToBox(b); return; }
    if (tool !== "select" || !dragStart) return; dragStart = null; setTool(null);
    setSel(sel && (sel.x1 - sel.x0 < 0.5 || sel.z1 - sel.z0 < 0.5) ? null : sel); emitSel();
  };
  const onLeave = () => { ring.visible = false; lastK = -1; onHover && onHover(null); };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", onLeave);
  const onContext = e => e.preventDefault(); canvas.addEventListener("contextmenu", onContext);
  controls.mouseButtons.RIGHT = -1;

  // ---------- camera presets: field (x1), wound (x10, about 16 sites across), cells (x40, a few sites) ----------
  function edgePoint() {
    let best = null, bd = Infinity;
    for (let k = 0; k < COUNT; k++) if (cur.state[k] === 2) { const d = (wx[k] - woundC.x) ** 2 + (wz[k] - woundC.z - 2) ** 2; if (d < bd) { bd = d; best = V(wx[k], 0, wz[k]); } }
    return best || woundC;
  }
  const views = {
    field: () => ({ p: V(-11, 11, 15), t: V(0, 0.2, 0) }),
    wound: () => ({ p: woundC.clone().add(V(-3.6, 4, 5)), t: woundC.clone().add(V(0, 0.3, 0)) }),
    cells: () => { const e = edgePoint(); return { p: e.clone().add(V(-1.1, 1.5, 1.6)), t: e.clone().add(V(0, 0.35, 0)) }; },
  };
  let fly = null, view = "field";
  function goTo(n) { view = n; const v = views[n](); fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: v.p, q1: v.t }; }
  { const v = views.field(); camera.position.copy(v.p); controls.target.copy(v.t); }
  const easeIO = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function zoom(dir) {
    const off = camera.position.clone().sub(controls.target).multiplyScalar(dir > 0 ? 0.8 : 1.25);
    const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length()));
    camera.position.copy(controls.target).add(off.setLength(len));
  }
  function zoomToBox(b) {
    const c = V((b.x0 + b.x1) / 2, 0.3, (b.z0 + b.z1) / 2), span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, span / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.15));
    view = "box"; fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: c.clone().add(dir.multiplyScalar(dist)), q1: c };
  }
  // zoom level 0 (whole field) .. 1 (closest), log-scaled camera distance
  const FIELD_D = views.field().p.distanceTo(views.field().t), NEAR_D = controls.minDistance * 1.2;
  const zoomLevel = () => { const d = camera.position.distanceTo(controls.target); return Math.max(0, Math.min(1, Math.log(FIELD_D / d) / Math.log(FIELD_D / NEAR_D))); };
  function setZoom(z) { const d = FIELD_D * Math.pow(NEAR_D / FIELD_D, Math.max(0, Math.min(1, z))); const off = camera.position.clone().sub(controls.target); camera.position.copy(controls.target).add(off.setLength(d)); }

  // screen length of 100 µm at the orbit target (for the HUD scale bar)
  const sa = new THREE.Vector3(), sb = new THREE.Vector3();
  function pxPer100um() {
    sa.copy(controls.target); sb.copy(sa); sb.x += (100 / SITE_UM) * S;
    sa.project(camera); sb.project(camera);
    return Math.abs(sb.x - sa.x) / 2 * canvas.clientWidth;
  }

  // ---------- loop ----------
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  const clock = new THREE.Clock();
  let onFrameCb = null;
  bornUpTo(0); show(f0, bornPb, 0, SPAN_PB); writeAll();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (moving) { ease(reduced ? 1 : dt); if (sel && !moving) emitSel(); }
    if (fly) { fly.t = reduced ? 1 : Math.min(1, fly.t + dt / 1.4); const e = easeIO(fly.t); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e); if (fly.t >= 1) fly = null; }
    controls.update(); renderer.render(scene, camera);
    onFrameCb && onFrameCb();
  });

  return {
    frameForArea,
    // swap to another playback of the same field size; shows its frame 0 (cell ages restart)
    setPlayback(p) {
      if (p === pb) return;
      load(p); bornUpTo(0); show(f0, bornPb, 0, SPAN_PB); drawOutline(f0.outline);
      if (stallOpts) { computeStall(); lastAge.fill(NaN); writeColours(); }
    },
    playback: () => pb,
    showArea(area) {
      const f = frameForArea(area); if (cur && f === cur.f) return cur;
      bornUpTo(f); show(frameData(f, f0.wound), bornPb, f, SPAN_PB); drawOutline(cur.outline);
      if (stallOpts) { computeStall(); lastAge.fill(NaN); writeColours(); }
      return cur;
    },
    // edge-stall overlay: opts = { prevArea, dtHours, cutH, horizonH } or null (off) -> { pace, stalledFrac } | null
    setStall(opts) { stallOpts = opts; computeStall(); lastAge.fill(NaN); if (cur) writeColours(); return stall && { pace: stall.pace, stalledFrac: stall.stalledFrac }; },
    isStall: () => !!stallOpts, zoomLevel, setZoom,
    // live field { data, w, h, perSite, norm?, level, step? } sampled onto the hexes; `fresh` (Uint8Array per hex) is kept
    // by the caller: pass the same array each time and it accumulates every hex that was ever wound (clear it on reset).
    // step (optional): the NCA step of this state, for speed-independent cell ages; default = states received so far
    showLive(field, fresh) {
      const { dens, wound } = liveFd; sample(field, dens);
      if (field.data !== liveData) { liveData = field.data; liveSteps++; }
      const now = field.step ?? liveSteps;
      for (let k = 0; k < COUNT; k++) {
        wound[k] = dens[k] < field.level ? 1 : 0;
        if (wound[k]) { fresh[k] = 1; bornLive[k] = -2; } else if (!fresh[k]) bornLive[k] = -1; else if (bornLive[k] === -2) bornLive[k] = now;
      }
      if (cur !== liveFd) drawOutline(null);
      show(classify(liveFd, fresh), bornLive, now, SPAN_LIVE);
    },
    current: () => cur,
    stateOf: k => STATES[cur.state[k]],
    grid: { NX, NY, COUNT, u: hu, v: hv, spacing: DX, W: FW, H: FH },
    setSelecting(on) { setTool(on ? "select" : null); }, isSelecting: () => tool === "select",
    setBrush(b) { setTool(b ? "brush" : null, b); },
    clearSelection() { setSel(null); emitSel(); },
    hasSelection: () => !!sel,
    goTo, view: () => view, reset() { goTo("field"); }, zoom, pxPer100um,
    onFrame(cb) { onFrameCb = cb; },
    // age heatmap overlay: recolours only (no change to heights, playback or the live run)
    setHeat(on) { heat = !!on; lastAge.fill(NaN); if (cur) writeColours(); }, isHeat: () => heat,
    snapshot: () => canvas.toDataURL("image/png"),
    dispose() {
      renderer.setAnimationLoop(null); ro.disconnect(); controls.dispose();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("contextmenu", onContext);
      scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
      renderer.dispose(); canvas.remove();
    },
  };
}
