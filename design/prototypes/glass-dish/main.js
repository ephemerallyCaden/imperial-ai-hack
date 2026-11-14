// Stitch look-dev v2: glass 24-well plate on black, one hero well with a simulated healing monolayer,
// zoom plate -> well -> cells, readouts and closure chart from Rand's embryo forecast export (sample data).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const data = await (await fetch('./sample/forecast_embryo_20min.json')).json();

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050607);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 0.25;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.47;

const grid = new THREE.GridHelper(60, 60, 0x2a3036, 0x121518);
grid.position.y = -0.01;
scene.add(grid);

const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(-5, 8, 4); scene.add(key);
const back = new THREE.DirectionalLight(0xbfd8ff, 1.6); back.position.set(4, 4, -8); scene.add(back);
scene.add(new THREE.AmbientLight(0xffffff, 0.06));

// ---------- glass plate: 4 x 6 wells ----------
const ROWS = 4, COLS = 6, PITCH = 1.0, WR = 0.42, WH = 0.38, BASE = 0.06;
const plateW = COLS * PITCH + 0.5, plateD = ROWS * PITCH + 0.5;
const glass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, roughness: 0.08, transmission: 1, thickness: 0.12, ior: 1.45, specularIntensity: 0.6,
  clearcoat: 1, clearcoatRoughness: 0.04, attenuationColor: new THREE.Color(0xdcecf4), attenuationDistance: 4,
  side: THREE.DoubleSide,
});
const plate = new THREE.Mesh(new RoundedBoxGeometry(plateW, 0.05, plateD, 4, 0.06), glass);
plate.position.y = 0.025;
scene.add(plate);
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new RoundedBoxGeometry(plateW, 0.05, plateD, 2, 0.06), 30),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
outline.position.copy(plate.position); scene.add(outline);

const wellProfile = [
  new THREE.Vector2(0.001, 0), new THREE.Vector2(WR, 0), new THREE.Vector2(WR, WH),
  new THREE.Vector2(WR - 0.025, WH), new THREE.Vector2(WR - 0.025, BASE), new THREE.Vector2(0.001, BASE),
];
const wellGeo = new THREE.LatheGeometry(wellProfile, 96);
const rimGeo = new THREE.TorusGeometry(WR - 0.0125, 0.004, 6, 96);
const floorY = 0.05 + BASE + 0.003;
const rowName = 'ABCD';

// pick 24 wounds; hero = a closing wound with a confident forecast
const pool = data.wounds.filter(w => w.t_fc.length);
const hero = pool.find(w => w.group === 'WH' && w.p_close_by > 0.8) || pool[0];
const others = pool.filter(w => w !== hero).slice(0, ROWS * COLS - 1);
const HERO_IDX = 1 * COLS + 2;                   // well B3
const wells = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const idx = r * COLS + c;
  const wound = idx === HERO_IDX ? hero : others[idx < HERO_IDX ? idx : idx - 1];
  const pos = new THREE.Vector3((c - (COLS - 1) / 2) * PITCH, 0.05, (r - (ROWS - 1) / 2) * PITCH);
  const cup = new THREE.Mesh(wellGeo, glass); cup.position.copy(pos); scene.add(cup);
  const status = statusOf(wound);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: status.color, transparent: true, opacity: 0.8 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(pos.x, pos.y + WH, pos.z); scene.add(rim);
  wells.push({ idx, name: `${rowName[r]}${c + 1}`, wound, pos, status });
}

// prototype status rule from P(close by T); thresholds are illustrative, real ones come from P1/P2
function statusOf(w) {
  if (w.p_close_by >= 0.8) return { label: 'ON TRACK', color: 0xe8ecef };
  if (w.p_close_by >= 0.2) return { label: 'MEASURE AGAIN', color: 0xd9a35b };
  return { label: 'STALL RISK', color: 0xd96a5b };
}

