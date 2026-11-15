// Draw mode field renderer: shows P2 engine frames ({occ, fine, outline}) as hex columns in three.js,
// or on a 2D canvas when WebGL (or the three.js CDN) is unavailable. Both expose the same interface:
//   const r = await createRenderer(container, { w, h });
//   r.setWound0(mask)   // the drawn wound (1 = drawn), used to tell new tissue from intact sheet
//   r.update(frame)     // a worker frame
//   r.view(name)        // 'field' | 'wound' | 'colony' | 'cells'
//   r.zoom(+1 | -1); r.resetCamera(); r.dispose(); r.kind = 'webgl' | '2d'
// Display rule (docs/p2-handoff.md): smoothed `fine` + `outline.display` by default; raw `occ` agents only at deep zoom.

export const PAL = { intact: 0x1F4F5C, edge: 0xEE7F2D, fresh: 0xF9D6FB, wound: 0x0B1116 };   // tokens.css --cell-*
const STATES = ['wound', 'intact', 'edge', 'fresh'];
const WOUND = 0, INTACT = 1, EDGE = 2, FRESH = 3;
// relative column height per state (non-colour cue: edge shorter, new tissue rising, wound at the floor)
const H_RAW = [0.04, 1.0, 0.6, 0.8];
const D_OPEN = 0.3, D_EDGE = 0.8;     // smoothed density thresholds: below D_OPEN reads as open floor

// Per-site state + target height for one frame. deep = raw agents, else the smoothed field.
export function classify(frame, wound0, deep, out) {
  const { w, h, occ, fine } = frame, n = w * h;
  const state = out?.state || new Uint8Array(n), height = out?.height || new Float32Array(n);
  const k = fine?.scale || 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (deep || !fine) {
      let s = WOUND;
      if (occ[i]) {
        s = wound0[i] ? FRESH : INTACT;
        for (let dy = -1; dy <= 1 && s !== EDGE; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && !occ[yy * w + xx]) { s = EDGE; break; }
        }
      }
      state[i] = s; height[i] = H_RAW[s];
    } else {
      let d = 0;                                      // site density = mean of its k x k fine pixels
      for (let fy = 0; fy < k; fy++) for (let fx = 0; fx < k; fx++) d += fine.data[(y * k + fy) * fine.w + x * k + fx];
      d /= k * k * 255;
      const s = d < D_OPEN ? WOUND : d < D_EDGE ? EDGE : wound0[i] ? FRESH : INTACT;
      state[i] = s; height[i] = s === WOUND ? 0.04 : s === EDGE ? 0.75 * d : d;
    }
  }
  return { state, height };
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export async function createRenderer(container, opts) {
  try { return await createField3D(container, opts); }
  catch (e) { console.warn('draw: WebGL unavailable, using the 2D field', e); return createFlat(container, opts); }
}

