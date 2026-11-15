// Ops mode: "Agent runs" (recorded run logs, scoreboard, adversarial set, investigator accuracy) and
// "Forecast evidence" (slot for web/ops/evidence.js, built separately). Every number shown is read from a
// file under agent/; a missing file shows "not available". Nothing is invented here.

import { lineChart, reliabilityChart, responsive, legend, colorOf, ensureEvidenceCss } from "./evidence.js";

const NA = `<span class="ops-na">not available</span>`;
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const show = v => (v === null || v === undefined || v === "") ? "–" : esc(v);
const fmtTok = n => (n === null || n === undefined) ? "–" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const fmtUsd = n => (n === null || n === undefined) ? "–" : "$" + n.toFixed(4);
const clock = ts => ts ? new Date(ts * 1000).toTimeString().slice(0, 8) : "–";

// RFC-4180-ish CSV parser (quoted fields with commas / doubled quotes); lib/data.js csv() splits on every comma.
function parseCSV(src) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x !== ""));
  return body.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}

// Small markdown renderer: headings, pipe tables, bullets, paragraphs, **bold**, `code`.
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>"); }
function md(src) {
  const out = []; const lines = src.split(/\r?\n/); let i = 0;
  const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^#{1,6}\s/.test(l)) { out.push(`<h3>${inline(l.replace(/^#+\s*/, ""))}</h3>`); i++; continue; }
    if (l.trim().startsWith("|")) {
      const block = []; while (i < lines.length && lines[i].trim().startsWith("|")) block.push(lines[i++]);
      const [h, , ...b] = block;
      out.push(`<table class="st-table"><tr>${cells(h).map(c => `<th>${inline(c)}</th>`).join("")}</tr>${b.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (/^\s*-\s/.test(l)) {
      const items = []; while (i < lines.length && /^\s*-\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*-\s/, ""));
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join("")}</ul>`); continue;
    }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#|\||\s*-\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return `<div class="ops-md">${out.join("")}</div>`;
}
// Split markdown into { title: body } by "## " headings ("" = text before the first one).
function mdSections(src) {
  const s = { "": [] }; let cur = "";
  for (const l of src.split(/\r?\n/)) { const m = l.match(/^##\s+(.*)/); if (m) { cur = m[1].trim(); s[cur] = []; } else s[cur].push(l); }
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.join("\n")]));
}

const maybe = p => p.then(v => v, () => null);   // missing file -> null

// ---------- run log helpers ----------
function runTotals(recs) {
  const end = recs.find(r => r.kind === "run_end") || null;
  const report = recs.find(r => r.kind === "report") || null;
  const approvals = recs.filter(r => r.kind === "approval");
  const costs = recs.map(r => r.cost_usd).filter(x => typeof x === "number");
  return {
    end, report,
    human: approvals.length ? approvals.map(a => a.approved ? "approved" : "rejected").join(" → ") : null,
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
}
function recTokens(r) {
  if (typeof r.tokens_total === "number") return r.tokens_total;
  if (r.usage && typeof r.usage.input_tokens === "number") return r.usage.input_tokens + (r.usage.output_tokens || 0);
  return null;
}
function recHelper(r) {
  if (r.kind === "tool_call") return r.tool;
  if (r.kind === "model_call") return (r.tool_calls || []).map(t => t.name).join(", ") || r.model;
  if (r.kind === "decision") return r.source;
  if (r.kind === "approval") return r.approver;
  if (r.kind === "report") return r.model_called ? r.model : r.source;
  return "";
}
function toolSummary(r) {
  const o = r.output;
  if (!o || typeof o !== "object") return show(o);
  const f = Array.isArray(o.forecasts) ? o.forecasts[0] : null;
  if (f) {
    const bits = [o.model, `P(90% closed by ${o.p_close_by_T_hours} h) ${f.p_close_by_T}`, f.p_stall == null ? "p_stall n/a (one image)" : `p_stall ${f.p_stall}`];
    if (f.flags && f.flags.length) bits.push(`flags: ${f.flags.map(x => x?.type ?? x).join(", ")}`);
    if (f.segmentation_quality) bits.push(`seg ${f.segmentation_quality.status}`);
    if (o.schedule) bits.push(`schedule ${o.schedule.action}${o.schedule.call ? ": " + o.schedule.call : ""}${o.schedule.next_image_hours != null ? " " + o.schedule.next_image_hours + " h" : ""}`);
    return esc(bits.join(" · "));
  }
  if (o.refused || o.refusal) return `<span class="warn">refused</span> ${esc(JSON.stringify(o.reasons || o.refusal || "").slice(0, 160))}`;
  const res = Array.isArray(o.results) ? o.results[0] : null;
  if (res && res.stall) return esc(`stall ${res.stall.p_stall == null ? "n/a (one image)" : `${res.stall.fired ? "fired" : "off"} (p ${res.stall.p_stall} vs ${res.stall.threshold})`} · schedule ${res.schedule?.action ?? "–"}${res.schedule?.call ? ": " + res.schedule.call : ""}`);
  if (Array.isArray(o.hypotheses) && o.hypotheses.length) return esc(`top hypothesis ${o.hypotheses[0].name} (fit error ${o.hypotheses[0].fit_error}) · ${o.note || ""}`);
  if ("ok" in o) return esc(`ok ${o.ok} · backend ${o.backend ?? "–"}${o.fallback_reason ? " · fallback " + o.fallback_reason : ""}`);
  return esc(Object.keys(o).slice(0, 6).join(", "));
}
function recSummary(r) {
  switch (r.kind) {
    case "run_start": return esc(`wound ${r.wound?.wound_id ?? "–"} · checks ${(r.checks_h || []).join(", ")} h · max ${r.max_steps} steps · budget ${r.token_budget} tokens · ${r.model_id ?? ""}`);
    case "tool_call": return toolSummary(r);
    case "model_call": {
      const p = (r.tool_calls || []).find(t => t.input && t.input.decision_id);
      return p ? esc(`proposed ${p.input.decision_id}`) : esc(r.text ? r.text.slice(0, 160) : `stop_reason ${r.stop_reason}`);
    }
    case "critic": return esc(`at ${r.cut_h} h: ${r.traced} traced, ${r.untraced} untraced${r.removed?.length ? " · removed " + r.removed.join(", ") : ""}`);
    case "decision": return esc(`${r.label} (${r.source}${r.proposed && r.proposed !== r.decision ? `, proposed ${r.proposed}` : ""}${r.fallback_reason ? ", fallback: " + r.fallback_reason : ""})`);
    case "approval": return `${esc(r.decision)}: <b class="${r.approved ? "" : "warn"}">${r.approved ? "approved" : "rejected"}</b>${r.note ? " · " + esc(r.note) : ""}`;
    case "report": return esc(r.headline);
    case "run_end": return esc(`${r.reason} · ${r.decision_label ?? r.decision ?? ""} · ended ${r.ended_at_h} of ${r.horizon_h} h · saved ${r.plate_hours_saved} plate-h`);
    case "intake_applied": return esc(Object.entries(r.applied || {}).map(([k, v]) => `${k} ${v.value} (${v.source})`).join(" · ") + ` · scope ok ${r.scope_ok}`);
    default: return esc(Object.keys(r).filter(k => !["run_id", "seq", "ts", "kind"].includes(k)).slice(0, 5).join(", "));
  }
}

// ---------- mount ----------
export function mount(el, ctx) {
  let dead = false;
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = new URL("./ops.css", import.meta.url).href;
  document.head.appendChild(css);

  el.innerHTML = `<div class="ops">
    <div class="st-seg" role="tablist" aria-label="Ops views">
      <button class="st-btn" data-tab="runs" aria-pressed="true">Overview</button>
      <button class="st-btn" data-tab="evidence" aria-pressed="false">Forecast evidence</button>
    </div>
    <div data-pane="runs"></div>
    <div data-pane="evidence" hidden></div>
    <div class="ops-tip" role="tooltip" hidden></div>
  </div>`;
  const root = el.querySelector(".ops");
  const panes = { runs: root.querySelector('[data-pane="runs"]'), evidence: root.querySelector('[data-pane="evidence"]') };
  wireTips(root);
  let evidenceLoaded = false;
  root.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.tab;
    root.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-pressed", x === b));
    Object.entries(panes).forEach(([k, p]) => p.hidden = k !== t);
    if (t === "evidence" && !evidenceLoaded) { evidenceLoaded = true; loadEvidence(panes.evidence); }
  }));

  renderOverview(panes.runs, ctx, () => dead);
  if (new URLSearchParams(location.search).get("tab") === "evidence") root.querySelector('[data-tab="evidence"]').click();   // ?tab=evidence for screenshots
  return () => { dead = true; css.remove(); el.replaceChildren(); };
}

