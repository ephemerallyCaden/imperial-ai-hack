// Held-out wound validation view (moved from the removed Draw screen's "Real wound" tab, web/draw/draw.js, unchanged):
// exp1_partII_C61_P2 from the 3.0 h mask, cell-agent simulation vs NCA (density) vs observed, plus the NCA band computed
// live in the worker from the same start and fit (labelled uncalibrated, never a 90% interval; data end at 19 h) and
// the edge-speed heatmap (#117). Mounted by Assay as the wound picker item "Held-out wound: sim vs NCA vs data".
//   const v = mountHeldout(el); ... v.dispose();
import { FIELD_H as H, FIELD_W as W, SITE_UM } from '../public/sim/js/engine.js';
import { viewFrame, agentFrame, densityFrame } from '../public/sim/js/playback.js';
import { edgeSpeed, stallSpeed, speedColour } from '../edge/edge_speed.js';
import { PAL, OLD, EDGE_CSS, BG_CSS, Age, shade } from './heldout_look.js';

const SIM = new URL('../public/sim/', import.meta.url);
const DEEP_ZOOM = 2.5;
const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
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

export function mountHeldout(host) {
  const worker = new Worker(new URL('../public/sim/js/worker.js', import.meta.url), { type: 'module' });
  const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./heldout.css', import.meta.url).href });
  document.head.append(css);
  const view = realView(worker);
  host.classList.add('dr-root'); host.replaceChildren(el('div', { class: 'dr-body' }, view)); view.focus();
  return { dispose() { worker.terminate(); css.remove(); host.classList.remove('dr-root'); host.replaceChildren(); } };
}