// ---------------------------------------------------------------- 3D (three.js)
async function createField3D(container, { w, h }) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const canvas = document.createElement('canvas');
  canvas.className = 'dr-scene';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // throws without WebGL
  container.appendChild(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050607);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 140; controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101018, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-30, 60, 25); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe4e6ea, 0.5); fill.position.set(40, 20, -30); scene.add(fill);

  // one world unit = one lattice site (20 um); field centred on the origin, rows along +z
  const X0 = -w / 2, Z0 = -h / 2, HMAX = 1.6, n = w * h, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const disposables = [];
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.28 });
  const faintMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.08 });
  disposables.push(lineMat, faintMat);
  const segs = (pts, m) => { const g = new THREE.BufferGeometry().setFromPoints(pts); disposables.push(g); scene.add(new THREE.LineSegments(g, m)); };
  const xa = X0 - 1, xb = -X0 + 1, za = Z0 - 1, zb = -Z0 + 1, grid = [];
  for (let x = 0; x <= w; x += 5) grid.push(V(X0 + x, 0, za), V(X0 + x, 0, zb));   // every 100 um
  for (let z = 0; z <= h; z += 5) grid.push(V(xa, 0, Z0 + z), V(xb, 0, Z0 + z));
  segs(grid, faintMat);
  segs([V(xa, 0, za), V(xb, 0, za), V(xb, 0, za), V(xb, 0, zb), V(xb, 0, zb), V(xa, 0, zb), V(xa, 0, zb), V(xa, 0, za),
    V(xa, 0, za), V(xa, HMAX * 1.2, za), V(xa, HMAX * 1.2, za), V(xb, HMAX * 1.2, za), V(xb, 0, za), V(xb, HMAX * 1.2, za)], lineMat);
  function label(text, pos, size = 1, color = '#8a949c', cx = 0) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.font = '28px ui-monospace, Menlo, monospace'; g.fillStyle = color; g.textBaseline = 'middle';
    g.textAlign = cx ? 'right' : 'left'; g.fillText(text, cx ? 252 : 4, 32);
    const tex = new THREE.CanvasTexture(c), mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    disposables.push(tex, mat);
    const sp = new THREE.Sprite(mat); sp.scale.set(size * 4, size, 1); sp.position.copy(pos); sp.center.set(cx, 0.5); scene.add(sp);
  }
  for (let x = 0; x <= w; x += 10) label(`${x * 20}`, V(X0 + x, 0, zb + 1.4), 1.1);
  label('x (µm)', V(-2, 0, zb + 3.4), 1.2, '#e8ecef');
  for (let z = 0; z <= h; z += 10) label(`${z * 20}`, V(xb + 1, 0, Z0 + z), 1.1);
  label('y (µm)', V(xb + 1, 0, zb + 3.4), 1.2, '#e8ecef');
  label('local density (relative)', V(xa - 0.5, HMAX * 1.2 + 0.8, za), 1.2, '#e8ecef', 1);

  // hex columns, one per lattice site
  const colGeo = new THREE.CylinderGeometry(0.56, 0.56, 1, 6); colGeo.translate(0, 0.5, 0); colGeo.rotateY(Math.PI / 6);
  const colMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  const cols = new THREE.InstancedMesh(colGeo, colMat, n);
  disposables.push(colGeo, colMat);
  scene.add(cols);
  const jitter = Float32Array.from({ length: n }, (_, i) => 0.85 + 0.3 * (((i * 2654435761) >>> 0) / 4294967296));
  const colours = STATES.map((s) => new THREE.Color(PAL[s]));

  // wound outline (area-matched, display rule): ink lines just above the floor columns
  const outMat = new THREE.LineBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0 });
  const outLines = new THREE.LineSegments(new THREE.BufferGeometry(), outMat);
  disposables.push(outMat); scene.add(outLines);

  let wound0 = new Uint8Array(n), frame = null, cls = { state: new Uint8Array(n), height: new Float32Array(n) };
  const hNow = new Float32Array(n).fill(1), m4 = new THREE.Matrix4(), col = new THREE.Color();
  let deep = false, dirty = 0;

  function setOutline(f) {
    const d = f?.outline?.display, pts = [];
    if (d && !deep) for (const L of d.lines) for (let j = 0; j + 3 < L.length; j += 2)
      pts.push(X0 + L[j], 0.12, Z0 + L[j + 1], X0 + L[j + 2], 0.12, Z0 + L[j + 3]);
    outLines.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    outLines.geometry = g; outMat.opacity = d ? d.opacity : 0;
  }
  function reclassify() { if (frame) { classify(frame, wound0, deep, cls); setOutline(frame); dirty = 1.2; } }

  function updateColumns(dt) {
    const ease = Math.min(1, dt * 8);
    for (let i = 0; i < n; i++) {
      const s = cls.state[i];
      hNow[i] += (cls.height[i] - hNow[i]) * ease;
      const x = i % w, y = (i / w) | 0, hh = Math.max(0.02, hNow[i]) * HMAX;
      m4.makeScale(1, hh, 1).setPosition(X0 + x + 0.5, 0, Z0 + y + 0.5);
      cols.setMatrixAt(i, m4);
      col.copy(colours[s]); if (s === INTACT) col.multiplyScalar(jitter[i]);
      cols.setColorAt(i, col);
    }
    cols.instanceMatrix.needsUpdate = true; cols.instanceColor.needsUpdate = true;
  }

  // camera presets ("magnification"): field, wound, colony; cells is close enough to switch to raw agents
  const DEEP_DIST = 14, centre = V(0, 0, 0);
  const VIEWS = { field: 62, wound: 34, colony: 20, cells: 10 };
  let fly = null;
  function view(name) {
    const dist = VIEWS[name] || VIEWS.field, t = name === 'field' ? V(0, 0.4, 0) : centre.clone().setY(0.4);
    const dir = V(-0.35, 0.78, 0.52).normalize();
    fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: t.clone().addScaledVector(dir, dist), q1: t };
  }
  camera.position.set(-0.35 * 62, 0.78 * 62, 0.52 * 62).multiplyScalar(1 / Math.hypot(0.35, 0.78, 0.52)); controls.target.set(0, 0.4, 0);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

  const ro = new ResizeObserver(() => {
    const W = container.clientWidth, H = container.clientHeight; if (!W || !H) return;
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  });
  ro.observe(container);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 1.4); const e = easeIO(fly.t);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    const nowDeep = camera.position.distanceTo(controls.target) < DEEP_DIST;
    if (nowDeep !== deep) { deep = nowDeep; reclassify(); }
    if (dirty > 0) { dirty -= dt; updateColumns(dt); }
    renderer.render(scene, camera);
  });

  return {
    kind: 'webgl',
    get deep() { return deep; },
    setWound0(m) {
      wound0 = Uint8Array.from(m);
      let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < n; i++) if (m[i]) { sx += i % w; sy += (i / w) | 0; c++; }
      centre.set(c ? X0 + sx / c + 0.5 : 0, 0, c ? Z0 + sy / c + 0.5 : 0);
    },
    update(f) { frame = f; reclassify(); },
    view,
    zoom(dir) {
      fly = null;
      const off = camera.position.clone().sub(controls.target).multiplyScalar(dir > 0 ? 0.8 : 1.25);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length()));
      camera.position.copy(controls.target).add(off.setLength(len));
    },
    resetCamera() { view('field'); },
    dispose() {
      renderer.setAnimationLoop(null); ro.disconnect(); controls.dispose();
      outLines.geometry.dispose(); disposables.forEach((d) => d.dispose()); cols.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}

