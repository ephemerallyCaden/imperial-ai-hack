// Glass-dish final look (chosen 15 Nov): skin palette, toon cel shading, age colouring, 8 deg cool hue shift.
// ONE source for the mockup (design/prototypes/glass-dish/main.js) and the app (web/assay/tissue.js imports the byte copy
// web/vendor-design/look.js; scripts/check_look_sync.py fails if the two differ). Edit here, then copy.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// defaults of the final look; the mockup's URL params still override them for look-dev
export const FINAL = { pal: 'C68B6E,B3122E,FFD2C6,FFFFFF,24120F', bg: '120A09', mat: 'toon', age: 'skin', hshift: 8 };
export const HMAX = 0.65;                                                    // world height of density 1
export const HEIGHT = { intact: 1.0, dividing: 1.0, edge: 0.6, wound: 0.08 };   // relative density per state
// new tissue grows from 0.7 to full height over its first 25 steps (age = steps since it filled in)
export const targetH = (st, age) => st === 'fresh' ? 0.7 + 0.3 * Math.min(1, age / 25) : HEIGHT[st];
export const colHeight = (st, age, rnd) => targetH(st, age) * (st === 'intact' ? 0.92 + 0.16 * rnd : 1);   // subtle unevenness

// ---------- lights: the dimmer rig for every material but matte (they add env + emissive light); ?light=warm rig ----------
export function addLights(scene, mat = FINAL.mat, warm = false) {
  const LIT = mat && mat !== 'matte' ? [0.4, 1.25, 0.3] : [1.1, 1.6, 0.5];
  if (warm) LIT[0] *= 1.6;
  const hemi = new THREE.HemisphereLight(warm ? 0xffe6d6 : 0xdfe8ff, warm ? 0x2a0c10 : 0x101018, LIT[0]);
  const key = new THREE.DirectionalLight(warm ? 0xfff0e2 : 0xffffff, LIT[1]); key.position.set(-30, 60, 25);
  const fill = new THREE.DirectionalLight(warm ? 0xffd2c2 : 0xe4e6ea, LIT[2]); fill.position.set(40, 20, -30);
  scene.add(hemi, key, fill);
  return { hemi, key, fill };
}
// studio reflections for sheen / clearcoat highlights (no effect on toon: three applies scene.environment to standard materials only)
export function addEnvironment(renderer, scene, mat = FINAL.mat) {
  if (!MATS[mat] || mat === 'matte') return;
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.12;
}

// ---------- column geometry: hex prism of radius r standing on y = 0, height 1 (scale y per instance) ----------
export function colGeo(r) {
  const g = new THREE.CylinderGeometry(r, r, 1, 6); g.translate(0, 0.5, 0); g.rotateY(Math.PI / 6); return g;
}

