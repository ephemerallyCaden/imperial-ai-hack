// Stats: live replay of the held-out test. One unseen series at a time: the shipped NCA's 90% band from the chosen
// check is drawn, then the real frames after the check are revealed against it. The running tallies are computed here
// from the raw forecast files (eval/forecasts/whad/loo_all/nca_realft3_<check>h.json) and end exactly on the published
// numbers (mean of per-series coverage = web/ops/evidence.json). Nothing is invented; the replay is labelled as one.

const H = 19, CHECKS = [1.9, 3.8, 5.7, 9.5];
const SPEEDS = { "1×": 1, "4×": 4, "12×": 12 };            // series per ~1.6 s at 1×
const T_BAND = 0.25, T_REVEAL = 1.0, T_HOLD = 0.35;        // seconds per series at 1×
const COND = { CC: "Control", C61: "CYR61 knockdown" };   // NC and N61 are not defined in the docs: shown as their codes
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortId = id => id.replace(/^exp(\d)_part(I+)_/, "E$1·$2·").replace(/_/g, "·");
const condOf = id => { const k = (id.match(/_(CC|C61|NC|N61)_/) || [])[1]; return k ? COND[k] ?? `Condition ${k}` : ""; };

function series(doc, cut) {
  return doc.forecasts.map(f => {
    const ob = new Map(f.observed.t_hours.map((t, k) => [t, f.observed.area[k]]));
    const after = f.t_hours.map((t, k) => [t, f.area_q05[k], f.area_q95[k], ob.get(t)]).filter(([t, , , y]) => t > cut && y != null);
    return { id: f.wound_id, f, cut, obs: f.observed.t_hours.map((t, k) => [t, f.observed.area[k]]), after,
      inside: after.map(([, lo, hi, y]) => y >= lo && y <= hi) };
  }).filter(s => s.after.length);
}

