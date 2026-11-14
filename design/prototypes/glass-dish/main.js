// Stitch look-dev v4: floating 3D graph space. Each simulated cell is a hex column; height = local
// density (healthy tall, wound low), colour = cell state (M8 palette). Box-select an area: it stays in
// colour while the rest drops to dark greyscale (each state keeps its own grey step). Readouts/curve from Rand's embryo export (sample).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const data = await (await fetch('./sample/forecast_embryo_20min.json')).json();
const wound = data.wounds.find(w => w.group === 'WH' && w.p_close_by > 0.8) || data.wounds[0];
// colour-blind-safe teal/vermillion: min ΔE ~26 under protan/deutan/tritan sim (Machado 2009), and states step
// ~20-30 apart in lightness (L 5/31/65/82/100) so they still read in greyscale
const PAL = { intact: 0x1F4F5C, edge: 0xEE7F2D, fresh: 0xF2B8F5, dividing: 0xFFFFFF, wound: 0x0B1116 };
// look-dev params: ?pal=intact,edge,fresh,dividing,wound (hex) overrides colours; ?bare&t=30&view=close hides HUD, freezes time
const Q = new URLSearchParams(location.search);
if (Q.get('pal')) Q.get('pal').split(',').forEach((h, i) => { PAL[['intact', 'edge', 'fresh', 'dividing', 'wound'][i]] = parseInt(h, 16); });
document.querySelectorAll('.legend .st i').forEach((el, i) => { el.style.background = '#' + PAL[['intact', 'edge', 'fresh', 'dividing', 'wound'][i]].toString(16).padStart(6, '0'); });
if (Q.has('bare')) document.body.classList.add('bare');
const HEIGHT = { intact: 1.0, dividing: 1.0, edge: 0.6, wound: 0.08 };   // relative density

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050607);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 120; controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101018, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-30, 60, 25); scene.add(key);
const fill = new THREE.DirectionalLight(0xe4e6ea, 0.5); fill.position.set(40, 20, -30); scene.add(fill);

// ---------- hex lattice + simulation (stand-in for P2's cell simulator) ----------
const NX = 90, NY = 104, HY = Math.sqrt(3) / 2;
const cxOf = (i, j) => i + (j & 1) * 0.5, cyOf = j => j * HY;
const W = NX - 0.5, D = NY * HY;
const idx = (i, j) => j * NX + i;
const nb = [];
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const n = (j & 1) ? [[i - 1, j], [i + 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
    : [[i - 1, j], [i + 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]];
  nb.push(n.filter(([a, b]) => a >= 0 && b >= 0 && a < NX && b < NY).map(([a, b]) => idx(a, b)));
}
const COUNT = NX * NY, rnd = Float32Array.from({ length: COUNT }, Math.random);
const frames = [];
{
  const occ = new Uint8Array(COUNT), born = new Int16Array(COUNT).fill(-999);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = cxOf(i, j), y = cyOf(j), c = W / 2 + 4 * Math.sin(y / 9);
    occ[idx(i, j)] = Math.abs(x - c) >= 14 + 3 * Math.sin(y / 5 + 1) ? 1 : 0;
  }
  const gap = () => occ.reduce((s, v) => s + (v ? 0 : 1), 0), g0 = gap();
  for (let s = 0; s < 600; s++) {
    frames.push({ occ: occ.slice(), born: born.slice(), step: s, area: gap() / g0 });
    if (frames.at(-1).area < 0.003) break;
    const next = occ.slice();
    for (let k = 0; k < COUNT; k++) {
      if (occ[k]) continue; let n = 0; for (const m of nb[k]) n += occ[m];
      if (n && Math.random() < 0.02 * n) { next[k] = 1; born[k] = s; }
    }
    occ.set(next);
  }
}
function stateOf(f, k) {
  if (!f.occ[k]) return 'wound';
  const age = f.step - f.born[k];
  if (age >= 0 && age < 2 && rnd[k] < 0.08) return 'dividing';
  for (const m of nb[k]) if (!f.occ[m]) return 'edge';
  if (age >= 0 && age < 25) return 'fresh';
  return 'intact';
}
const targetH = (f, k, st) => st === 'fresh' ? 0.7 + 0.3 * Math.min(1, (f.step - f.born[k]) / 25) : HEIGHT[st];

