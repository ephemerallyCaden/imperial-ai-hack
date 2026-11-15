// Draw mode (#106, INT-3): P2's cell-agent engine + NCA band (docs/p2-handoff.md), as one mountable module.
//   import { mountDraw } from './draw/draw.js'; mountDraw(document.querySelector('#draw'));
// Two views:
//   "Draw a wound": freehand wound on the locked 32x44 WHAD lattice, follow-rule presets, NO band (simulation, not a forecast).
//   "Real wound":   exp1_partII_C61_P2 from the 3.0 h mask: sim (agents) vs NCA (density) vs observed, plus the NCA band
//                   computed live in the worker from the same start and fit. Labelled uncalibrated, never a 90% interval.
// Zoom keeps the same area at every scale: one viewport (centre + zoom) is shared by the smoothed view and the raw-agent view;
// the raw agents take over at deep zoom (handoff rendering rule).
import { PRESETS_FOLLOW, PRESET_LABEL_FOLLOW, PRESET_CAPTION_FOLLOW, FIELD_H as H, FIELD_W as W, SITE_UM } from '../public/sim/js/engine.js';
import { viewFrame, agentFrame, densityFrame } from '../public/sim/js/playback.js';

const SIM = new URL('../public/sim/', import.meta.url);
const T_MAX = 24, HPF = 0.1, DEEP_ZOOM = 2.5, BRUSH = 2.2;
const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const pct = (f) => (100 * f).toFixed(1) + '%';

function el(tag, attrs = {}, ...kids) {
  const e = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? e.setAttribute('class', v) : k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
}
const btn = (label, onclick, cls = '') => el('button', { class: 'st-btn ' + cls, type: 'button', onclick }, label);
const chip = (text, cls = 'st-chip--honesty') => el('span', { class: 'st-chip ' + cls }, text);

// ---------- one field renderer: smoothed density + outline, raw agents, or a coarse density, through a shared viewport ----------
class Field {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.zoom = 1; this.cx = W / 2; this.cy = H / 2;
    this.off = document.createElement('canvas');
  }
  view() { // viewport in site coords, clamped to the lattice
    const vw = W / this.zoom, vh = H / this.zoom;
    const x0 = Math.min(Math.max(this.cx - vw / 2, 0), W - vw), y0 = Math.min(Math.max(this.cy - vh / 2, 0), H - vh);
    return { x0, y0, vw, vh, s: this.c.width / vw };
  }
  toSite(ev) { const r = this.c.getBoundingClientRect(), v = this.view(); return [v.x0 + ((ev.clientX - r.left) / r.width) * v.vw, v.y0 + ((ev.clientY - r.top) / r.height) * v.vh]; }
  blit(gw, gh, val, smooth) { // val(i) in 0..1 = occupancy -> wound..intact colour
    const lo = hex(css('--cell-wound') || '#0B1116'), hi = hex(css('--cell-intact') || '#1F4F5C');
    this.off.width = gw; this.off.height = gh;
    const og = this.off.getContext('2d'), img = og.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const v = val(i); for (let k = 0; k < 3; k++) img.data[4 * i + k] = lo[k] + (hi[k] - lo[k]) * v; img.data[4 * i + 3] = 255; }
    og.putImageData(img, 0, 0);
    const v = this.view(), sx = gw / W;
    this.g.imageSmoothingEnabled = smooth;
    this.g.clearRect(0, 0, this.c.width, this.c.height);
    this.g.drawImage(this.off, v.x0 * sx, v.y0 * sx, v.vw * sx, v.vh * sx, 0, 0, this.c.width, this.c.height);
  }
  agents(occ) { this.blit(W, H, (i) => occ[i], false); this.grid(); }
  smooth(fine, lines, alpha) { this.blit(fine.w, fine.h, (i) => fine.data[i] / 255, true); this.lines(lines, alpha); }
  density(rho, h, w) { this.blit(w, h, (i) => rho[i], true); }
  grid() { // hairline site grid at deep zoom so single cells read as cells
    const v = this.view(); if (v.s < 9) return;
    this.g.strokeStyle = 'rgba(5,6,7,.55)'; this.g.lineWidth = 1; this.g.beginPath();
    for (let x = Math.ceil(v.x0); x <= v.x0 + v.vw; x++) { const p = (x - v.x0) * v.s; this.g.moveTo(p, 0); this.g.lineTo(p, this.c.height); }
    for (let y = Math.ceil(v.y0); y <= v.y0 + v.vh; y++) { const p = (y - v.y0) * v.s; this.g.moveTo(0, p); this.g.lineTo(this.c.width, p); }
    this.g.stroke();
  }
  lines(lines, alpha) {
    if (!lines || !alpha) return;
    const v = this.view(); this.g.save(); this.g.globalAlpha = alpha; this.g.strokeStyle = css('--cell-edge') || '#EE7F2D'; this.g.lineWidth = 2;
    for (const l of lines) { this.g.beginPath(); for (let k = 0; k < l.length; k += 2) this.g[k ? 'lineTo' : 'moveTo']((l[k] - v.x0) * v.s, (l[k + 1] - v.y0) * v.s); this.g.stroke(); }
    this.g.restore();
  }
}

