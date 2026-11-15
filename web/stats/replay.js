// Stats: live replay of the held-out test, plus a series inspector. Replay: one unseen series at a time, the shipped NCA's
// 90% band from the chosen check is drawn, then the real frames after the check are revealed against it; the running
// tallies end exactly on the published numbers (mean of per-series coverage = web/ops/evidence.json). Inspector: every
// series in a list (test order or worst first); click one (or ←/→) to pause and look at it in full. Data: the raw
// forecast files eval/forecasts/whad/loo_all/nca_realft3_<check>h.json. Nothing is invented; the replay is labelled.

const H = 19, CHECKS = [1.9, 3.8, 5.7, 9.5];
const SPEEDS = { "1×": 1, "4×": 4, "12×": 12 };            // series per ~1.6 s at 1×
const T_BAND = 0.25, T_REVEAL = 1.0, T_HOLD = 0.35;        // seconds per series at 1×
const COND = { CC: "Control", C61: "CYR61 knockdown" };   // NC and N61 are not defined in the docs: shown as their codes
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortId = id => id.replace(/^exp(\d)_part(I+)_/, "E$1·$2·").replace(/_/g, "·");
const condOf = id => { const k = (id.match(/_(CC|C61|NC|N61)_/) || [])[1]; return k ? COND[k] ?? `Condition ${k}` : ""; };
const hrs = t => t?.median == null ? `> ${H} h` : `${t.median.toFixed(1)} h`;

function series(doc, cut) {
  return doc.forecasts.map(f => {
    const ob = new Map(f.observed.t_hours.map((t, k) => [t, f.observed.area[k]]));
    const after = f.t_hours.map((t, k) => [t, f.area_q05[k], f.area_q95[k], ob.get(t)]).filter(([t, , , y]) => t > cut && y != null);
    const inside = after.map(([, lo, hi, y]) => y >= lo && y <= hi), ins = inside.filter(Boolean).length;
    return { id: f.wound_id, f, cut, obs: f.observed.t_hours.map((t, k) => [t, f.observed.area[k]]), after, inside, ins, n: inside.length, cov: ins / inside.length };
  }).filter(s => s.n);
}

