// Stitch look-dev v4: floating 3D graph space. Each simulated cell is a hex column; height = local
// density (healthy tall, wound low), colour = cell state (M8 palette). Box-select an area: it stays in
// colour while the rest drops to dark greyscale (each state keeps its own grey step). Readouts/curve from Rand's embryo export (sample).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { loadPhoto, analyse, outline } from './photo.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const data = await (await fetch('./sample/forecast_embryo_20min.json')).json();
const wound = data.wounds.find(w => w.group === 'WH' && w.p_close_by > 0.8) || data.wounds[0];
// colour-blind-safe teal/vermillion: min ΔE ~26 under protan/deutan/tritan sim (Machado 2009), and states step
// ~20-30 apart in lightness (L 5/31/65/89/100); dividing is told from new tissue by a dark centre dot (M8 cue) so they still read in greyscale
const PAL = { intact: 0x1F4F5C, edge: 0xEE7F2D, fresh: 0xF9D6FB, dividing: 0xFFFFFF, wound: 0x0B1116 };
// look-dev params: ?pal=intact,edge,fresh,dividing,wound (hex) overrides colours; ?bare&t=30&view=close hides HUD, freezes time
const Q = new URLSearchParams(location.search);
// final look (chosen 15 Nov): skin palette, toon, age colouring, 8 deg hue shift. URL params still override for look-dev.
for (const [k, v] of Object.entries({ pal: 'C68B6E,B3122E,FFD2C6,FFFFFF,24120F', bg: '120A09', mat: 'toon', age: 'skin' })) if (!Q.has(k)) Q.set(k, v);
if (Q.get('pal')) Q.get('pal').split(',').forEach((h, i) => { PAL[['intact', 'edge', 'fresh', 'dividing', 'wound'][i]] = parseInt(h, 16); });
const paintLegend = () => document.querySelectorAll('.legend .st i').forEach((el, i) => { if (i === 3) return; el.style.background = '#' + PAL[['intact', 'edge', 'fresh', 'dividing', 'wound'][i]].toString(16).padStart(6, '0'); });
paintLegend();
if (Q.has('bare')) document.body.classList.add('bare');
const HEIGHT = { intact: 1.0, dividing: 1.0, edge: 0.6, wound: 0.08 };   // relative density

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(parseInt(Q.get('bg') || '050607', 16));   // ?bg=hex look-dev
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 120; controls.maxPolarAngle = Math.PI * 0.49;
const LIT = Q.get('mat') && Q.get('mat') !== 'matte' ? [0.4, 1.25, 0.3] : [1.1, 1.6, 0.5];   // new materials add env + emissive light, so dim the rig
// ?light=warm: warm rig (the default sky is cool blue-white, which greys out reds and oranges) with brighter fill so colours stay vivid
const WARM = Q.get('light') === 'warm'; if (WARM) LIT[0] *= 1.6;
scene.add(new THREE.HemisphereLight(WARM ? 0xffe6d6 : 0xdfe8ff, WARM ? 0x2a0c10 : 0x101018, LIT[0]));
const key = new THREE.DirectionalLight(WARM ? 0xfff0e2 : 0xffffff, LIT[1]); key.position.set(-30, 60, 25); scene.add(key);
const fill = new THREE.DirectionalLight(WARM ? 0xffd2c2 : 0xe4e6ea, LIT[2]); fill.position.set(40, 20, -30); scene.add(fill);

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
// simulate(occ0): fill the gap from its edges, one frame per step (re-run for a shape from a photo)
function defaultOcc() {
  const occ = new Uint8Array(COUNT);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = cxOf(i, j), y = cyOf(j), c = W / 2 + 4 * Math.sin(y / 9);
    occ[idx(i, j)] = Math.abs(x - c) >= 14 + 3 * Math.sin(y / 5 + 1) ? 1 : 0;
  }
  return occ;
}
function simulate(occ0) {
  const out = [], occ = occ0.slice(), born = new Int16Array(COUNT).fill(-999);
  const gap = () => occ.reduce((s, v) => s + (v ? 0 : 1), 0), g0 = Math.max(1, gap());
  for (let s = 0; s < 600; s++) {
    out.push({ occ: occ.slice(), born: born.slice(), step: s, area: gap() / g0 });
    if (out.at(-1).area < 0.003) break;
    const next = occ.slice();
    for (let k = 0; k < COUNT; k++) {
      if (occ[k]) continue; let n = 0; for (const m of nb[k]) n += occ[m];
      if (n && Math.random() < 0.02 * n) { next[k] = 1; born[k] = s; }
    }
    occ.set(next);
  }
  return out;
}
let frames = simulate(defaultOcc());
function stateOf(f, k) {
  if (!f.occ[k]) return 'wound';
  const age = f.step - f.born[k];
  if (age >= 0 && age < 2 && rnd[k] < 0.08) return 'dividing';
  for (const m of nb[k]) if (!f.occ[m]) return 'edge';
  if (age >= 0 && age < 25) return 'fresh';
  return 'intact';
}
// cell age (sim steps since the cell filled in; original tissue counts as oldest). ?age=skin: intact cells fade
// new tissue colour -> intact -> darker, quieter intact as they mature. ?heat (or the AGE HEATMAP button): age heatmap overlay
let AGE_SPAN = Math.max(60, frames.length * 0.6); const AGE_SKIN = Q.get('age') === 'skin';
let HEAT = Q.has('heat');
// ?ageramp= how healed cells change colour as they age (t: 0 = just filled in, 1 = mature). Original tissue is not healed,
// so it keeps the plain intact colour except in 'pale', where it is the oldest and darkest (the first version).
//   pale  new-tissue colour -> intact -> darker intact (light -> dark)
//   scar  dusky red -> pink -> skin tinted toward the new-tissue colour, like a real scar maturing (ends paler than skin)
//   ember leading-edge colour cooling to intact (hot -> calm)
//   deep  dark intact -> intact (dark -> normal)
//   sat   over-saturated intact -> intact (same lightness, colour drains)
//   hue   intact with hue rotated -> intact (same lightness, hue drifts)
const AGE_RAMP = Q.get('ageramp') || 'pale';
const C = h => new THREE.Color(h), hsl = (h, dh, ds, dl) => { const c = C(h), o = {}; c.getHSL(o); return c.setHSL((o.h + dh + 1) % 1, Math.min(1, Math.max(0, o.s * ds)), Math.min(1, o.l * dl)); };
const RAMPS = {
  pale: () => [C(PAL.fresh), C(PAL.intact), C(PAL.intact).multiplyScalar(0.45).lerp(C(PAL.wound), 0.15)],
  scar: () => [C(PAL.edge).lerp(C(PAL.wound), 0.35).lerp(C(0x6A1B4D), 0.3), C(PAL.fresh).lerp(C(PAL.edge), 0.25), C(PAL.intact).lerp(C(PAL.fresh), 0.35)],
  ember: () => [C(PAL.edge), C(PAL.edge).lerp(C(PAL.intact), 0.6), C(PAL.intact)],
  deep: () => [C(PAL.intact).multiplyScalar(0.35), C(PAL.intact).multiplyScalar(0.7), C(PAL.intact)],
  sat: () => [hsl(PAL.intact, 0, 2.2, 1.05), hsl(PAL.intact, 0, 1.4, 1), C(PAL.intact)],
  hue: () => [hsl(PAL.intact, -0.12, 1.3, 1), hsl(PAL.intact, -0.05, 1.1, 1), C(PAL.intact)],
};
let STOPS, ORIG;
function rebuildRamp() { STOPS = (RAMPS[AGE_RAMP] || RAMPS.pale)(); ORIG = AGE_RAMP === 'pale' || !RAMPS[AGE_RAMP] ? STOPS[2] : C(PAL.intact); }
rebuildRamp();
const ageT = age => Math.min(1, Math.max(0, age / (AGE_SPAN + 25)));
function ageSkin(c, age) {   // age < 0 never happens for healed cells; original tissue has age > 999
  if (age > 900) return c.copy(ORIG);
  const t = ageT(age); return t < 0.3 ? c.copy(STOPS[0]).lerp(STOPS[1], t / 0.3) : c.copy(STOPS[1]).lerp(STOPS[2], (t - 0.3) / 0.7);
}
// inferno, trimmed so the oldest cells stay above the wound floor: old = deep purple, new = pale yellow
const cRef = new THREE.Color();
const HEAT_STOPS = [0x2A0B52, 0x6A176E, 0xA52C60, 0xDD513A, 0xFCA50A, 0xFCFFA4].map(h => new THREE.Color(h));
function heatCol(c, age) {
  const u = (1 - ageT(age)) * (HEAT_STOPS.length - 1), i = Math.min(HEAT_STOPS.length - 2, Math.floor(u));
  return c.copy(HEAT_STOPS[i]).lerp(HEAT_STOPS[i + 1], u - i);
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
// ?mat= look-dev materials: matte (original) | skin (velvet sheen + faked subsurface) | wet (clearcoat, moist wound bed)
// | gel (translucent, fresnel rim) | glow (self-lit, fluorescence-style). emit = instance colour added as light, rim = fresnel edge
const MATS = {
  matte: { make: () => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), emit: 0, rim: 0 },
  skin: { make: () => new THREE.MeshPhysicalMaterial({ roughness: 0.5, sheen: 0.5, sheenRoughness: 0.5, sheenColor: 0xff9c8c }), emit: 0.1, rim: 0.3, rimCol: 0xffc4b0 },
  wet: { make: () => new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }), emit: 0.05, rim: 0.2, rimCol: 0xffffff },
  gel: { make: () => new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, transparent: true, opacity: 0.82 }), emit: 0.12, rim: 0.8, rimCol: 0xdfeaff },
  glow: { make: () => new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0 }), emit: 0.4, rim: 0.35, rimCol: 0xffffff },
  // toon: 3-band cel shading | pearl: thin-film iridescence | xray: additive fresnel shells, hologram / glass-heart look
  toon: { make: () => new THREE.MeshToonMaterial({ gradientMap: (() => { const t = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })() }), emit: 0.05, rim: 0.5, rimCol: 0xffffff },
  pearl: { make: () => new THREE.MeshPhysicalMaterial({ roughness: 0.22, clearcoat: 0.6, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520] }), emit: 0.06, rim: 0.3, rimCol: 0xffe0ee },
  xray: { make: () => new THREE.MeshStandardMaterial({ roughness: 0.4, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), emit: 0.25, rim: 2.2, rimCol: 0xffffff },
};
// ?ramp=1: colour by world height like a space-time stack (dark base -> state colour -> pale tips); works with any ?mat=
const RAMP = Q.has('ramp');
// ?hshift=deg: as a colour gets darker (cell variation, age, shadow) its hue turns toward cool blue (240 deg, shortest way round),
// in proportion to how much darker it got. deg = shift at fully dark, so a cell 50% darker turns deg/2. Default 8 (~4 deg at half); 0 = off
const HSHIFT = +(Q.get('hshift') ?? 8);
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, hslT = {};
function coolShift(c, dark) {   // dark: 0 (as bright as its reference) .. 1 (black)
  if (!HSHIFT || dark <= 0) return c; c.getHSL(hslT);
  let d = 0.6667 - hslT.h; d -= Math.floor(d + 0.5);
  return c.setHSL((hslT.h + Math.sign(d) * Math.min(Math.abs(d), HSHIFT / 360 * Math.min(1, dark)) + 1) % 1, hslT.s, hslT.l);
}
const M = MATS[Q.get('mat')] || MATS.matte;
const colMat = M.make();
if (M.emit || M.rim || RAMP || HSHIFT) colMat.onBeforeCompile = sh => {
  if (HSHIFT) {   // same cool shift for lighting: compare lit colour with the unlit albedo
    sh.uniforms.uHShift = { value: HSHIFT };
    sh.fragmentShader = `uniform float uHShift;
vec3 hsRgb2Hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y); return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x); }
vec3 hsHsv2Rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec3 coolShift(vec3 c, float dark){ vec3 h=hsRgb2Hsv(c); float d=0.6667-h.x; d-=floor(d+0.5); h.x=fract(h.x+sign(d)*min(abs(d),uHShift/360.*dark)); return hsHsv2Rgb(h); }
` + sh.fragmentShader.replace('#include <opaque_fragment>', `{ const vec3 W = vec3(.2126,.7152,.0722);
    float dk = clamp(1.0 - dot(outgoingLight, W) / max(dot(diffuseColor.rgb, W), 1e-4), 0.0, 1.0);
    outgoingLight = coolShift(outgoingLight, dk); }
  #include <opaque_fragment>`);
  }
  if (RAMP) {
    sh.uniforms.uHMax = { value: HMAX };
    sh.vertexShader = 'uniform float uHMax; varying float vH;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = (instanceMatrix * vec4(position, 1.0)).y / uHMax;');
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float rh = clamp(vH, 0.0, 1.1);
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.2, diffuseColor.rgb, smoothstep(0.0, 0.7, rh));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vec3(1.0, 0.93, 0.95), 0.32), smoothstep(0.85, 1.1, rh));`);
  }
  sh.uniforms.uEmit = { value: M.emit }; sh.uniforms.uRim = { value: M.rim }; sh.uniforms.uRimCol = { value: new THREE.Color(M.rimCol) };
  sh.fragmentShader = 'uniform float uEmit; uniform float uRim; uniform vec3 uRimCol;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);
    totalEmissiveRadiance += vColor.rgb * uEmit + uRimCol * vColor.rgb * fres * uRim;`);
};
if (M !== MATS.matte) {   // studio reflections for sheen / clearcoat highlights
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.12;
}
const cols = new THREE.InstancedMesh(colGeo, colMat, COUNT);
// outside-selection look (?ghost=): grey (default) | rims | dim | flat | dots | lift
const GHOST = Q.get('ghost') || 'grey', LIFT = 1.4;
// greyscale context: dark overall, but each state keeps its own step so the wound still reads (linear RGB)
const DARK = { wound: 0.0, intact: 0.010, edge: 0.045, fresh: 0.11, dividing: 0.16 };
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x0c1018, transparent: true, opacity: 0.55 });
const ghosts = new THREE.InstancedMesh(colGeo, ghostMat, COUNT);
const rimGeo = new THREE.RingGeometry(0.5 * S * 0.92, 0.5 * S * 1.1, 6, 1); rimGeo.rotateX(-Math.PI / 2);
const ghostRims = new THREE.InstancedMesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.32, depthWrite: false }), COUNT);
const dotGeo = new THREE.CircleGeometry(0.5 * S * 0.38, 6); dotGeo.rotateX(-Math.PI / 2);
const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial(), COUNT);
const dull = new THREE.InstancedMesh(colGeo, new THREE.MeshLambertMaterial(), COUNT);   // matte, no specular sheen: greyscale context
const capGeo = new THREE.CircleGeometry(0.5 * S * 0.42, 12); capGeo.rotateX(-Math.PI / 2);
const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0x0B1116 }), COUNT);   // dividing-cell centre dot
scene.add(cols, ghosts, ghostRims, dots, dull, caps);
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
    col.setHex(PAL[st]);
    const age = f.step - f.born[k];
    if (HEAT && st !== 'wound') heatCol(col, age);
    else if (AGE_SKIN && (st === 'intact' || st === 'fresh')) ageSkin(col, age).multiplyScalar(0.92 + 0.16 * rnd[k]);
    else if (st === 'intact') col.multiplyScalar(0.85 + 0.3 * rnd[k]);
    if (!HEAT && (st === 'intact' || st === 'fresh')) { cRef.setHex(PAL.intact); coolShift(col, 1 - lum(col) / lum(cRef)); }   // darker than plain skin -> cooler
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
    caps.setMatrixAt(k, st === 'dividing' && (showCol || showDull) ? m4r.makeTranslation(x, h + (lifted ? LIFT : 0) + 0.004, z) : ZERO);
    cols.setColorAt(k, col);
  }
  cols.instanceMatrix.needsUpdate = ghosts.instanceMatrix.needsUpdate = ghostRims.instanceMatrix.needsUpdate = dots.instanceMatrix.needsUpdate = dull.instanceMatrix.needsUpdate = caps.instanceMatrix.needsUpdate = true;
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
function ageLegend() {
  const on = HEAT || AGE_SKIN; $('age-leg').style.display = on ? '' : 'none'; $('btn-heat').classList.toggle('on', HEAT);
  document.querySelectorAll('.legend > .st').forEach(el => { el.style.opacity = HEAT ? 0.35 : 1; });   // state colours are hidden under the overlay
  const hx = c => '#' + c.getHexString(), stops = HEAT ? HEAT_STOPS.slice().reverse().map(hx)
    : [0, 0.3, 0.65, 1].map(t => hx(ageSkin(new THREE.Color(), t * (AGE_SPAN + 25))));
  $('age-bar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  $('age-title').textContent = HEAT ? 'Cell age · heatmap overlay' : `Healed cells · colour = age (${AGE_RAMP})`;
}
$('btn-heat').addEventListener('click', () => { HEAT = !HEAT; ageLegend(); dirty = true; });
ageLegend();
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
let PHOTO = false;   // Draw from photo: steps only, no times / probabilities
const tEnd = () => PHOTO ? frames.length - 1 : T_END;
function setTime(tt) {
  if (PHOTO) { t = tt; slider.value = tt; const i = Math.min(frames.length - 1, Math.round(tt)); frameNow = frames[i];
    $('t-label').textContent = `step ${i} / ${frames.length - 1}`; dirty = true; return; }
  t = tt; slider.value = tt; $('t-label').textContent = `t = ${tt.toFixed(0)} min`;
  const a = areaAt(tt); let f = frames[0]; for (const fr of frames) { f = fr; if (fr.area <= a) break; } frameNow = f;
  $('r-area').textContent = `${(a * 100).toFixed(0)}% of start`; $('r-bar').style.width = `${Math.min(100, a * 100)}%`;
  $('r-mode').textContent = tt <= data.cutoff_min ? 'observed' : 'forecast (median)';
  $('now').setAttribute('x1', X(tt)); $('now').setAttribute('x2', X(tt)); dirty = true;
}
slider.addEventListener('input', () => { playing = false; playBtn.textContent = 'PLAY'; setTime(+slider.value); });
playBtn.addEventListener('click', () => { if (t >= tEnd()) setTime(0); playing = !playing; playBtn.textContent = playing ? 'PAUSE' : 'PLAY'; });
playBtn.textContent = 'PAUSE'; setTime(0);
if (Q.get('sel')) { const [x0, z0, x1, z1] = Q.get('sel').split(',').map(Number); sel = { x0, z0, x1, z1 }; drawSelBox(); $('selpanel').style.display = ''; }
if (Q.has('bare')) { playing = false; setTime(+(Q.get('t') || 30)); const v = views[Q.get('view') || 'close']; camera.position.copy(v.p); controls.target.copy(v.t); }

// ---------- Draw from photo (P3-29 #124): classify, outline, simulate the shape in the photo's skin tone ----------
let photoRes = null;
const MSG = {
  microscopy: 'Looks like a microscopy image (little or no colour). For a forecast use the Assay upload; Draw from photo is for skin-wound photos.',
  other: 'Not a skin photo: too little skin-coloured area to find a wound.',
  skin: 'Skin found, but no clear wound region. Try a closer crop around the wound.',
  wound: 'Wound outline found (white). The simulation heals this shape on a cell-culture model.',
};
const hex = rgb => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
async function openPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const img = await loadPhoto(file), res = analyse(img); photoRes = res;
  const cv = $('photo-cv'), s = Math.min(320 / img.bmp.width, 220 / img.bmp.height); cv.width = img.bmp.width * s; cv.height = img.bmp.height * s;
  const g = cv.getContext('2d'); g.drawImage(img.bmp, 0, 0, cv.width, cv.height);
  if (res.kind === 'wound') { g.fillStyle = '#FFFFFF'; const k = cv.width / res.w; for (const [x, y] of outline(res.mask, res.w, res.h)) g.fillRect(x * k, y * k, Math.max(1.5, k), Math.max(1.5, k)); }
  $('photo-kind').textContent = { microscopy: 'MICROSCOPY IMAGE', other: 'OTHER PHOTO', skin: 'SKIN, NO WOUND FOUND', wound: 'SKIN WOUND PHOTO' }[res.kind];
  $('photo-msg').textContent = MSG[res.kind];
  $('photo-stats').textContent = Object.entries(res.stats).map(([k, v]) => `${k} ${v}`).join(' · ');
  $('photo-run').disabled = res.kind !== 'wound'; $('photo').style.display = '';
}
function occFromMask(mask, w, h) {   // fit the mask's bounding box into ~70% of the dish, keeping its aspect (shape only, not size)
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, fit = 0.7 * Math.min(W / bw, D / bh), occ = new Uint8Array(COUNT).fill(1);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const mx = Math.floor(x0 + bw / 2 + (cxOf(i, j) - W / 2) / fit), my = Math.floor(y0 + bh / 2 + (cyOf(j) - D / 2) / fit);
    if (mx >= 0 && my >= 0 && mx < w && my < h && mask[my * w + mx]) occ[idx(i, j)] = 0;
  }
  return occ;
}
function runPhoto() {
  const r = photoRes; if (!r || r.kind !== 'wound') return;
  PAL.intact = hex(r.skinRGB); PAL.edge = 0xFF3E41; PAL.fresh = hex(mixRGB(r.skinRGB, [255, 255, 255], 0.65)); PAL.wound = hex(r.skinRGB.map(v => Math.round(v * 0.1)));
  rebuildRamp(); paintLegend(); ageLegend();
  frames = simulate(occFromMask(r.mask, r.w, r.h)); AGE_SPAN = Math.max(60, frames.length * 0.6); hNow.fill(0.5);
  PHOTO = true; document.body.classList.add('photo-mode'); $('photo').style.display = 'none';
  slider.max = frames.length - 1; slider.step = 1; setTime(0); playing = true; playBtn.textContent = 'PAUSE'; goTo('close');
}
$('btn-photo').addEventListener('click', () => $('photo-in').click());
$('photo-in').addEventListener('change', e => openPhoto(e.target.files[0]));
$('photo-run').addEventListener('click', runPhoto);
$('photo-cancel').addEventListener('click', () => { $('photo').style.display = 'none'; $('photo-in').value = ''; });
$('btn-exit-photo').addEventListener('click', () => location.reload());
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); openPhoto(e.dataTransfer.files[0]); });

