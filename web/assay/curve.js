// Figure A, closure curve (SVG). Observed: solid ink with a dot per image; after t0 the held-out frames are greyed.
// Median: amber dashed. 90% band: amber fill, only when the doc's band is calibrated; otherwise the spread is drawn
// as dim dotted lines and labelled "uncalibrated". Members: faint.
import { HORIZON_H } from "./runlog.js";

const CW = 360, CH = 210, L = 34, R = 10, T = 22, B = 30;
const X = t => L + (t / HORIZON_H) * (CW - L - R);
export const curveX = X;   // for moving the 'now' line without a re-render
const Y = a => T + (1 - Math.min(1.05, Math.max(0, a)) / 1.05) * (CH - T - B);
const f1 = v => v.toFixed(1);
const path = (ts, ys) => ts.map((t, i) => `${i ? "L" : "M"}${f1(X(t))},${f1(Y(ys[i]))}`).join("");

export function curveSVG(fc, { cutoff, t = null, calibrated }) {
  if (!fc) return `<p class="as-note">No forecast in this record.</p>`;
  const o = fc.observed || { t_hours: [], area: [] };
  const seen = o.t_hours.map((h, i) => [h, o.area[i]]).filter(([h]) => h <= cutoff + 1e-9);
  const later = o.t_hours.map((h, i) => [h, o.area[i]]).filter(([h]) => h > cutoff + 1e-9);
  // the forecast starts from the last observed point at or before t0
  const anchor = seen.at(-1);
  const ft = anchor ? [anchor[0], ...fc.t_hours] : fc.t_hours, join = a => anchor ? [anchor[1], ...a] : a;
  const grid = [0, 0.5, 1].map(a => `<line x1="${L}" x2="${CW - R}" y1="${f1(Y(a))}" y2="${f1(Y(a))}" class="c-grid"/><text x="${L - 4}" y="${f1(Y(a) + 3)}" class="c-lbl" text-anchor="end">${a * 100}</text>`).join("");
  const xt = [0, 5, 10, 15, 19].map(h => `<text x="${f1(X(h))}" y="${CH - B + 13}" class="c-lbl" text-anchor="middle">${h} h</text>`).join("");
  let band = "";
  if (calibrated) {
    band = `<path d="${path(ft, join(fc.area_q95))}L${[...ft].reverse().map((h, i) => `${f1(X(h))},${f1(Y(join(fc.area_q05)[ft.length - 1 - i]))}`).join("L")}Z" class="c-band"/>`;
  } else {
    band = `<path d="${path(ft, join(fc.area_q05))}" class="c-unc"/><path d="${path(ft, join(fc.area_q95))}" class="c-unc"/>`;
  }
  const members = (fc.members || []).map(m => `<path d="${path(ft, join(m))}" class="c-mem"/>`).join("");
  const obs = seen.length ? `<path d="${path(seen.map(p => p[0]), seen.map(p => p[1]))}" class="c-obs"/>` + seen.map(([h, a]) => `<circle cx="${f1(X(h))}" cy="${f1(Y(a))}" r="2.2" class="c-dot"/>`).join("") : "";
  const held = later.length ? `<path d="${path((anchor ? [anchor, ...later] : later).map(p => p[0]), (anchor ? [anchor, ...later] : later).map(p => p[1]))}" class="c-held"/>` : "";
  const now = t == null ? "" : `<line x1="${f1(X(t))}" x2="${f1(X(t))}" y1="${T}" y2="${CH - B}" class="c-now"/>`;
  const label = `closure curve: wound area as % of start; forecast from t0 = ${cutoff} h; P(90% closed by ${HORIZON_H} h) = ${fc.p_close_by_T}`;
  return `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${label}" class="as-curve">
    <text x="${L}" y="12" class="c-lbl">area % of start</text>
    ${grid}<line x1="${L}" x2="${CW - R}" y1="${f1(Y(0.1))}" y2="${f1(Y(0.1))}" class="c-ninety"/>
    <text x="${CW - R}" y="${f1(Y(0.1) - 3)}" class="c-lbl" text-anchor="end">90% closed</text>
    ${band}${members}${held}
    <path d="${path(ft, join(fc.area_q50))}" class="c-med"/>${obs}
    <line x1="${f1(X(cutoff))}" x2="${f1(X(cutoff))}" y1="${T - 6}" y2="${CH - B}" class="c-cut"/>
    <text x="${f1(X(cutoff) + 4)}" y="${T + 2}" class="c-lbl">t0 = ${cutoff} h · forecast from here</text>
    ${calibrated ? "" : `<text x="${CW - R}" y="${T + 14}" class="c-unc-lbl" text-anchor="end">spread uncalibrated · not a 90% band</text>`}
    <line x1="${L}" x2="${CW - R}" y1="${CH - B}" y2="${CH - B}" class="c-axis"/>${xt}${now}
  </svg>
  <div class="as-legend"><span><i class="lg-obs"></i>observed</span>${later.length ? `<span><i class="lg-held"></i>observed after t0 (held out)</span>` : ""}<span><i class="lg-med"></i>median</span>
    ${calibrated ? `<span><i class="lg-band"></i>90% band</span>` : `<span><i class="lg-unc"></i>spread (uncalibrated)</span>`}${(fc.members || []).length ? `<span><i class="lg-mem"></i>members</span>` : ""}</div>`;
}

// area (relative to the first frame) at time t: observed up to t0, forecast median after
export function areaAt(fc, cutoff, t) {
  if (!fc) return 1;
  const o = fc.observed;
  const pts = o.t_hours.map((h, i) => [h, o.area[i]]).filter(([h]) => h <= cutoff + 1e-9);
  if (t > cutoff) pts.push(...fc.t_hours.map((h, i) => [h, fc.area_q50[i]]));
  if (!pts.length) return 1;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const q = (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + q * (pts[i][1] - pts[i - 1][1]); }
  return pts.at(-1)[1];
}