// ---------- small SVG line chart: wound fraction vs hours ----------
function chart(svg, { tMax, yMax, series, cut }) {
  const Wd = 320, Hd = 150, L = 34, R = 16, T = 8, B = 22, X = (t) => L + (t / tMax) * (Wd - L - R), Y = (v) => T + (1 - v / yMax) * (Hd - T - B);
  const path = (xs, ys) => xs.map((t, i) => (ys[i] == null ? '' : `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`)).join('');
  let s = `<line x1="${L}" y1="${Y(0)}" x2="${Wd - R}" y2="${Y(0)}" stroke="var(--chart-axis)"/>`;
  for (let t = 0; t <= tMax; t += tMax > 12 ? 6 : 2) s += `<text x="${X(t)}" y="${Hd - 6}" fill="var(--dim)" font-size="9" text-anchor="middle">${t} h</text>`;
  for (const f of [0, yMax / 2, yMax]) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(f)}" y2="${Y(f)}" stroke="var(--chart-grid)"/><text x="${L - 4}" y="${Y(f) + 3}" fill="var(--dim)" font-size="9" text-anchor="end">${pct(f)}</text>`;
  if (cut != null) s += `<line x1="${X(cut)}" x2="${X(cut)}" y1="${T}" y2="${Y(0)}" stroke="var(--chart-cut)" stroke-dasharray="2 3"/><text x="${X(cut) + 3}" y="${T + 8}" fill="var(--dim)" font-size="9">forecast from here</text>`;
  for (const se of series) {
    if (se.dots) s += se.t.map((t, i) => `<circle cx="${X(t)}" cy="${Y(se.v[i])}" r="1.8" fill="${se.color}"/>`).join('');
    s += `<path d="${path(se.t, se.v)}" fill="none" stroke="${se.color}" stroke-width="${se.width || 1.3}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`); svg.innerHTML = s;
}
const legend = (items) => el('div', { class: 'dr-legend' }, ...items.map(([c, t, dash]) => el('span', {}, el('i', { style: `border-top:2px ${dash ? 'dashed' : 'solid'} ${c}` }), t)));

