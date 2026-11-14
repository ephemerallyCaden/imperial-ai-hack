// Stitch look-dev v3: two glass wells (condition + control) on black, x-ray fresnel glass,
// flat solid-colour hex cells (M8 palette), zoom overview -> well -> cells.
// Readouts and curves come from Rand's embryo export (sample data; the pairing is illustrative).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const data = await (await fetch('./sample/forecast_embryo_20min.json')).json();
const PAL = { intact: '#4B4FA8', edge: '#F1605D', fresh: '#C0388A', dividing: '#FCFDBF', wound: '#06060B' };

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050607);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 0.15; controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.47;
const grid = new THREE.GridHelper(60, 60, 0x232930, 0x111417); grid.position.y = -0.02; scene.add(grid);

// ---------- x-ray glass: fresnel rim glow (bright at grazing angles, clear face-on) ----------
const fresnel = (strength = 1, tint = 0xe8f2f8) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTint: { value: new THREE.Color(tint) }, uK: { value: strength } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform vec3 uTint; uniform float uK; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(uTint, (0.02 + 0.75*f)*uK); }`,
});

// stage: thin glass disc so the wells sit on something
const stage = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.04, 128), fresnel(0.12));
stage.position.y = 0.0; scene.add(stage);
const stageRim = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.004, 6, 200), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
stageRim.rotation.x = Math.PI / 2; stageRim.position.y = 0.02; scene.add(stageRim);

// ---------- wells ----------
const WR = 1.25, WH = 0.55, WALL = 0.012, BASE = 0.03;
const profile = [new THREE.Vector2(0.001, 0), new THREE.Vector2(WR, 0), new THREE.Vector2(WR, WH),
  new THREE.Vector2(WR - WALL, WH), new THREE.Vector2(WR - WALL, BASE), new THREE.Vector2(0.001, BASE)];
const wellGeo = new THREE.LatheGeometry(profile, 160);
const floorY = 0.02 + BASE + 0.002;

const pool = data.wounds.filter(w => w.t_fc.length);
const cond = pool.find(w => w.group === 'WH' && w.p_close_by > 0.8) || pool[0];
const ctrl = pool.filter(w => w !== cond).sort((a, b) => b.p_close_by - a.p_close_by)
  .find(w => Math.abs(w.p_close_by - 0.5) < 0.35) || pool[1];
const wells = [
  { key: 'cond', label: 'CONDITION', wound: cond, pos: new THREE.Vector3(1.55, 0.02, 0) },
  { key: 'ctrl', label: 'CONTROL', wound: ctrl, pos: new THREE.Vector3(-1.55, 0.02, 0) },
];

function statusOf(w) {
  if (w.p_close_by >= 0.8) return { label: 'ON TRACK', color: 0xe8ecef };
  if (w.p_close_by >= 0.2) return { label: 'MEASURE AGAIN', color: 0xe0a458 };
  return { label: 'STALL RISK', color: 0xf1605d };
}
function areaAt(w, t) {
  const obs = t <= data.cutoff_min, ts = obs ? w.t_obs : w.t_fc, ys = obs ? w.area_obs : w.median;
  if (t <= ts[0]) return ys[0];
  for (let i = 1; i < ts.length; i++) if (t <= ts[i]) { const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]); }
  return ys.at(-1);
}

for (const w of wells) {
  w.status = statusOf(w.wound);
  const cup = new THREE.Mesh(wellGeo, fresnel(0.45)); cup.position.copy(w.pos); scene.add(cup);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WR - WALL / 2, 0.006, 8, 200),
    new THREE.MeshBasicMaterial({ color: w.status.color, transparent: true, opacity: 0.9 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(w.pos.x, w.pos.y + WH, w.pos.z); scene.add(rim);
  const glow = new THREE.Mesh(new THREE.TorusGeometry(WR - WALL / 2, 0.03, 8, 200),
    new THREE.MeshBasicMaterial({ color: w.status.color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = Math.PI / 2; glow.position.copy(rim.position); scene.add(glow);
}

// ---------- hex-lattice simulation per well (stand-in for P2's simulator) ----------
const NX = 120, NY = 138;                      // offset-row hex lattice
const HX = 1, HY = Math.sqrt(3) / 2;
const cx = i => i + 0.5 * (i, 0), centreX = (i, j) => i + (j & 1) * 0.5, centreY = j => j * HY;
const W_LAT = NX - 0.5, H_LAT = NY * HY, R_LAT = Math.min(W_LAT, H_LAT) / 2 - 0.6;
const inWell = (i, j) => { const dx = centreX(i, j) - W_LAT / 2, dy = centreY(j) - H_LAT / 2; return dx * dx + dy * dy < R_LAT * R_LAT; };
const nbrs = (i, j) => (j & 1)
  ? [[i - 1, j], [i + 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
  : [[i - 1, j], [i + 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]];
const idx = (i, j) => j * NX + i;
const nbrIdx = []; for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
  nbrIdx.push(nbrs(i, j).filter(([a, b]) => a >= 0 && b >= 0 && a < NX && b < NY).map(([a, b]) => idx(a, b)));
const valid = Uint8Array.from({ length: NX * NY }, (_, k) => inWell(k % NX, (k / NX) | 0));

function simulate(seedShift, rate) {
  const occ = new Uint8Array(NX * NY), born = new Int16Array(NX * NY).fill(-999);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j), x = centreX(i, j), y = centreY(j);
    const c = W_LAT / 2 + 4 * Math.sin(y / 9 + seedShift);
    occ[k] = valid[k] && Math.abs(x - c) >= 19 + 3 * Math.sin(y / 5 + 1 + seedShift) ? 1 : 0;
  }
  const gap = o => { let g = 0; for (let k = 0; k < o.length; k++) if (valid[k] && !o[k]) g++; return g; };
  const g0 = gap(occ), frames = [];
  for (let s = 0; s < 500; s++) {
    frames.push({ occ: occ.slice(), born: born.slice(), step: s, area: gap(occ) / g0 });
    if (frames.at(-1).area < 0.004) break;
    const next = occ.slice();
    for (let k = 0; k < occ.length; k++) {
      if (occ[k] || !valid[k]) continue;
      let n = 0; for (const m of nbrIdx[k]) n += occ[m];
      if (n && Math.random() < rate * n) { next[k] = 1; born[k] = s; }
    }
    occ.set(next);
  }
  return frames;
}
const rnd = Float32Array.from({ length: NX * NY }, Math.random);

// paint a frame as flat hexes in M8 colours
const TEX = 2048;
function makeField(w) {
  const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(WR - WALL - 0.01, 160), mat);
  disc.rotation.x = -Math.PI / 2; disc.position.set(w.pos.x, floorY, w.pos.z); scene.add(disc);
  return { cv, ctx: cv.getContext('2d'), tex, last: null };
}
const S = TEX / (2 * R_LAT + 1.2), OX = TEX / 2 - (W_LAT / 2) * S, OY = TEX / 2 - (H_LAT / 2) * S;
const hexR = S * 0.56;
const hexPath = new Path2D(); for (let a = 0; a < 6; a++) { const t = Math.PI / 6 + a * Math.PI / 3; hexPath[a ? 'lineTo' : 'moveTo'](Math.cos(t) * hexR * 0.93, Math.sin(t) * hexR * 0.93); } hexPath.closePath();
function stateOf(f, k) {
  if (!f.occ[k]) return 'wound';
  let empty = false; for (const m of nbrIdx[k]) if (valid[m] && !f.occ[m]) { empty = true; break; }
  const age = f.step - f.born[k];
  if (age >= 0 && age < 2 && rnd[k] < 0.08) return 'dividing';
  if (empty) return 'edge';
  if (age >= 0 && age < 12) return 'fresh';
  return 'intact';
}
function paintField(field, f) {
  if (field.last === f) return; field.last = f;
  const { ctx, tex } = field;
  ctx.clearRect(0, 0, TEX, TEX);
  ctx.save(); ctx.beginPath(); ctx.arc(TEX / 2, TEX / 2, TEX / 2, 0, Math.PI * 2); ctx.fillStyle = PAL.wound; ctx.fill(); ctx.restore();
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j); if (!valid[k]) continue;
    const st = stateOf(f, k); if (st === 'wound') continue;
    ctx.save(); ctx.translate(OX + centreX(i, j) * S, OY + centreY(j) * S);
    ctx.fillStyle = PAL[st]; ctx.fill(hexPath);
    if (st === 'dividing') { ctx.fillStyle = '#1A0F00'; ctx.beginPath(); ctx.arc(0, 0, hexR * 0.22, 0, 6.283); ctx.fill(); }
    if (st === 'fresh') { ctx.fillStyle = '#FFD6EE'; for (let q = 0; q < 3; q++) { const a = rnd[k] * 6.28 + q * 2.09; ctx.beginPath(); ctx.arc(Math.cos(a) * hexR * 0.38, Math.sin(a) * hexR * 0.38, hexR * 0.09, 0, 6.283); ctx.fill(); } }
    ctx.restore();
  }
  tex.needsUpdate = true;
}
for (const [n, w] of wells.entries()) { w.frames = simulate(n * 2.1, 0.022 + 0.004 * n); w.field = makeField(w); }
const frameFor = (w, a) => { let f = w.frames[0]; for (const fr of w.frames) { f = fr; if (fr.area <= a) break; } return f; };

// ---------- zoom: overview -> well -> cells ----------
const hero = wells[0];
const views = {
  overview: { pos: new THREE.Vector3(0, 5.6, 6.4), target: new THREE.Vector3(0, 0.1, 0.2) },
  well: { pos: hero.pos.clone().add(new THREE.Vector3(0, 2.6, 2.4)), target: hero.pos.clone().setY(floorY) },
  cells: { pos: hero.pos.clone().add(new THREE.Vector3(0.05, 0.36, 0.22)), target: hero.pos.clone().add(new THREE.Vector3(0.05, floorY - 0.02, 0)) },
};
let fly = null;
function goTo(name) {
  const v = views[name]; fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: v.pos, q1: v.target };
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
camera.position.copy(views.overview.pos); controls.target.copy(views.overview.target);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.view)));
document.querySelector('[data-view="overview"]').classList.add('on');
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

// ---------- callouts ----------
const svg = document.getElementById('leaders');
const mk = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
const toWorld = (w, i, j) => new THREE.Vector3(w.pos.x + (OX + centreX(i, j) * S - TEX / 2) / TEX * 2 * (WR - WALL - 0.01), floorY, w.pos.z + (OY + centreY(j) * S - TEX / 2) / TEX * 2 * (WR - WALL - 0.01));
const callouts = [
  { el: document.getElementById('c-cond'), anchor: wells[0].pos.clone().add(new THREE.Vector3(WR * 0.7, WH, -WR * 0.7)), dx: 160, dy: -120, show: d => d > 5 },
  { el: document.getElementById('c-ctrl'), anchor: wells[1].pos.clone().add(new THREE.Vector3(-WR * 0.7, WH, -WR * 0.7)), dx: -380, dy: -120, show: d => d > 5 },
  { el: document.getElementById('c-edge'), anchor: new THREE.Vector3(), dx: 220, dy: -130, show: d => d <= 5 },
  { el: document.getElementById('c-gap'), anchor: new THREE.Vector3(), dx: -430, dy: 140, show: d => d <= 5 },
].map(c => ({ ...c, line: mk('line'), dot: mk('circle', { r: 2.5 }) }));
function anchorsFor(f) {
  const j = (NY * 0.36) | 0; let l = -1, r = -1;
  for (let i = 0; i < NX; i++) if (valid[idx(i, j)] && !f.occ[idx(i, j)]) { if (l < 0) l = i; r = i; }
  callouts[2].anchor.copy(toWorld(hero, r < 0 ? NX / 2 : r + 1, j));
  const j2 = (NY * 0.64) | 0; let l2 = -1, r2 = -1;
  for (let i = 0; i < NX; i++) if (valid[idx(i, j2)] && !f.occ[idx(i, j2)]) { if (l2 < 0) l2 = i; r2 = i; }
  callouts[3].anchor.copy(toWorld(hero, l2 < 0 ? NX / 2 : (l2 + r2) / 2, j2));
}
function placeCallouts() {
  const w = innerWidth, h = innerHeight, d = camera.position.distanceTo(controls.target);
  for (const c of callouts) {
    const vis = c.show(d); c.el.style.display = c.line.style.display = c.dot.style.display = vis ? '' : 'none'; if (!vis) continue;
    const p = c.anchor.clone().project(camera), sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
    const lx = Math.min(w - 300, Math.max(440, sx + c.dx)), ly = Math.min(h - 160, Math.max(110, sy + c.dy));
    c.el.style.left = `${lx}px`; c.el.style.top = `${ly}px`;
    const ex = c.dx > 0 ? lx : lx + c.el.offsetWidth;
    Object.entries({ x1: sx, y1: sy, x2: ex, y2: ly }).forEach(([k, v]) => c.line.setAttribute(k, v));
    c.dot.setAttribute('cx', sx); c.dot.setAttribute('cy', sy);
  }
}

// ---------- readouts + chart ----------
const $ = id => document.getElementById(id);
const rangeTxt = (r, obsCut) => r[2] <= obsCut ? `reached at ${r[1].toFixed(0)} min` : `${r[1].toFixed(0)} min (${r[0].toFixed(0)}–${r[2].toFixed(0)})`;
$('r-src').textContent = `fly embryo set · cutoff ${data.cutoff_min} min · ${data.forecaster} · 90% band`;
for (const w of wells) {
  $(`r-${w.key}-id`).textContent = w.wound.id;
  $(`r-${w.key}-t90`).textContent = rangeTxt(w.wound.t90_range, data.cutoff_min);
  $(`r-${w.key}-p`).textContent = `${(w.wound.p_close_by * 100).toFixed(0)}%`;
  $(`r-${w.key}-flag`).textContent = w.status.label;
  $(`r-${w.key}-flag`).style.color = '#' + w.status.color.toString(16).padStart(6, '0');
  $(`c-${w.key}-sub`).textContent = `${w.wound.id} · ${w.status.label.toLowerCase()} · P(close by ${data.p_close_by_min} min) ${(w.wound.p_close_by * 100).toFixed(0)}%`;
}
$('r-pmin').textContent = data.p_close_by_min;

const T_END = Math.max(...wells.map(w => Math.max(w.wound.t_obs.at(-1), w.wound.t_fc.at(-1))));
const CW = 360, CH = 160, pad = 28, chart = $('chart');
const X = t => pad + (t / T_END) * (CW - pad - 8), Y = a => 8 + (1 - Math.min(1.05, a)) / 1.05 * (CH - pad - 8);
const path = (ts, ys) => ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
const band = w => `${path(w.t_fc, w.hi)}L${[...w.t_fc].reverse().map((t, i) => `${X(t).toFixed(1)},${Y(w.lo[w.lo.length - 1 - i]).toFixed(1)}`).join('L')}Z`;
const obsPart = w => { const n = w.t_obs.findIndex(t => t > data.cutoff_min); return [w.t_obs.slice(0, n < 0 ? undefined : n + 1), w.area_obs.slice(0, n < 0 ? undefined : n + 1)]; };
chart.innerHTML = wells.map(w => `
  <path d="${band(w.wound)}" class="band ${w.key}"/>
  <path d="${path(w.wound.t_fc, w.wound.median)}" class="med ${w.key}"/>
  <path d="${path(...obsPart(w.wound))}" class="obs ${w.key}"/>`).join('') + `
  <line x1="${X(data.cutoff_min)}" x2="${X(data.cutoff_min)}" y1="6" y2="${CH - pad}" class="cut"/>
  <text x="${X(data.cutoff_min) + 4}" y="16" class="lbl">forecast from here</text>
  <line x1="${pad}" x2="${CW - 8}" y1="${CH - pad}" y2="${CH - pad}" class="axis"/>
  <text x="${pad}" y="${CH - 10}" class="lbl">0</text><text x="${CW - 48}" y="${CH - 10}" class="lbl">${T_END.toFixed(0)} min</text>
  <text x="2" y="14" class="lbl">area</text>
  <line id="now" y1="6" y2="${CH - pad}" class="now"/>`;

// ---------- timeline ----------
const slider = $('time'), playBtn = $('play');
slider.max = T_END; slider.step = 0.5;
let t = 0, playing = true;
function show(tt) {
  t = tt; slider.value = tt; $('t-label').textContent = `t = ${tt.toFixed(0)} min`;
  const mode = tt <= data.cutoff_min ? 'observed' : 'forecast';
  for (const w of wells) {
    const a = areaAt(w.wound, tt), f = frameFor(w, a); paintField(w.field, f); w.f = f;
    $(`r-${w.key}-area`).textContent = `${(a * 100).toFixed(0)}%`;
    $(`r-${w.key}-bar`).style.width = `${Math.min(100, a * 100)}%`;
  }
  $('r-mode').textContent = mode;
  anchorsFor(hero.f);
  $('c-gap-sub').textContent = `${((1 - areaAt(hero.wound, tt)) * 100).toFixed(0)}% closed · ${mode}`;
  $('now').setAttribute('x1', X(tt)); $('now').setAttribute('x2', X(tt));
}
slider.addEventListener('input', () => { playing = false; playBtn.textContent = 'PLAY'; show(+slider.value); });
playBtn.addEventListener('click', () => { if (t >= T_END) show(0); playing = !playing; playBtn.textContent = playing ? 'PAUSE' : 'PLAY'; });
playBtn.textContent = 'PAUSE'; show(0);

// ---------- loop ----------
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) { const nt = Math.min(T_END, t + dt * 6); show(nt); if (nt >= T_END) { playing = false; playBtn.textContent = 'PLAY'; } }
  if (fly) { fly.t = Math.min(1, fly.t + dt / 1.4); const e = ease(fly.t); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e); if (fly.t >= 1) fly = null; }
  controls.update(); renderer.render(scene, camera); placeCallouts();
});
