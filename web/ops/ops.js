// Ops mode: "Agent runs" (recorded run logs, scoreboard, adversarial set, investigator accuracy) and
// "Forecast evidence" (slot for web/ops/evidence.js, built separately). Every number shown is read from a
// file under agent/; a missing file shows "not available". Nothing is invented here.

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
      <button class="st-btn" data-tab="runs" aria-pressed="true">Agent runs</button>
    </div>
    <div data-pane="runs"></div>
    <div data-pane="evidence" hidden></div>
  </div>`;
  const root = el.querySelector(".ops");
  const panes = { runs: root.querySelector('[data-pane="runs"]'), evidence: root.querySelector('[data-pane="evidence"]') };
  let evidenceLoaded = false;
  root.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.tab;
    root.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-pressed", x === b));
    Object.entries(panes).forEach(([k, p]) => p.hidden = k !== t);
    if (t === "evidence" && !evidenceLoaded) { evidenceLoaded = true; loadEvidence(panes.evidence); }
  }));

  renderRuns(panes.runs, ctx, () => dead);
  return () => { dead = true; css.remove(); el.replaceChildren(); };
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
