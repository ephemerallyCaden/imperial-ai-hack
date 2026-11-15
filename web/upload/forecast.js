// Browser port of data/upload.py run(..., forecaster="edge_speed") (issue #39): masks -> forecast contract doc.
// >= 2 frames: eval/forecast_baselines.py forecast_file, model edge_speed, leave-one-wound-out conformal band over the
// WHAD pool; 1 frame: whad_population_prior (spread of WHAD wounds). Calibration data: web/data/browser_calib.json
// (web/upload/export_calib.py). Plain ES module, no dependencies; nothing is sent anywhere.
//   runUpload(frames [{grey, h, w}], interval, scale, calib, {condition}) -> { doc, masks: [{mask, mh, mw} | null] }
import { checkFrame, DOWN, WHAD_UM_PER_PX } from "./segment.js";

export const BROWSER_LABEL = "Browser estimate: edge-speed forecaster; the NCA forecast needs the Python pipeline.";
const EVENTS = [[0.5, "t50"], [0.1, "t90"]];

// ---------- numpy helpers (same arithmetic as numpy, float64) ----------
const r = (x, d) => +x.toFixed(d);
const r4 = xs => Array.from(xs, v => r(v, 4));
const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
const pyFloat = x => Number.isInteger(x) ? x.toFixed(1) : String(x);   // Python str(float)
const stripBars = s => s.replace(/^[ |]+|[ |]+$/g, "");                  // str.strip(" |")
function qLevels(m, level) {
  const a = (1 - level) / 2;
  return [Math.max(0, Math.floor((m + 1) * a) / m), Math.min(1, Math.ceil((m + 1) * (1 - a)) / m)];
}
// np.quantile(x, q, method="inverted_cdf")
function quantileInv(xs, qs) {
  const s = Float64Array.from(xs).sort(), n = s.length;
  return qs.map(q => {
    const vi = n * q - 1, lo = Math.floor(vi);
    const k = Math.min(n - 1, Math.max(0, vi - lo === 0 ? lo : lo + 1));
    return s[k];
  });
}
function interp(x, xp, fp) {
  const n = xp.length;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let j = 0; while (xp[j + 1] <= x) j++;
  return (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]) * (x - xp[j]) + fp[j];
}
const arange = (a, b, s) => { const n = Math.max(0, Math.ceil((b - a) / s)), o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = a + i * s; return o; };
function eventTime(t, a, level) { for (let i = 0; i < a.length; i++) if (a[i] <= level) return t[i]; return null; }

// eval/baselines.py edge_speed: sqrt(area) falls linearly from the peak on; lvcf if it is not closing
function edgeSpeed(t, a, tf) {
  let p = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[p]) p = i;
  const tp = t.slice(p), sp = a.slice(p).map(Math.sqrt), n = tp.length;
  const lvcf = () => Float64Array.from(tf, () => a[a.length - 1]);
  if (n < 2) return lvcf();
  const mt = mean(tp), ms = mean(sp);
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (tp[i] - mt) * (sp[i] - ms); sxx += (tp[i] - mt) ** 2; }
  const m = sxy / sxx, c = ms - m * mt;
  if (m >= 0) return lvcf();
  return Float64Array.from(tf, x => Math.max(m * x + c, 0) ** 2);
}

// forecast_baselines.prepare for one series
function prepare(s, cut, G, Gl) {
  const h = s.t.map(x => x <= cut + 1e-9), th = s.t.filter((_, i) => h[i]), ah = s.a.filter((_, i) => h[i]);
  if (th.length < 2 || (th.length === s.t.length && !s.no_truth) || ah[ah.length - 1] <= 0.1) return null;
  const pred = edgeSpeed(th, ah, G), b = { pred, res: Float64Array.from(G, (g, i) => interp(g, s.t, s.a) - pred[i]) };
  const predL = edgeSpeed(th, ah, Gl);
  for (const [lvl, key] of EVENTS) {
    const seen = eventTime(th, ah, lvl), x = eventTime(Gl, predL, lvl), tt = eventTime(s.t, s.a, lvl);
    b[key + "_pred"] = x ?? Infinity; b[key + "_seen"] = seen;
    b[key + "_true"] = seen !== null ? null : (tt ?? Infinity);
  }
  return b;
}