// ?fx=bloom,grain post-processing (soft glow on bright cells; film grain like the reference poster)
const FX = (Q.get('fx') || '').split(','), composer = FX.some(Boolean) ? new EffectComposer(renderer) : null;
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  if (FX.includes('bloom')) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 0.82));
  composer.addPass(new OutputPass());
  if (FX.includes('grain')) composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float uT; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float n = fract(sin(dot(vUv * 1000.0 + uT, vec2(12.9898, 78.233))) * 43758.5453); gl_FragColor = vec4(c.rgb + (n - 0.5) * 0.07, c.a); }' }));
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); let settle = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) { const nt = Math.min(tEnd(), t + dt * (PHOTO ? 30 : 5)); setTime(nt); if (nt >= tEnd()) { playing = false; playBtn.textContent = 'PLAY'; } }
  if (dirty) { settle = 1.2; dirty = false; }
  if (settle > 0) { settle -= dt; updateColumns(frameNow, dt); selStats(); }
  if (fly) { fly.t = Math.min(1, fly.t + dt / 1.4); const e = easeIO(fly.t); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e); if (fly.t >= 1) fly = null; }
  controls.update(); if (composer) { const g = composer.passes.at(-1).uniforms?.uT; if (g) g.value = clock.elapsedTime % 10; composer.render(); } else renderer.render(scene, camera);
});
