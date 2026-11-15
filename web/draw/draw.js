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
import { edgeSpeed, stallSpeed, speedColour } from '../edge/edge_speed.js';
import { PAL, OLD, EDGE_CSS, BG_CSS, Age, shade } from './tissue.js';

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
  blit(gw, gh, rgb, smooth) { // rgb(i) -> [r, g, b]: the final tissue look (tissue.js)
    this.off.width = gw; this.off.height = gh;
    const og = this.off.getContext('2d'), img = og.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const c = rgb(i); img.data[4 * i] = c[0]; img.data[4 * i + 1] = c[1]; img.data[4 * i + 2] = c[2]; img.data[4 * i + 3] = 255; }
    og.putImageData(img, 0, 0);
    const v = this.view(), sx = gw / W;
    this.g.imageSmoothingEnabled = smooth;
    this.g.clearRect(0, 0, this.c.width, this.c.height);
    this.g.drawImage(this.off, v.x0 * sx, v.y0 * sx, v.vw * sx, v.vh * sx, 0, 0, this.c.width, this.c.height);
  }
  agents(occ, age) { this.blit(W, H, (i) => shade(age ? age.colour(i) : PAL.intact, occ[i]), false); this.grid(); }
  smooth(fine, lines, alpha, age) {   // fine px -> its lattice site for the age colour
    const k = fine.w / W;
    this.blit(fine.w, fine.h, (i) => shade(age ? age.colour(Math.floor(((i / fine.w) | 0) / k) * W + Math.floor((i % fine.w) / k)) : PAL.intact, fine.data[i] / 255), true);
    this.lines(lines, alpha);
  }
  density(rho, h, w) { this.blit(w, h, (i) => shade(OLD, rho[i]), true); }   // no cell ages in a density field: original-tissue stop, matching the sim panel
  grid() { // hairline site grid at deep zoom so single cells read as cells
    const v = this.view(); if (v.s < 9) return;
    this.g.strokeStyle = 'rgba(18,10,9,.55)'; this.g.lineWidth = 1; this.g.beginPath();
    for (let x = Math.ceil(v.x0); x <= v.x0 + v.vw; x++) { const p = (x - v.x0) * v.s; this.g.moveTo(p, 0); this.g.lineTo(p, this.c.height); }
    for (let y = Math.ceil(v.y0); y <= v.y0 + v.vh; y++) { const p = (y - v.y0) * v.s; this.g.moveTo(0, p); this.g.lineTo(this.c.width, p); }
    this.g.stroke();
  }
  edges(sites, perSite, vMax, stallV) {   // edge-speed ring (#117): sites in fine px, perSite fine px per lattice site
    const v = this.view(), sz = v.s / perSite;
    this.g.save(); this.g.globalAlpha = 0.55; this.g.fillStyle = BG_CSS; this.g.fillRect(0, 0, this.c.width, this.c.height); this.g.restore();
    for (const p of sites) {
      const [r, g, b] = speedColour(p.v, vMax), x = (p.x / perSite - v.x0) * v.s, y = (p.y / perSite - v.y0) * v.s;
      this.g.fillStyle = `rgb(${r},${g},${b})`; this.g.fillRect(x, y, sz + 0.5, sz + 0.5);
      if (stallV != null && p.v < stallV) {   // never colour alone: stalled sites also get the amber flag hatch
        this.g.strokeStyle = css('--accent') || '#E0A458'; this.g.lineWidth = 1;
        this.g.beginPath(); this.g.moveTo(x, y + sz); this.g.lineTo(x + sz, y); this.g.stroke();
      }
    }
  }
  ring(px, py, perSite, r) {               // marks the slowest segment
    const v = this.view(), x = (px / perSite - v.x0) * v.s, y = (py / perSite - v.y0) * v.s;
    this.g.strokeStyle = css('--accent') || '#E0A458'; this.g.lineWidth = 2; this.g.setLineDash([3, 2]);
    this.g.beginPath(); this.g.arc(x, y, r, 0, 2 * Math.PI); this.g.stroke(); this.g.setLineDash([]);
  }
  lines(lines, alpha) {
    if (!lines || !alpha) return;
    const v = this.view(); this.g.save(); this.g.globalAlpha = alpha; this.g.strokeStyle = EDGE_CSS; this.g.lineWidth = 2;
    for (const l of lines) { this.g.beginPath(); for (let k = 0; k < l.length; k += 2) this.g[k ? 'lineTo' : 'moveTo']((l[k] - v.x0) * v.s, (l[k + 1] - v.y0) * v.s); this.g.stroke(); }
    this.g.restore();
  }
}