// wound area at time t: observed up to the cutoff, forecast median after
function areaAt(w, t) {
  const useObs = t <= data.cutoff_min;
  const ts = useObs ? w.t_obs : w.t_fc, ys = useObs ? w.area_obs : w.median;
  if (!ts.length) return 1;
  if (t <= ts[0]) return ys[0];
  for (let i = 1; i < ts.length; i++) if (t <= ts[i]) {
    const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}

// ---------- simple well tissue (non-hero): shared cell pattern + dark wound ellipse ----------
const pat = document.createElement('canvas'); pat.width = pat.height = 256;
{ const g = pat.getContext('2d');
  for (let k = 0; k < 2600; k++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 2.2, j = Math.random();
    g.fillStyle = `hsla(200, 10%, ${78 + 10 * j}%, ${0.3 + 0.3 * j})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.7 + 0.4 * j), j * 3, 0, Math.PI * 2); g.fill();
  } }
const discGeo = new THREE.CircleGeometry(WR - 0.03, 64);
function makeTissue(size) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45 });
  return { cv, ctx: cv.getContext('2d'), tex, mat };
}
for (const w of wells) if (w.idx !== HERO_IDX) {
  w.tissue = makeTissue(128);
  const m = new THREE.Mesh(discGeo, w.tissue.mat);
  m.rotation.x = -Math.PI / 2; m.position.set(w.pos.x, floorY, w.pos.z); scene.add(m);
}
function paintSimple(w, a) {
  const { ctx, cv, tex } = w.tissue, s = cv.width;
  ctx.clearRect(0, 0, s, s);
  ctx.save(); ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(pat, 0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out';
  const half = Math.max(0, a) * s * 0.22;                 // wound band half-width scales with area
  ctx.beginPath(); ctx.ellipse(s / 2, s / 2, half, s * 0.48, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore(); tex.needsUpdate = true;
}

// ---------- hero well: lattice simulation, frame chosen to match the wound's area curve ----------
const N = 140;
const inWell = (x, y) => { const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5; return dx * dx + dy * dy < (N / 2 - 1) ** 2; };
const occ = new Uint8Array(N * N), age = new Float32Array(N * N);
const jitter = Float32Array.from({ length: N * N }, Math.random);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x, centre = N / 2 + 3 * Math.sin(y / 8);
  occ[i] = inWell(x, y) && Math.abs(x - centre) >= 22 + 3 * Math.sin(y / 5 + 1) ? 1 : 0;
  age[i] = occ[i] ? 1e6 : 0;
}
const gapOf = o => { let g = 0; for (let i = 0; i < o.length; i++) if (!o[i] && inWell(i % N, (i / N) | 0)) g++; return g; };
const frames = [], gap0 = gapOf(occ);
for (let s = 0; s < 400; s++) {
  frames.push({ occ: occ.slice(), age: age.slice(), area: gapOf(occ) / gap0 });
  if (frames.at(-1).area < 0.005) break;
  const next = occ.slice();
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x; if (occ[i] || !inWell(x, y)) continue;
    const n = occ[i - 1] + occ[i + 1] + occ[i - N] + occ[i + N] + occ[i - N - 1] + occ[i - N + 1] + occ[i + N - 1] + occ[i + N + 1];
    if (n && Math.random() < 0.03 * n) { next[i] = 1; age[i] = 0; }
  }
  occ.set(next); for (let i = 0; i < age.length; i++) if (occ[i] && age[i] < 1e6) age[i]++;
}
const heroT = makeTissue(1536);
const heroWell = wells[HERO_IDX];
{ const m = new THREE.Mesh(discGeo, heroT.mat); m.rotation.x = -Math.PI / 2; m.position.set(heroWell.pos.x, floorY, heroWell.pos.z); scene.add(m); }
let lastHero = null;
function paintHero(a) {
  let f = frames[0]; for (const fr of frames) { f = fr; if (fr.area <= a) break; }
  if (f === lastHero) return f; lastHero = f;
  const { ctx, cv, tex } = heroT, s = cv.width, cell = s / N;
  ctx.clearRect(0, 0, s, s);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; if (!f.occ[i] || !inWell(x, y)) continue;
    const fresh = Math.max(0, 1 - f.age[i] / 30), j = jitter[i];
    ctx.fillStyle = `hsla(${200 - 20 * fresh}, ${10 + 18 * fresh}%, ${78 + 10 * j + 12 * fresh}%, ${0.35 + 0.3 * j})`;
    const r = cell * (0.55 + 0.25 * j);
    ctx.beginPath();
    ctx.ellipse((x + 0.5 + (j - 0.5) * 0.4) * cell, (y + 0.5 + (jitter[(i * 7) % jitter.length] - 0.5) * 0.4) * cell,
      r, r * (0.75 + 0.3 * j), j * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    if (j > 0.55) {                                    // nucleus, visible when zoomed to cells
      ctx.fillStyle = `hsla(205, 15%, 55%, ${0.35 + 0.2 * j})`;
      ctx.beginPath(); ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, r * 0.32, 0, Math.PI * 2); ctx.fill();
    }
  }
  tex.needsUpdate = true;
  return f;
}

// ---------- zoom levels: plate -> well -> cells ----------
const views = {
  plate: { pos: new THREE.Vector3(0, 7.5, 8.2), target: new THREE.Vector3(0, 0, 0.3) },
  well: { pos: heroWell.pos.clone().add(new THREE.Vector3(0, 1.35, 1.25)), target: heroWell.pos.clone().setY(floorY) },
  cells: { pos: heroWell.pos.clone().add(new THREE.Vector3(0.05, 0.32, 0.18)), target: heroWell.pos.clone().add(new THREE.Vector3(0.05, floorY - 0.05, 0)) },
};
let fly = null;
function goTo(name) {
  const v = views[name];
  fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: v.pos, q1: v.target };
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
camera.position.copy(views.plate.pos); controls.target.copy(views.plate.target);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.view)));
document.querySelector('[data-view="plate"]').classList.add('on');
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

// ---------- callouts ----------
const svg = document.getElementById('leaders');
const mk = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e;
};
const callouts = [
  { el: document.getElementById('c-well'), anchor: heroWell.pos.clone().setY(0.05 + WH), dx: 260, dy: -150, show: d => d > 3.2 },
  { el: document.getElementById('c-edge'), anchor: new THREE.Vector3(), dx: 230, dy: -130, show: d => d <= 3.2 },
  { el: document.getElementById('c-gap'), anchor: new THREE.Vector3(), dx: -420, dy: 150, show: d => d <= 3.2 },
].map(c => ({ ...c, line: mk('line', {}), dot: mk('circle', { r: 2.5 }) }));
function anchorsFor(f) {
  const y = (N * 0.36) | 0; let left = -1, right = -1;
  for (let x = 0; x < N; x++) if (!f.occ[y * N + x] && inWell(x, y)) { if (left < 0) left = x; right = x; }
  const k = 2 * (WR - 0.03) / N, base = heroWell.pos;
  const at = (gx, gy) => new THREE.Vector3(base.x + (gx - N / 2) * k, floorY, base.z + (gy - N / 2) * k);
  callouts[1].anchor.copy(at(right < 0 ? N / 2 : right + 1, y));
  callouts[2].anchor.copy(at(left < 0 ? N / 2 : (left + right) / 2, N * 0.64));
}
function placeCallouts() {
  const w = innerWidth, h = innerHeight, d = camera.position.distanceTo(controls.target);
  for (const c of callouts) {
    const vis = c.show(d);
    c.el.style.display = vis ? '' : 'none'; c.line.style.display = c.dot.style.display = vis ? '' : 'none';
    if (!vis) continue;
    const p = c.anchor.clone().project(camera), sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
    const lx = Math.min(w - 260, Math.max(40, sx + c.dx)), ly = Math.min(h - 140, Math.max(120, sy + c.dy));
    c.el.style.left = `${lx}px`; c.el.style.top = `${ly}px`;
    const ex = c.dx > 0 ? lx : lx + c.el.offsetWidth;
    Object.entries({ x1: sx, y1: sy, x2: ex, y2: ly }).forEach(([k, v]) => c.line.setAttribute(k, v));
    c.dot.setAttribute('cx', sx); c.dot.setAttribute('cy', sy);
  }
}

// ---------- readouts + closure chart (real numbers from the export) ----------
const $ = id => document.getElementById(id);
const fmtR = r => `${r[1].toFixed(0)} min (${r[0].toFixed(0)}–${r[2].toFixed(0)})`;
$('r-well').textContent = `${heroWell.name} · wound ${hero.id}`;
$('r-src').textContent = `fly embryo set · cutoff ${data.cutoff_min} min · ${data.forecaster}`;
$('r-t50').textContent = fmtR(hero.t50_range);
$('r-t90').textContent = fmtR(hero.t90_range);
$('r-p').textContent = `${(hero.p_close_by * 100).toFixed(0)}% by ${data.p_close_by_min} min`;
$('r-flag').textContent = heroWell.status.label;
$('c-well-sub').textContent = `${hero.id} · ${heroWell.status.label.toLowerCase()} · P(close by ${data.p_close_by_min} min) ${(hero.p_close_by * 100).toFixed(0)}%`;
const counts = wells.reduce((m, w) => (m[w.status.label] = (m[w.status.label] || 0) + 1, m), {});
$('r-plate').textContent = Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ');

const T_END = Math.max(hero.t_obs.at(-1), hero.t_fc.at(-1));
const chart = $('chart'), CW = 340, CH = 150, pad = 26;
const X = t => pad + (t / T_END) * (CW - pad - 8), Y = a => 8 + (1 - Math.min(1.05, a)) / 1.05 * (CH - pad - 8);
const path = (ts, ys) => ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
const obsIdx = hero.t_obs.findIndex(t => t > data.cutoff_min);
const tObs = hero.t_obs.slice(0, obsIdx < 0 ? undefined : obsIdx + 1), aObs = hero.area_obs.slice(0, tObs.length);
chart.innerHTML = `
  <path d="${path(hero.t_fc, hero.hi)}L${[...hero.t_fc].reverse().map((t, i) => `${X(t).toFixed(1)},${Y(hero.lo[hero.lo.length - 1 - i]).toFixed(1)}`).join('L')}Z" class="band"/>
  <path d="${path(hero.t_fc, hero.median)}" class="med"/>
  <path d="${path(hero.t_obs, hero.area_obs)}" class="truth"/>
  <path d="${path(tObs, aObs)}" class="obs"/>
  <line x1="${X(data.cutoff_min)}" x2="${X(data.cutoff_min)}" y1="6" y2="${CH - pad}" class="cut"/>
  <text x="${X(data.cutoff_min) + 4}" y="16" class="lbl">cutoff</text>
  <line x1="${pad}" x2="${CW - 8}" y1="${CH - pad}" y2="${CH - pad}" class="axis"/>
  <text x="${pad}" y="${CH - 8}" class="lbl">0</text><text x="${CW - 40}" y="${CH - 8}" class="lbl">${T_END.toFixed(0)} min</text>
  <text x="2" y="14" class="lbl">area</text>
  <line id="now" y1="6" y2="${CH - pad}" class="now"/>`;

// ---------- timeline ----------
const slider = $('time'), playBtn = $('play');
slider.max = T_END; slider.step = 0.5;
let t = 0, playing = true;
function show(tt) {
  t = tt; slider.value = tt; $('t-label').textContent = `t = ${tt.toFixed(0)} min`;
  const a = areaAt(hero, tt), f = paintHero(a); anchorsFor(f);
  for (const w of wells) if (w.tissue) paintSimple(w, areaAt(w.wound, tt));
  $('r-area').textContent = `${(a * 100).toFixed(0)}% of start`;
  $('r-area-bar').style.width = `${Math.min(100, a * 100)}%`;
  $('r-mode').textContent = tt <= data.cutoff_min ? 'observed' : 'forecast (median)';
  $('c-gap-sub').textContent = `${((1 - a) * 100).toFixed(0)}% closed · ${tt <= data.cutoff_min ? 'observed' : 'forecast'}`;
  $('now').setAttribute('x1', X(tt)); $('now').setAttribute('x2', X(tt));
}
slider.addEventListener('input', () => { playing = false; playBtn.textContent = 'PLAY'; show(+slider.value); });
playBtn.addEventListener('click', () => { if (t >= T_END) show(0); playing = !playing; playBtn.textContent = playing ? 'PAUSE' : 'PLAY'; });
playBtn.textContent = 'PAUSE';
show(0);

// ---------- loop ----------
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) { const nt = Math.min(T_END, t + dt * 6); show(nt); if (nt >= T_END) { playing = false; playBtn.textContent = 'PLAY'; } }
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.4); const e = ease(fly.t);
    camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e);
    if (fly.t >= 1) fly = null;
  }
  controls.update(); renderer.render(scene, camera); placeCallouts();
});