// forecast_baselines.forecast_file(model="edge_speed") for the single upload series
function edgeForecast(up, pool, cut, G, Gl, T, level, stallKeep) {
  const b = prepare(up, cut, G, Gl);
  if (!b) return { error: "the wound is already at or below 10% of its first-frame area; nothing left to forecast" };
  const others = pool.map(s => prepare(s, cut, G, Gl)).filter(Boolean);
  if (others.length < 3) return { error: "fewer than 3 WHAD wounds in the calibration pool at this cut-off" };
  const nG = G.length, E = others.map(o => Float64Array.from(o.res, (v, i) => Math.max(b.pred[i] + v, 0)));
  const [lq, hq] = qLevels(others.length, level), lo = [], med = [], hi = [];
  for (let i = 0; i < nG; i++) { const q = quantileInv(E.map(e => e[i]), [lq, 0.5, hq]); lo.push(q[0]); med.push(q[1]); hi.push(q[2]); }
  const ev = {}, Glast = Gl[Gl.length - 1];
  for (const [, key] of EVENTS) {
    if (b[key + "_seen"] !== null) {
      const v = r(b[key + "_seen"], 2);
      ev[key] = { median: v, q05: v, q95: v, censored_prob: 0 }; ev[key + "_samples"] = [b[key + "_seen"]]; continue;
    }
    const rr = others.filter(o => o[key + "_true"] !== null).map(o => isFinite(o[key + "_pred"]) ? o[key + "_true"] / o[key + "_pred"] : Infinity);
    const samp = rr.length ? rr.map(x => Math.max(b[key + "_pred"] * x, cut)) : [Infinity];
    const [ql, qh] = qLevels(samp.length, level), q = quantileInv(samp, [ql, 0.5, qh]);
    const fin = x => isFinite(x) && x <= Glast ? r(x, 2) : null;
    ev[key] = { median: fin(q[1]), q05: fin(q[0]), q95: fin(q[2]), censored_prob: r(mean(samp.map(x => x > G[nG - 1] ? 1 : 0)), 3) };
    ev[key + "_samples"] = samp;
  }
  const aCut = up.a[up.a.length - 1], last = E.map(e => e[nG - 1]);
  const pStall = mean(last.map(x => x >= stallKeep * aCut ? 1 : 0));
  const order = last.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[1]);   // stable argsort
  const k = Math.min(5, order.length), step = (order.length - 1) / (k - 1 || 1);
  const pick = Array.from({ length: k }, (_, i) => order[Math.trunc(i === k - 1 ? order.length - 1 : i * step)]);
  return { model: "edge_speed", notes: "statistical baseline + leave-one-wound-out conformal (eval/forecast_baselines.py)", fc: {
    wound_id: "upload", wound: "upload", condition: "upload", part: "",
    t_hours: r4(G), area_q05: r4(lo), area_q50: r4(med), area_q95: r4(hi), t50: ev.t50, t90: ev.t90,
    p_close_by_T: r(mean(ev.t90_samples.map(x => x <= T ? 1 : 0)), 3), p_stall: r(pStall, 3), flags: [],
    segmentation_quality: { status: "ok", reasons: [] }, observed: { t_hours: r4(up.t), area: r4(up.a) },
    members: pick.map(i => r4(E[i])) } };
}

// upload.py one-frame branch: spread of the WHAD wounds' observed curves, no measured rate
function populationPrior(up, pool, G, T, level) {
  const nG = G.length, E = pool.map(s => G.map(g => interp(g, s.t, s.a)));
  const [lq, hq] = qLevels(E.length, level), lo = [], med = [], hi = [];
  for (let i = 0; i < nG; i++) { const q = quantileInv(E.map(e => e[i]), [lq, 0.5, hq]); lo.push(q[0]); med.push(q[1]); hi.push(q[2]); }
  const ev = {}, fin = x => isFinite(x) ? r(x, 2) : null;
  for (const [lvl, key] of EVENTS) {
    const tt = pool.map(s => eventTime(s.t, s.a, lvl) ?? Infinity), q = quantileInv(tt, [lq, 0.5, hq]);
    ev[key] = { median: fin(q[1]), q05: fin(q[0]), q95: fin(q[2]), censored_prob: r(mean(tt.map(x => x > G[nG - 1] ? 1 : 0)), 3) };
  }
  const p = mean(pool.map(s => { const x = eventTime(s.t, s.a, 0.1); return x !== null && x <= T ? 1 : 0; }));
  return { model: "whad_population_prior", notes: "one frame: spread of WHAD wounds, no measured closure rate", fc: {
    wound_id: "upload", t_hours: r4(G), area_q05: r4(lo), area_q50: r4(med), area_q95: r4(hi), t50: ev.t50, t90: ev.t90,
    p_close_by_T: r(p, 3), p_stall: null, flags: [], segmentation_quality: { status: "ok", reasons: [] },
    observed: { t_hours: r4(up.t), area: r4(up.a) } } };
}