// ---------- small SVG line chart: wound fraction vs hours ----------
function chart(svg, { tMax, yMax, series, cut, xLabel = (t) => `${t} h` }) {
  const Wd = 320, Hd = 150, L = 34, R = 16, T = 8, B = 22, X = (t) => L + (t / tMax) * (Wd - L - R), Y = (v) => T + (1 - v / yMax) * (Hd - T - B);
  const path = (xs, ys) => xs.map((t, i) => (ys[i] == null ? '' : `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`)).join('');
  let s = `<line x1="${L}" y1="${Y(0)}" x2="${Wd - R}" y2="${Y(0)}" stroke="var(--chart-axis)"/>`;
  for (let t = 0; t <= tMax; t += Math.max(1, Math.round(tMax / 4))) s += `<text x="${X(t)}" y="${Hd - 6}" fill="var(--dim)" font-size="9" text-anchor="middle">${xLabel(t)}</text>`;
  for (const f of [0, yMax / 2, yMax]) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(f)}" y2="${Y(f)}" stroke="var(--chart-grid)"/><text x="${L - 4}" y="${Y(f) + 3}" fill="var(--dim)" font-size="9" text-anchor="end">${pct(f)}</text>`;
  if (cut != null) s += `<line x1="${X(cut)}" x2="${X(cut)}" y1="${T}" y2="${Y(0)}" stroke="var(--chart-cut)" stroke-dasharray="2 3"/><text x="${X(cut) + 3}" y="${T + 8}" fill="var(--dim)" font-size="9">forecast from here</text>`;
  for (const se of series) {
    if (se.dots) s += se.t.map((t, i) => `<circle cx="${X(t)}" cy="${Y(se.v[i])}" r="1.8" fill="${se.color}"/>`).join('');
    s += `<path d="${path(se.t, se.v)}" fill="none" stroke="${se.color}" stroke-width="${se.width || 1.3}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`); svg.innerHTML = s;
}
function scaleBar(vMax, stallV) {   // gradient legend with units and the stall-pace tick
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const [r, g, b] = speedColour(t * vMax, vMax); return `rgb(${r},${g},${b}) ${t * 100}%`; }).join(',');
  const tick = stallV != null ? `<i style="left:${Math.min(100, (100 * stallV) / vMax)}%"></i><span style="left:${Math.min(100, (100 * stallV) / vMax)}%">stall pace ${stallV.toFixed(2)} µm/h</span>` : '';
  return `<b style="background:linear-gradient(90deg,${stops})"></b>${tick}<em>0 (slow)</em><em style="right:0">${vMax} µm/h (fast)</em>`;
}
const legend = (items) => el('div', { class: 'dr-legend' }, ...items.map(([c, t, dash]) => el('span', {}, el('i', { style: `border-top:2px ${dash ? 'dashed' : 'solid'} ${c}` }), t)));