// ---------- overview: what an assay scientist needs at a glance ----------
// Every value comes from a repo file: eval/results/scheduler.csv (stop-early replay), web/ops/evidence.json (band width
// per check, band coverage per test), agent/runs/*.jsonl (one card per recorded run), agent/results/adversarial.csv.
const H = 19;                                   // forecast horizon (h)
const CHECKS = [1.9, 3.8, 5.7, 9.5];
const pct = x => Math.round(x * 100) + "%";
const num = s => (s === "" || s == null) ? null : +s;

function wireTips(root) {
  const tip = root.querySelector(".ops-tip");
  const place = (el, x, y) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = root.getBoundingClientRect();
    tip.style.left = Math.min(x - r.left + 12, r.width - tip.offsetWidth - 8) + "px";
    tip.style.top = (y - r.top + root.scrollTop + 14) + "px";
  };
  const own = t => t && !t.closest(".evidence:not(.ev-embed)");
  root.addEventListener("pointermove", e => { const t = e.target.closest("[data-tip]"); if (own(t)) place(t, e.clientX, e.clientY); else tip.hidden = true; });
  root.addEventListener("pointerleave", () => { tip.hidden = true; });
  root.addEventListener("focusin", e => { const t = e.target.closest("[data-tip]"); if (!own(t)) return; const b = t.getBoundingClientRect(); place(t, b.left + b.width / 2, b.bottom); });
  root.addEventListener("focusout", () => { tip.hidden = true; });
}

// Live replay: the recorded run logs are played on one clock (replay hours). Steps inside a check are spaced so the
// pipeline can be followed; the wait for approval is held a little longer. Labelled "recorded · replayed" on screen.
const STEP_H = 0.14, WAIT_H = 0.5;
const SPEEDS = { "2160×": 0.6, "8640×": 2.4 };            // replay hours per second (2160× = 0.6 h of assay per second)
const NODES = [["Images", "code"], ["Forecast", "code"], ["Flags", "code"], ["Propose", "Claude"], ["Critic", "code"], ["Policy", "code"], ["You", "reviewer"], ["Report", "Claude"]];
const COND = { CC: "Control", C61: "CYR61 knockdown" };
const FORECASTER = { edge_speed: "edge-speed baseline", nca_realft3: "Stitch NCA" };
const short = id => id.replace(/^exp(\d)_part(I+)_/, "E$1·$2·").replace(/_/g, "·");