// upload.py schedule_advice
export function scheduleAdvice(p, cut) {
  const nxt = [1.9, 3.8, 5.7, 9.5].find(c => c > cut + 1e-9) ?? null;
  if (p <= 0.1) return { action: "call", call: "unlikely to reach 90% closure by 19 h",
    evidence: "on held-out WHAD wounds such early calls were right 91% of the time (always saying no: 75%)" };
  if (p >= 0.9) return { action: "call", call: "likely to reach 90% closure by 19 h", evidence: "untested: no held-out WHAD wound got this call early" };
  return { action: "image_again", next_image_hours: nxt,
    evidence: "the 90% band narrows on average from 0.49 (1.9 h) to 0.34 (3.8 h) of the starting area (held-out WHAD, real-data NCA)" };
}
const nearest = (obj, cut) => { let best = null; for (const k of Object.keys(obj)) if (best === null || Math.abs(+k - cut) < Math.abs(+best - cut)) best = k; return best === null ? null : obj[best]; };

// upload.py run(): QC every frame, then forecast; any refused frame refuses the upload
export function runUpload(frames, interval, scale, calib, { condition = null } = {}) {
  const refused = reasons => ({ doc: { version: "1.0", refused: true, reasons }, masks: [] });
  if (!interval || !scale) return refused(["frame interval and pixel scale are required"]);
  const masks = [], reasons = [];
  frames.slice(0, 5).forEach((f, k) => {
    const c = checkFrame(f.grey, f.h, f.w, scale);
    reasons.push(...c.reasons.map(x => `frame ${k + 1}: ${x}`));
    masks.push(c.mask ? { mask: c.mask, mh: c.mh, mw: c.mw, frac: c.frac } : null);
  });
  if (reasons.length) return { doc: { version: "1.0", refused: true, reasons }, masks };
  const H = calib.horizon_h, level = calib.level, t = masks.map((_, i) => i * interval), w = masks.map(m => m.frac);
  const up = { t, a: w.map(x => x / w[0]), no_truth: true }, cut = t[t.length - 1];
  const G = arange(Math.floor(cut) + 1, H + 1e-9, 1.0);
  if (!G.length) return { doc: { version: "1.0", error: `the last frame (${cut} h) is at or after the ${H} h horizon; nothing to forecast` }, masks };
  const Gl = arange(G[0], 20 * H, 0.25), pool = calib.series;
  const res = masks.length >= 2 ? edgeForecast(up, pool, cut, G, Gl, H, level, calib.stall_keep) : populationPrior(up, pool, G, H, level);
  if (res.error) return { doc: { version: "1.0", error: res.error }, masks };
  const f = res.fc;
  const doc = { version: "1.0", model: res.model, dataset: "upload", fold: "upload_vs_whad", cutoff_hours: cut, level,
    p_close_by_T_hours: H, notes: res.notes, forecasts: [f] };
  if (Math.abs(scale - WHAD_UM_PER_PX) > 0.05 * WHAD_UM_PER_PX)
    f.segmentation_quality = { status: "flagged", reasons: [`scale ${scale} um/px resampled; validated only at 0.454 um/px (WHAD)`] };
  const th = nearest(calib.stall_threshold, cut);
  if (f.p_stall !== null && th != null && f.p_stall >= th)
    f.flags.push({ type: "stall", reason: `${(100 * f.p_stall).toFixed(0)}% of plausible futures close less than 10% more by ${H} h (flag threshold ${th.toFixed(2)}, tuned leave-one-wound-out on WHAD).` });
  const lam = condition && !calib.calibrated_conditions.includes(condition) ? nearest(calib.condition_shift_edge_speed || {}, cut) : null;
  if (lam != null) {   // upload.py condition_guard
    f.area_q05 = f.area_q50.map((m, i) => r(Math.max(m - lam * (m - f.area_q05[i]), 0), 4));
    f.area_q95 = f.area_q50.map((m, i) => r(m + lam * (f.area_q95[i] - m), 4));
    f.flags.push({ type: "uncalibrated_condition", reason: `'${condition}' is not in the calibration set (WHAD MCF10A CC/C61/N61/NC): band widened x${lam}; calibration did not transfer to a new cell type in our tests.` });
  }
  doc.schedule = scheduleAdvice(f.p_close_by_T, cut);
  doc.notes = stripBars(`${doc.notes} | frames=${masks.length}, interval=${pyFloat(interval)} h, scale=${pyFloat(scale)} um/px, wound at first frame ${(100 * w[0]).toFixed(1)}% of field`);
  return { doc, masks, umPerPx: WHAD_UM_PER_PX * DOWN };
}