// ---------------------------------------------------------------- 2D fallback
function createFlat(container, { w, h }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'dr-scene dr-scene--flat';
  container.appendChild(canvas);
  const g = canvas.getContext('2d'), n = w * h;
  let wound0 = new Uint8Array(n), frame = null, scale = 1, cls = null;
  const deepAt = 2;   // zoom factor at which the raw agents are drawn
  const css = STATES.map((s) => hex(PAL[s]));

  function draw() {
    const W = container.clientWidth, H = container.clientHeight; if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#050607'; g.fillRect(0, 0, W, H);
    if (!frame) return;
    const cell = Math.min((W * 0.8) / w, (H * 0.8) / h) * scale, ox = (W - cell * w) / 2, oy = (H - cell * h) / 2;
    cls = classify(frame, wound0, scale >= deepAt, cls);
    for (let i = 0; i < n; i++) {
      const s = cls.state[i];
      g.globalAlpha = s === WOUND ? 1 : 0.45 + 0.55 * Math.min(1, cls.height[i]);   // brightness ~ density
      g.fillStyle = css[s];
      g.fillRect(ox + (i % w) * cell, oy + ((i / w) | 0) * cell, cell - (cell > 6 ? 1 : 0), cell - (cell > 6 ? 1 : 0));
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(232,236,239,0.18)'; g.strokeRect(ox - 0.5, oy - 0.5, cell * w + 1, cell * h + 1);
    const d = frame.outline?.display;
    if (d && scale < deepAt && d.opacity > 0) {
      g.strokeStyle = `rgba(232,236,239,${d.opacity})`; g.lineWidth = 1.5;
      for (const L of d.lines) {
        g.beginPath();
        for (let j = 0; j + 1 < L.length; j += 2) g[j ? 'lineTo' : 'moveTo'](ox + L[j] * cell, oy + L[j + 1] * cell);
        g.stroke();
      }
    }
  }
  const ro = new ResizeObserver(draw); ro.observe(container);
  const VIEWS = { field: 1, wound: 1.5, colony: 1.8, cells: 3 };
  return {
    kind: '2d',
    get deep() { return scale >= deepAt; },
    setWound0(m) { wound0 = Uint8Array.from(m); },
    update(f) { frame = f; draw(); },
    view(name) { scale = VIEWS[name] || 1; draw(); },
    zoom(dir) { scale = Math.min(4, Math.max(0.5, scale * (dir > 0 ? 1.25 : 0.8))); draw(); },
    resetCamera() { scale = 1; draw(); },
    dispose() { ro.disconnect(); canvas.remove(); },
  };
}
