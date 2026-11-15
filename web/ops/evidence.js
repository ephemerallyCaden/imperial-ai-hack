// Ops tab, "Forecast evidence": how good the shipped forecaster is on wounds it never saw.
// Data: web/ops/evidence.json (written by eval/web_evidence.py from the same files as docs/results.md).
// Usage: import { renderEvidence } from "./ops/evidence.js"; renderEvidence(div, { root: "../" })
// root = path from the page to the repo root. Styles are scoped under .evidence; tokens from design/style-guide/tokens.css
// (fallback values below, so the page also works without it).

const NS = "http://www.w3.org/2000/svg";
const C = {
  ink: "var(--ink, #E8ECEF)", dim: "var(--dim, #8A949C)", faint: "var(--faint, #5C656D)",
  accent: "var(--accent, #E0A458)", band: "var(--chart-band, rgba(224,164,88,.18))",
  grid: "var(--chart-grid, rgba(232,236,239,.08))", axis: "var(--chart-axis, rgba(232,236,239,.3))",
  cut: "var(--chart-cut, rgba(232,236,239,.5))", bg: "var(--bg, #050607)",
};
const COLOR = { shipped: C.accent, edge_speed: C.ink };
const colorOf = (s) => COLOR[s.kind === "shipped" ? "shipped" : s.model] || C.dim;
const f2 = (x) => x.toFixed(2), f4 = (x) => x.toFixed(4), pct = (x) => `${Math.round(x * 100)}%`;
const hrs = (x) => `${x.toFixed(1)} h`;
const ci = (v, lo, hi, f) => `${f(v)} [${f(lo)}–${f(hi)}]`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CSS = `
.evidence { --ev-gap: var(--s5, 24px); color: ${C.ink}; font: var(--fs-body, 12px)/1.45 var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  background: var(--bg, #050607); padding: var(--s5, 24px) var(--s4, 16px); max-width: 1180px; margin: 0 auto; position: relative; }
.evidence * { box-sizing: border-box; }
.evidence .ev-kicker { font: 600 var(--fs-label, 10px) var(--font-cond, "Arial Narrow", sans-serif); letter-spacing: var(--track-label, .1em); text-transform: uppercase; color: ${C.dim}; margin: 0; }
.evidence h2 { font: 500 18px/1.3 var(--font-mono, monospace); margin: 6px 0 4px; text-wrap: balance; }
.evidence h3 { font: 600 var(--fs-small, 11px) var(--font-cond, "Arial Narrow", sans-serif); letter-spacing: var(--track-button, .12em); text-transform: uppercase; margin: 0 0 2px; }
.evidence .ev-sub { color: ${C.dim}; margin: 0 0 var(--s3, 12px); max-width: 70ch; }
.evidence .ev-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: var(--s3, 12px) 0 var(--ev-gap); }
.evidence .ev-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px dashed var(--line, rgba(232,236,239,.5)); color: ${C.dim};
  font: var(--fs-label, 10px) var(--font-mono, monospace); letter-spacing: .06em; text-transform: uppercase; }
.evidence .ev-chip--flag { color: ${C.accent}; border: 1px solid ${C.accent}; }
.evidence .ev-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--hair, rgba(232,236,239,.18));
  border: 1px solid var(--hair, rgba(232,236,239,.18)); margin-bottom: var(--ev-gap); }
.evidence .ev-tile { background: var(--panel-solid, #0B0D10); padding: var(--s3, 12px) var(--s4, 16px); }
.evidence .ev-tile b { display: block; font: 500 26px/1.1 var(--font-mono, monospace); font-variant-numeric: tabular-nums; margin: 6px 0 4px; }
.evidence .ev-tile b.is-accent { color: ${C.accent}; }
.evidence .ev-tile span { color: ${C.dim}; font-size: var(--fs-small, 11px); }
.evidence .ev-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ev-gap); }
.evidence .ev-card { background: var(--panel-solid, #0B0D10); border: 1px solid var(--hair, rgba(232,236,239,.18)); padding: var(--s4, 16px); min-width: 0; }
.evidence .ev-card--wide { grid-column: 1 / -1; }
.evidence .ev-card p.ev-note { color: ${C.dim}; font-size: var(--fs-small, 11px); margin: 6px 0 0; }
.evidence .ev-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s3, 12px); flex-wrap: wrap; margin-bottom: 6px; }
.evidence .ev-chart { width: 100%; }
.evidence .ev-chart svg { display: block; overflow: visible; }
.evidence .ev-chart text { font-family: var(--font-mono, monospace); }
.evidence .ev-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 4px 0 8px; color: ${C.dim}; font-size: var(--fs-small, 11px); }
.evidence .ev-legend i { display: inline-block; width: 14px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 6px; }
.evidence .ev-legend i.is-band { height: 10px; border: 0; background: ${C.band}; }
.evidence .ev-legend i.is-dash { border-top-style: dashed; }
.evidence .ev-seg { display: inline-flex; }
.evidence .ev-seg button { height: 26px; padding: 0 10px; border: 1px solid var(--line, rgba(232,236,239,.5)); background: transparent; color: ${C.dim}; cursor: pointer;
  font: 600 var(--fs-small, 11px) var(--font-cond, "Arial Narrow", sans-serif); letter-spacing: var(--track-button, .12em); }
.evidence .ev-seg button + button { border-left: 0; }
.evidence .ev-seg button[aria-pressed="true"] { background: var(--raise, #12151A); color: ${C.ink}; border-color: ${C.ink}; }
.evidence .ev-seg button:focus-visible, .evidence summary:focus-visible { outline: none; box-shadow: var(--focus, 0 0 0 2px #050607, 0 0 0 4px #E0A458); }
.evidence table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: var(--fs-small, 11px); }
.evidence th { text-align: left; font: 600 var(--fs-label, 10px) var(--font-cond, "Arial Narrow", sans-serif); letter-spacing: var(--track-label, .1em); text-transform: uppercase;
  color: ${C.dim}; border-bottom: 1px solid ${C.ink}; padding: 6px 8px 6px 0; }
.evidence td { border-bottom: 1px solid var(--hair, rgba(232,236,239,.18)); padding: 6px 8px 6px 0; }
.evidence td.is-shipped { color: ${C.accent}; }
.evidence details { margin-top: 8px; color: ${C.dim}; font-size: var(--fs-small, 11px); }
.evidence summary { cursor: pointer; width: max-content; }
.evidence details table { margin-top: 6px; color: ${C.ink}; }
.evidence .ev-scroll { overflow-x: auto; }
.evidence .ev-tip { position: absolute; z-index: 5; pointer-events: none; background: ${C.ink}; color: ${C.bg}; font: var(--fs-label, 10px)/1.4 var(--font-mono, monospace);
  padding: 4px 8px; white-space: pre; display: none; }
.evidence .ev-foot { color: ${C.dim}; font: italic var(--fs-label, 10px) var(--font-serif, Georgia, serif); margin-top: var(--ev-gap); }
@media (max-width: 760px) { .evidence .ev-grid { grid-template-columns: minmax(0, 1fr); } .evidence { padding: var(--s4, 16px); } }
`;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