// ---------- materials ----------
// matte (original) | skin (velvet sheen + faked subsurface) | wet (clearcoat, moist wound bed)
// | gel (translucent, fresnel rim) | glow (self-lit, fluorescence-style). emit = instance colour added as light, rim = fresnel edge
export const MATS = {
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
// column material: MATS[mat] + emissive (emit x instance colour), white fresnel rim (power 3) x instance colour and, for
// hshift > 0, the cool hue shift applied to lit colour (darker than its unlit albedo -> hue turns toward 240 deg).
// ramp: colour by world height like a space-time stack (dark base -> state colour -> pale tips), hmax = height of density 1
export function makeColumnMaterial(mat = FINAL.mat, hshift = FINAL.hshift, { ramp = false, hmax = HMAX } = {}) {
  const M = MATS[mat] || MATS.matte, m = M.make();
  if (!(M.emit || M.rim || ramp || hshift)) return m;
  m.customProgramCacheKey = () => `look:${mat}:${hshift}:${ramp}`;   // shader source depends on these, not only on the closure
  m.onBeforeCompile = sh => {
    if (hshift) {   // same cool shift for lighting: compare lit colour with the unlit albedo
      sh.uniforms.uHShift = { value: hshift };
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
    if (ramp) {
      sh.uniforms.uHMax = { value: hmax };
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
  return m;
}

// ---------- cool hue shift: as a colour gets darker its hue turns toward cool blue (240 deg, shortest way round) ----------
// in proportion to how much darker it got; deg = shift at fully dark (8: ~4 deg at half), 0 = off
export const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const hslT = {};
export function coolShift(c, dark, deg = FINAL.hshift) {   // dark: 0 (as bright as its reference) .. 1 (black)
  if (!deg || dark <= 0) return c; c.getHSL(hslT);
  let d = 0.6667 - hslT.h; d -= Math.floor(d + 0.5);
  return c.setHSL((hslT.h + Math.sign(d) * Math.min(Math.abs(d), deg / 360 * Math.min(1, dark)) + 1) % 1, hslT.s, hslT.l);
}

// ---------- age colouring: cell age = steps since the cell filled in; original tissue keeps the plain intact colour ----------
// ramps (t: 0 = just filled in, 1 = mature). Original tissue is not healed, so it keeps the plain intact colour
// (all ramps, including 'pale'; decided 15 Nov so untouched skin reads bright like the healed salmon).
//   pale  new-tissue colour -> intact -> darker intact (light -> dark)
//   scar  dusky red -> pink -> skin tinted toward the new-tissue colour, like a real scar maturing (ends paler than skin)
//   ember leading-edge colour cooling to intact (hot -> calm)
//   deep  dark intact -> intact (dark -> normal)
//   sat   over-saturated intact -> intact (same lightness, colour drains)
//   hue   intact with hue rotated -> intact (same lightness, hue drifts)
const C = h => new THREE.Color(h), hsl = (h, dh, ds, dl) => { const c = C(h), o = {}; c.getHSL(o); return c.setHSL((o.h + dh + 1) % 1, Math.min(1, Math.max(0, o.s * ds)), Math.min(1, o.l * dl)); };
export const RAMPS = {
  pale: P => [C(P.fresh), C(P.intact), C(P.intact).multiplyScalar(0.45).lerp(C(P.wound), 0.15)],
  scar: P => [C(P.edge).lerp(C(P.wound), 0.35).lerp(C(0x6A1B4D), 0.3), C(P.fresh).lerp(C(P.edge), 0.25), C(P.intact).lerp(C(P.fresh), 0.35)],
  ember: P => [C(P.edge), C(P.edge).lerp(C(P.intact), 0.6), C(P.intact)],
  deep: P => [C(P.intact).multiplyScalar(0.35), C(P.intact).multiplyScalar(0.7), C(P.intact)],
  sat: P => [hsl(P.intact, 0, 2.2, 1.05), hsl(P.intact, 0, 1.4, 1), C(P.intact)],
  hue: P => [hsl(P.intact, -0.12, 1.3, 1), hsl(P.intact, -0.05, 1.1, 1), C(P.intact)],
};
// PAL = { intact, edge, fresh, dividing?, wound } (hex numbers; read by reference, call rebuild() after changing it).
// span = age (steps) at which healed tissue is mature, max(60, 0.6 x frames); original tissue: pass age = Infinity
export function makeAgeRamp(PAL, span, name = 'pale') {
  const r = { PAL, span, name, STOPS: null, ORIG: null };
  r.rebuild = () => { r.STOPS = (RAMPS[name] || RAMPS.pale)(PAL); r.ORIG = C(PAL.intact); return r; };   // original (untouched) tissue: plain intact colour; only healed tissue runs the ramp (15 Nov)
  r.ageT = age => Math.min(1, Math.max(0, age / (r.span + 25)));
  r.ageSkin = (c, age) => {
    if (age > Math.max(900, r.span + 25)) return c.copy(r.ORIG);
    const t = r.ageT(age); return t < 0.3 ? c.copy(r.STOPS[0]).lerp(r.STOPS[1], t / 0.3) : c.copy(r.STOPS[1]).lerp(r.STOPS[2], (t - 0.3) / 0.7);
  };
  return r.rebuild();
}

// ---------- per-cell colour: state colour, age ramp for intact / new tissue (x 0.92-1.08 jitter), then darker -> cooler ----------
// c: THREE.Color (written), st: 'intact' | 'edge' | 'fresh' | 'dividing' | 'wound', rnd: fixed per-cell random 0..1
const cRef = new THREE.Color();
export function cellColour(c, st, age, rnd, ramp, { age: useAge = true, hshift = FINAL.hshift } = {}) {
  const PAL = ramp.PAL; c.setHex(PAL[st]);
  const tissue = st === 'intact' || st === 'fresh';
  if (useAge && tissue) ramp.ageSkin(c, age).multiplyScalar(0.92 + 0.16 * rnd);
  else if (st === 'intact') c.multiplyScalar(0.85 + 0.3 * rnd);
  if (tissue) { cRef.setHex(PAL.intact); coolShift(c, 1 - lum(c) / lum(cRef), hshift); }   // darker than plain skin -> cooler
  return c;
}