function chart(s, phase, shown) {
  const W = 760, Ht = 260, L = 36, R = 16, T = 12, B = 26;
  const x = t => L + (t / H) * (W - L - R), y = a => T + a * (Ht - T - B);   // closure rises: area 1 (0% closed) at the bottom
  const path = pts => pts.map(([t, a], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(a).toFixed(1)}`).join("");
  const f = s.f, seen = s.obs.filter(([t]) => t <= s.cut + 1e-6), at = seen.at(-1);
  let g = "";
  if (phase > 0) {
    const band = [at, ...f.t_hours.map((t, k) => [t, f.area_q95[k]]), ...f.t_hours.map((t, k) => [t, f.area_q05[k]]).reverse()];
    g += `<path class="band" d="${path(band)}Z"/><path class="med" d="${path([at, ...f.t_hours.map((t, k) => [t, f.area_q50[k]])])}"/>`;
  }
  g += `<line class="cut" x1="${x(s.cut)}" x2="${x(s.cut)}" y1="${T}" y2="${Ht - B}"/><text class="ax" x="${x(s.cut) + 4}" y="${T + 9}">forecast made at ${s.cut} h</text>`;
  g += `<path class="obs" d="${path(seen)}"/>${seen.map(([t, a]) => `<circle class="fr" cx="${x(t)}" cy="${y(a)}" r="2.5"/>`).join("")}`;
  const rev = s.after.slice(0, shown);
  if (rev.length) g += `<path class="truth" d="${path([at, ...rev.map(([t, , , a]) => [t, a])])}"/>`;
  g += rev.map(([t, , , a], k) => s.inside[k] ? `<circle class="pin" cx="${x(t)}" cy="${y(a)}" r="3.5"/>`
    : `<circle class="pout" cx="${x(t)}" cy="${y(a)}" r="4.5"/>`).join("");
  return `<svg class="hero-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(shortId(s.id))}: forecast from ${s.cut} h, ${rev.length} later frames revealed">
    ${[0, 0.5, 1].map(a => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}"/><text class="ax" x="${L - 6}" y="${y(a) + 3}" text-anchor="end">${pct(1 - a)}</text>`).join("")}
    <line class="grid g90" x1="${L}" x2="${W - R}" y1="${y(0.1)}" y2="${y(0.1)}"/><text class="ax" x="${W - R}" y="${y(0.1) - 3}" text-anchor="end">90% closed</text>
    <line class="axis" x1="${L}" x2="${W - R}" y1="${Ht - B}" y2="${Ht - B}"/>
    ${[0, ...CHECKS, H].map(k => `<text class="ax" x="${x(k)}" y="${Ht - 8}" text-anchor="middle">${k}${k === H ? " h" : ""}</text>`).join("")}
    ${g}</svg>`;
}

// Running coverage (mean of per-series coverage) as series complete, converging on the published figure.
function converge(hist, n) {
  const W = 360, Ht = 120, L = 30, R = 8, T = 8, B = 18, lo = 0.6;
  const x = i => L + (i / Math.max(1, n - 1)) * (W - L - R), y = v => T + (1 - (Math.max(lo, v) - lo) / (1 - lo)) * (Ht - T - B);
  const d = hist.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return `<svg class="ov-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Running 90% band coverage over ${hist.length} of ${n} series">
    ${[0.6, 0.8, 1].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${pct(v)}</text>`).join("")}
    <line class="target" x1="${L}" x2="${W - R}" y1="${y(0.9)}" y2="${y(0.9)}"/><text class="ax" x="${W - R}" y="${y(0.9) - 3}" text-anchor="end">target 90%</text>
    ${hist.length ? `<path class="ln hi" d="${d}"/><circle class="pt hi" cx="${x(hist.length - 1)}" cy="${y(hist.at(-1))}" r="4"/>` : ""}
    <text class="ax" x="${(L + W - R) / 2}" y="${Ht - 3}" text-anchor="middle">series tested</text></svg>`;
}

export async function mountReplay(host, { root }) {
  const q = new URLSearchParams(location.search);
  let cut = CHECKS.includes(+q.get("check")) ? +q.get("check") : 3.8, speed = "4×";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !q.has("test") && !reduce, dead = false;
  const cache = {};
  const load = async c => cache[c] ??= series(await (await fetch(`${root}eval/forecasts/whad/loo_all/nca_realft3_${c}h.json`)).json(), c);

  host.innerHTML = `<section class="cr st-test">
    <header class="cr-top">
      <div class="cr-clock"><span class="live">● Replay</span><b class="num" data-n>0 / 0</b>
        <span class="st-seg"><button class="st-btn st-btn--icon" data-play aria-label="Play or pause"></button>
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
      <div class="ov-legend"><i class="lg-obs"></i>frames before the forecast <i class="lg-med"></i>forecast <i class="lg-band"></i>90% band <i class="lg-in"></i>later frame inside <i class="lg-out"></i>outside</div></div>
    <aside class="st-side"><h2>Running coverage</h2><div data-conv></div>
      <h2>Last series</h2><ol class="stream" data-log></ol></aside>
  </section>`;
  const $ = s => host.querySelector(s);
  let S = [], i = 0, tt = 0, hist = [], pin = 0, ptot = 0, full = 0;
  const reset = async () => {
    S = await load(cut); if (dead) return;
    i = 0; tt = 0; hist = []; pin = 0; ptot = 0; full = 0; $("[data-log]").replaceChildren();
    if (q.has("test")) { const k = Math.min(S.length, Math.max(1, +q.get("test"))); while (i < k - 1) finish(); if (k === S.length) finish(); else tt = T_BAND + T_REVEAL; }
    if (reduce && !q.has("test")) while (i < S.length) finish();
  };
  const finish = () => {
    const s = S[i], ins = s.inside.filter(Boolean).length;
    hist.push(((hist.at(-1) ?? 0) * hist.length + ins / s.inside.length) / (hist.length + 1));
    pin += ins; ptot += s.inside.length; if (ins === s.inside.length) full++;
    $("[data-log]").insertAdjacentHTML("afterbegin", `<li class="${ins < s.inside.length ? "you" : ""}"><span class="num">${i + 1}</span><b>${esc(condOf(s.id))} <i>${esc(shortId(s.id))}</i></b><span></span><span>${ins}/${s.inside.length} frames inside</span></li>`);
    while ($("[data-log]").children.length > 8) $("[data-log]").lastElementChild.remove();
    i++;
  };
  const draw = () => {
    if (!S.length) return;
    const s = S[Math.min(i, S.length - 1)], done = i >= S.length;
    const phase = done ? 2 : tt < T_BAND ? 0 : 1;
    const shown = done ? s.after.length : Math.max(0, Math.min(s.after.length, Math.floor(((tt - T_BAND) / T_REVEAL) * s.after.length) + (tt >= T_BAND ? 1 : 0)));
    const ins = s.inside.slice(0, shown).filter(Boolean).length;
    $("[data-n]").textContent = `${Math.min(i + (done ? 0 : 1), S.length)} / ${S.length}`;
    $("[data-line]").innerHTML = `<b>${esc(condOf(s.id))}</b> · <span class="dim">${esc(shortId(s.id))}</span> · forecast at ${s.cut} h · ${shown ? `<b>${ins} of ${shown}</b> later frames inside the 90% band` : "band drawn, frames to come"}`;
    $("[data-chart]").innerHTML = chart(s, phase, shown);
    $("[data-cov]").textContent = hist.length ? pct(hist.at(-1), 1) : "–";
    $("[data-pool]").textContent = ptot ? `${pin} / ${ptot}` : "–";
    $("[data-full]").textContent = hist.length ? `${full} / ${hist.length}` : "–";
    $("[data-conv]").innerHTML = converge(hist, S.length);
  };
  const setPlay = p => { playing = p; $("[data-play]").textContent = p ? "⏸" : "▶"; $(".live").classList.toggle("on", p); };
  $("[data-play]").addEventListener("click", () => setPlay(!playing));
  $("[data-restart]").addEventListener("click", async () => { await reset(); setPlay(true); draw(); });
  host.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => { speed = b.dataset.speed; host.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
  host.querySelectorAll("[data-cut]").forEach(b => b.addEventListener("click", async () => {
    cut = +b.dataset.cut; host.querySelectorAll("[data-cut]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("[data-cutlab]").textContent = cut;
    await reset(); draw();
  }));
  setPlay(playing);
  try { await reset(); } catch (e) { $("[data-line]").textContent = `Could not load the forecast files: ${e.message}`; return () => {}; }
  let prev = performance.now(), last = 0;
  const tick = now => {
    if (dead) return;
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (playing && S.length) {
      if (i < S.length) { tt += dt * SPEEDS[speed]; if (tt >= T_BAND + T_REVEAL + T_HOLD) { finish(); tt = 0; } }
      else if ((tt += dt) > 6) reset();
    }
    if (now - last > 66) { last = now; draw(); }
    requestAnimationFrame(tick);
  };
  draw(); requestAnimationFrame(tick);
  return () => { dead = true; };
}