// ---------- graph space: axis frame, floor grid, rulers ----------
const S = 0.5;                           // world units per lattice unit
const X0 = -W * S / 2, Z0 = -D * S / 2, HMAX = 0.65;  // column height scale
const frame = new THREE.Group(); scene.add(frame);
const lineMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.28 });
const faint = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.08 });
const seg = (pts, m = lineMat) => frame.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), m));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const xa = X0 - 1.5, xb = -X0 + 1.5, za = Z0 - 1.5, zb = -Z0 + 1.5, top = HMAX * 1.25;
// floor grid every 50 um (1 lattice unit ~ 10 um, so 5 units)
const UM = 10, step = 5 * S, gridPts = [];
for (let x = xa; x <= xb + 1e-6; x += step) gridPts.push(V(x, 0, za), V(x, 0, zb));
for (let z = za; z <= zb + 1e-6; z += step) gridPts.push(V(xa, 0, z), V(xb, 0, z));
seg(gridPts, faint);
// box edges + back walls
seg([V(xa, 0, za), V(xb, 0, za), V(xb, 0, za), V(xb, 0, zb), V(xb, 0, zb), V(xa, 0, zb), V(xa, 0, zb), V(xa, 0, za),
  V(xa, 0, za), V(xa, top, za), V(xb, 0, za), V(xb, top, za), V(xa, 0, zb), V(xa, top, zb),
  V(xa, top, za), V(xb, top, za), V(xa, top, za), V(xa, top, zb)]);
const wallPts = [];
for (let h = 0; h <= top; h += HMAX / 4) wallPts.push(V(xa, h, za), V(xb, h, za), V(xa, h, za), V(xa, h, zb));
seg(wallPts, faint);
// tick labels as sprites
function label(text, pos, size = 0.9, color = '#8a949c') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.font = '28px ui-monospace, Menlo, monospace'; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 4, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.set(size * 4, size, 1); sp.position.copy(pos); sp.center.set(0, 0.5); frame.add(sp); return sp;
}
for (let k = 0; k * step <= xb - xa + 1e-6; k += 4) label(`${k * 50}`, V(xa + k * step, 0, zb + 1.6), 0.8);
label('x (µm)', V(0, 0, zb + 3.6), 1.0, '#e8ecef');
for (let k = 0; k * step <= zb - za + 1e-6; k += 4) label(`${k * 50}`, V(xb + 1.2, 0, za + k * step), 0.8);
label('y (µm)', V(xb + 3.2, 0, 0), 1.0, '#e8ecef');
for (let q = 0; q <= 4; q++) label(q === 4 ? '1.0' : (q / 4).toFixed(2), V(xa - 0.4, q * HMAX / 4, za), 0.8).center.set(1, 0.5);
label('local density (relative)', V(xa - 0.4, top + 1.2, za), 1.0, '#e8ecef').center.set(1, 0.5);