// ---------- view 1: draw a wound ----------
function drawView(worker) {
  const root = el('div', { class: 'dr-view' });
  const canvas = el('canvas', { width: 660, height: 480, class: 'dr-canvas', 'aria-label': 'Drawing canvas: drag to draw a wound' });
  const f = new Field(canvas), mask = new Uint8Array(W * H);
  let state = 'draw', preset = 'CC', last = null, curve = { t: [], v: [] }, drawing = false;
  const readT = el('span', { class: 'num' }, '0.0 h'), readF = el('span', { class: 'num' }, '—'), readV = el('span', {}, 'smoothed density');
  const svg = el('svg', { class: 'dr-chart', role: 'img', 'aria-label': 'Wound area over time' });
  const hint = el('p', { class: 'st-caption' }, 'Drag on the field to draw a wound, then press Run.');

  const run = btn('Run', () => (state === 'running' ? pause() : start()), 'st-btn--primary');
  const step = btn('Step', () => { ensure(); worker.postMessage({ type: 'step', hours: 0.5 }); });
  const reset = btn('Reset', () => { if (state === 'draw') return; pause(); worker.postMessage({ type: 'reset' }); curve = { t: [], v: [] }; });
  const clear = btn('Clear', () => { pause(); mask.fill(0); state = 'draw'; last = null; curve = { t: [], v: [] }; render(); });
  const sample = btn('Sample wound', () => { pause(); mask.fill(0); const r = 9; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + 0.5 - W / 2) ** 2 + (y + 0.5 - H / 2) ** 2 <= r * r) mask[y * W + x] = 1; state = 'draw'; last = null; curve = { t: [], v: [] }; render(); });
  const segCC = btn('CC', () => setPreset('CC')), segC61 = btn('C61', () => setPreset('C61'));
  const zin = btn('+', () => zoomBy(1.5), 'st-btn--icon'), zout = btn('−', () => zoomBy(1 / 1.5), 'st-btn--icon');
  zin.setAttribute('aria-label', 'Zoom in (+)'); zout.setAttribute('aria-label', 'Zoom out (−)');

  function setPreset(p) { preset = p; segCC.setAttribute('aria-pressed', p === 'CC'); segC61.setAttribute('aria-pressed', p === 'C61'); if (state !== 'draw') worker.postMessage({ type: 'preset', preset: p }); }
  function ensure() {
    if (state !== 'draw') return true;
    if (!mask.some(Boolean)) { hint.textContent = 'Draw a wound first (or press Sample wound).'; return false; }
    curve = { t: [], v: [] }; worker.postMessage({ type: 'init', w: W, h: H, wound: mask.slice(), preset, seed: 1, rule: 'follow' }); state = 'paused'; return true;
  }
  function start() { if (!ensure()) return; state = 'running'; run.textContent = 'Pause'; worker.postMessage({ type: 'run', hoursPerFrame: HPF }); }
  function pause() { if (state === 'running') { worker.postMessage({ type: 'pause' }); state = 'paused'; } run.textContent = 'Run'; }
  function zoomBy(k) { f.zoom = Math.min(6, Math.max(1, f.zoom * k)); render(); }

  function render() {
    const deep = f.zoom >= DEEP_ZOOM;
    readV.textContent = deep ? 'cells (raw agents)' : 'smoothed density';
    clear.hidden = !mask.some(Boolean);
    if (!last) { f.agents(Uint8Array.from(mask, (m) => 1 - m)); readT.textContent = '0.0 h'; readF.textContent = mask.some(Boolean) ? pct(mask.reduce((a, b) => a + b, 0) / (W * H)) : '—'; }
    else { deep ? f.agents(last.occ) : f.smooth(last.fine, last.outline.display.lines, last.outline.display.opacity); readT.textContent = last.t_hours.toFixed(1) + ' h'; readF.textContent = pct(last.wound_frac); }
    chart(svg, { tMax: T_MAX, yMax: Math.max(0.05, curve.v[0] || 0.2), series: [{ t: curve.t, v: curve.v, color: 'var(--chart-observed)', width: 1.7 }] });
  }
  worker.addEventListener('message', ({ data: m }) => {
    if (m.type !== 'frame' || state === 'draw') return;
    last = m; curve.t.push(m.t_hours); curve.v.push(m.wound_frac);
    if (m.t_hours >= T_MAX - 1e-9 || m.wound_frac === 0) pause();
    render();
  });

  const paint = (ev) => { // brush in site coords; only while still drawing
    if (state !== 'draw') { hint.textContent = 'Press Clear to draw a new wound.'; return; }
    const [sx, sy] = f.toSite(ev);
    for (let y = Math.floor(sy - BRUSH); y <= sy + BRUSH; y++) for (let x = Math.floor(sx - BRUSH); x <= sx + BRUSH; x++)
      if (x >= 0 && y >= 0 && x < W && y < H && (x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 <= BRUSH * BRUSH) mask[y * W + x] = 1;
    hint.textContent = 'Press Run to let the simulated cells close it.'; render();
  };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener('pointermove', (e) => drawing && paint(e));
  canvas.addEventListener('pointerup', () => (drawing = false));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); [f.cx, f.cy] = f.toSite(e); zoomBy(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); state === 'running' ? pause() : start(); }
    else if (e.key === 'ArrowRight') step.click(); else if (e.key === '+' || e.key === '=') zoomBy(1.5); else if (e.key === '-') zoomBy(1 / 1.5);
    else if (e.key === 'Escape' && !clear.hidden) clear.click(); else if (e.key === 'r') reset.click();
  });

  const p = PRESETS_FOLLOW;
  root.append(
    el('div', { class: 'dr-stage' }, canvas, el('div', { class: 'dr-zoom' }, zout, zin)),
    el('aside', { class: 'dr-side st-panel--solid' },
      el('div', { class: 'st-kicker' }, 'Preset'), el('div', { class: 'st-seg' }, segCC, segC61),
      el('p', { class: 'st-caption' }, `Tm: CC ${p.CC.Tm.toFixed(1)} h, C61 ${p.C61.Tm.toFixed(1)} h. The fitted conditions differ little under this model.`),
      el('div', { class: 'dr-tools' }, run, step, reset, sample, clear),
      el('div', { class: 'st-row' }, el('span', {}, 'Time'), readT),
      el('div', { class: 'st-row' }, el('span', {}, 'Wound area'), readF),
      el('div', { class: 'st-row' }, el('span', {}, 'View'), readV),
      svg, legend([['var(--chart-observed)', 'simulated wound area (no band: a drawn wound is a simulation, not a forecast)']]),
      hint,
      el('div', { class: 'dr-chips' }, chip(PRESET_LABEL_FOLLOW), chip('simulated cells, not tracked cells')),
      el('p', { class: 'st-caption' }, PRESET_CAPTION_FOLLOW + `. One site = one cell = ${SITE_UM} µm; field ${W}×${H} sites (the WHAD field).`)));
  setPreset('CC'); root.tabIndex = 0; render();
  return root;
}

