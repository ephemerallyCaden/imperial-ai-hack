// Right panel: a one-line decision strip with icon buttons, then four small charts (closure curve, closure chance
// per check, 90% band width per check, time to 50% / 90% closed), frame thumbnails when there are real images,
// or the refused layout. Labels only, no prose. Pure render functions returning HTML; assay.js wires data-act.
import { curveSVG } from "./curve.js";
import { HORIZON_H, isCalibrated } from "./runlog.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = p => `${Math.round(p * 100)}%`;
export const ICON = {
  check: `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  undo: `<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>`,
  flask: `<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>`,
  stop: `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>`,
  stall: `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/></svg>`,
  again: `<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  go: `<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  refused: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>`,
};

// decision id -> icon kind + short label (the Why / run steps detail lives in Ops)
export function decisionKind(d) {
  const id = d?.decision || "";
  if (id.startsWith("stop")) return "stop";
  if (id.includes("stall")) return "stall";
  if (id === "image_again") return "again";
  if (id.includes("refused")) return "refused";
  return "go";
}
const SHORT = { stop_unlikely: "Stop · unlikely to close", stop_likely: "Stop · likely to close", ask_human_stall: "Stall · check the plate",
  image_again: "Image again", continue: "Continue", data_refused: "Refused" };
const shortLabel = (d, next) => (SHORT[d.decision] || d.label || d.decision) + (d.decision === "image_again" && next != null ? ` · ${next} h` : "");
const SCHED = { image_again: "Image again", call: "Call", continue: "Continue" };

// ---------- decision strip ----------
export function decisionCard(s) {
  const { check, run, approvals, sourceKind } = s;
  const strip = (kind, line, sub, btns = "", cls = "") => `<section class="as-strip as-strip--${kind} ${cls}">
      <span class="as-strip-icon">${ICON[kind]}</span><div class="as-strip-text"><b>${esc(line)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>
      <div class="as-strip-btns">${btns}</div></section>`;
  const p = check?.fc?.p_close_by_T;
  const chance = p != null ? `P(90% by ${HORIZON_H} h) ${pct(p)}` : "";
  if (sourceKind === "sample" || sourceKind === "upload" || !run?.start) {
    const sch = check?.doc?.schedule;
    const line = sch ? `${SCHED[sch.action] || sch.action}${sch.next_image_hours != null ? ` · ${sch.next_image_hours} h` : ""}` : "No advice";
    return strip(sch?.action === "image_again" ? "again" : "go", line, chance);
  }
  if (!check) return strip("go", `First check · ${run.checks[0]?.cut_h ?? "–"} h`, "");
  const d = check.decision, st = approvals[check.cut_h], kind = decisionKind(d);
  const next = d.state?.next_check_h;
  const btn = (act, icon, label, primary) => `<button class="as-ibtn ${primary ? "as-ibtn--primary" : ""}" data-act="${act}" aria-label="${label}" title="${label}">${ICON[icon]}</button>`;
  if (check.needsApproval && st === "approved") return strip(kind, `Approved · ${shortLabel(d, next)}`, chance, btn("undo", "undo", "Undo"), "is-approved");
  if (check.needsApproval && st === "rejected") return strip(kind, `Rejected · ${shortLabel(d, next)}`, chance, btn("undo", "undo", "Undo"), "is-rejected");
  const pending = check.needsApproval && !st;
  return strip(kind, shortLabel(d, next), chance,
    pending ? btn("approve", "check", "Approve", true) + btn("reject", "x", "Reject") : "", pending ? "is-pending" : "");
}

// ---------- refused layout ----------
export function refusedPanel(doc) {
  return `<section class="as-strip as-strip--refused is-pending"><span class="as-strip-icon">${ICON.refused}</span>
      <div class="as-strip-text"><b>Refused</b><span>${esc((doc.reasons || [])[0] || "")}</span></div>
      <div class="as-strip-btns"><button class="as-ibtn as-ibtn--primary" data-act="upload" aria-label="Replace image" title="Replace image">${ICON.upload}</button>
      <button class="as-ibtn" data-act="sample" aria-label="Try a sample" title="Try a sample">${ICON.flask}</button></div></section>
    ${(doc.reasons || []).length > 1 ? `<ul class="as-reasons">${doc.reasons.slice(1).map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}`;
}

// ---------- small charts ----------
const box = (title, body, right = "") => `<section class="as-chart"><div class="as-chart-h"><span>${title}</span><span>${right}</span></div>${body}</section>`;
const W = 360, H = 78, PL = 30, PR = 10, PT = 8, PB = 16;
const sx = h => PL + (h / HORIZON_H) * (W - PL - PR);
const xAxis = () => [0, 5, 10, 15, 19].map(h => `<text x="${sx(h).toFixed(1)}" y="${H - 4}" class="c-lbl" text-anchor="middle">${h}</text>`).join("");

// one point per check (up to the current check), y in [0, 1]
function perCheck(points, { now, lines = [], fmt, yMax = 1 }) {
  const sy = v => PT + (1 - Math.min(yMax, Math.max(0, v)) / yMax) * (H - PT - PB);
  const grid = [0, yMax / 2, yMax].map(v => `<line x1="${PL}" x2="${W - PR}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="c-grid"/><text x="${PL - 4}" y="${(sy(v) + 3).toFixed(1)}" class="c-lbl" text-anchor="end">${fmt(v)}</text>`).join("");
  const ref = lines.map(([v, lbl]) => `<line x1="${PL}" x2="${W - PR}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="c-ref"/><text x="${W - PR}" y="${(sy(v) - 3).toFixed(1)}" class="c-lbl" text-anchor="end">${lbl}</text>`).join("");
  const pts = points.filter(p => p.v != null);
  const line = pts.length > 1 ? `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${sx(p.h).toFixed(1)},${sy(p.v).toFixed(1)}`).join("")}" class="c-pc"/>` : "";
  const dots = pts.map(p => `<circle cx="${sx(p.h).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="${p.h === now ? 4.5 : 3}" class="${p.h === now ? "c-pdot c-pdot--now" : "c-pdot"}"/>${p.h === now ? `<text x="${(sx(p.h) + 7).toFixed(1)}" y="${(sy(p.v) - 6).toFixed(1)}" class="c-val">${fmt(p.v)}</text>` : ""}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="as-mini">${grid}${ref}${line}${dots}<line x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}" class="c-axis"/>${xAxis()}</svg>`;
}