function chart(s, phase, shown) {
  const W = 760, Ht = 260, L = 40, R = 16, T = 12, B = 26;
  const f = s.f, aMax = Math.max(1, ...s.obs.map(p => p[1]), ...f.area_q95) * 1.02;   // a wound that grows: closure below 0%
  const x = t => L + (t / H) * (W - L - R), y = a => T + (a / aMax) * (Ht - T - B);       // closure rises: area 1 (0% closed) low
  const path = pts => pts.map(([t, a], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(a).toFixed(1)}`).join("");
  const seen = s.obs.filter(([t]) => t <= s.cut + 1e-6), at = seen.at(-1);
  let g = "";
  if (phase > 0) {
    const band = [at, ...f.t_hours.map((t, k) => [t, f.area_q95[k]]), ...f.t_hours.map((t, k) => [t, f.area_q05[k]]).reverse()];
    g += `<path class="band" d="${path(band)}Z"/><path class="med" d="${path([at, ...f.t_hours.map((t, k) => [t, f.area_q50[k]])])}"/>`;
  }
  g += `<line class="cut" x1="${x(s.cut)}" x2="${x(s.cut)}" y1="${T}" y2="${Ht - B}"/><text class="ax" x="${x(s.cut) + 4}" y="${T + 9}">forecast made at ${s.cut} h</text>`;
  g += `<path class="obs" d="${path(seen)}"/>${seen.map(([t, a]) => `<circle class="fr" cx="${x(t)}" cy="${y(a)}" r="2.5" data-tip="${t} h · ${pct(1 - a)} closed · before the forecast"/>`).join("")}`;
  const rev = s.after.slice(0, shown);
  if (rev.length) g += `<path class="truth" d="${path([at, ...rev.map(([t, , , a]) => [t, a])])}"/>`;
  g += rev.map(([t, lo, hi, a], k) => `<circle class="${s.inside[k] ? "pin" : "pout"}" cx="${x(t)}" cy="${y(a)}" r="${s.inside[k] ? 3.5 : 4.5}" tabindex="0"
    data-tip="${t} h · ${pct(1 - a)} closed · band ${pct(1 - hi)}–${pct(1 - lo)} · ${s.inside[k] ? "inside" : "outside"}"/>`).join("");
  const ticks = [0, 0.5, 1, ...(aMax > 1.05 ? [aMax / 1.02] : [])];
  return `<svg class="hero-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(shortId(s.id))}: forecast from ${s.cut} h, ${rev.length} later frames revealed">
    ${ticks.map(a => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}"/><text class="ax" x="${L - 6}" y="${y(a) + 3}" text-anchor="end">${pct(1 - a)}</text>`).join("")}
    <line class="grid g90" x1="${L}" x2="${W - R}" y1="${y(0.1)}" y2="${y(0.1)}"/><text class="ax" x="${W - R}" y="${y(0.1) - 3}" text-anchor="end">90% closed</text>
    <line class="axis" x1="${L}" x2="${W - R}" y1="${Ht - B}" y2="${Ht - B}"/>
    ${[0, ...CHECKS, H].map(k => `<text class="ax" x="${x(k)}" y="${Ht - 8}" text-anchor="middle">${k}${k === H ? " h" : ""}</text>`).join("")}
    ${g}</svg>`;
}

// Running coverage (mean of per-series coverage) as series complete, converging on the published figure.
function converge(hist, n) {
  const W = 360, Ht = 110, L = 30, R = 8, T = 8, B = 18, lo = 0.6;
  const x = i => L + (i / Math.max(1, n - 1)) * (W - L - R), y = v => T + (1 - (Math.max(lo, v) - lo) / (1 - lo)) * (Ht - T - B);
  const d = hist.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return `<svg class="ov-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Running 90% band coverage over ${hist.length} of ${n} series">
    ${[0.6, 0.8, 1].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${pct(v)}</text>`).join("")}
    <line class="target" x1="${L}" x2="${W - R}" y1="${y(0.9)}" y2="${y(0.9)}"/><text class="ax" x="${W - R}" y="${y(0.9) - 3}" text-anchor="end">target 90%</text>
    ${hist.length ? `<path class="ln hi" d="${d}"/><circle class="pt hi" cx="${x(hist.length - 1)}" cy="${y(hist.at(-1))}" r="4"/>` : ""}
    <text class="ax" x="${(L + W - R) / 2}" y="${Ht - 3}" text-anchor="middle">series tested</text></svg>`;
}

function wireTips(host) {
  const tip = Object.assign(document.createElement("div"), { className: "ops-tip", hidden: true });
  host.style.position = "relative"; host.appendChild(tip);
  const place = (el, cx, cy) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = host.getBoundingClientRect();
    tip.style.left = Math.min(cx - r.left + 12, r.width - tip.offsetWidth - 8) + "px"; tip.style.top = (cy - r.top + 14) + "px";
  };
  host.addEventListener("pointermove", e => { const t = e.target.closest?.("[data-tip]"); if (t && host.contains(t)) place(t, e.clientX, e.clientY); else tip.hidden = true; });
  host.addEventListener("pointerleave", () => { tip.hidden = true; });
  host.addEventListener("focusin", e => { const t = e.target.closest?.("[data-tip]"); if (!t) return; const b = t.getBoundingClientRect(); place(t, b.left + b.width / 2, b.bottom); });
  host.addEventListener("focusout", () => { tip.hidden = true; });
}

export async function mountReplay(host, { root, ctx }) {
  const q = new URLSearchParams(location.search);
  let cut = CHECKS.includes(+q.get("check")) ? +q.get("check") : 3.8, speed = "4×", sort = "order";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !q.has("test") && !q.has("series") && !reduce, dead = false, inspect = null;   // inspect = wound id shown in full
  const cache = {};
  const load = async c => cache[c] ??= series(await (await fetch(`${root}eval/forecasts/whad/loo_all/nca_realft3_${c}h.json`)).json(), c);
  const runs = await fetch(`${root}agent/runs/index.json`).then(r => r.ok ? r.json() : { runs: [] }, () => ({ runs: [] }));
  const runOf = new Map((runs.runs || []).filter(r => !r.branch && r.kind === "whad_loo").map(r => [r.wound_id, r.run_id]));

  host.innerHTML = `<section class="cr st-test">
    <header class="cr-top">
      <div class="cr-clock"><span class="live">● Replay</span><b class="num" data-n>0 / 0</b>
        <span class="st-seg"><button class="st-btn st-btn--icon" data-play aria-label="Play or pause (Space)"></button>
        ${Object.keys(SPEEDS).map(k => `<button class="st-btn" data-speed="${k}" aria-pressed="${k === speed}">${k}</button>`).join("")}
        <button class="st-btn st-btn--icon" data-restart aria-label="Restart">⟲</button></span>
        <span class="st-seg" aria-label="Forecast made at">${CHECKS.map(c => `<button class="st-btn" data-cut="${c}" aria-pressed="${c === cut}">${c} h</button>`).join("")}</span>
        <span class="st-chip st-chip--honesty">Replay of the held-out test · recorded data</span></div>
      <div class="cr-kpis"><span class="kpi-src">Held-out test · Stitch NCA<br>forecast at <b data-cutlab>${cut}</b> h</span>
        <div class="kpi"><b class="num" data-cov>–</b><span>90% band coverage</span></div>
        <div class="kpi"><b class="num" data-pool>–</b><span>Frames inside band</span></div>
        <div class="kpi"><b class="num" data-full>–</b><span>Series fully inside</span></div></div>
    </header>
    <div class="st-hero"><p class="hero-line" data-line></p><div data-chart></div>
      <div class="st-foot"><div class="ov-legend"><i class="lg-obs"></i>frames before the forecast <i class="lg-med"></i>forecast <i class="lg-band"></i>90% band <i class="lg-in"></i>later frame inside <i class="lg-out"></i>outside</div>
        <span class="st-nav" data-nav hidden><button class="st-btn st-btn--icon" data-prev aria-label="Previous series (←)">◀</button><button class="st-btn st-btn--icon" data-next aria-label="Next series (→)">▶</button>
          <button class="st-btn" data-assay hidden>Open in Assay ↗</button><button class="st-btn" data-back>Back to replay</button></span></div></div>
    <aside class="st-side"><h2>Running coverage</h2><div data-conv></div>
      <div class="st-listhead"><h2>Series · <span data-count>0</span></h2><span class="st-seg"><button class="st-btn" data-sort="order" aria-pressed="true">Test order</button><button class="st-btn" data-sort="worst" aria-pressed="false">Worst first</button></span></div>
      <ol class="st-list" data-list></ol></aside>
  </section>`;
  const $ = s => host.querySelector(s);
  wireTips(host.querySelector(".st-test"));
  let S = [], i = 0, tt = 0, hist = [], pin = 0, ptot = 0, full = 0;
  const finish = () => {
    const s = S[i];
    hist.push(((hist.at(-1) ?? 0) * hist.length + s.cov) / (hist.length + 1));
    pin += s.ins; ptot += s.n; if (s.ins === s.n) full++;
    i++;
  };
  const reset = async () => {
    S = await load(cut); if (dead) return;
    i = 0; tt = 0; hist = []; pin = 0; ptot = 0; full = 0;
    if (q.has("test")) { const k = Math.min(S.length, Math.max(1, +q.get("test"))); while (i < k - 1) finish(); if (k === S.length) finish(); else tt = T_BAND + T_REVEAL; }
    if (reduce && !q.has("test")) while (i < S.length) finish();
  };
  const tested = s => S.indexOf(s) < i;
  const listRows = () => {
    const rows = sort === "worst" ? [...S].sort((a, b) => a.cov - b.cov || a.n - b.n) : S;
    const reveal = sort === "worst" || i >= S.length;
    return rows.map(s => {
      const k = S.indexOf(s), known = reveal || tested(s) || s.id === inspect, cur = inspect ? s.id === inspect : (k === i && i < S.length);
      return `<li><button class="sr-row ${cur ? "sel" : ""} ${known && s.ins < s.n ? "miss" : ""} ${known ? "" : "pending"}" data-id="${esc(s.id)}">
        <span class="num">${k + 1}</span><b>${esc(condOf(s.id))} <i>${esc(shortId(s.id))}</i></b>
        <span class="st-cov">${known ? `<i style="width:${(s.cov * 100).toFixed(0)}%"></i>` : ""}</span><span class="num">${known ? `${s.ins}/${s.n}` : "–"}</span></button></li>`;
    }).join("");
  };
  let listKey = "";
  const draw = () => {
    if (!S.length) return;
    const ins = inspect ? S.find(s => s.id === inspect) : null;
    const s = ins ?? S[Math.min(i, S.length - 1)], done = i >= S.length;
    const phase = ins || done ? 2 : tt < T_BAND ? 0 : 1;
    const shown = ins || done ? s.n : Math.max(0, Math.min(s.n, Math.floor(((tt - T_BAND) / T_REVEAL) * s.n) + (tt >= T_BAND ? 1 : 0)));
    const inNow = s.inside.slice(0, shown).filter(Boolean).length;
    $("[data-n]").textContent = ins ? `#${S.indexOf(s) + 1}` : `${Math.min(i + (done ? 0 : 1), S.length)} / ${S.length}`;
    $(".live").textContent = ins ? "Inspecting" : done ? "Test complete" : "● Replay";
    $("[data-line]").innerHTML = `<b>${esc(condOf(s.id))}</b> · <span class="dim">${esc(shortId(s.id))}</span> · forecast at ${s.cut} h · `
      + (ins ? `${pct(s.f.p_close_by_T)} chance of 90% closure by ${H} h · 50% closed ${hrs(s.f.t50)} · 90% closed ${hrs(s.f.t90)} · <b>${s.ins} of ${s.n}</b> later frames inside`
        : shown ? `<b>${inNow} of ${shown}</b> later frames inside the 90% band` : "band drawn, frames to come");
    $("[data-chart]").innerHTML = chart(s, phase, shown);
    $("[data-nav]").hidden = !ins;
    const run = ins && runOf.get(s.id); $("[data-assay]").hidden = !run; if (run) $("[data-assay]").dataset.run = run;
    $("[data-cov]").textContent = hist.length ? pct(hist.at(-1), 1) : "–";
    $("[data-pool]").textContent = ptot ? `${pin} / ${ptot}` : "–";
    $("[data-full]").textContent = hist.length ? `${full} / ${hist.length}` : "–";
    $("[data-conv]").innerHTML = converge(hist, S.length);
    $("[data-count]").textContent = S.length;
    const key = `${sort}|${i}|${inspect}|${cut}`;
    if (key !== listKey) { listKey = key; $("[data-list]").innerHTML = listRows(); $("[data-list] .sel")?.scrollIntoView({ block: "nearest" }); }
  };
  const setPlay = p => { playing = p; $("[data-play]").textContent = p ? "⏸" : "▶"; $(".live").classList.toggle("on", p); };
  const show = id => { inspect = id; setPlay(false); draw(); };
  const step = d => {
    const rows = sort === "worst" ? [...S].sort((a, b) => a.cov - b.cov || a.n - b.n) : S;
    const k = inspect ? rows.findIndex(s => s.id === inspect) : Math.min(i, S.length - 1);
    show(rows[(k + d + rows.length) % rows.length].id);
  };
  const resume = () => { inspect = null; if (i >= S.length) reset().then(draw); setPlay(true); draw(); };
  $("[data-play]").addEventListener("click", () => { if (inspect) return resume(); if (!playing && i >= S.length) reset().then(draw); setPlay(!playing); });
  $("[data-restart]").addEventListener("click", async () => { inspect = null; await reset(); setPlay(true); draw(); });
  $("[data-list]").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) show(b.dataset.id); });
  $("[data-prev]").addEventListener("click", () => step(-1));
  $("[data-next]").addEventListener("click", () => step(1));
  $("[data-back]").addEventListener("click", resume);
  $("[data-assay]").addEventListener("click", e => { if (!ctx) return; ctx.openItem = e.currentTarget.dataset.run; document.querySelector('[data-mode="assay"]')?.click(); });
  host.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => { sort = b.dataset.sort; host.querySelectorAll("[data-sort]").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); }));
  host.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => { speed = b.dataset.speed; host.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
  host.querySelectorAll("[data-cut]").forEach(b => b.addEventListener("click", async () => {
    cut = +b.dataset.cut; host.querySelectorAll("[data-cut]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("[data-cutlab]").textContent = cut;
    await reset(); if (inspect && !S.some(s => s.id === inspect)) inspect = null; draw();   // an inspected series stays: see its band at another check
  }));
  const onKey = e => {
    if (dead) return ctx.bus.removeEventListener("key", onKey);
    const a = e.detail.action;
    if (a === "step-back") step(-1); else if (a === "step-forward") step(1);
    else if (a === "escape" && inspect) resume();
    else if (a === "play") $("[data-play]").click();
  };
  ctx?.bus.addEventListener("key", onKey);
  setPlay(playing);
  try { await reset(); } catch (e) { $("[data-line]").textContent = `Could not load the forecast files: ${e.message}`; return () => {}; }
  if (q.has("series") && S.some(s => s.id === q.get("series"))) inspect = q.get("series");
  let prev = performance.now(), last = 0;
  const tick = now => {
    if (dead) return;
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (playing && !inspect && S.length && i < S.length) {
      tt += dt * SPEEDS[speed];
      if (tt >= T_BAND + T_REVEAL + T_HOLD) { finish(); tt = 0; if (i >= S.length) setPlay(false); }
    }
    if (now - last > 66) { last = now; draw(); }
    requestAnimationFrame(tick);
  };
  draw(); requestAnimationFrame(tick);
  return () => { dead = true; ctx?.bus.removeEventListener("key", onKey); };
}