function nodeOf(r) {
  if (r.kind === "tool_call") return /forecast/.test(r.tool) ? "Forecast" : r.tool === "flags_schedule" ? "Flags" : r.tool === "investigate" ? "Investigator" : null;
  if (r.kind === "model_call") return r.purpose === "report" || r.purpose === "intake" ? null : "Propose";
  return { critic: "Critic", decision: "Policy", approval: "You", human_review: "You", report: "Report", run_end: "Done" }[r.kind] || null;
}
function evText(r, end, heldOut) {
  const o = r.output || {};
  if (r.kind === "tool_call" && o.forecasts) return `${FORECASTER[o.model] ?? o.model} · P(close) ${pct(o.forecasts[0].p_close_by_T)}`;
  if (r.kind === "tool_call" && o.results) { const s = o.results[0]?.stall; return s?.fired ? "stall flag fired" : "no stall"; }
  if (r.kind === "tool_call" && o.hypotheses) return `top hypothesis: ${o.hypotheses[0]?.name ?? "–"}`;
  if (r.kind === "model_call") { const p = (r.tool_calls || []).find(t => t.input?.decision_id); return p ? `proposes ${p.input.decision_id.replace(/_/g, " ")}` : "proposal"; }
  if (r.kind === "critic") return `${r.traced}/${r.traced + r.untraced} numbers traced`;
  if (r.kind === "decision") return r.source === "forced" ? `${r.label} (forced by rule)` : `allowed: ${r.label}`;
  if (r.kind === "approval") return r.approved ? "approved (simulated reviewer)" : "rejected (recorded branch)";
  if (r.kind === "human_review") return "reviewed (simulated reviewer)";
  if (r.kind === "report") return "report written";
  if (r.kind === "run_end") return end.stopped ? `stopped at ${end.stop_h} h` : heldOut ? `no stop · imaged to ${H} h` : `run ended at ${end.ended_at_h} h · keep imaging`;
  return r.kind;
}
function prep(run, recs) {
  const end = recs.find(x => x.kind === "run_end") || {}, heldOut = run.kind === "whad_loo";
  const ev = [], fcs = []; let cut = 0, t = 0;
  for (const r of recs) {
    const node = nodeOf(r); if (!node) continue;
    if (r.kind === "tool_call" && /forecast/.test(r.tool) && r.output?.forecasts?.length) {
      cut = r.output.cutoff_hours; t = cut;
      fcs.push({ cut, doc: r.output, f: r.output.forecasts[0] });
      ev.push({ t, node: "Images", text: `frames to ${cut} h`, r: { kind: "images" } });
    }
    t += r.kind === "approval" ? WAIT_H : STEP_H;
    if (heldOut && !end.stopped && (r.kind === "run_end" || r.kind === "report")) t = r.kind === "run_end" ? H : H - STEP_H;   // no stop: plate imaged to the horizon
    ev.push({ t, node, text: evText(r, end, heldOut), r });
  }
  const f0 = fcs[0]?.f;
  const obs = f0 ? f0.observed.t_hours.map((x, k) => [x, f0.observed.area[k]]) : [];
  const closeT = obs.find(([x, a]) => x <= H && a <= 0.1)?.[0] ?? null;
  return { run, end, ev, fcs, obs, heldOut, closeT, cond: f0?.condition ?? "", id: run.kind === "frames" ? "upload" : short(run.wound_id),
    stopT: end.stopped ? ev.find(e => e.node === "Done")?.t ?? end.stop_h : null, doneT: ev.find(e => e.node === "Done")?.t ?? H };
}
const condName = w => w.run.kind === "frames" ? "Your upload" : COND[w.cond] ?? w.cond;
const fcAt = (w, c) => [...w.fcs].reverse().find(f => f.cut <= c);
function statusAt(w, c) {
  if (w.stopT != null && c >= w.stopT) return w.end.stop_kind === "stall" ? ["flag", "▲", `Stall · stopped ${w.end.stop_h} h`] : ["stop", "■", `Stopped ${w.end.stop_h} h`];
  if (!w.end.stopped && c >= w.doneT) return ["go", "→", w.heldOut ? `No stop · imaged to ${H} h` : "Keep imaging"];
  const past = w.ev.filter(e => e.t <= c), dec = past.filter(e => e.r.kind === "decision").at(-1), app = past.filter(e => e.r.kind === "approval").at(-1);
  if (dec && /stop|stall/.test(dec.r.decision) && !(app && app.r.cut_h === dec.r.cut_h)) return ["flag", "⏸", "Needs you"];
  if (!past.length) return ["idle", "◌", "Imaging"];
  if (!dec || dec.r.cut_h !== fcAt(w, c)?.cut) return ["idle", "◌", `Checking ${fcAt(w, c)?.cut} h`];
  return ["go", "→", dec.r.decision === "image_again" ? "Image again" : dec.r.label];
}
function verdict(w) {
  if (!w.heldOut) return "";
  if (w.end.stopped && w.end.stop_kind === "unlikely") return w.closeT != null ? `<span class="warn">✕ wrong call · closed by ${w.closeT} h</span>` : `<span>✓ right call</span>`;
  if (w.end.stopped) return "";
  return `<span class="dim">${w.closeT != null ? `closed at ${w.closeT} h` : `not closed by ${H} h`}</span>`;
}
function headline(w, c) {
  const fc = fcAt(w, c), [, , st] = statusAt(w, c);
  const parts = [`<b>${esc(condName(w))}</b>`, `<span class="dim">${esc(w.id)}</span>`];
  if (fc) parts.push(`${pct(fc.f.p_close_by_T)} chance of 90% closure by ${H} h <span class="dim">(${esc(FORECASTER[fc.doc.model] ?? fc.doc.model)}, ${fc.cut} h check)</span>`);
  else parts.push(`<span class="dim">waiting for the first check</span>`);
  parts.push(st === "Needs you" ? `<b class="accent">proposes stop → waiting for you</b>` : esc(st));
  return parts.join(" · ");
}