// first time a curve reaches `level` (area <= level), linear between grid points; null if never by the horizon
function crossT(ts, ys, level) {
  for (let i = 0; i < ys.length; i++) if (ys[i] <= level) {
    if (!i) return ts[0];
    const q = (ys[i - 1] - level) / (ys[i - 1] - ys[i]); return ts[i - 1] + q * (ts[i] - ts[i - 1]);
  }
  return null;
}
function timeToClose(fc) {
  const rows = [["50%", fc.t50, 0.5], ["90%", fc.t90, 0.1]];
  const RH = 28, HH = rows.length * RH + PB + 14;
  const body = rows.map(([lbl, ev, level], r) => {
    const y = 20 + r * RH, lo = ev?.q05, hi = ev?.q95, med = ev?.median;
    const x0 = sx(lo ?? 0), x1 = sx(hi ?? HORIZON_H);
    const mem = (fc.members || []).map(m => crossT(fc.t_hours, m, level)).map(t => t == null ? "" : `<circle cx="${sx(t).toFixed(1)}" cy="${y + 10}" r="2.2" class="c-memdot"/>`).join("");
    return `<text x="${PL - 4}" y="${y + 4}" class="c-lbl" text-anchor="end">${lbl}</text>
      ${lo != null || hi != null || med != null ? `<rect x="${x0.toFixed(1)}" y="${y - 4}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="8" class="c-range ${hi == null ? "c-range--open" : ""}"/>` : ""}
      ${med != null ? `<line x1="${sx(med).toFixed(1)}" x2="${sx(med).toFixed(1)}" y1="${y - 7}" y2="${y + 7}" class="c-medtick"/><text x="${sx(med).toFixed(1)}" y="${y - 10}" class="c-val" text-anchor="middle">${med} h</text>` : `<text x="${(W - PR).toFixed(1)}" y="${y - 7}" class="c-val" text-anchor="end">&gt; ${HORIZON_H} h</text>`}
      ${mem}`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${HH}" class="as-mini">${body}<line x1="${PL}" x2="${W - PR}" y1="${HH - PB}" y2="${HH - PB}" class="c-axis"/>${[0, 5, 10, 15, 19].map(h => `<text x="${sx(h).toFixed(1)}" y="${HH - 4}" class="c-lbl" text-anchor="middle">${h}</text>`).join("")}</svg>`;
}

export function charts(run, check, t) {
  if (!check?.fc) return "";
  const { doc, fc } = check, cal = isCalibrated(doc, fc);
  const checks = (run?.checks || [check]).filter(c => c.fc && c.cut_h <= t + 1e-9);
  const seen = checks.length ? checks : [check], now = check.cut_h;
  const width = c => { const a = c.fc.area_q95?.at(-1), b = c.fc.area_q05?.at(-1); return a != null && b != null ? a - b : null; };
  return box("Closure", curveSVG(fc, { cutoff: doc.cutoff_hours, t, calibrated: cal }), cal ? "90% band" : "uncalibrated")
    + box(`P(90% closed by ${HORIZON_H} h)`, perCheck(seen.map(c => ({ h: c.cut_h, v: c.fc.p_close_by_T })), { now, lines: [[0.1, "stop"], [0.9, "call"]], fmt: pct }), "per check")
    + box(`Band width at ${HORIZON_H} h`, perCheck(seen.map(c => ({ h: c.cut_h, v: width(c) })), { now, fmt: v => v.toFixed(2) }), "per check")
    + box("Time to close", timeToClose(fc), "q05–q95 · members");
}

// ---------- frame thumbnails (real images only) ----------
export function framesRow(images) {
  if (!images?.frames?.length) return "";
  return `<section class="as-frames">${images.frames.map((im, i) => `<figure><div class="as-img"><img src="${esc(im.src)}" alt="frame ${i + 1}">${im.mask ? `<canvas data-mask="${esc(im.mask)}"></canvas>` : ""}</div>
    <figcaption>${im.t != null ? `${im.t} h` : `#${i + 1}`}${im.area != null ? ` · ${Math.round(im.area * 100)}%` : ""}</figcaption></figure>`).join("")}</section>`;
}
