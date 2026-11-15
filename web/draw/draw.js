// Draw mode: freehand a wound on a confluent monolayer, then watch P2's cell-agent engine heal it under a fitted
// preset (web/public/sim/js/worker.js, see docs/p2-handoff.md). Simulation under preset parameters, not a forecast:
// no band and no coverage claim is ever shown here.
import { FIELD_W as W, FIELD_H as H, SITE_UM, PRESETS_FOLLOW, presetLabelFor, presetCaptionFor, DEFAULT_RULE } from '../public/sim/js/engine.js';
import { createRenderer, PAL } from './renderer.js';

const T_END = 24;                                   // hours of simulated time per run
const STEP_H = 0.1;                                 // one "step" on the readout = 0.1 h
const SPEEDS = [0.5, 1, 2, 4];                      // x 0.1 h of sim time per worker frame (~30 frames/s)
const SEED = 1;
const PRESET_NAMES = { CC: 'Normal cells · MCF10A control', C61: 'CYR61 knocked down' };
const SIMILAR = 'the fitted conditions differ little under this model';
const BRUSHES = { S: 1.0, M: 1.8, L: 3.0 };          // brush radius in lattice sites
const hexCss = (c) => '#' + c.toString(16).padStart(6, '0');
const fmt = (x, d = 3) => x.toFixed(d);