// Re-render a chart whenever its host changes width (no fixed-width SVGs, readable at phone width).
function responsive(host, draw) {
  let w = 0;
  const go = () => {
    const nw = Math.floor(host.clientWidth);
    if (nw > 0 && nw !== w) { w = nw; host.replaceChildren(draw(w)); }
  };
  new ResizeObserver(go).observe(host);
  go();
}

function svgRoot(w, h, label) {
  return el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label });
}

function xAxis(svg, x, ticks, y0, y1, fmt) {
  for (const t of ticks) {
    el("line", { x1: x(t), x2: x(t), y1: y0, y2: y1, stroke: C.grid }, svg);
    el("text", { x: x(t), y: y1 + 14, "text-anchor": "middle", fill: C.dim, "font-size": 9 }, svg).textContent = fmt(t);
  }
}
function yAxis(svg, y, ticks, x0, x1, fmt) {
  for (const t of ticks) {
    el("line", { x1: x0, x2: x1, y1: y(t), y2: y(t), stroke: C.grid }, svg);
    el("text", { x: x0 - 6, y: y(t) + 3, "text-anchor": "end", fill: C.dim, "font-size": 9 }, svg).textContent = fmt(t);
  }
}
const axisTitle = (svg, x, y, text, anchor = "middle") =>
  (el("text", { x, y, "text-anchor": anchor, fill: C.dim, "font-size": 9 }, svg).textContent = text);