// ---------- view 1: draw a wound ----------
function drawView(worker) {
  const root = el('div', { class: 'dr-view' });
  const canvas = el('canvas', { width: 660, height: 480, class: 'dr-canvas', 'aria-label': 'Drawing canvas: drag to draw a wound' });
  const f = new Field(canvas), mask = new Uint8Array(W * H), age = new Age(W * H);
  let state = 'draw', preset = 'CC', last = null, curve = { t: [], v: [] }, drawing = false;
  const readT = el('span', { class: 'num' }, '0.0 h'), readF = el('span', { class: 'num' }, '—'), readV = el('span', {}, 'smoothed density');
  const svg = el('svg', { class: 'dr-chart', role: 'img', 'aria-label': 'Wound area over time' });
  const hint = el('p', { class: 'st-caption' }, 'Drag on the field to draw a wound, then press Run.');

  const run = btn('Run', () => (state === 'running' ? pause() : start()), 'st-btn--primary');
  const step = btn('Step', () => { ensure(); worker.postMessage({ type: 'step', hours: 0.5 }); });
  const reset = btn('Reset', () => { if (state === 'draw') return; pause(); age.reset(Uint8Array.from(mask, (m) => 1 - m)); worker.postMessage({ type: 'reset' }); curve = { t: [], v: [] }; });
  const clear = btn('Clear', () => { pause(); mask.fill(0); state = 'draw'; last = null; curve = { t: [], v: [] }; render(); });
  const sample = btn('Sample wound', () => { pause(); mask.fill(0); const r = 9; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + 0.5 - W / 2) ** 2 + (y + 0.5 - H / 2) ** 2 <= r * r) mask[y * W + x] = 1; state = 'draw'; last = null; curve = { t: [], v: [] }; render(); });
  const segCC = btn('CC', () => setPreset('CC')), segC61 = btn('C61', () => setPreset('C61'));
  const zin = btn('+', () => zoomBy(1.5), 'st-btn--icon'), zout = btn('−', () => zoomBy(1 / 1.5), 'st-btn--icon');
  zin.setAttribute('aria-label', 'Zoom in (+)'); zout.setAttribute('aria-label', 'Zoom out (−)');

  function setPreset(p) { preset = p; segCC.setAttribute('aria-pressed', p === 'CC'); segC61.setAttribute('aria-pressed', p === 'C61'); if (state !== 'draw') worker.postMessage({ type: 'preset', preset: p }); }
  function ensure() {
    if (state !== 'draw') return true;
    if (!mask.some(Boolean)) { hint.textContent = 'Draw a wound first (or press Sample wound).'; return false; }
    curve = { t: [], v: [] }; age.reset(Uint8Array.from(mask, (m) => 1 - m)); worker.owner = 'draw'; worker.postMessage({ type: 'init', w: W, h: H, wound: mask.slice(), preset, seed: 1, rule: 'follow' }); state = 'paused'; return true;
  }
  function start() { if (!ensure()) return; state = 'running'; run.textContent = 'Pause'; worker.postMessage({ type: 'run', hoursPerFrame: HPF }); }
  function pause() { if (state === 'running') { worker.postMessage({ type: 'pause' }); state = 'paused'; } run.textContent = 'Run'; }
  function zoomBy(k) { f.zoom = Math.min(6, Math.max(1, f.zoom * k)); render(); }

  function render() {
    const deep = f.zoom >= DEEP_ZOOM;
    readV.textContent = deep ? 'cells (raw agents)' : 'smoothed density';
    clear.hidden = !mask.some(Boolean);
    if (!last) { f.agents(Uint8Array.from(mask, (m) => 1 - m)); readT.textContent = '0.0 h'; readF.textContent = mask.some(Boolean) ? pct(mask.reduce((a, b) => a + b, 0) / (W * H)) : '—'; }
    else { deep ? f.agents(last.occ, age) : f.smooth(last.fine, last.outline.display.lines, last.outline.display.opacity, age); readT.textContent = last.t_hours.toFixed(1) + ' h'; readF.textContent = pct(last.wound_frac); }
    chart(svg, { tMax: T_MAX, yMax: Math.max(0.05, curve.v[0] || 0.2), series: [{ t: curve.t, v: curve.v, color: 'var(--chart-observed)', width: 1.7 }] });
  }
  worker.addEventListener('message', ({ data: m }) => {
    if (m.type !== 'frame' || state === 'draw' || worker.owner !== 'draw') return;
    last = m; age.update(m.occ); curve.t.push(m.t_hours); curve.v.push(m.wound_frac);
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
  let sim, nca, band = null, timer = null, edgeOn = false, stallV = null, occF = null;
  const play = btn('Play', () => (timer ? stop() : go()), 'st-btn--primary');
  const edgeBtn = btn('Edge speed', () => { edgeOn = !edgeOn; edgeBtn.setAttribute('aria-pressed', edgeOn); edgeBox.hidden = !edgeOn; render(); });
  edgeBtn.setAttribute('aria-pressed', 'false'); edgeBtn.title = 'Edge speed heatmap (H)';
  const readE = el('span', { class: 'num' }, '—'), readSlow = el('span', { class: 'num' }, '—');
  const scale = el('div', { class: 'dr-scale' }), edgeBox = el('div', {},
    el('div', { class: 'st-row' }, el('span', {}, 'Mean edge speed'), readE),
    el('div', { class: 'st-row' }, el('span', {}, 'Slowest segment'), readSlow), scale,
    el('p', { class: 'st-caption' }, 'Edge speed: how far the front moved over the last 2 h along its normal (distance transform, no cell tracking), smoothed over ±3 px of front, on simulation frames. Slow = hot; hatched = slower than the stall pace, the existing stall rule (closing under 10% more of the 3.8 h area by 19 h) as a speed. Check on this wound (5-9 h): mean speed × perimeter = 0.91 × the area loss rate.'),
    el('div', { class: 'dr-chips' }, chip('uncalibrated (simulation frames)')));
  edgeBox.hidden = true;
  const V_MAX = 20;   // µm/h at the cool end of the scale (mean front speed on this wound is 4-8 µm/h)
  const near = (ts, t) => ts.reduce((b, x, i) => (Math.abs(x - t) < Math.abs(ts[b] - t) ? i : b), 0);

  function go() { play.textContent = 'Pause'; if (+slider.value >= 19) slider.value = 3; timer = setInterval(() => { slider.value = Math.min(19, +slider.value + 0.1); render(); if (+slider.value >= 19) stop(); }, 60); }
  function stop() { clearInterval(timer); timer = null; play.textContent = 'Play'; }
  function render() {
    if (!sim) return;
    const t = +slider.value, i = near(sim.t_hours, t), j = near(nca.t_hours, t), ob = sim.meta.observed, k = near(ob.t_hours, t);
    const v = viewFrame(sim, i), age = new Age(W * H);
    occF ??= sim.t_hours.map((_, k) => agentFrame(sim, k));
    age.reset(occF[0]); for (let k = 1; k <= i; k++) age.update(occF[k], occF.length);
    fs.zoom >= DEEP_ZOOM ? fs.agents(occF[i], age) : fs.smooth(v.fine, v.outline.display.lines, v.outline.display.opacity, age);
    fn.density(densityFrame(nca, j), nca.density.h, nca.density.w);
    if (edgeOn) {
      const back = near(sim.t_hours, t - 2), mk = (f) => { const { fine, outline } = viewFrame(sim, f), m = new Uint8Array(fine.h * fine.w);
        for (let q = 0; q < m.length; q++) m[q] = outline.level != null && fine.data[q] / 255 < outline.level ? 1 : 0; return { m, fine }; };
      const a = mk(back), b = mk(i), um = SITE_UM / b.fine.scale;
      if (stallV == null) { const c = mk(near(sim.t_hours, nca.meta.cutoff_hours)), e0 = edgeSpeed(c.m, c.m, c.fine.h, c.fine.w, 1, um);
        stallV = stallSpeed(e0.areaUm2, e0.perimeterUm, nca.meta.cutoff_hours, 19); scale.innerHTML = scaleBar(V_MAX, stallV); }
      if (back < i) {
        const e = edgeSpeed(a.m, b.m, b.fine.h, b.fine.w, sim.t_hours[i] - sim.t_hours[back], um);
        fs.edges(e.sites, b.fine.scale, V_MAX, stallV);
        if (e.slowest) fs.ring(e.slowest.x, e.slowest.y, b.fine.scale, 14);
        readE.textContent = e.meanUmH == null ? 'no edge' : e.meanUmH.toFixed(1) + ' µm/h';
        readSlow.textContent = e.slowest ? e.slowest.v.toFixed(1) + ' µm/h' : '—';
      } else { readE.textContent = readSlow.textContent = '— (first frame)'; }
    }
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
  root.tabIndex = 0;
  root.addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') edgeBtn.click(); else if (e.key === ' ') { e.preventDefault(); play.click(); } });

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
      el('div', { class: 'dr-tools' }, play, edgeBtn, slider),
      el('div', { class: 'st-row' }, el('span', {}, 'Time'), readT),
      el('div', { class: 'st-row' }, el('span', {}, 'Observed'), readO),
      el('div', { class: 'st-row' }, el('span', {}, 'Simulation'), readS),
      el('div', { class: 'st-row' }, el('span', {}, 'NCA'), readN),
      edgeBox,
      svg,
      legend([['var(--chart-observed)', 'observed'], ['var(--dim)', 'cell-agent simulation'], ['var(--chart-median)', 'NCA rollout', 1], ['var(--chart-member)', 'NCA ensemble spread (uncalibrated)', 1]]),
      status,
      el('div', { class: 'dr-chips' }, chip('uncalibrated (simulator/NCA spread)'), chip('simulated cells, not tracked cells')),
      el('p', { class: 'st-caption' }, 'Both start from the observed mask at 3.0 h and use the fit from frames up to 3.8 h (follow rule). One wound only, so do not generalise. The spread is not a 90% interval; the calibrated band is in Assay mode.')));
  return root;
}

