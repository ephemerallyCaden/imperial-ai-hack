// 3D tissue field for Assay (look from web/vendor-design/glass-dish-main.js): one hex column per lattice site,
// height = local density, colour = cell state. Box-select keeps the selection in colour and drops the rest to matte
// greyscale (one grey step per state). The cells are SIMULATED (P2's cell-agent playback, web/public/sim), never
// tracked cells: the frame shown is the playback frame whose wound area matches the area curve at time t.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { viewFrame } from "../public/sim/js/playback.js";

export const SITE_UM = 20;                               // one lattice site = one cell = 20 µm (docs/p2-handoff.md)
const PAL = { intact: 0x1F4F5C, edge: 0xEE7F2D, fresh: 0xF9D6FB, wound: 0x0B1116 };   // tokens.css --cell-*
const DARK = { wound: 0.0, intact: 0.010, edge: 0.045, fresh: 0.11 };                // tokens.css --ghost-* (linear)
export const STATE_LABEL = { wound: "wound (no cells)", intact: "intact sheet", edge: "leading edge", fresh: "new tissue" };
const HY = Math.sqrt(3) / 2, S = 0.5, HMAX = 0.7;

export function createTissue(host, pb, { onSelection, onHover } = {}) {
  const NX = pb.W, NY = pb.H, COUNT = NX * NY;
  const cxOf = (i, j) => i + (j & 1) * 0.5, cyOf = j => j * HY;
  const W = NX - 0.5, D = (NY - 1) * HY;
  const X0 = -W * S / 2, Z0 = -D * S / 2;
  const nb = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const n = (j & 1) ? [[i - 1, j], [i + 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
      : [[i - 1, j], [i + 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]];
    nb.push(n.filter(([a, b]) => a >= 0 && b >= 0 && a < NX && b < NY).map(([a, b]) => b * NX + a));
  }
  const pos = k => { const i = k % NX, j = (k / NX) | 0; return [X0 + cxOf(i, j) * S, Z0 + cyOf(j) * S]; };

  // ---------- per-frame site data from the playback (cached): density per site + wound mask at the outline level ----------
  const cache = new Map();
  function frameData(f) {
    if (cache.has(f)) return cache.get(f);
    const { fine, outline } = viewFrame(pb, f), k = fine.scale, dens = new Float32Array(COUNT), wound = new Uint8Array(COUNT);
    const level = outline.level == null ? -1 : outline.level * 255;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      let a = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) a += fine.data[(j * k + dy) * fine.w + i * k + dx];
      a /= k * k; dens[j * NX + i] = a / 255; wound[j * NX + i] = a < level ? 1 : 0;
    }
    const d = { f, dens, wound, outline: outline.display, t: pb.t_hours[f], wf: pb.wound_frac[f] };
    cache.set(f, d); return d;
  }
  const f0 = frameData(0);
  const stateOf = (fd, k) => {
    if (fd.wound[k]) return "wound";
    for (const m of nb[k]) if (fd.wound[m]) return "edge";
    return f0.wound[k] ? "fresh" : "intact";
  };
  const wf0 = pb.wound_frac[0];
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
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050607);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 1.5; controls.maxDistance = 80; controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101018, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-30, 60, 25); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe4e6ea, 0.5); fill.position.set(40, 20, -30); scene.add(fill);

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
  label("local density (simulated)", V(xa - 0.2, top + 0.6, za), 0.5, "#e8ecef").center.set(1, 0.5);

  // ---------- columns: coloured + matte greyscale (outside a selection) ----------
  const colGeo = new THREE.CylinderGeometry(0.5 * S * 1.1, 0.5 * S * 1.1, 1, 6); colGeo.translate(0, 0.5, 0); colGeo.rotateY(Math.PI / 6);
  const cols = new THREE.InstancedMesh(colGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), COUNT);
  const dull = new THREE.InstancedMesh(colGeo, new THREE.MeshLambertMaterial(), COUNT);
  scene.add(cols, dull);
  const rnd = Float32Array.from({ length: COUNT }, (_, k) => ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1);  // fixed shade jitter
  const hNow = new Float32Array(COUNT).fill(0.5), states = new Array(COUNT).fill("intact");
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // simulated outline (area-matched contour from smooth.js), labelled uncalibrated
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.8 });
  const outlineGroup = new THREE.Group(); scene.add(outlineGroup);
  const outlineLabel = label("simulated outline (uncalibrated)", V(0, HMAX * 1.1, 0), 0.4, "#e8ecef", scene);
  const siteToWorld = (x, y) => V(X0 + (x - 0.25) * S, HMAX * 0.9, Z0 + (y - 0.5) * HY * S);
  function drawOutline(disp) {
    outlineGroup.children.forEach(c => c.geometry.dispose()); outlineGroup.clear();
    outlineMat.opacity = 0.8 * (disp?.opacity ?? 0);
    outlineLabel.visible = !!disp && disp.opacity > 0.05 && disp.lines.length > 0;
    if (!outlineLabel.visible) return;
    let best = null;
    for (const l of disp.lines) {
      const pts = []; for (let i = 0; i + 1 < l.length; i += 2) pts.push(siteToWorld(l[i], l[i + 1]));
      outlineGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outlineMat));
      for (const p of pts) if (!best || p.z < best.z) best = p;
    }
    if (best) outlineLabel.position.set(best.x, HMAX * 1.15, best.z - 0.3);
  }

  let sel = null, cur = f0, dirty = true, settle = 0;
  const inSel = k => { if (!sel) return true; const [x, z] = pos(k); return x >= sel.x0 && x <= sel.x1 && z >= sel.z0 && z <= sel.z1; };
  function updateColumns(dt) {
    const ease = Math.min(1, dt * 6);
    for (let k = 0; k < COUNT; k++) {
      const st = stateOf(cur, k); states[k] = st;
      hNow[k] += (cur.dens[k] - hNow[k]) * ease;
      const [x, z] = pos(k), h = Math.max(0.03, hNow[k]) * HMAX, on = inSel(k);
      m4.makeScale(1, h, 1).setPosition(x, 0, z);
      if (on) { col.setHex(PAL[st]); if (st === "intact") col.multiplyScalar(0.85 + 0.3 * rnd[k]); cols.setColorAt(k, col); }
      else { const g = DARK[st] * (st === "intact" ? 0.85 + 0.3 * rnd[k] : 1); col.setRGB(g, g, g); dull.setColorAt(k, col); }
      cols.setMatrixAt(k, on ? m4 : ZERO); dull.setMatrixAt(k, on ? ZERO : m4);
    }
    cols.instanceMatrix.needsUpdate = dull.instanceMatrix.needsUpdate = true;
    if (cols.instanceColor) cols.instanceColor.needsUpdate = true;
    if (dull.instanceColor) dull.instanceColor.needsUpdate = true;
  }

  // ---------- selection: drag a box on the floor ----------
  const ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  const selMesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0a458 })); scene.add(selMesh);
  let selecting = false, dragStart = null;
  function floorHit(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3(); return ray.ray.intersectPlane(floor, p) ? p : null;
  }
  function drawSelBox() {
    selMesh.geometry.dispose();
    if (!sel) { selMesh.geometry = new THREE.BufferGeometry(); return; }
    const y = 0.05, { x0, z0, x1, z1 } = sel, h = top * 0.8;
    selMesh.geometry = new THREE.BufferGeometry().setFromPoints([V(x0, y, z0), V(x1, y, z0), V(x1, y, z0), V(x1, y, z1), V(x1, y, z1), V(x0, y, z1), V(x0, y, z1), V(x0, y, z0),
      V(x0, 0, z0), V(x0, h, z0), V(x1, 0, z0), V(x1, h, z0), V(x1, 0, z1), V(x1, h, z1), V(x0, 0, z1), V(x0, h, z1)]);
  }
  function selStats() {
    if (!sel) return null;
    const c = { intact: 0, edge: 0, fresh: 0, wound: 0 }; let n = 0, h = 0;
    for (let k = 0; k < COUNT; k++) if (inSel(k)) { c[states[k]]++; n++; h += cur.dens[k]; }
    if (!n) return null;
    return { w_um: Math.round((sel.x1 - sel.x0) / S * SITE_UM), d_um: Math.round((sel.z1 - sel.z0) / (S * HY) * SITE_UM),
      sites: n, open: c.wound / n, density: h / n, counts: c };
  }
  const emitSel = () => onSelection && onSelection(selStats());
  const onDown = e => { if (selecting) dragStart = floorHit(e); };
  const onMove = e => {
    if (selecting && dragStart) {
      const p = floorHit(e); if (!p) return;
      sel = { x0: Math.min(dragStart.x, p.x), x1: Math.max(dragStart.x, p.x), z0: Math.min(dragStart.z, p.z), z1: Math.max(dragStart.z, p.z) };
      drawSelBox(); dirty = true; return;
    }
    if (!onHover) return;
    const p = floorHit(e); if (!p) return onHover(null);
    const j = Math.round((p.z - Z0) / (HY * S)), i = Math.round((p.x - X0) / S - (j & 1) * 0.5);
    if (i < 0 || j < 0 || i >= NX || j >= NY) return onHover(null);
    const k = j * NX + i, r = canvas.getBoundingClientRect();
    onHover({ i, j, x_um: i * SITE_UM, y_um: j * SITE_UM, state: states[k], density: cur.dens[k], px: e.clientX - r.left, py: e.clientY - r.top });
  };
  const onUp = () => {
    if (!selecting || !dragStart) return; dragStart = null; setSelecting(false);
    if (sel && (sel.x1 - sel.x0 < 0.5 || sel.z1 - sel.z0 < 0.5)) { sel = null; drawSelBox(); }
    dirty = true; emitSel();
  };
  const onLeave = () => onHover && onHover(null);
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", onLeave);
  function setSelecting(on) { selecting = on; controls.enabled = !on; canvas.style.cursor = on ? "crosshair" : ""; }

  // ---------- camera presets: field (x1), wound (x10, about 10 cells across), cells (x40, a few cells) ----------
  let woundC = V(0, 0, 0);
  { let sx = 0, sz = 0, n = 0; for (let k = 0; k < COUNT; k++) if (f0.wound[k]) { const [x, z] = pos(k); sx += x; sz += z; n++; } if (n) woundC = V(sx / n, 0, sz / n); }
  function edgePoint() {
    let best = null, bd = Infinity;
    for (let k = 0; k < COUNT; k++) if (states[k] === "edge") { const [x, z] = pos(k), d = (x - woundC.x) ** 2 + (z - woundC.z - 2) ** 2; if (d < bd) { bd = d; best = V(x, 0, z); } }
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

  // screen length of 100 µm at the orbit target (for the HUD scale bar)
  function pxPer100um() {
    const a = controls.target.clone(), b = a.clone(); b.x += (100 / SITE_UM) * S;
    a.project(camera); b.project(camera);
    return Math.abs(b.x - a.x) / 2 * canvas.clientWidth;
  }

  // ---------- loop ----------
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  const clock = new THREE.Clock();
  let onFrameCb = null;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (dirty) { settle = 1.2; dirty = false; }
    if (settle > 0) { settle -= dt; updateColumns(reduced ? 1 : dt); if (sel) emitSel(); }
    if (fly) { fly.t = reduced ? 1 : Math.min(1, fly.t + dt / 1.4); const e = easeIO(fly.t); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e); if (fly.t >= 1) fly = null; }
    controls.update(); renderer.render(scene, camera);
    onFrameCb && onFrameCb();
  });

  return {
    frameForArea,
    showArea(area) {
      const f = frameForArea(area); if (f === cur.f) return cur;
      cur = frameData(f); drawOutline(cur.outline); dirty = true; return cur;
    },
    current: () => cur,
    states: () => states,
    stateOf: k => stateOf(cur, k),
    grid: { NX, NY },
    setSelecting, isSelecting: () => selecting,
    clearSelection() { sel = null; drawSelBox(); dirty = true; emitSel(); },
    hasSelection: () => !!sel,
    goTo, view: () => view, reset() { goTo("field"); }, zoom, pxPer100um,
    onFrame(cb) { onFrameCb = cb; },
    snapshot: () => canvas.toDataURL("image/png"),
    dispose() {
      renderer.setAnimationLoop(null); ro.disconnect(); controls.dispose();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave);
      scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
      renderer.dispose(); canvas.remove();
    },
  };
}