function legend(items) {
  const d = document.createElement("div");
  d.className = "ev-legend";
  d.innerHTML = items.map(([color, label, cls = ""]) =>
    `<span><i class="${cls}" style="border-color:${color}"></i>${esc(label)}</span>`).join("");
  return d;
}

function table(head, rows, shippedCol = -1) {
  return `<div class="ev-scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 && r.shipped ? "is-shipped" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`;
}

// ---------- 1. Scorecard: quantile score with 95% CI per model at one cut-off, gate line ----------
function scorecardChart(sc, cut) {
  return (w) => {
    const rows = sc.rows, narrow = w < 520, rh = narrow ? 40 : 30, top = 22, labW = narrow ? 8 : Math.min(250, w * 0.42), right = 18;
    const h = top + rows.length * rh + 30;
    const max = Math.max(...rows.map((r) => r.q_hi), sc.gate) * 1.08;
    const x = lin(0, max, labW, w - right);
    const svg = svgRoot(w, h, `Quantile score on 28 unseen WHAD wounds, forecast after ${cut} h. Shipped NCA ${
      f4(rows.find((r) => r.kind === "shipped").qscore)}, best simple model ${sc.best_statistical} ${f4(rows.find((r) => r.model === sc.best_statistical).qscore)}.`);
    const ticks = niceTicks(max, 4);
    xAxis(svg, x, ticks, top - 6, top + rows.length * rh, (t) => t.toFixed(2));
    axisTitle(svg, (labW + w - right) / 2, h - 2, "quantile score, lower is better (95% CI over wounds)");
    el("line", { x1: x(sc.gate), x2: x(sc.gate), y1: top - 10, y2: top + rows.length * rh, stroke: C.dim, "stroke-dasharray": "4 3" }, svg);
    el("text", { x: x(sc.gate) + (narrow ? -4 : 4), y: top - 12, "text-anchor": narrow ? "end" : "start", fill: C.dim, "font-size": 9 }, svg).textContent = narrow ? "gate (+10%)" : "gate: within 10% of best simple model";
    rows.forEach((r, i) => {
      const cy = top + i * rh + (narrow ? 27 : rh / 2), col = colorOf(r);
      const g = el("g", { "data-tip": `${r.label}\nscore ${ci(r.qscore, r.q_lo, r.q_hi, f4)}\nband holds ${ci(r.coverage, r.cov_lo, r.cov_hi, f2)}${
        r.passable === undefined ? "" : `\ngate: ${r.passable ? "pass" : "fail"}`}` }, svg);
      el("rect", { x: 0, y: top + i * rh, width: w, height: rh, fill: "transparent" }, g);
      const ly = narrow ? cy - 11 : cy + 3;
      const name = el("text", { x: 0, y: ly, fill: r.kind === "shipped" ? C.accent : C.ink, "font-size": 10.5 }, g);
      name.textContent = !narrow && r.label.length * 6.3 > labW - 70 ? r.label.slice(0, Math.floor((labW - 70) / 6.3) - 1) + "…" : r.label;
      if (r.passable !== undefined)
        el("text", { x: narrow ? w - right : labW - 10, y: ly, "text-anchor": "end", fill: r.passable ? C.dim : C.accent, "font-size": 9 }, g).textContent = r.passable ? "pass" : "fail ▲";
      el("line", { x1: x(r.q_lo), x2: x(r.q_hi), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" }, g);
      el("circle", { cx: x(r.qscore), cy, r: 5, fill: col, stroke: C.bg, "stroke-width": 2 }, g);
    });
    return svg;
  };
}

function niceTicks(max, n) {
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.75);
  const out = [];
  for (let t = 0; t <= max + 1e-12; t += step) out.push(+t.toFixed(10));
  return out;
}

// ---------- line chart over the four checks (score by cut-off, band narrowing) ----------
function lineChart(series, { key, lo, hi, yLabel, fmt, label, cuts }) {
  return (w) => {
    const h = 230, L = 46, R = 104, T = 14, B = 34;
    const vals = series.flatMap((s) => s.points.flatMap((p) => [p[key], lo ? p[lo] : p[key], hi ? p[hi] : p[key]]));
    const ymax = Math.max(...vals) * 1.1;
    const x = lin(cuts[0] - 0.4, cuts[cuts.length - 1] + 0.4, L, w - R), y = lin(0, ymax, h - B, T);
    const svg = svgRoot(w, h, label);
    yAxis(svg, y, niceTicks(ymax, 4), L, w - R, fmt.tick);
    xAxis(svg, x, cuts, T, h - B, (t) => `${t} h`);
    axisTitle(svg, (L + w - R) / 2, h - 4, "history seen before forecasting (of 19 h)");
    axisTitle(svg, 0, 9, yLabel, "start");
    const ends = [];
    for (const s of [...series].reverse()) {
      const col = colorOf(s);
      if (lo) el("path", { d: s.points.map((p, i) => `${i ? "L" : "M"}${x(p.cut)},${y(p[hi])}`).join("") +
        [...s.points].reverse().map((p) => `L${x(p.cut)},${y(p[lo])}`).join("") + "Z",
        fill: col, "fill-opacity": s.kind === "shipped" ? 0.12 : 0.06 }, svg);
      el("path", { d: s.points.map((p, i) => `${i ? "L" : "M"}${x(p.cut)},${y(p[key])}`).join(""), fill: "none", stroke: col,
        "stroke-width": 2, "stroke-linejoin": "round" }, svg);
      for (const p of s.points) el("circle", { cx: x(p.cut), cy: y(p[key]), r: 4, fill: col, stroke: C.bg, "stroke-width": 2 }, svg);
      const last = s.points[s.points.length - 1];
      ends.push({ y: y(last[key]), text: s.short || s.label, col });
    }
    ends.sort((a, b) => a.y - b.y);                              // direct labels at the line ends, nudged apart
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
    for (const e of ends) el("text", { x: w - R + 8, y: e.y + 3, fill: e.col, "font-size": 9.5 }, svg).textContent = e.text;
    cuts.forEach((c, i) => {                                       // hover column per check
      const x0 = i ? (x(cuts[i - 1]) + x(c)) / 2 : L, x1 = i < cuts.length - 1 ? (x(c) + x(cuts[i + 1])) / 2 : w - R;
      el("rect", { x: x0, y: T, width: x1 - x0, height: h - B - T, fill: "transparent",
        "data-tip": `after ${c} h\n` + series.map((s) => {
          const p = s.points.find((q) => q.cut === c);
          return `${s.short || s.label}: ${lo ? ci(p[key], p[lo], p[hi], fmt.value) : fmt.value(p[key])}`;
        }).join("\n") }, svg);
    });
    return svg;
  };
}

// ---------- 3. Reliability: share of the future inside the 90% band, per test ----------
function reliabilityChart(rows) {
  return (w) => {
    const rh = 46, top = 16, L = 0, R = 16, h = top + rows.length * rh + 30;
    const x = lin(0, 1, L + 8, w - R);
    const svg = svgRoot(w, h, `Coverage of the 90% band: ${rows.map((r) => `${r.label} ${pct(r.coverage)}`).join(", ")}.`);
    xAxis(svg, x, [0, 0.25, 0.5, 0.75, 1], top - 4, top + rows.length * rh, pct);
    el("line", { x1: x(0.9), x2: x(0.9), y1: top - 8, y2: top + rows.length * rh, stroke: C.dim, "stroke-dasharray": "4 3" }, svg);
    el("text", { x: x(0.9), y: top - 10, "text-anchor": "middle", fill: C.dim, "font-size": 9 }, svg).textContent = "target 90%";
    axisTitle(svg, (L + w) / 2, h - 2, "share of later frames inside the 90% band (95% CI over wounds)");
    rows.forEach((r, i) => {
      const cy = top + i * rh + 30, bad = r.coverage < 0.8, col = bad ? C.accent : r.model === "nca_realft3" ? C.ink : C.dim;
      const g = el("g", { "data-tip": `${r.label}: ${r.detail}\n${r.model_label}, after ${r.cut} h\nband holds ${ci(r.coverage, r.cov_lo, r.cov_hi, f2)} (${r.n_wounds} wounds)` }, svg);
      el("rect", { x: 0, y: cy - 28, width: w, height: rh, fill: "transparent" }, g);
      el("text", { x: x(0) , y: cy - 12, fill: bad ? C.accent : C.ink, "font-size": 10.5 }, g).textContent =
        `${r.label}: ${pct(r.coverage)}${bad ? "  ▲ not calibrated" : ""}`;
      el("line", { x1: x(r.cov_lo), x2: x(r.cov_hi), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" }, g);
      el("circle", { cx: x(r.coverage), cy, r: 5, fill: col, stroke: C.bg, "stroke-width": 2 }, g);
    });
    return svg;
  };
}

// ---------- 6. Failure case: hardest unseen wound for the shipped model ----------
function failureChart(f) {
  return (w) => {
    const h = 260, L = 40, R = 16, T = 18, B = 34;
    const x = lin(0, 19.3, L, w - R), y = lin(0, 1.12, h - B, T);
    const ot = f.observed.t_hours, oa = f.observed.area;
    const svg = svgRoot(w, h, `Hardest unseen wound ${f.wound_id}: forecast after ${f.cut} h, quantile score ${f4(f.qscore)} vs median ${f4(f.median_qscore)}.`);
    yAxis(svg, y, [0, 0.25, 0.5, 0.75, 1], L, w - R, (t) => t.toFixed(2));
    xAxis(svg, x, [0, 4, 8, 12, 16], T, h - B, (t) => `${t} h`);
    axisTitle(svg, (L + w - R) / 2, h - 4, "hours since the scratch");
    axisTitle(svg, 0, 9, "wound area (1 = start)", "start");
    const ft = f.t_hours;
    el("path", { d: ft.map((t, i) => `${i ? "L" : "M"}${x(t)},${y(f.area_q95[i])}`).join("") +
      [...ft.keys()].reverse().map((i) => `L${x(ft[i])},${y(f.area_q05[i])}`).join("") + "Z", fill: C.band }, svg);
    el("path", { d: ft.map((t, i) => `${i ? "L" : "M"}${x(t)},${y(f.area_q50[i])}`).join(""), fill: "none", stroke: C.accent,
      "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
    el("line", { x1: x(f.cut), x2: x(f.cut), y1: T, y2: h - B, stroke: C.cut, "stroke-dasharray": "2 3" }, svg);
    el("text", { x: x(f.cut) + 4, y: T + 2, fill: C.dim, "font-size": 9 }, svg).textContent = "forecast from here";
    const k = ot.findIndex((t) => t > f.cut + 1e-9);
    el("path", { d: ot.map((t, i) => `${i ? "L" : "M"}${x(t)},${y(oa[i])}`).join(""), fill: "none", stroke: C.ink, "stroke-width": 1.7 }, svg);
    ot.forEach((t, i) => {
      const after = k >= 0 && i >= k;
      const fi = ft.findIndex((u) => Math.abs(u - t) < 1e-6);
      el("circle", { cx: x(t), cy: y(oa[i]), r: 4, fill: after ? C.bg : C.ink, stroke: C.ink, "stroke-width": 1.7,
        "data-tip": `${hrs(t)}: observed ${f2(oa[i])}${fi >= 0 ? `\nforecast ${f2(f.area_q50[fi])} [${f2(f.area_q05[fi])}–${f2(f.area_q95[fi])}]` : ""}` }, svg);
    });
    return svg;
  };
}

export async function renderEvidence(host, { root = "../" } = {}) {
  if (!document.getElementById("evidence-css")) {
    const s = document.createElement("style");
    s.id = "evidence-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  host.innerHTML = "";
  const box = document.createElement("section");
  box.className = "evidence";
  host.appendChild(box);
  let D;
  try {
    const r = await fetch(`${root}web/ops/evidence.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    D = await r.json();
  } catch (e) {
    box.innerHTML = `<p class="ev-kicker">Forecast evidence</p><p>Could not load web/ops/evidence.json (${esc(e.message)}). Serve the repo root, e.g. <code>python -m http.server 8000</code>.</p>`;
    return;
  }

  const sc38 = D.scorecard["3.8"], ship38 = sc38.rows.find((r) => r.kind === "shipped"), best38 = sc38.rows.find((r) => r.model === sc38.best_statistical);
  const rel = D.reliability, newType = rel.find((r) => r.label === "New cell type");
  const st = D.stall, aucs = st.map((s) => s.auc);
  const byCut = D.by_cutoff.map((s) => ({ ...s, short: { nca_realft3: "NCA, real frames", edge_speed: "Edge speed", nca_ensemble: "NCA, sim only" }[s.model] }));
  const wins = byCut[0].points.filter((p, i) => p.qscore < byCut[1].points[i].qscore).map((p) => `${p.cut} h`);

  box.innerHTML = `
    <p class="ev-kicker">Ops · Forecast evidence</p>
    <h2>How good are the forecasts on wounds the model never saw?</h2>
    <p class="ev-sub">Every wound below was forecast by a model that never trained on it (${D.n_wounds} WHAD wounds, ${D.n_series} series, ${D.horizon_h} h each),
      using the same calibration as the product. Numbers come from <code>docs/results.md</code>.</p>
    <div class="ev-chips"><span class="ev-chip">Held-out recorded data</span><span class="ev-chip">Research use only, not for diagnosis or treatment</span></div>
    <div class="ev-tiles">
      <div class="ev-tile"><p class="ev-kicker">90% band holds</p><b class="is-accent num">${pct(ship38.coverage)}</b><span>of later frames on unseen wounds (target 90%)</span></div>
      <div class="ev-tile"><p class="ev-kicker">vs best simple model, 3.8 h</p><b class="num">${ship38.qscore > best38.qscore ? "+" : ""}${Math.round((ship38.qscore / best38.qscore - 1) * 100)}%</b><span>quantile score; better at ${wins.join(" and ")}</span></div>
      <div class="ev-tile"><p class="ev-kicker">New cell type</p><b class="num" style="color:${C.accent}">${pct(newType.coverage)}</b><span>▲ band does not transfer: calibrate per cell line</span></div>
      <div class="ev-tile"><p class="ev-kicker">Stall flag</p><b class="num">${f2(Math.min(...aucs))}–${f2(Math.max(...aucs))}</b><span>AUC across the four checks</span></div>
    </div>
    <div class="ev-grid">
      <div class="ev-card ev-card--wide" id="ev-score">
        <div class="ev-head"><div><h3>Scorecard</h3><p class="ev-note" style="margin:0">Unseen WHAD wounds. Pass = score within 10% of the best simple model and band coverage 0.85–0.95, fixed before testing.</p></div>
          <div class="ev-seg" role="group" aria-label="History seen before forecasting">${D.cutoffs.map((c) =>
            `<button type="button" data-cut="${c}" aria-pressed="${c === 3.8}">${c} h</button>`).join("")}</div></div>
        <div class="ev-chart"></div>
        <details><summary>Table</summary><div class="ev-tbl"></div></details>
      </div>
      <div class="ev-card" id="ev-bycut"><h3>Score by history seen</h3><p class="ev-note" style="margin:0 0 4px">Lower is better. Shaded: 95% CI over wounds.</p>
        <div class="ev-legend-slot"></div><div class="ev-chart"></div>
        <p class="ev-note">Trained only on simulator output, the NCA failed the gate. Fine-tuned on real frames, it beats edge speed at ${wins.join(" and ")} and is within a few percent in between.</p>
        <details><summary>Table</summary>${table(["Check", ...byCut.map((s) => s.short)], D.cutoffs.map((c) => [`${c} h`, ...byCut.map((s) => f4(s.points.find((p) => p.cut === c).qscore))]))}</details>
      </div>
      <div class="ev-card" id="ev-rel"><h3>Is the 90% band honest?</h3><p class="ev-note" style="margin:0 0 4px">Shipped NCA where it was tested (WHAD); best simple model on WHiM-BC.</p>
        <div class="ev-chart"></div>
        <details><summary>Table</summary>${table(["Test", "Model", "Check", "Band holds", "Wounds"], rel.map((r) => [`${r.label} (${r.detail})`, r.model_label, `${r.cut} h`, ci(r.coverage, r.cov_lo, r.cov_hi, f2), r.n_wounds]))}</details>
      </div>
      <div class="ev-card" id="ev-narrow"><h3>More frames, narrower band</h3><p class="ev-note" style="margin:0 0 4px">Mean width of the 90% band (fraction of the starting area), unseen wounds.</p>
        <div class="ev-legend-slot"></div><div class="ev-chart"></div>
        <p class="ev-note">Why the agent may say "image again": the band for the shipped NCA narrows from ${f2(D.narrowing[0].points[0].width)} at 1.9 h to ${f2(D.narrowing[0].points[1].width)} at 3.8 h.</p>
        <details><summary>Table</summary>${table(["Check", ...D.narrowing.map((s) => s.label)], D.cutoffs.map((c) => [`${c} h`, ...D.narrowing.map((s) => f2(s.points.find((p) => p.cut === c).width))]))}</details>
      </div>
      <div class="ev-card" id="ev-stall"><h3>Stall flag</h3><p class="ev-note" style="margin:0 0 8px">Flags wounds whose area at 19 h is still at least 90% of the area at the check. Thresholds tuned leave-one-wound-out.</p>
        ${table(["Check", "AUC", "Precision", "Recall", "Stalled / series"], st.map((s) => [`${s.cut} h`, f2(s.auc), f2(s.precision), f2(s.recall), `${s.positives} / ${s.n}`]))}
        <p class="ev-note">A fired stall flag forces "stall flagged, ask a human"; the agent cannot override it.</p>
      </div>
      <div class="ev-card ev-card--wide" id="ev-fail"><h3>Where it fails</h3>
        <p class="ev-note" style="margin:0 0 4px">Hardest unseen wound for the shipped NCA (${esc(D.failure.wound_id.replace(/_/g, " "))}): slow for the first hours, then far faster than any forecast from its start.
          Quantile score ${f4(D.failure.qscore)}, against a median of ${f4(D.failure.median_qscore)} over all unseen wounds.</p>
        <div class="ev-legend-slot"></div><div class="ev-chart"></div>
      </div>
    </div>
    <p class="ev-foot">Quantile score: a CRPS approximation from the 5/50/95% quantiles of area over the rest of the 19 h. CIs: wound-level bootstrap. Generated by eval/web_evidence.py.</p>`;

  const tip = document.createElement("div");
  tip.className = "ev-tip";
  box.appendChild(tip);
  box.addEventListener("pointermove", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t || !box.contains(t)) { tip.style.display = "none"; return; }
    tip.textContent = t.getAttribute("data-tip");
    tip.style.display = "block";
    const b = box.getBoundingClientRect(), tw = tip.offsetWidth;
    let left = e.clientX - b.left + 14;
    if (left + tw > b.width - 8) left = e.clientX - b.left - tw - 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${e.clientY - b.top + 14}px`;
  });
  box.addEventListener("pointerleave", () => (tip.style.display = "none"));

  // scorecard + cut-off control
  const scoreHost = box.querySelector("#ev-score .ev-chart");
  let current = 3.8, ro;
  const drawScore = () => {
    const sc = D.scorecard[String(current)];
    ro?.disconnect();
    scoreHost.replaceChildren();
    let w = 0;
    const go = () => { const nw = Math.floor(scoreHost.clientWidth); if (nw > 0 && nw !== w) { w = nw; scoreHost.replaceChildren(scorecardChart(sc, current)(w)); } };
    ro = new ResizeObserver(go); ro.observe(scoreHost); go();
    const rows = sc.rows.map((r) => Object.assign([r.label, ci(r.qscore, r.q_lo, r.q_hi, f4), ci(r.coverage, r.cov_lo, r.cov_hi, f2),
      r.passable === undefined ? "simple model" : r.passable ? "pass" : "fail"], { shipped: r.kind === "shipped" }));
    box.querySelector("#ev-score .ev-tbl").innerHTML = table(["Forecaster", "Quantile score", "Band holds", "Gate"], rows);
  };
  box.querySelectorAll("#ev-score .ev-seg button").forEach((b) => b.addEventListener("click", () => {
    current = +b.dataset.cut;
    box.querySelectorAll("#ev-score .ev-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawScore();
  }));
  drawScore();

  const legendFor = (series) => legend(series.map((s) => [colorOf(s), s.short || s.label]));
  box.querySelector("#ev-bycut .ev-legend-slot").replaceWith(legendFor(byCut));
  responsive(box.querySelector("#ev-bycut .ev-chart"), lineChart(byCut, {
    key: "qscore", lo: "qscore_lo", hi: "qscore_hi", yLabel: "quantile score", cuts: D.cutoffs,
    fmt: { tick: (t) => t.toFixed(2), value: f4 },
    label: `Quantile score by history seen: shipped NCA ${byCut[0].points.map((p) => f4(p.qscore)).join(", ")} vs edge speed ${byCut[1].points.map((p) => f4(p.qscore)).join(", ")} at ${D.cutoffs.join(", ")} h.` }));
  responsive(box.querySelector("#ev-rel .ev-chart"), reliabilityChart(rel));
  const narrow = D.narrowing.map((s) => ({ ...s, short: s.kind === "shipped" ? "NCA, real frames" : s.label }));
  box.querySelector("#ev-narrow .ev-legend-slot").replaceWith(legendFor(narrow));
  responsive(box.querySelector("#ev-narrow .ev-chart"), lineChart(narrow, {
    key: "width", yLabel: "band width", cuts: D.cutoffs, fmt: { tick: (t) => t.toFixed(1), value: f2 },
    label: `Mean 90% band width, shipped NCA: ${narrow[0].points.map((p) => `${f2(p.width)} at ${p.cut} h`).join(", ")}.` }));
  box.querySelector("#ev-fail .ev-legend-slot").replaceWith(legend([[C.band, "90% band", "is-band"], [C.accent, "forecast median", "is-dash"],
    [C.ink, "observed (filled: before the forecast, hollow: what happened)"]]));
  responsive(box.querySelector("#ev-fail .ev-chart"), failureChart(D.failure));
}