function heroChart(w, c) {
  const W = 760, Ht = 250, L = 36, R = 16, T = 12, B = 26;
  const x = t => L + (t / H) * (W - L - R), y = a => T + a * (Ht - T - B);   // closure rises: area 1 (0% closed) at the bottom
  const path = pts => pts.map(([t, a], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(a).toFixed(1)}`).join("");
  const fc = fcAt(w, c), stopH = w.stopT != null && c >= w.stopT ? w.end.stop_h : null;
  const seen = w.obs.filter(([t]) => t <= Math.min(c, stopH ?? H) + 1e-6), last = seen.at(-1);
  let g = "";
  if (fc) {   // the forecast starts at the last image the check used (frames are hourly), with zero width there
    const f = fc.f, at = w.obs.filter(([t]) => t <= fc.cut + 1e-6).at(-1) ?? [fc.cut, f.area_q50[0]];
    g += `<path class="band" d="${path([at, ...f.t_hours.map((t, k) => [t, f.area_q95[k]]), ...f.t_hours.map((t, k) => [t, f.area_q05[k]]).reverse()])}Z" data-tip="90% band from the ${fc.cut} h check (${FORECASTER[fc.doc.model] ?? fc.doc.model})"/>
      <path class="med" d="${path([at, ...f.t_hours.map((t, k) => [t, f.area_q50[k]])])}"/>
      <line class="cut" x1="${x(fc.cut)}" x2="${x(fc.cut)}" y1="${T}" y2="${Ht - B}"/>`;
  }
  if (c >= H && w.heldOut && stopH != null) { const after = w.obs.filter(([t]) => t >= (last?.[0] ?? 0)); if (after.length > 1) g += `<path class="truth" d="${path(after)}"/>`; }
  g += `<path class="obs" d="${path(seen)}"/>${seen.map(([t, a]) => `<circle class="fr" cx="${x(t)}" cy="${y(a)}" r="2.5"/>`).join("")}`;
  if (last) g += `<circle class="dot" cx="${x(last[0])}" cy="${y(last[1])}" r="4.5" data-tip="${pct(1 - last[1])} closed at ${last[0]} h"/>`;
  if (stopH != null) g += `<line class="stop" x1="${x(stopH)}" x2="${x(stopH)}" y1="${T}" y2="${Ht - B}"/><text class="ax" x="${x(stopH) + 4}" y="${Ht - B - 6}">stopped ${stopH} h</text>`;
  if (c < H) g += `<line class="now" x1="${x(c)}" x2="${x(c)}" y1="${T}" y2="${Ht - B}"/><text class="ax" x="${x(c) + 3}" y="${Ht - B - 6}">now</text>`;
  return `<svg class="hero-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(condName(w))} ${esc(w.id)}: closure observed${fc ? `, forecast from ${fc.cut} h` : ""}">
    ${[0, 0.5, 1].map(a => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}"/><text class="ax" x="${L - 6}" y="${y(a) + 3}" text-anchor="end">${pct(1 - a)}</text>`).join("")}
    <line class="grid g90" x1="${L}" x2="${W - R}" y1="${y(0.1)}" y2="${y(0.1)}"/><text class="ax" x="${W - R}" y="${y(0.1) - 3}" text-anchor="end">90% closed</text>
    <line class="axis" x1="${L}" x2="${W - R}" y1="${Ht - B}" y2="${Ht - B}"/>
    ${CHECKS.map(k => `<line class="tick ${w.fcs.some(f => f.cut === k && f.cut <= c) ? "on" : ""}" x1="${x(k)}" x2="${x(k)}" y1="${Ht - B}" y2="${Ht - B + 5}"/><text class="ax" x="${x(k)}" y="${Ht - 8}" text-anchor="middle">${k}</text>`).join("")}
    <text class="ax" x="${W - R}" y="${Ht - 8}" text-anchor="end">${H} h</text><text class="ax" x="${L}" y="${Ht - 8}">0</text>
    ${g}
  </svg>`;
}
function spark(w, c) {
  const W = 84, Ht = 24, x = t => (t / H) * W, y = a => 2 + a * (Ht - 4);
  const stopH = w.stopT != null && c >= w.stopT ? w.end.stop_h : null;
  const pts = w.obs.filter(([t]) => t <= Math.min(c, stopH ?? H) + 1e-6);
  return `<svg class="spark" viewBox="0 0 ${W} ${Ht}" aria-hidden="true"><line class="grid" x1="0" x2="${W}" y1="${y(0.1)}" y2="${y(0.1)}"/>
    <path class="obs" d="${pts.map(([t, a], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(a).toFixed(1)}`).join("")}"/>
    ${stopH != null ? `<line class="stopk" x1="${x(stopH)}" x2="${x(stopH)}" y1="0" y2="${Ht}"/>` : ""}</svg>`;
}
function pipeline(w, c) {
  const cuts = w.fcs.map(f => f.cut), i = cuts.filter(k => k <= c).length - 1;
  const checks = `<span class="pc-lab">Check</span>${CHECKS.map(k => { const has = cuts.includes(k);
    const s = !has ? "na" : k < (cuts[i] ?? -1) ? "ok" : k === cuts[i] ? (w.stopT != null && c >= w.stopT ? "ok" : "run") : "wait";
    return `<span class="pc pc-${s}">${k}${s === "ok" ? " ✓" : s === "run" ? " ●" : s === "wait" ? " ○" : ""}</span>`; }).join("")}`;
  if (i < 0) return `<div class="pipe-checks">${checks}</div><ol class="pipe">${NODES.map(([n, who]) => `<li class="ps ps-wait"><i></i>${n}<em>${who}</em></li>`).join("")}</ol>`;
  const from = cuts[i], to = cuts[i + 1] ?? Infinity;
  const win = w.ev.filter(e => e.t >= from - 1e-9 && e.t < to && e.node !== "Done");
  const nodes = [...NODES]; if (win.some(e => e.node === "Investigator")) nodes.splice(3, 0, ["Investigator", "code"]);
  let active = false;
  const li = nodes.map(([n, who]) => {
    const es = win.filter(e => e.node === n), done = es.length && es.every(e => e.t <= c);
    let s = done ? "ok" : es.length ? (active ? "wait" : (active = true, "run")) : (win.every(e => e.t <= c) ? "skip" : "wait");
    if (n === "You" && es.some(e => e.r.kind === "approval" && !e.r.approved && e.t <= c)) s = "x";
    const tip = es.filter(e => e.t <= c).map(e => e.text).join(" · ") || (s === "skip" ? "not needed at this check" : "pending");
    return `<li class="ps ps-${s}" data-tip="${esc(tip)}"><i></i>${n}<em>${who}</em></li>`;
  }).join("");
  const waiting = statusAt(w, c)[2] === "Needs you", next = cuts[i + 1];
  const tail = waiting ? `<b class="accent">⏸ waiting for your approval</b>` : w.stopT != null && c >= w.stopT ? `■ stopped at ${w.end.stop_h} h`
    : next ? `↻ next check ${next} h` : !w.end.stopped && c >= w.doneT ? (w.heldOut ? `→ no stop, imaged to ${H} h` : "→ keep imaging") : "";
  return `<div class="pipe-checks">${checks}<span class="pipe-next">${tail}</span></div><ol class="pipe">${li}</ol>`;
}
function callsChart(src) {
  const rows = src ? parseCSV(src) : [];
  if (!rows.length) return `<p>${NA}: eval/results/calls_by_check.csv</p>`;
  const n = +rows[0].n_series, W = 460, Ht = 210, L = 28, R = 10, T = 18, B = 34, bw = 24;
  const max = Math.max(...rows.map(r => +r.called)), y = v => T + (1 - v / max) * (Ht - T - B), slot = (W - L - R) / rows.length;
  const cols = rows.map((r, i) => {
    const cx = L + slot * (i + 0.5), called = +r.called, right = r.right === "" ? null : +r.right, wrong = right == null ? 0 : called - right;
    const lab = r.check_h === "none" ? "no call" : `${r.check_h} h`;
    const bar = (v0, v1, cls) => v1 > v0 ? `<path class="${cls}" d="M${cx - bw / 2},${y(v0)}V${y(v1) + (v1 === called ? 4 : 0)}${v1 === called ? `a4,4 0 0 1 4,-4H${cx + bw / 2 - 4}a4,4 0 0 1 4,4` : `H${cx + bw / 2}`}V${y(v0)}Z"/>` : "";
    const tip = r.check_h === "none" ? `${called} of ${n} series: no call, imaged to ${H} h` : `${called} of ${n} series called at ${lab}: ${right} right, ${wrong} wrong`;
    return `<g tabindex="0" data-tip="${esc(tip)}"><rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${Ht - T - B}" fill="transparent"/>
      ${right == null ? bar(0, called, "bar nocall") : bar(0, right, "bar right") + bar(right, called, "bar wrong")}
      <text class="val" x="${cx}" y="${y(called) - 6}" text-anchor="middle">${called}${wrong ? `<tspan class="warn"> · ${wrong} wrong</tspan>` : ""}</text>
      <text class="ax" x="${cx}" y="${Ht - B + 14}" text-anchor="middle">${lab}</text></g>`;
  }).join("");
  return `<div class="ov-key"><span><i class="k-right"></i>right call</span><span><i class="k-wrong"></i>wrong call</span><span><i class="k-none"></i>no call</span></div>
    <svg class="ov-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Calls by check: ${rows.map(r => `${r.check_h === "none" ? "no call" : r.check_h + " h"} ${r.called}`).join(", ")} of ${n} series">
      <line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${cols}
      <text class="ax" x="${(L + W - R) / 2}" y="${Ht - 4}" text-anchor="middle">check where the call was made (series)</text></svg>`;
}

async function renderOverview(pane, ctx, isDead) {
  const d = ctx.data;
  pane.innerHTML = `<p class="dim">Loading…</p>`;
  const [idx, schedSrc, ev, advSrc, callsSrc] = await Promise.all([
    d.runIndex().catch(() => ({ runs: [], base: "agent/runs/" })),
    maybe(d.text("eval/results/scheduler.csv")), maybe(d.json("web/ops/evidence.json")), maybe(d.text("agent/results/adversarial.csv")),
    maybe(d.text("eval/results/calls_by_check.csv")),
  ]);
  const runs = idx.runs || [];
  const logs = await Promise.all(runs.map(r => maybe(d.jsonl(idx.base + r.file))));
  if (isDead()) return;
  const W = runs.map((r, i) => (!r.branch && logs[i]) ? prep(r, logs[i]) : null).filter(Boolean);
  if (!W.length) { pane.innerHTML = `<p>${NA}: no recorded runs in ${esc(idx.base)}</p>`; return; }
  const all = W.flatMap(w => w.ev.map(e => ({ ...e, w }))).sort((a, b) => a.t - b.t);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const q = new URLSearchParams(location.search), qt = q.has("replay") ? Math.min(H, Math.max(0, +q.get("replay"))) : null;
  let c = qt ?? (reduce ? H : 0), playing = qt == null && !reduce, speed = Object.keys(SPEEDS)[0], hold = 0, emitted = 0;
  const want = q.get("wound") || "exp1_partII_C61_P1";
  let sel = Math.max(0, W.findIndex(w => w.run.wound_id === want));

  pane.innerHTML = `<div class="cr">
    <header class="cr-top">
      <div class="cr-clock"><span class="live">● Replay</span><b class="num" data-clock>T+00.0 h</b>
        <span class="st-seg"><button class="st-btn st-btn--icon" data-play aria-label="Play or pause (Space)"></button>
        ${Object.keys(SPEEDS).map(k => `<button class="st-btn" data-speed="${k}" aria-pressed="${k === speed}" data-tip="${SPEEDS[k]} h of assay per second">${k}</button>`).join("")}
        <button class="st-btn st-btn--icon" data-restart aria-label="Restart">⟲</button></span>
        <span class="st-chip st-chip--honesty">Recorded runs · replayed</span></div>
      ${kpis(schedSrc, ev)}
    </header>
    <aside class="cr-list" aria-label="Wound status"><h2>Wound status · ${W.length} recorded runs</h2><div data-list></div></aside>
    <section class="cr-hero"><p class="hero-line" data-hline></p><div class="hero-pipe" data-hpipe></div><div data-hchart></div>
      <div class="hero-foot"><div class="ov-legend"><i class="lg-obs"></i>observed <i class="lg-med"></i>forecast <i class="lg-band"></i>90% band <i class="lg-truth"></i>what happened</div>
        <span data-hverdict></span><button class="st-btn" data-open>Open in Assay ↗</button></div></section>
    <aside class="cr-stream" aria-label="Agent events">
      <div class="cr-needs"><b class="num" data-needs>0</b><span>Needs you</span></div>
      <ul class="cr-stats"><li><b data-freed>0.0 h</b> imaging saved<span class="dim" data-wrongstop></span></li><li><b data-traced>0</b> numbers traced · <span data-removed>0</span> removed</li>
        <li><b data-asked>0</b> approvals <span class="dim">(simulated reviewer)</span></li></ul>
      <h2>Agent event log</h2><ol class="stream" data-stream aria-live="off"></ol></aside>
    <section class="cr-a"><h2>Calls by check · held-out series</h2><p class="cap">Same policy as the agent · simulation on recorded data</p>${callsChart(callsSrc)}</section>
    <section class="cr-b"><h2>90% band coverage by test set</h2><p class="cap">NCA on WHAD · best statistical baseline on WHiM-BC</p>
      <div class="evidence ev-embed"><div class="ev-chart" data-c="rel"></div></div></section>
    <section class="cr-c">${audit(runs, logs, advSrc)}
      <details class="ov-details"><summary>Agent details · run log, scoreboard, attacks, Investigator</summary><div data-s="details"></div></details></section>
  </div>`;
  const $ = s => pane.querySelector(s);
  ensureEvidenceCss();
  if (ev?.reliability) responsive($('[data-c="rel"]'), reliabilityChart(ev.reliability.filter(r => r.label !== "Unseen condition, wider calibration")));
  const det = $(".ov-details");
  det.addEventListener("toggle", () => { if (det.open && !det.dataset.done) { det.dataset.done = 1; renderRuns(det.querySelector('[data-s="details"]'), ctx, isDead); } });
  $("[data-open]").addEventListener("click", () => { ctx.openItem = W[sel].run.run_id; document.querySelector('[data-mode="assay"]')?.click(); });
  const setPlay = p => { playing = p; $("[data-play]").textContent = p ? "⏸" : "▶"; $(".live").classList.toggle("on", p); };
  const restart = () => { c = 0; hold = 0; emitted = 0; $("[data-stream]").replaceChildren(); };
  $("[data-play]").addEventListener("click", () => setPlay(!playing));
  $("[data-restart]").addEventListener("click", () => { restart(); setPlay(true); });
  pane.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => { speed = b.dataset.speed; pane.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
  const onKey = e => { if (isDead()) return ctx.bus.removeEventListener("key", onKey); if (e.detail.action === "play") setPlay(!playing); };
  ctx.bus.addEventListener("key", onKey);
  setPlay(playing);

  const stream = $("[data-stream]");
  const draw = () => {
    $("[data-clock]").textContent = `T+${c.toFixed(1).padStart(4, "0")} h`;
    $("[data-list]").innerHTML = W.map((w, i) => { const [cls, ic, lab] = statusAt(w, c), fc = fcAt(w, c);
      return `<button class="cl-row ${i === sel ? "sel" : ""} ${lab === "Needs you" ? "need" : ""}" data-w="${i}">
        <span class="cl-name">${esc(condName(w))}<i>${esc(w.id)}</i></span>${spark(w, c)}
        <span class="cl-p num" data-tip="P(90% closed by ${H} h) at the latest check">${fc ? pct(fc.f.p_close_by_T) : "–"}</span>
        <span class="cl-st oc-${cls}">${ic} ${esc(lab)}</span>${c >= H ? `<span class="cl-v">${verdict(w)}</span>` : ""}</button>`; }).join("");
    const w = W[sel];
    $("[data-hline]").innerHTML = headline(w, c);
    $("[data-hverdict]").innerHTML = c >= H ? verdict(w) : "";
    $("[data-hchart]").innerHTML = heroChart(w, c); $("[data-hpipe]").innerHTML = pipeline(w, c);
    const stopped = W.filter(x => x.stopT != null && c >= x.stopT), wrong = stopped.filter(x => x.end.stop_kind === "unlikely" && x.closeT != null).length;
    const needs = W.filter(x => statusAt(x, c)[2] === "Needs you").length, crit = all.filter(e => e.r.kind === "critic" && e.t <= c);
    $("[data-needs]").textContent = needs; $("[data-needs]").parentElement.classList.toggle("on", needs > 0);
    $("[data-freed]").textContent = stopped.reduce((a, x) => a + H - x.end.stop_h, 0).toFixed(1) + " h";
    $("[data-wrongstop]").textContent = wrong ? ` · incl. ${wrong} wrong stop` : "";
    $("[data-traced]").textContent = crit.reduce((a, e) => a + e.r.traced, 0); $("[data-removed]").textContent = crit.reduce((a, e) => a + e.r.untraced, 0);
    $("[data-asked]").textContent = all.filter(e => e.r.kind === "approval" && e.t <= c).length;
    while (emitted < all.length && all[emitted].t <= c) {
      const e = all[emitted++], who = NODES.find(n => n[0] === e.node)?.[1] ?? "";
      stream.insertAdjacentHTML("afterbegin", `<li class="${e.node === "You" ? "you" : ""}"><span class="num">T+${e.t.toFixed(1)}</span><b>${esc(condName(e.w))} <i>${esc(e.w.id)}</i></b><span></span><span><em>${esc(e.node)}${who && who !== "code" ? " · " + esc(who) : ""}</em> ${esc(e.text)}</span></li>`);
      while (stream.children.length > 14) stream.lastElementChild.remove();
    }
  };
  $("[data-list]").addEventListener("click", e => { const b = e.target.closest("[data-w]"); if (b) { sel = +b.dataset.w; draw(); } });
  let lastDraw = 0, prev = performance.now();
  const tick = now => {
    if (isDead()) return;
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (playing) { if (c < H) c = Math.min(H, c + dt * SPEEDS[speed]); else if ((hold += dt) > 6) restart(); }
    if (now - lastDraw > 66) { lastDraw = now; draw(); }
    requestAnimationFrame(tick);
  };
  draw(); requestAnimationFrame(tick);
}

function kpis(schedSrc, ev) {
  const rows = schedSrc ? parseCSV(schedSrc) : [];
  const shipped = ev?.shipped || "nca_realft3";
  const s = rows.find(r => r.model === shipped && r.thresholds.startsWith("<= 0.1"));
  const rel = ev?.reliability?.[0];
  const tile = (big, label, tip) => `<div class="kpi" tabindex="0" data-tip="${esc(tip)}"><b class="num">${big}</b><span>${label}</span></div>`;
  if (!s) return `<div class="cr-kpis">${NA}: eval/results/scheduler.csv (${esc(shipped)})</div>`;
  return `<div class="cr-kpis"><span class="kpi-src">Held-out evaluation · simulation<br>${s.n} series · ${rel?.n_wounds ?? "–"} wounds · NCA</span>
    ${tile(pct(+s.share_called), "Early-call rate", `Series with a call (P(90% closed by ${H} h) ≤ 0.1 or ≥ 0.9) at any check up to 9.5 h: ${s.called_early} of ${s.n}. Source: eval/results/scheduler.csv`)}
    ${tile(pct(+s.accuracy_of_calls), `Call accuracy · baseline ${pct(+s.base_rate_not_closed)}`, `${s.called_early - s.wrong_calls} of ${s.called_early} calls right; ${s.wrong_calls} wounds called "won't close" did close. Baseline: always "won't close", right for ${pct(+s.base_rate_not_closed)} of all series.`)}
    ${tile((+s.hours_saved_mean).toFixed(1) + " h", "Imaging saved / series", `Mean over all ${s.n} series of ${H} h minus the stop time (0 when no call). Simulation on recorded data. Source: eval/results/scheduler.csv`)}
    ${rel ? tile(pct(rel.coverage), "90% band coverage", `Share of later frames inside the 90% band, ${rel.model_label}, forecast at ${rel.cut} h. 95% CI ${pct(rel.cov_lo)}–${pct(rel.cov_hi)}. Source: web/ops/evidence.json`) : ""}
  </div>`;
}

function audit(runs, logs, advSrc) {
  const ends = logs.filter((l, i) => l && !runs[i].branch).map(l => l.find(x => x.kind === "run_end")).filter(Boolean);
  const tr = ends.reduce((a, e) => a + (e.numbers_traced || 0), 0), un = ends.reduce((a, e) => a + (e.numbers_untraced || 0), 0);
  const adv = advSrc ? parseCSV(advSrc) : [];
  const met = adv.filter(r => r.met === "met").length;
  const costs = logs.filter((l, i) => l && !runs[i].branch).map(l => l.reduce((a, x) => a + (typeof x.cost_usd === "number" ? x.cost_usd : 0), 0));
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const b = (ok, txt, tip) => `<span class="ab ${ok ? "" : "warn"}" tabindex="0" data-tip="${esc(tip)}">${ok ? "✓" : "▲"} ${txt}</span>`;
  return `<div class="ov-audit">
    ${ends.length ? b(un === 0, `${tr}/${tr + un} numbers traced · recorded runs`, "Every number the agent wrote matched a tool output; the code Critic removes any that don't") : ""}
    ${adv.length ? b(met === adv.length, `${met}/${adv.length} attacks handled (stub models)`, "Adversarial set run with stub models: prompt injection, bad frames, oversized uploads, out-of-scope requests") : ""}
    ${avg != null ? `<span class="ab" tabindex="0" data-tip="Mean model cost per recorded run">$${avg.toFixed(2)} per run</span>` : ""}
    <span class="ab dim" tabindex="0" data-tip="Stops always wait for a person; code sets the allowed decisions">Stops need your approval</span>
  </div>`;
}

async function loadEvidence(slot) {
  const url = new URL("./evidence.js", import.meta.url).href;
  let exists = false;
  try { exists = (await fetch(url, { method: "HEAD" })).ok; } catch { /* treat as missing */ }
  if (!exists) { slot.innerHTML = `<div class="ops-placeholder">Forecast evidence page (P1) not available yet</div>`; return; }
  try {
    const m = await import(url);
    slot.replaceChildren();
    await m.renderEvidence(slot);
  } catch (e) {
    console.error(e);
    slot.innerHTML = `<div class="error">Forecast evidence page failed to load: ${esc(e.message)}</div>`;
  }
}

async function renderRuns(pane, ctx, isDead) {
  const d = ctx.data;
  pane.innerHTML = `<div class="ops-cols">
    <div class="ops-col">
      <section class="ops-box" data-s="list"><div class="st-kicker">Run log · click a row to open its steps</div><p class="dim">Loading…</p></section>
      <section class="ops-box" data-s="detail"><div class="st-kicker">Run detail (selected run) · step trace</div><p class="dim">Select a run above.</p></section>
      <section class="ops-box" data-s="adv"><div class="st-kicker">Adversarial test set · expected outcome met or missed</div><p class="dim">Loading…</p></section>
    </div>
    <div class="ops-col">
      <section class="ops-box" data-s="score"><div class="st-kicker">Agent scoreboard · held-out replay · simulation on recorded data</div><p class="dim">Loading…</p></section>
      <section class="ops-box" data-s="inv"><div class="st-kicker">Investigator · hypothesis accuracy (synthetic known-cause wounds)</div><p class="dim">Loading…</p></section>
    </div>
  </div>`;
  const box = k => pane.querySelector(`[data-s="${k}"]`);
  const setBody = (k, html) => { const b = box(k); b.replaceChildren(b.firstElementChild); b.insertAdjacentHTML("beforeend", html); return b; };

  // results files (independent of runs)
  Promise.all([maybe(d.text("agent/results/scoreboard.csv")), maybe(d.text("agent/results/scoreboard.md"))])
    .then(([c, m]) => { if (!isDead()) renderScoreboard(box("score"), setBody, c, m); });
  maybe(d.text("agent/results/adversarial.csv")).then(c => { if (!isDead()) renderAdversarial(setBody, c); });
  Promise.all([maybe(d.text("agent/results/investigator.md")), maybe(d.text("agent/results/investigator.csv"))])
    .then(([m, c]) => { if (!isDead()) renderInvestigator(setBody, m, c); });

  // runs
  let idx;
  try { idx = await d.runIndex(); } catch { idx = { runs: [], base: "agent/runs/" }; }
  if (isDead()) return;
  const runs = idx.runs || [];
  if (!runs.length) { setBody("list", `<p>${NA}: no run index at agent/runs/index.json or agent/runs/practice/index.json.</p>`); return; }
  const logs = await Promise.all(runs.map(r => maybe(d.jsonl(idx.base + r.file))));
  if (isDead()) return;
  const practice = idx.base.includes("practice");
  let filter = "all", selected = null;

  const rowsHtml = () => runs.map((r, i) => ({ r, i })).filter(({ r }) =>
    filter === "all" || (filter === "upload" ? r.kind !== "whad_loo" : r.kind === "whad_loo")).map(({ r, i }) => {
    const recs = logs[i]; const t = recs ? runTotals(recs) : null; const e = t?.end;
    const traced = e ? `${e.numbers_traced}/${e.numbers_traced + e.numbers_untraced}` : "–";
    return `<tr class="click${i === selected ? " sel" : ""}" data-i="${i}">
      <td>${esc(r.run_id)}${r.branch ? ` <span class="dim">(branch)</span>` : ""}</td><td>${esc(r.wound_id)}</td>
      <td class="n">${e ? show(e.ended_at_h) + " h" : "–"}</td><td>${e ? show(e.decision_label ?? e.decision ?? e.reason) : (recs ? "–" : NA)}</td>
      <td>${show(t?.human)}</td><td class="n">${traced}</td><td class="n">${show(e?.steps)}</td>
      <td class="n">${fmtTok(e?.tokens?.total)}</td><td class="n">${fmtUsd(t?.cost)}</td><td class="n">${show(r.plate_hours_saved)}</td></tr>`;
  }).join("");

  const list = setBody("list", `
    <div class="ops-bar" style="margin-bottom:8px"><span class="st-kicker">Agent runs</span>
      <span class="st-seg">${[["all", "All runs"], ["upload", "Uploads"], ["replay", "Replay (held-out)"]].map(([k, l]) =>
        `<button class="st-btn" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join("")}</span>
      ${practice ? `<span class="st-chip st-chip--honesty">practice runs · ${esc(idx.base)}</span>` : `<span class="st-chip st-chip--honesty">recorded runs · ${esc(idx.base)}</span>`}</div>
    <table class="st-table"><thead><tr><th>run_id</th><th>wound</th><th class="n">ended</th><th>decision</th><th>human</th>
      <th class="n">traced</th><th class="n">steps</th><th class="n">tokens</th><th class="n">cost</th><th class="n">plate-h saved</th></tr></thead>
      <tbody></tbody></table>`);
  const tbody = list.querySelector("tbody");
  const redraw = () => { tbody.innerHTML = rowsHtml(); };
  redraw();
  list.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.f; list.querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-pressed", x === b)); redraw();
  }));
  tbody.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-i]"); if (!tr) return;
    selected = +tr.dataset.i; redraw(); renderDetail(setBody, runs[selected], logs[selected], idx.base);
  });
  selected = 0; redraw(); renderDetail(setBody, runs[0], logs[0], idx.base);
}