// ---------- columns: coloured + ghost instanced meshes ----------
const colGeo = new THREE.CylinderGeometry(0.5 * S * 1.1, 0.5 * S * 1.1, 1, 6); colGeo.translate(0, 0.5, 0); colGeo.rotateY(Math.PI / 6);
const colMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
const cols = new THREE.InstancedMesh(colGeo, colMat, COUNT);
// outside-selection look (?ghost=): grey (default) | rims | dim | flat | dots | lift
const GHOST = Q.get('ghost') || 'grey', LIFT = 1.4;
// greyscale context: dark overall, but each state keeps its own step so the wound still reads (linear RGB)
const DARK = { wound: 0.0, intact: 0.010, edge: 0.045, fresh: 0.085, dividing: 0.14 };
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x0c1018, transparent: true, opacity: 0.55 });
const ghosts = new THREE.InstancedMesh(colGeo, ghostMat, COUNT);
const rimGeo = new THREE.RingGeometry(0.5 * S * 0.92, 0.5 * S * 1.1, 6, 1); rimGeo.rotateX(-Math.PI / 2);
const ghostRims = new THREE.InstancedMesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.32, depthWrite: false }), COUNT);
const dotGeo = new THREE.CircleGeometry(0.5 * S * 0.38, 6); dotGeo.rotateX(-Math.PI / 2);
const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial(), COUNT);
const dull = new THREE.InstancedMesh(colGeo, new THREE.MeshLambertMaterial(), COUNT);   // matte, no specular sheen: greyscale context
scene.add(cols, ghosts, ghostRims, dots, dull);
const hNow = new Float32Array(COUNT).fill(0.5), m4 = new THREE.Matrix4(), m4r = new THREE.Matrix4(), col = new THREE.Color(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const pos = k => { const i = k % NX, j = (k / NX) | 0; return [X0 + cxOf(i, j) * S, Z0 + cyOf(j) * S]; };
const states = new Array(COUNT).fill('intact');
let sel = null;                                          // {x0,z0,x1,z1} in world coords
const inSel = k => { if (!sel) return true; const [x, z] = pos(k); return x >= sel.x0 && x <= sel.x1 && z >= sel.z0 && z <= sel.z1; };
const toGrey = (c, f) => { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return c.setRGB(l, l, l).multiplyScalar(f); };

function updateColumns(f, dt) {
  const ease = Math.min(1, dt * 6);
  for (let k = 0; k < COUNT; k++) {
    const st = stateOf(f, k); states[k] = st;
    const tgt = targetH(f, k, st) * (st === 'intact' ? 0.92 + 0.16 * rnd[k] : 1);   // subtle unevenness
    hNow[k] += (tgt - hNow[k]) * ease;
    const [x, z] = pos(k), h = Math.max(0.02, hNow[k]) * HMAX;
    const on = inSel(k), lifted = sel && on && GHOST === 'lift';
    m4.makeScale(1, h, 1).setPosition(x, lifted ? LIFT : 0, z);
    col.setHex(PAL[st]); if (st === 'intact') col.multiplyScalar(0.85 + 0.3 * rnd[k]);
    let showCol = on, showGhost = false, showRim = false, showDot = false, showDull = false;
    if (!on) {
      if (GHOST === 'rims') { showGhost = showRim = true; }
      else if (GHOST === 'grey') { showDull = true; const g = DARK[st] * (st === 'intact' ? 0.85 + 0.3 * rnd[k] : 1); col.setRGB(g, g, g); dull.setColorAt(k, col); }
      else if (GHOST === 'lift') { showCol = true; toGrey(col, 0.45); }
      else if (GHOST === 'dim') { showCol = true; col.multiplyScalar(0.22); }
      else if (GHOST === 'flat') { showCol = true; m4.makeScale(1, 0.015, 1).setPosition(x, 0, z); toGrey(col, 0.4); }
      else if (GHOST === 'dots') { showDot = true; if (st === 'intact') col.multiplyScalar(0.7); dots.setColorAt(k, col); }
    }
    cols.setMatrixAt(k, showCol ? m4 : ZERO);
    ghosts.setMatrixAt(k, showGhost ? m4 : ZERO);
    ghostRims.setMatrixAt(k, showRim ? m4r.makeTranslation(x, h + 0.003, z) : ZERO);
    dots.setMatrixAt(k, showDot ? m4r.makeTranslation(x, h, z) : ZERO);
    dull.setMatrixAt(k, showDull ? m4 : ZERO);
    cols.setColorAt(k, col);
  }
  cols.instanceMatrix.needsUpdate = ghosts.instanceMatrix.needsUpdate = ghostRims.instanceMatrix.needsUpdate = dots.instanceMatrix.needsUpdate = dull.instanceMatrix.needsUpdate = true;
  cols.instanceColor.needsUpdate = true; if (dots.instanceColor) dots.instanceColor.needsUpdate = true; if (dull.instanceColor) dull.instanceColor.needsUpdate = true;
}

// ---------- selection: drag a box on the floor (SELECT mode) ----------
const $ = id => document.getElementById(id);
const ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
const selMesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0a458 })); scene.add(selMesh);
let selecting = false, dragStart = null;
function floorHit(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(floor, p) ? p : null;
}
function drawSelBox() {
  if (!sel) { selMesh.geometry.dispose(); selMesh.geometry = new THREE.BufferGeometry(); return; }
  const y = 0.05, { x0, z0, x1, z1 } = sel;
  selMesh.geometry.setFromPoints([V(x0, y, z0), V(x1, y, z0), V(x1, y, z0), V(x1, y, z1), V(x1, y, z1), V(x0, y, z1), V(x0, y, z1), V(x0, y, z0),
    V(x0, 0, z0), V(x0, top * 0.8, z0), V(x1, 0, z0), V(x1, top * 0.8, z0), V(x1, 0, z1), V(x1, top * 0.8, z1), V(x0, 0, z1), V(x0, top * 0.8, z1)]);
}
$('btn-select').addEventListener('click', () => { selecting = !selecting; controls.enabled = !selecting; $('btn-select').classList.toggle('on', selecting); });
$('btn-clear').addEventListener('click', () => { sel = null; drawSelBox(); $('selpanel').style.display = 'none'; dirty = true; });
canvas.addEventListener('pointerdown', e => { if (!selecting) return; dragStart = floorHit(e); });
canvas.addEventListener('pointermove', e => {
  if (!selecting || !dragStart) return; const p = floorHit(e); if (!p) return;
  sel = { x0: Math.min(dragStart.x, p.x), x1: Math.max(dragStart.x, p.x), z0: Math.min(dragStart.z, p.z), z1: Math.max(dragStart.z, p.z) };
  drawSelBox(); dirty = true;
});
canvas.addEventListener('pointerup', () => {
  if (!selecting || !dragStart) return; dragStart = null;
  selecting = false; controls.enabled = true; $('btn-select').classList.remove('on');
  if (sel && (sel.x1 - sel.x0 < 0.5 || sel.z1 - sel.z0 < 0.5)) { sel = null; drawSelBox(); }
  $('selpanel').style.display = sel ? '' : 'none'; dirty = true;
});
function selStats() {
  if (!sel) return;
  const c = { intact: 0, edge: 0, fresh: 0, dividing: 0, wound: 0 }; let n = 0, h = 0;
  for (let k = 0; k < COUNT; k++) if (inSel(k)) { c[states[k]]++; n++; h += hNow[k]; }
  const w = ((sel.x1 - sel.x0) / S * UM).toFixed(0), d = ((sel.z1 - sel.z0) / S * UM).toFixed(0);
  $('s-size').textContent = `${w} × ${d} µm`;
  $('s-cells').textContent = `${n - c.wound} cells · ${n} sites`;
  $('s-wound').textContent = `${(c.wound / n * 100).toFixed(0)}% open`;
  $('s-dens').textContent = (h / n).toFixed(2);
  $('s-mix').textContent = `edge ${c.edge} · new ${c.fresh} · dividing ${c.dividing}`;
}