export function mount(el, ctx) {
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('./draw.css', import.meta.url).href;
  document.head.appendChild(css);

  el.innerHTML = `
  <div class="dr">
    <div class="dr-bar">
      <span class="st-kicker">Tool</span>
      <div class="st-seg">
        <button class="st-btn" data-tool="draw">✎ Draw wound</button>
        <button class="st-btn" data-tool="heal" disabled>✦ Heal</button>
      </div>
      <div class="st-seg" aria-label="Brush size">
        ${Object.keys(BRUSHES).map((b) => `<button class="st-btn" data-brush="${b}" title="brush ${b}">${b}</button>`).join('')}
      </div>
      <button class="st-btn" data-clear hidden>Clear</button>
      <span class="st-kicker">Preset</span>
      <div class="st-seg">${Object.keys(PRESET_NAMES).map((p) => `<button class="st-btn" data-preset="${p}">${PRESET_NAMES[p]}</button>`).join('')}</div>
      <div class="dr-chips">
        <span class="st-chip st-chip--honesty" data-label>${presetLabelFor(DEFAULT_RULE)}</span>
        <span class="st-chip st-chip--honesty">Not a forecast · no band · no agent</span>
      </div>
    </div>

    <div class="dr-stage">
      <div class="dr-field"></div>
      <div class="dr-draw">
        <div class="dr-pad">
          <canvas></canvas>
          <div class="dr-empty"><span class="st-kicker">Draw canvas · freehand wound on a confluent monolayer</span>
            <span class="st-caption">drag to draw the empty region (Shift-drag erases), then press Heal to run the cell-agent engine under the preset</span></div>
        </div>
      </div>
      <span class="st-chip st-chip--honesty dr-honesty">Simulated cells · not tracked cells</span>

      <div class="st-panel st-panel--solid dr-float dr-tl" data-mag>
        <h4 class="st-kicker">Magnification</h4>
        <button class="st-btn" data-view="field">1× field</button>
        <button class="st-btn" data-view="wound">5× wound</button>
        <button class="st-btn" data-view="colony">10× colony</button>
        <button class="st-btn" data-view="cells">20× cells</button>
        <span class="st-caption" data-render></span>
      </div>

      <div class="st-panel st-panel--solid dr-float dr-tr">
        <h4 class="st-kicker">Field readout</h4>
        <div class="st-row"><span>step</span><span data-r="step">–</span></div>
        <div class="st-row"><span>time</span><span data-r="t">–</span></div>
        <div class="st-row"><span>wound fraction</span><span data-r="wf">–</span></div>
        <div class="st-row"><span>n cells</span><span data-r="cells">–</span></div>
        <div class="st-row"><span>wound area</span><span data-r="area">–</span></div>
        <span class="st-caption">from the engine frames · 32×44 sites at ${SITE_UM} µm · seed ${SEED}</span>
      </div>

      <div class="st-panel st-panel--solid dr-float dr-mr">
        <h4 class="st-kicker">This preset assumes</h4>
        <p data-pname></p>
        <p class="num" data-pparams></p>
        <span class="st-caption" data-pcaption></span>
        <span class="st-caption">${SIMILAR[0].toUpperCase() + SIMILAR.slice(1)}. Not modelled: cell division (off), seeding density, plate edges, imaging artefacts, drugs. For a forecast on your plate, use Assay.</span>
      </div>

      <div class="st-panel st-panel--solid dr-float dr-bl dr-legend">
        <h4 class="st-kicker">Cell states · non-colour cues</h4>
        <p><i style="background:${hexCss(PAL.intact)}"></i>Intact — full column</p>
        <p><i style="background:${hexCss(PAL.edge)}"></i>Leading edge — shorter column</p>
        <p><i style="background:${hexCss(PAL.fresh)}"></i>New tissue (inside the drawn wound) — rising column</p>
        <p><i style="background:${hexCss(PAL.wound)}"></i>Wound — floor, near-black</p>
        <span class="st-caption">smoothed field + wound outline; raw agents at 20×</span>
      </div>

      <div class="st-panel st-panel--solid dr-float dr-br" data-hint>
        <h4 class="st-kicker">First-time hint</h4>
        <p>Draw any shape, then press Heal. This shows how cells following the rules fitted to the chosen condition would close it, in theory. It makes no forecast claim. Clear appears once a wound is drawn.</p>
        <button class="st-btn" data-hint-close>Got it</button>
      </div>
    </div>

    <div class="dr-transport">
      <div class="st-seg">
        <button class="st-btn st-btn--icon" data-act="step-back" aria-label="Step back" title="Step back (←)"><svg viewBox="0 0 24 24"><path d="M6 5v14M18 5l-9 7 9 7z"/></svg></button>
        <button class="st-btn st-btn--icon st-btn--primary" data-act="play" aria-label="Play" title="Play / pause (Space)"><svg viewBox="0 0 24 24" data-icon><path d="M7 5l12 7-12 7z"/></svg></button>
        <button class="st-btn st-btn--icon" data-act="step-forward" aria-label="Step forward" title="Step forward (→)"><svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l9 7-9 7z"/></svg></button>
      </div>
      <div class="st-seg">${SPEEDS.map((s) => `<button class="st-btn" data-speed="${s}">${s}×</button>`).join('')}</div>
      <span class="dr-status num" data-status></span>
      <div class="dr-progress"><div></div></div>
    </div>
  </div>`;

  const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
  const pad = $('.dr-pad'), padCanvas = pad.querySelector('canvas'), drawLayer = $('.dr-draw');

  // ---------- state ----------
  const mask = new Uint8Array(W * H);               // 1 = drawn wound
  const st = { tool: 'draw', preset: 'CC', speed: 1, brush: 'M', running: false, history: [], at: -1, startFrac: 0, done: false };
  let renderer = null, alive = true;

  // ---------- worker ----------
  const worker = new Worker(new URL('../public/sim/js/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: m }) => {
    if (m.type !== 'frame') return;
    const follow = st.at === st.history.length - 1;
    st.history.push(m);
    if (st.history.length === 1) st.startFrac = m.wound_frac;
    if (follow) show(st.history.length - 1);
    if (st.running && (m.t_hours >= T_END - 1e-6 || m.wound_frac <= 0)) { pause(); st.done = true; status(); }
  };
  const hpf = () => STEP_H * st.speed;

  function heal() {
    if (!mask.some(Boolean)) return;
    setTool('heal');
    st.history = []; st.at = -1; st.done = false;
    renderer?.setWound0(mask);
    worker.postMessage({ type: 'init', w: W, h: H, wound: mask.slice(), preset: st.preset, seed: SEED, rule: DEFAULT_RULE });
    play();
  }
  function play() {
    if (st.tool === 'draw') return heal();
    if (!st.history.length) return heal();
    if (st.done) { st.history = []; st.at = -1; st.done = false; worker.postMessage({ type: 'reset' }); }
    else if (st.at < st.history.length - 1) show(st.history.length - 1);
    st.running = true; worker.postMessage({ type: 'run', hoursPerFrame: hpf() }); status();
  }
  function pause() { st.running = false; worker.postMessage({ type: 'pause' }); status(); }
  function stepBack() { if (st.tool !== 'heal' || st.at <= 0) return; if (st.running) pause(); show(st.at - 1); }
  function stepForward() {
    if (st.tool !== 'heal' || !st.history.length) return;
    if (st.running) pause();
    if (st.at < st.history.length - 1) show(st.at + 1);
    else if (!st.done && st.history.at(-1).t_hours < T_END - 1e-6) worker.postMessage({ type: 'step', hours: hpf() });
  }

  // ---------- frame display ----------
  function show(i) {
    st.at = i; const f = st.history[i]; if (!f) return;
    renderer?.update(f);
    const nCells = f.occ.reduce((s, v) => s + v, 0);
    $('[data-r="step"]').textContent = `${Math.round(f.t_hours / STEP_H)} / ${Math.round(T_END / STEP_H)}`;
    $('[data-r="t"]').textContent = `t = ${fmt(f.t_hours, 1)} h`;
    $('[data-r="wf"]').textContent = `${fmt(f.wound_frac)} (start ${fmt(st.startFrac)})`;
    $('[data-r="cells"]').textContent = `${nCells.toLocaleString()} of ${(W * H).toLocaleString()} sites`;
    $('[data-r="area"]').textContent = `${Math.round((f.wound_frac * W * H * SITE_UM * SITE_UM) / 1000)}k µm²`;
    if (f.label) $('[data-label]').textContent = f.label;
    $('.dr-progress > div').style.width = `${Math.min(100, (f.t_hours / T_END) * 100)}%`;
    presetPanel(f.caption);
    status();
  }
  function status() {
    const f = st.history[st.at], icon = $('[data-icon]');
    icon.innerHTML = st.running ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 5l12 7-12 7z"/>';
    $('[data-act="play"]').setAttribute('aria-label', st.running ? 'Pause' : 'Play');
    if (st.tool === 'draw' || !f) {
      const drawn = mask.reduce((s, v) => s + v, 0) / (W * H);
      $('[data-status]').innerHTML = drawn ? `drawn wound fraction <b>${fmt(drawn)}</b> · press Heal or Space` : 'draw a wound to begin';
      return;
    }
    const steps = Math.round(T_END / STEP_H);
    $('[data-status]').innerHTML = `step <b>${Math.round(f.t_hours / STEP_H)}</b> of ${steps} · simulated time <b>t = ${fmt(f.t_hours, 1)} h</b>` +
      ` · wound fraction <b>${fmt(f.wound_frac)}</b>${st.done ? ' · run finished, Space replays' : ''}` +
      (st.at < st.history.length - 1 ? ' · reviewing earlier frame' : '');
  }
  function presetPanel(caption) {
    const p = PRESETS_FOLLOW[st.preset];
    $('[data-pname]').textContent = PRESET_NAMES[st.preset];
    $('[data-pparams]').textContent = `Tm ${fmt(p.Tm)} h · bias ${fmt(p.bias)} (${DEFAULT_RULE} rule) · median of 7 WHAD part II fits`;
    $('[data-pcaption]').textContent = caption ?? presetCaptionFor(DEFAULT_RULE) ?? '';
  }

  // ---------- tools ----------
  function setTool(t) {
    st.tool = t;
    if (t === 'draw' && st.running) pause();
    drawLayer.hidden = t !== 'draw';
    $('[data-mag]').hidden = t !== 'heal';
    $$('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('.dr-progress > div').style.width = t === 'draw' ? '0%' : $('.dr-progress > div').style.width;
    if (t === 'draw') paintPad();
    status();
  }
  function maskChanged() {
    const any = mask.some(Boolean);
    $('[data-tool="heal"]').disabled = !any;
    $('[data-clear]').hidden = !any;
    pad.querySelector('.dr-empty').hidden = any;
    paintPad(); status();
  }

  // ---------- drawing pad (32x44 lattice, scaled up visually) ----------
  let cell = 10, hover = null;
  function sizePad() {
    const box = drawLayer.getBoundingClientRect();
    cell = Math.max(4, Math.floor(Math.min((box.width * 0.62) / W, (box.height * 0.8) / H)));
    const dpr = Math.min(devicePixelRatio, 2);
    padCanvas.width = W * cell * dpr; padCanvas.height = H * cell * dpr;
    padCanvas.style.width = `${W * cell}px`; padCanvas.style.height = `${H * cell}px`;
    padCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPad();
  }
  function paintPad() {
    const g = padCanvas.getContext('2d');
    g.fillStyle = hexCss(PAL.wound); g.fillRect(0, 0, W * cell, H * cell);
    g.fillStyle = hexCss(PAL.intact);
    for (let i = 0; i < W * H; i++) if (!mask[i]) g.fillRect((i % W) * cell, ((i / W) | 0) * cell, cell - 1, cell - 1);
    if (hover) {
      g.strokeStyle = '#E0A458'; g.lineWidth = 1;
      g.beginPath(); g.arc(hover.x * cell, hover.y * cell, BRUSHES[st.brush] * cell, 0, Math.PI * 2); g.stroke();
    }
  }
  function stamp(px, py, val) {
    const r = BRUSHES[st.brush];
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++)
      if (x >= 0 && x < W && y >= 0 && y < H && (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 <= r * r) mask[y * W + x] = val;
  }
  const toSite = (e) => { const b = padCanvas.getBoundingClientRect(); return { x: (e.clientX - b.left) / cell, y: (e.clientY - b.top) / cell }; };
  let last = null, erase = false;
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId); erase = e.shiftKey || e.button === 2;
    last = toSite(e); stamp(last.x, last.y, erase ? 0 : 1); maskChanged();
  });
  pad.addEventListener('pointermove', (e) => {
    hover = toSite(e);
    if (last) {                                     // fill along the segment so fast strokes stay continuous
      const n = Math.max(1, Math.ceil(Math.hypot(hover.x - last.x, hover.y - last.y) / 0.4));
      for (let k = 1; k <= n; k++) stamp(last.x + ((hover.x - last.x) * k) / n, last.y + ((hover.y - last.y) * k) / n, erase ? 0 : 1);
      last = hover; maskChanged();
    } else paintPad();
  });
  const endStroke = () => { last = null; };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('pointerleave', () => { hover = null; paintPad(); });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  const ro = new ResizeObserver(sizePad); ro.observe(drawLayer);

  // ---------- controls ----------
  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => (b.dataset.tool === 'heal' ? heal() : setTool('draw'))));
  $('[data-clear]').addEventListener('click', () => { mask.fill(0); setTool('draw'); maskChanged(); });
  const pick = (attr, v) => $$(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', b.getAttribute(attr) === String(v)));
  $$('[data-brush]').forEach((b) => b.addEventListener('click', () => { st.brush = b.dataset.brush; pick('data-brush', st.brush); }));
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    st.preset = b.dataset.preset; pick('data-preset', st.preset);
    worker.postMessage({ type: 'preset', preset: st.preset });   // live switch; ignored by the worker before init
    presetPanel(st.history[st.at]?.caption);
  }));
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    st.speed = +b.dataset.speed; pick('data-speed', st.speed);
    if (st.running) worker.postMessage({ type: 'run', hoursPerFrame: hpf() });   // updates hpf of the running loop
  }));
  const ACTS = { play: () => (st.running ? pause() : play()), 'step-back': stepBack, 'step-forward': stepForward,
    'zoom-in': () => renderer?.zoom(1), 'zoom-out': () => renderer?.zoom(-1), 'reset-camera': () => renderer?.resetCamera() };
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => ACTS[b.dataset.act]()));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { renderer?.view(b.dataset.view); pick('data-view', b.dataset.view); }));
  const hint = $('[data-hint]');
  if (localStorage.getItem('stitch.draw.hint') === 'seen') hint.hidden = true;
  $('[data-hint-close]').addEventListener('click', () => { hint.hidden = true; localStorage.setItem('stitch.draw.hint', 'seen'); });

  const onKey = (e) => { const a = ACTS[e.detail?.action]; if (a) a(); };
  const onAction = (e) => {
    const a = e.detail?.action || '';
    if (a === 'reset-camera') renderer?.resetCamera();
    else if (a.startsWith('camera:')) renderer?.view(a.slice(7) === 'cells' ? 'cells' : a.slice(7));
  };
  ctx.bus.addEventListener('key', onKey);
  ctx.bus.addEventListener('action', onAction);

  pick('data-brush', st.brush); pick('data-preset', st.preset); pick('data-speed', st.speed); pick('data-view', 'field');
  presetPanel(); setTool('draw'); maskChanged();

  createRenderer($('.dr-field'), { w: W, h: H }).then((r) => {
    if (!alive) return r.dispose();
    renderer = r;
    $('[data-render]').textContent = r.kind === 'webgl' ? '3D field · drag to orbit' : '2D field (WebGL unavailable)';
    renderer.setWound0(mask);
    if (st.history[st.at]) renderer.update(st.history[st.at]);
  });

  return function unmount() {
    alive = false;
    worker.terminate();
    ro.disconnect();
    ctx.bus.removeEventListener('key', onKey);
    ctx.bus.removeEventListener('action', onAction);
    renderer?.dispose();
    css.remove();
    el.replaceChildren();
  };
}