// ---------- view 2: a real WHAD wound, sim vs NCA vs observed, with the live NCA band ----------
function realView(worker) {
  const root = el('div', { class: 'dr-view' });
  const cs = el('canvas', { width: 440, height: 320, class: 'dr-canvas', 'aria-label': 'Cell-agent simulation of the real wound' });
  const cn = el('canvas', { width: 440, height: 320, class: 'dr-canvas', 'aria-label': 'NCA emulator rollout of the real wound' });
  const fs = new Field(cs), fn = new Field(cn);
  const slider = el('input', { type: 'range', min: 3, max: 19, step: 0.1, value: 3, 'aria-label': 'Time (hours)' });
  const readT = el('span', { class: 'num' }, '3.0 h'), readS = el('span', { class: 'num' }), readN = el('span', { class: 'num' }), readO = el('span', { class: 'num' });
  const svg = el('svg', { class: 'dr-chart', role: 'img', 'aria-label': 'Observed, simulated and NCA wound area for exp1_partII_C61_P2' });
  const status = el('p', { class: 'st-caption' }, 'Loading the wound…');
  let sim, nca, band = null, timer = null;
  const play = btn('Play', () => (timer ? stop() : go()), 'st-btn--primary');
  const near = (ts, t) => ts.reduce((b, x, i) => (Math.abs(x - t) < Math.abs(ts[b] - t) ? i : b), 0);

  function go() { play.textContent = 'Pause'; if (+slider.value >= 19) slider.value = 3; timer = setInterval(() => { slider.value = Math.min(19, +slider.value + 0.1); render(); if (+slider.value >= 19) stop(); }, 60); }
  function stop() { clearInterval(timer); timer = null; play.textContent = 'Play'; }
  function render() {
    if (!sim) return;
    const t = +slider.value, i = near(sim.t_hours, t), j = near(nca.t_hours, t), ob = sim.meta.observed, k = near(ob.t_hours, t);
    const v = viewFrame(sim, i);
    fs.zoom >= DEEP_ZOOM ? fs.agents(agentFrame(sim, i)) : fs.smooth(v.fine, v.outline.display.lines, v.outline.display.opacity);
    fn.density(densityFrame(nca, j), nca.density.h, nca.density.w);
    readT.textContent = t.toFixed(1) + ' h'; readS.textContent = pct(sim.wound_frac[i]); readN.textContent = pct(nca.wound_frac[j]);
    readO.textContent = Math.abs(ob.t_hours[k] - t) < 0.06 ? pct(ob.wound_frac[k]) : '— (imaged hourly)';
    const series = [];
    if (band) { series.push({ t: band.t, v: band.q05, color: 'var(--chart-member)', width: 0.9, dash: '2 2' }, { t: band.t, v: band.q95, color: 'var(--chart-member)', width: 0.9, dash: '2 2' }); }
    series.push({ t: sim.t_hours, v: sim.wound_frac, color: 'var(--dim)', width: 1 },
      { t: nca.t_hours, v: nca.wound_frac, color: 'var(--chart-median)', dash: '4 3' },
      { t: ob.t_hours, v: ob.wound_frac, color: 'var(--chart-observed)', width: 1.7, dots: true },
      { t: [t, t], v: [0, Math.max(...ob.wound_frac)], color: 'var(--hair)', width: 1 });
    chart(svg, { tMax: 20, yMax: Math.max(...ob.wound_frac) * 1.05, series, cut: nca.meta.cutoff_hours });
  }
  const zs = (k) => { fs.zoom = fn.zoom = Math.min(6, Math.max(1, fs.zoom * k)); render(); };
  for (const c of [cs, cn]) c.addEventListener('wheel', (e) => { e.preventDefault(); const f = c === cs ? fs : fn; const [x, y] = f.toSite(e); fs.cx = fn.cx = x; fs.cy = fn.cy = y; zs(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  slider.addEventListener('input', () => { stop(); render(); });

  Promise.all(['whad_partII_C61_P2_sim38_follow.json', 'whad_partII_C61_P2_nca_follow.json'].map((n) => fetch(new URL(n, SIM)).then((r) => r.json())))
    .then(([s, n]) => {
      sim = s; nca = n; render();
      status.textContent = 'Computing the NCA band in the browser (20 members)…';
      const onBand = ({ data: m }) => {
        if (m.type === 'nca-ready') worker.postMessage({ type: 'band', Tm: n.meta.Tm, bias: n.meta.bias, hours: 16, members: 20, seed: 1, start: { occ: agentFrame(s, 0), h: s.H, w: s.W } });
        else if (m.type === 'band') { band = { t: m.t_hours.map((x) => x + s.t_hours[0]), q05: m.q05, q95: m.q95 }; status.textContent = 'NCA band: 20-member emulator spread, computed live from the 3.0 h mask and the 3.8 h fit.'; worker.removeEventListener('message', onBand); render(); }
        else if (m.type === 'band-error') { const b = n.meta.band; band = { t: b.t_hours, q05: b.q05, q95: b.q95 }; status.textContent = `Live band failed (${m.error}); showing the precomputed ${b.members}-member band.`; worker.removeEventListener('message', onBand); render(); }
      };
      worker.addEventListener('message', onBand);
      worker.postMessage({ type: 'nca-load' }); // default: v2 follower emulator, matches the follow fits
    })
    .catch((e) => (status.textContent = 'Could not load the playback files: ' + e.message));

  root.append(
    el('div', { class: 'dr-pair' },
      el('figure', {}, cs, el('figcaption', { class: 'st-kicker' }, 'Cell agents (simulation)')),
      el('figure', {}, cn, el('figcaption', { class: 'st-kicker' }, 'NCA emulator (density)'))),
    el('aside', { class: 'dr-side st-panel--solid' },
      el('div', { class: 'st-kicker' }, 'Held-out WHAD wound · exp1_partII_C61_P2'),
      el('div', { class: 'dr-tools' }, play, slider),
      el('div', { class: 'st-row' }, el('span', {}, 'Time'), readT),
      el('div', { class: 'st-row' }, el('span', {}, 'Observed'), readO),
      el('div', { class: 'st-row' }, el('span', {}, 'Simulation'), readS),
      el('div', { class: 'st-row' }, el('span', {}, 'NCA'), readN),
      svg,
      legend([['var(--chart-observed)', 'observed'], ['var(--dim)', 'cell-agent simulation'], ['var(--chart-median)', 'NCA rollout', 1], ['var(--chart-member)', 'NCA ensemble spread (uncalibrated)', 1]]),
      status,
      el('div', { class: 'dr-chips' }, chip('uncalibrated (simulator/NCA spread)'), chip('simulated cells, not tracked cells')),
      el('p', { class: 'st-caption' }, 'Both start from the observed mask at 3.0 h and use the fit from frames up to 3.8 h (follow rule). One wound only, so do not generalise. The spread is not a 90% interval; the calibrated band is in Assay mode.')));
  return root;
}

export function mountDraw(host) {
  const worker = new Worker(new URL('../public/sim/js/worker.js', import.meta.url), { type: 'module' });
  const views = { draw: drawView(worker), real: realView(worker) };
  const tabs = el('div', { class: 'st-tabs', role: 'tablist' });
  const body = el('div', { class: 'dr-body' });
  const show = (k) => { for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.k === k); body.replaceChildren(views[k]); views[k].focus?.(); };
  for (const [k, label] of [['draw', 'Draw a wound'], ['real', 'Real wound: sim vs NCA']]) { const b = el('button', { role: 'tab', type: 'button', onclick: () => show(k) }, label); b.dataset.k = k; tabs.append(b); }
  host.classList.add('dr-root'); host.replaceChildren(tabs, body); show('draw');
  return { worker, show };
}