function renderDetail(setBody, run, recs, base) {
  if (!recs) { setBody("detail", `<p>${NA}: could not read ${esc(base + run.file)}.</p>`); return; }
  const { end, report, human, cost } = runTotals(recs);
  const row = (k, v) => `<div class="st-row"><span>${k}</span><span>${v}</span></div>`;
  const headline = report?.headline ?? run.headline;
  const b = setBody("detail", `
    <div class="ops-bar"><b>${esc(run.run_id)}</b><span class="dim">${esc(run.kind)} · ${esc(base + run.file)}</span></div>
    ${headline ? `<p class="ops-headline">${esc(headline)}</p>` : `<p>Report headline ${NA}</p>`}
    ${report?.summary ? `<p class="ops-summary">${esc(report.summary)}</p>` : ""}
    ${report?.next_step ? `<p class="ops-summary"><b>Next step:</b> ${esc(report.next_step)}</p>` : ""}
    <div class="ops-totals">${end ? [
      row("steps", show(end.steps)),
      row("tokens", show(end.tokens?.total)),
      row("cost (USD)", cost === null ? "–" : cost.toFixed(4)),
      row("numbers traced", show(end.numbers_traced)),
      row("numbers untraced", show(end.numbers_untraced)),
      row("stop kind", show(end.stop_kind ?? "no stop")),
      row("stop at", end.stop_h === null || end.stop_h === undefined ? "–" : end.stop_h + " h"),
      row("plate-hours saved", show(end.plate_hours_saved)),
      row("human", show(human)),
    ].join("") : `<p>Run totals ${NA} (no run_end record).</p>`}</div>
    ${report?.caveats?.length ? `<ul class="ops-summary">${report.caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <div class="st-kicker" style="margin-top:12px">Step trace · click a row for the full record</div>
    <table class="st-table"><thead><tr><th class="n">seq</th><th>kind</th><th class="n">step</th><th>helper / tool</th><th>decision or result</th>
      <th>time</th><th class="n">tokens</th><th class="n">cost</th></tr></thead>
      <tbody>${recs.map((r, i) => `<tr class="click" data-r="${i}"><td class="n">${show(r.seq)}</td><td>${esc(r.kind)}</td><td class="n">${show(r.step)}</td>
        <td>${esc(recHelper(r))}</td><td>${recSummary(r)}</td>
        <td>${clock(r.ts)}${typeof r.elapsed_s === "number" ? ` <span class="dim">${r.elapsed_s}s</span>` : ""}</td>
        <td class="n">${fmtTok(recTokens(r))}</td><td class="n">${typeof r.cost_usd === "number" ? fmtUsd(r.cost_usd) : "–"}</td></tr>`).join("")}</tbody></table>`);
  b.querySelector("tbody").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-r]"); if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("json")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    tr.insertAdjacentHTML("afterend", `<tr class="json"><td colspan="8"><pre>${esc(JSON.stringify(recs[+tr.dataset.r], null, 2))}</pre></td></tr>`);
  });
}

function renderScoreboard(b, setBody, csvSrc, mdSrc) {
  if (!csvSrc && !mdSrc) { setBody("score", `<p>${NA}: agent/results/scoreboard.csv and scoreboard.md are missing.</p>`); return; }
  const rows = csvSrc ? parseCSV(csvSrc) : [];
  const rates = [...new Set(rows.map(r => r.cost_rate_plate_hour))];
  let rate = rates.includes("5") ? "5" : rates[0];
  const cols = [["label", "Policy"], ["n_wounds", "Wounds"], ["plate_hours_saved", "Plate-hours saved"], ["wrong_stall_stop", "Wrong stall stop"],
    ["wrong_closure_call", "Wrong closure call"], ["missed_stall", "Missed stall"], ["missed_non_closer", "Missed non-closer"],
    ["frames_used", "Frames used"], ["pct_numbers_traced", "% numbers traced"], ["cost_per_run", "Cost per run"],
    ["model_tokens_per_run", "Model tokens per run"], ["model_cost_usd_per_run", "Model cost per run (USD)"]];
  const sec = mdSrc ? mdSections(mdSrc) : {};
  // Bold notes ("agent rows use the replay model", "Real model row: a small sample") stay visible.
  const notes = mdSrc ? mdSrc.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.startsWith("**") && !/^\*\*\d+ of \d+/.test(p)) : [];
  const assumptions = Object.entries(sec).find(([k]) => /^assumptions/i.test(k));
  const table = () => rows.length ? `<table class="st-table"><tr>${cols.map(([, h], i) => `<th${i ? ' class="n"' : ""}>${h}</th>`).join("")}</tr>
    ${rows.filter(r => r.cost_rate_plate_hour === rate).map(r => `<tr>${cols.map(([k], i) =>
      `<td${i ? ' class="n"' : ""}>${r[k] === "" ? '<span class="dim">n/a</span>' : esc(r[k])}</td>`).join("")}</tr>`).join("")}</table>`
    : `<p>Table ${NA}: agent/results/scoreboard.csv is missing.</p>`;
  const body = setBody("score", `
    ${rates.length > 1 ? `<div class="ops-bar" style="margin-bottom:8px"><span class="st-kicker">Cost of 1 plate-hour (1 image = 1)</span>
      <span class="st-seg">${rates.map(x => `<button class="st-btn" data-rate="${esc(x)}" aria-pressed="${x === rate}">${esc(x)}</button>`).join("")}</span></div>` : ""}
    <div data-t>${table()}</div>
    ${notes.length ? md(notes.join("\n\n")) : (mdSrc ? "" : `<p>Notes ${NA}: agent/results/scoreboard.md is missing.</p>`)}
    ${assumptions ? `<div class="st-kicker" style="margin-top:8px">Assumptions</div>${md(assumptions[1])}` : (mdSrc ? `<p>Assumptions ${NA}</p>` : "")}
    ${mdSrc ? `<details><summary>Full scoreboard notes (scoreboard.md)</summary>${md(mdSrc)}</details>` : ""}`);
  body.querySelectorAll("[data-rate]").forEach(btn => btn.addEventListener("click", () => {
    rate = btn.dataset.rate; body.querySelectorAll("[data-rate]").forEach(x => x.setAttribute("aria-pressed", x === btn));
    body.querySelector("[data-t]").innerHTML = table();
  }));
}

function renderAdversarial(setBody, csvSrc) {
  if (!csvSrc) { setBody("adv", `<p>${NA}: agent/results/adversarial.csv is missing.</p>`); return; }
  const rows = parseCSV(csvSrc);
  const groups = new Map();
  for (const r of rows) {
    const g = r["attack type"].replace(/\s*\(.*$/, "");     // "prompt injection (protocol text)" -> "prompt injection"
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r);
  }
  const met = rows.filter(r => r.met === "met").length;
  const b = setBody("adv", `<p><b>${met} of ${rows.length}</b> expected outcomes met.</p>
    <table class="st-table"><thead><tr><th>Attack type</th><th class="n">Cases</th><th>Result</th></tr></thead><tbody>
    ${[...groups].map(([g, rs], i) => {
      const m = rs.filter(r => r.met === "met").length;
      return `<tr class="click" data-g="${i}"><td>${esc(g)}</td><td class="n">${rs.length}</td>
        <td class="${m === rs.length ? "" : "warn"}">${m} / ${rs.length} met${m < rs.length ? ` · ${rs.length - m} missed` : ""}</td></tr>`;
    }).join("")}</tbody></table><p class="st-caption">Click an attack type for its cases (expected vs observed).</p>`);
  const list = [...groups.values()];
  b.querySelector("tbody").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-g]"); if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("json")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    tr.insertAdjacentHTML("afterend", `<tr class="json"><td colspan="3"><table class="st-table">
      <tr><th>Case</th><th>Expected</th><th>Observed</th><th>Met</th></tr>
      ${list[+tr.dataset.g].map(r => `<tr><td>${esc(r.case)}<div class="dim">${esc(r["attack type"])}</div></td><td>${esc(r.expected)}</td>
        <td class="dim">${esc(r.observed)}</td><td class="${r.met === "met" ? "" : "warn"}">${esc(r.met)}</td></tr>`).join("")}</table></td></tr>`);
  });
}

function renderInvestigator(setBody, mdSrc, csvSrc) {
  if (mdSrc) { setBody("inv", md(mdSrc.replace(/^#\s.*\n/, ""))); return; }
  if (!csvSrc) { setBody("inv", `<p>${NA}: agent/results/investigator.md and investigator.csv are missing.</p>`); return; }
  const rows = parseCSV(csvSrc);
  setBody("inv", `<table class="st-table"><tr><th>Wound</th><th>True cause</th><th class="n">Check (h)</th><th>Top hypothesis</th><th class="n">True rank</th></tr>
    ${rows.map(r => `<tr><td>${esc(r.wound_id)}</td><td>${esc(r.true_cause)}</td><td class="n">${esc(r.check_h)}</td><td>${esc(r.top)}</td><td class="n">${esc(r.true_rank)}</td></tr>`).join("")}</table>
    <p class="st-caption">Hypotheses, not causes. Simulated wounds.</p>`);
}