// ---------- view 3: draw from photo (#124): a photo's wound OUTLINE drives the simulation. Not a forecast. ----------
// Segmentation (no model): the user boxes the wound; skin colour = mean of the box border; per-pixel colour distance to
// it, Otsu threshold inside the box, largest connected component, holes filled. The shape (not its size) is fitted to
// the dish lattice, editable with an add / erase brush, then run under a preset exactly like a drawn wound.
// The photo is read with a local object URL and never leaves the browser. No hours, band, probability or flags here.
function segmentBox(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, d = img.data, W0 = img.width, dist = new Float32Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  const px = (x, y) => 4 * ((y0 + y) * W0 + (x0 + x));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { const i = px(x, y); sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
  sr /= n; sg /= n; sb /= n;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = px(x, y); dist[y * w + x] = Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb); }
  let mx = 0; for (const v of dist) if (v > mx) mx = v; mx = mx || 1;   // loop, not Math.max(...big array): stack overflow
  const hist = new Float64Array(256);   // Otsu on the distance histogram
  for (const v of dist) hist[Math.min(255, Math.floor((255 * v) / mx))]++;
  let best = 0, th = 128, wB = 0, sumB = 0, sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB || wB === dist.length) continue; sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / (dist.length - wB), b = wB * (dist.length - wB) * (mB - mF) ** 2; if (b > best) { best = b; th = t; } }
  const m = Uint8Array.from(dist, (v) => ((255 * v) / mx > th ? 1 : 0));
  // largest 4-connected component
  const lab = new Int32Array(w * h), sizes = [0]; let id = 0;
  for (let i = 0; i < w * h; i++) if (m[i] && !lab[i]) { id++; let c = 0; const st = [i]; lab[i] = id;
    while (st.length) { const q = st.pop(); c++; const x = q % w, y = (q / w) | 0;
      for (const r of [x > 0 && q - 1, x < w - 1 && q + 1, y > 0 && q - w, y < h - 1 && q + w]) if (r !== false && m[r] && !lab[r]) { lab[r] = id; st.push(r); } }
    sizes.push(c); }
  let keep = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[keep]) keep = k;
  const out = Uint8Array.from(lab, (l) => (l === keep && keep > 0 ? 1 : 0));
  // fill holes: background reachable from the box border stays background
  const seen = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) { const q = st.pop(); if (seen[q] || out[q]) continue; seen[q] = 1; const x = q % w, y = (q / w) | 0;
    if (x > 0) st.push(q - 1); if (x < w - 1) st.push(q + 1); if (y > 0) st.push(q - w); if (y < h - 1) st.push(q + w); }
  for (let i = 0; i < w * h; i++) if (!seen[i]) out[i] = 1;
  return { mask: out, w, h };
}
// Photo-type check before segmenting (thresholds from the look-dev prototype, design/prototypes/glass-dish/photo.js):
// greyscale microscopy, not skin, or no clear wound -> say so instead of tracing something meaningless.
function photoCheck(img, box, seg) {
  const d = img.data; let n = 0, colourful = 0, skin = 0;
  for (let i = 0; i < d.length; i += 16) {   // every 4th pixel
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 10) continue; n++;
    if (mx - mn > 25) colourful++;
    const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b;   // YCbCr skin box
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
  }
  if (!n || colourful / n < 0.05) return 'This looks like greyscale microscopy: use the Assay upload for cell-culture frames.';
  if (skin / n < 0.2) return 'This does not look like a skin photo.';
  let a = 0; for (const v of seg.mask) a += v;
  const frac = a / ((img.width * img.height) || 1);
  if (frac < 0.002 || frac > 0.6) return 'Skin, but no clear wound in that box: try a tighter box around the wound.';
  return null;
}
function fitToLattice(seg, fill = 0.6) {   // shape only: bbox of the mask scaled to `fill` of the field, centred
  let x0 = seg.w, y0 = seg.h, x1 = -1, y1 = -1;
  for (let y = 0; y < seg.h; y++) for (let x = 0; x < seg.w; x++) if (seg.mask[y * seg.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const out = new Uint8Array(W * H); if (x1 < 0) return out;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((fill * W) / bw, (fill * H) / bh), ow = bw * k, oh = bh * k, ox = (W - ow) / 2, oy = (H - oh) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.floor(x0 + (x + 0.5 - ox) / k), sy = Math.floor(y0 + (y + 0.5 - oy) / k);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) out[y * W + x] = seg.mask[sy * seg.w + sx];
  }
  return out;
}
function photoView(worker) {
  const root = el('div', { class: 'dr-view' });
  const pc = el('canvas', { width: 660, height: 480, class: 'dr-canvas', 'aria-label': 'Photo: drag a box around the wound' });
  const canvas = el('canvas', { width: 660, height: 480, class: 'dr-canvas', 'aria-label': 'Dish: the wound shape from the photo' });
  canvas.hidden = true;
  const f = new Field(canvas), mask = new Uint8Array(W * H), pg = pc.getContext('2d'), age = new Age(W * H);
  let img = null, box = null, drag = null, state = 'photo', last = null, steps = 0, curve = { t: [], v: [] }, erase = false, brushing = false, preset = 'CC';
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': 'Choose a wound photo' });
  const hint = el('p', { class: 'st-caption' }, 'Choose a photo, then drag a box around the wound. The photo stays in this browser tab.');
  const readS = el('span', { class: 'num' }, '—'), readF = el('span', { class: 'num' }, '—');
  const svg = el('svg', { class: 'dr-chart', role: 'img', 'aria-label': 'Open area over simulation steps' });
  const trace = btn('Trace outline', () => box && traceIt(), 'st-btn--primary');
  const brush = btn('Erase', () => { erase = !erase; brush.setAttribute('aria-pressed', erase); }); brush.setAttribute('aria-pressed', 'false');
  const run = btn('Run', () => (state === 'running' ? pause() : start()));
  const again = btn('New photo', () => { pause(); state = 'photo'; last = null; canvas.hidden = true; pc.hidden = false; file.value = ''; img = null; box = null; pg.clearRect(0, 0, pc.width, pc.height); sync(); });
  const segCC = btn('CC', () => setPreset('CC')), segC61 = btn('C61', () => setPreset('C61'));
  function setPreset(p) { preset = p; segCC.setAttribute('aria-pressed', p === 'CC'); segC61.setAttribute('aria-pressed', p === 'C61'); if (state !== 'photo' && state !== 'edit') worker.postMessage({ type: 'preset', preset: p }); }
  function sync() { trace.hidden = state !== 'photo'; brush.hidden = state !== 'edit'; run.hidden = state === 'photo'; again.hidden = state === 'photo'; }
  file.addEventListener('change', () => {
    const fl = file.files[0]; if (!fl) return;
    const url = URL.createObjectURL(fl), im = new Image();
    im.onload = () => { const k = Math.min(pc.width / im.width, pc.height / im.height); pg.fillStyle = '#050607'; pg.fillRect(0, 0, pc.width, pc.height);
      pg.drawImage(im, 0, 0, im.width * k, im.height * k); img = pg.getImageData(0, 0, pc.width, pc.height); URL.revokeObjectURL(url); box = null;
      hint.textContent = 'Drag a box around the wound, then press Trace outline.'; };
    im.src = url;
  });
  const at = (c, e) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]; };
  pc.addEventListener('pointerdown', (e) => { if (!img) return; drag = at(pc, e); pc.setPointerCapture(e.pointerId); });
  pc.addEventListener('pointermove', (e) => { if (!drag) return; const [x, y] = at(pc, e); box = [Math.min(drag[0], x), Math.min(drag[1], y), Math.max(drag[0], x), Math.max(drag[1], y)].map(Math.round);
    pg.putImageData(img, 0, 0); pg.strokeStyle = '#E0A458'; pg.lineWidth = 2; pg.setLineDash([5, 3]); pg.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]); pg.setLineDash([]); });
  pc.addEventListener('pointerup', () => (drag = null));
  function traceIt() {
    if (box[2] - box[0] < 12 || box[3] - box[1] < 12) { hint.textContent = 'Draw a bigger box around the wound.'; return; }
    const seg = segmentBox(img, ...box), why = photoCheck(img, box, seg);
    if (why) { hint.textContent = why; return; }
    mask.set(fitToLattice(seg));
    if (!mask.some(Boolean)) { hint.textContent = 'No outline found in that box: try a tighter box.'; return; }
    state = 'edit'; pc.hidden = true; canvas.hidden = false; last = null; render(); sync();
    hint.textContent = 'Fix the outline with the brush (Erase toggles), then press Run.';
  }
  function ensure() { if (state !== 'edit') return; worker.owner = 'photo'; steps = 0; curve = { t: [], v: [] }; age.reset(Uint8Array.from(mask, (m) => 1 - m));
    worker.postMessage({ type: 'init', w: W, h: H, wound: mask.slice(), preset, seed: 1, rule: 'follow' }); state = 'paused'; }
  function start() { ensure(); state = 'running'; run.textContent = 'Pause'; worker.postMessage({ type: 'run', hoursPerFrame: HPF }); }
  function pause() { if (state === 'running') { worker.postMessage({ type: 'pause' }); state = 'paused'; } run.textContent = 'Run'; }
  function render() {
    if (!last) { f.agents(Uint8Array.from(mask, (m) => 1 - m)); readS.textContent = '0'; readF.textContent = '100% (start)'; }
    else { f.smooth(last.fine, last.outline.display.lines, last.outline.display.opacity, age); readS.textContent = String(steps); readF.textContent = pct(curve.v[curve.v.length - 1] / curve.v[0]); }
    chart(svg, { tMax: Math.max(10, steps), yMax: 1, series: [{ t: curve.t, v: curve.v.map((v) => v / (curve.v[0] || 1)), color: 'var(--chart-observed)', width: 1.7 }], xLabel: (t) => `${t}` });
  }
  worker.addEventListener('message', ({ data: m }) => {
    if (m.type !== 'frame' || worker.owner !== 'photo' || state === 'edit' || state === 'photo') return;
    last = m; age.update(m.occ); curve.t.push(steps); curve.v.push(m.wound_frac); steps++;
    if (m.wound_frac === 0 || m.t_hours >= T_MAX - 1e-9) pause();
    render();
  });
  const paint = (e) => { if (state !== 'edit') return; const [sx, sy] = f.toSite(e);
    for (let y = Math.floor(sy - BRUSH); y <= sy + BRUSH; y++) for (let x = Math.floor(sx - BRUSH); x <= sx + BRUSH; x++)
      if (x >= 0 && y >= 0 && x < W && y < H && (x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 <= BRUSH * BRUSH) mask[y * W + x] = erase ? 0 : 1;
    render(); };
  canvas.addEventListener('pointerdown', (e) => { brushing = true; canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener('pointermove', (e) => brushing && paint(e));
  canvas.addEventListener('pointerup', () => (brushing = false));
  root.append(
    el('div', { class: 'dr-stage' }, pc, canvas),
    el('aside', { class: 'dr-side st-panel--solid' },
      el('div', { class: 'st-kicker' }, 'Draw from photo'), file,
      el('div', { class: 'dr-tools' }, trace, brush, run, again),
      el('div', { class: 'st-kicker' }, 'Preset'), el('div', { class: 'st-seg' }, segCC, segC61),
      el('div', { class: 'st-row' }, el('span', {}, 'Simulation steps'), readS),
      el('div', { class: 'st-row' }, el('span', {}, 'Open area vs start'), readF),
      svg, legend([['var(--chart-observed)', 'open area over simulation steps (no hours, no band, no probability)']]),
      hint,
      el('div', { class: 'dr-chips' }, chip('simulation, preset parameters'), chip('shape from photo; healing is a cell-culture model, not this wound'),
        chip('research use only, not for diagnosis or treatment')),
      el('p', { class: 'st-caption' }, 'Only the outline is used, rescaled to the dish: the wound size, depth and tissue are not. The steps are simulation steps of a cultured-cell model and say nothing about how this wound heals.')));
  setPreset('CC'); sync(); render();
  return root;
}

export function mountDraw(host) {
  const worker = new Worker(new URL('../public/sim/js/worker.js', import.meta.url), { type: 'module' });
  const views = { draw: drawView(worker), real: realView(worker), photo: photoView(worker) };
  const tabs = el('div', { class: 'st-tabs', role: 'tablist' });
  const body = el('div', { class: 'dr-body' });
  const show = (k) => { for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.k === k); body.replaceChildren(views[k]); views[k].focus?.(); };
  for (const [k, label] of [['draw', 'Draw a wound'], ['real', 'Real wound: sim vs NCA'], ['photo', 'From photo (demo)']]) { const b = el('button', { role: 'tab', type: 'button', onclick: () => show(k) }, label); b.dataset.k = k; tabs.append(b); }
  host.classList.add('dr-root'); host.replaceChildren(tabs, body); show('draw');
  return { worker, show };
}