// ---------- camera presets ----------
const views = {
  overview: { p: V(-30, 24, 36), t: V(0, 0.5, 0) },
  close: { p: V(-11, 9, 13), t: V(0, 0.5, 0) },
  cells: { p: V(-6, 6.5, 8), t: V(1, 0.6, 0) },
};
let fly = null;
function goTo(n) { fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: views[n].p, q1: views[n].t };
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === n)); }
camera.position.copy(views.overview.p); controls.target.copy(views.overview.t);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.view)));
document.querySelector('[data-view="overview"]').classList.add('on');
const easeIO = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

// ---------- readouts + closure chart ----------
function areaAt(t) {
  const obs = t <= data.cutoff_min, ts = obs ? wound.t_obs : wound.t_fc, ys = obs ? wound.area_obs : wound.median;
  if (t <= ts[0]) return ys[0];
  for (let i = 1; i < ts.length; i++) if (t <= ts[i]) { const q = (t - ts[i - 1]) / (ts[i] - ts[i - 1]); return ys[i - 1] + q * (ys[i] - ys[i - 1]); }
  return ys.at(-1);
}
const rng = r => r[2] <= data.cutoff_min ? `reached at ${r[1].toFixed(0)} min` : `${r[1].toFixed(0)} min (${r[0].toFixed(0)}–${r[2].toFixed(0)})`;
const flag = wound.p_close_by >= 0.8 ? 'ON TRACK' : wound.p_close_by >= 0.2 ? 'MEASURE AGAIN' : 'STALL RISK';
$('r-id').textContent = `wound ${wound.id}`;
$('r-src').textContent = `fly embryo set · cutoff ${data.cutoff_min} min · ${data.forecaster} · 90% band`;
$('r-t50').textContent = rng(wound.t50_range); $('r-t90').textContent = rng(wound.t90_range);
$('r-p').textContent = `${(wound.p_close_by * 100).toFixed(0)}% by ${data.p_close_by_min} min`; $('r-flag').textContent = flag;

const T_END = Math.max(wound.t_obs.at(-1), wound.t_fc.at(-1)), CW = 360, CH = 150, pad = 28;
const X = t => pad + (t / T_END) * (CW - pad - 8), Y = a => 8 + (1 - Math.min(1.05, a)) / 1.05 * (CH - pad - 8);
const path = (ts, ys) => ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
const nObs = wound.t_obs.findIndex(t => t > data.cutoff_min);
$('chart').innerHTML = `
  <path d="${path(wound.t_fc, wound.hi)}L${[...wound.t_fc].reverse().map((t, i) => `${X(t).toFixed(1)},${Y(wound.lo[wound.lo.length - 1 - i]).toFixed(1)}`).join('L')}Z" class="band"/>
  <path d="${path(wound.t_fc, wound.median)}" class="med"/>
  <path d="${path(wound.t_obs.slice(0, nObs + 1), wound.area_obs.slice(0, nObs + 1))}" class="obs"/>
  <line x1="${X(data.cutoff_min)}" x2="${X(data.cutoff_min)}" y1="6" y2="${CH - pad}" class="cut"/>
  <text x="${X(data.cutoff_min) + 4}" y="16" class="lbl">forecast from here</text>
  <line x1="${pad}" x2="${CW - 8}" y1="${CH - pad}" y2="${CH - pad}" class="axis"/>
  <text x="${pad}" y="${CH - 10}" class="lbl">0</text><text x="${CW - 48}" y="${CH - 10}" class="lbl">${T_END.toFixed(0)} min</text>
  <text x="2" y="14" class="lbl">area</text><line id="now" y1="6" y2="${CH - pad}" class="now"/>`;

// ---------- timeline + loop ----------
const slider = $('time'), playBtn = $('play'); slider.max = T_END; slider.step = 0.5;
let t = 0, playing = true, dirty = true, frameNow = frames[0];
function setTime(tt) {
  t = tt; slider.value = tt; $('t-label').textContent = `t = ${tt.toFixed(0)} min`;
  const a = areaAt(tt); let f = frames[0]; for (const fr of frames) { f = fr; if (fr.area <= a) break; } frameNow = f;
  $('r-area').textContent = `${(a * 100).toFixed(0)}% of start`; $('r-bar').style.width = `${Math.min(100, a * 100)}%`;
  $('r-mode').textContent = tt <= data.cutoff_min ? 'observed' : 'forecast (median)';
  $('now').setAttribute('x1', X(tt)); $('now').setAttribute('x2', X(tt)); dirty = true;
}
slider.addEventListener('input', () => { playing = false; playBtn.textContent = 'PLAY'; setTime(+slider.value); });
playBtn.addEventListener('click', () => { if (t >= T_END) setTime(0); playing = !playing; playBtn.textContent = playing ? 'PAUSE' : 'PLAY'; });
playBtn.textContent = 'PAUSE'; setTime(0);
if (Q.get('sel')) { const [x0, z0, x1, z1] = Q.get('sel').split(',').map(Number); sel = { x0, z0, x1, z1 }; drawSelBox(); $('selpanel').style.display = ''; }
if (Q.has('bare')) { playing = false; setTime(+(Q.get('t') || 30)); const v = views[Q.get('view') || 'close']; camera.position.copy(v.p); controls.target.copy(v.t); }

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); let settle = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) { const nt = Math.min(T_END, t + dt * 5); setTime(nt); if (nt >= T_END) { playing = false; playBtn.textContent = 'PLAY'; } }
  if (dirty) { settle = 1.2; dirty = false; }
  if (settle > 0) { settle -= dt; updateColumns(frameNow, dt); selStats(); }
  if (fly) { fly.t = Math.min(1, fly.t + dt / 1.4); const e = easeIO(fly.t); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e); if (fly.t >= 1) fly = null; }
  controls.update(); renderer.render(scene, camera);
});
