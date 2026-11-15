// Right panel: decision card pinned above three tabs (Forecast · Images · Why), or the refused layout.
// Pure render functions returning HTML; assay.js wires the buttons (data-act) and re-renders.
import { curveSVG } from "./curve.js";
import { HORIZON_H, isCalibrated } from "./runlog.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = p => `${Math.round(p * 100)}%`;
const ICON = {
  check: `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  help: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/></svg>`,
  upload: `<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>`,
  flask: `<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>`,
};

// ---------- event (t50 / t90) in the style-guide format ----------
export function fmtEvent(ev) {
  if (!ev) return "—";
  const cens = ev.censored_prob > 0 ? ` · ${pct(ev.censored_prob)} not reached` : "";
  if (ev.median == null) return `not reached by ${HORIZON_H} h${cens}${ev.q05 != null ? ` · earliest (q05) ${ev.q05} h` : ""}`;
  if (ev.censored_prob === 0 && ev.q05 === ev.median && ev.q95 === ev.median) return `${ev.median} h (observed)`;
  return `${ev.median} h (${ev.q05 ?? "—"} – ${ev.q95 ?? "open"})${cens}`;
}

const SCHEDULE_LABEL = { image_again: "Image again at the next check", call: "Code call", continue: "Continue" };

// ---------- decision card ----------
export function decisionCard(s) {
  const { check, run, approvals, branchAvailable, sourceKind } = s;
  if (sourceKind === "sample" || !run?.start) {
    const sch = check?.doc?.schedule;
    return `<section class="st-card as-card">
      <div class="st-kicker">Decision card · code schedule advice</div>
      <h3>${esc(sch ? `${SCHEDULE_LABEL[sch.action] || sch.action}${sch.next_image_hours != null ? ` (${sch.next_image_hours} h)` : ""}` : "No schedule advice in this file")}</h3>
      ${sch ? `<p>${esc(sch.evidence)}</p>` : ""}
      <p class="as-note">No agent run is recorded for this sample, so there is no proposal to approve. The schedule advice comes from data/upload.py.</p>
      <div class="as-btns"><button class="st-btn" disabled>${ICON.check}Approve</button><button class="st-btn" disabled>${ICON.x}Reject</button><button class="st-btn" data-act="why">${ICON.help}Why?</button></div>
    </section>`;
  }
  if (!check) {
    const first = run.checks[0];
    return `<section class="st-card as-card st-card--rejected">
      <div class="st-kicker">Decision card · recorded run</div>
      <h3>${first ? `First check at ${first.cut_h} h` : "No checks in this run"}</h3>
      <p>Press play (Space) to replay the run. The agent proposes a decision at each check.</p>
    </section>`;
  }
  const d = check.decision, chosen = d.allowed?.find(a => a.id === d.decision);
  const forced = d.source === "forced", st = approvals[check.cut_h];
  const kicker = forced ? "Decision card · forced by code" : d.source === "fallback" ? "Decision card · fallback (code)" : "Decision card · agent proposal";
  const next = d.decision === "image_again" && d.state?.next_check_h != null ? ` (${d.state.next_check_h} h)` : "";
  const cr = check.critic, total = cr ? cr.traced + cr.untraced : 0;
  const critic = cr ? `<p class="as-caption">${cr.untraced === 0 ? "Every number traced to a tool output" : `${cr.untraced} untraced number${cr.untraced > 1 ? "s" : ""} removed by the Critic`} (Critic: ${cr.traced}/${total})</p>` : "";
  const chips = [d.irreversible ? `<span class="st-chip st-chip--flag">cannot be undone</span>` : "", d.untested ? `<span class="st-chip">untested</span>` : ""].join("");
  const recorded = check.approval ? `<p class="as-caption">Recorded in the log: ${check.approval.approved ? "approved" : "rejected"} by ${esc(check.approval.approver || "human")}${check.approval.note ? ` (${esc(check.approval.note)})` : ""}.</p>` : "";
  let body;
  if (check.needsApproval && st === "approved") {
    body = `<div class="st-kicker">After approve</div><h3>✓ Approved · ${esc(d.label)}${esc(next)}</h3>
      <p>Playback continues on the recorded approved branch.</p>${recorded}
      <div class="as-btns"><button class="st-btn" data-act="undo">Undo</button><button class="st-btn" data-act="why">Open run log ▸</button></div>`;
  } else if (check.needsApproval && st === "rejected") {
    body = `<div class="st-kicker">After reject</div><h3>✕ Rejected · proposal not applied</h3>
      <label class="as-caption" for="as-reason">Optional reason (kept in this view only; recorded logs are not changed):</label>
      <input id="as-reason" class="as-input" placeholder="e.g. plate needed for another run" value="${esc(s.rejectNote || "")}">
      <p>${branchAvailable ? "Playback switches to the recorded rejected branch." : "No rejected branch was recorded for this run, so playback stops here."}</p>
      <div class="as-btns"><button class="st-btn" data-act="undo">Undo</button></div>`;
  } else {
    const pending = check.needsApproval && !st;
    body = `<div class="st-kicker">${kicker}</div>
      <h3>${esc(d.label)}${esc(next)}</h3>
      ${chosen ? `<p class="as-evidence">${esc(chosen.evidence)}</p>` : ""}
      <p>${esc(d.explanation)}</p>${chips ? `<div class="as-chips">${chips}</div>` : ""}
      ${pending ? `<p class="as-await">Paused: this needs your approval.</p>` : ""}
      <div class="as-btns">
        <button class="st-btn ${pending ? "st-btn--primary" : ""}" data-act="approve" ${pending ? "" : "disabled"}>${ICON.check}Approve</button>
        <button class="st-btn" data-act="reject" ${pending ? "" : "disabled"}>${ICON.x}Reject</button>
        <button class="st-btn" data-act="why">${ICON.help}Why?</button>
      </div>
      ${pending ? "" : `<p class="as-caption">${check.needsApproval ? "" : "Approval is asked only for stops and flags; this decision can be undone."}</p>`}
      ${critic}`;
  }
  const cls = st === "approved" ? "st-card--approved" : st === "rejected" ? "st-card--rejected" : forced ? "st-card--forced" : "";
  return `<section class="st-card as-card ${cls}">${body}</section>`;
}

// ---------- refused layout (panel_refused) ----------
export function refusedPanel(doc, check) {
  const d = check?.decision;
  return `<section class="st-card st-card--forced as-card">
      <div class="st-kicker">Decision card · forced by code</div>
      <h3>${esc(d?.label || "Data refused · ask a human")}</h3>
      <p class="as-caption">No forecast, no band, no simulation. The LLM cannot propose anything else.</p>
      <div class="as-btns"><button class="st-btn st-btn--primary" data-act="upload">${ICON.upload}Replace image…</button><button class="st-btn" data-act="sample">${ICON.flask}Try a sample</button></div>
    </section>
    <section class="st-panel--solid as-box">
      <div class="st-kicker">Why it was refused (from upload.py)</div>
      <ul class="as-list">${(doc.reasons || []).map(r => `<li>${esc(r)}</li>`).join("")}</ul>
      <p class="as-caption">Reasons are listed verbatim from the refusal file (refused: true, reasons: […]).</p>
    </section>
    <section class="st-panel--solid as-box">
      <div class="st-kicker">What you can do</div>
      <ul class="as-list"><li>Re-image the well and upload again</li><li>Check the image is phase contrast at the stated scale</li><li>Use a sample to see how a forecast looks</li></ul>
    </section>`;
}

export const tabs = tab => `<div class="st-tabs as-tabs" role="tablist">${["forecast", "images", "why"].map(k =>
  `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${k}</button>`).join("")}</div>`;

// ---------- Forecast tab ----------
export function forecastTab(check, t) {
  if (!check?.fc) return `<p class="as-note">No forecast yet.</p>`;
  const { doc, fc } = check, cal = isCalibrated(doc, fc), unc = (fc.flags || []).filter(f => f.type === "uncalibrated_condition");
  const stall = check.flags?.stall;
  const stallTxt = stall ? `${stall.fired ? "ON" : "off"} (P = ${stall.p_stall}, threshold ${stall.threshold})`
    : fc.p_stall == null ? "not evaluable (needs 2+ frames)" : `${(fc.flags || []).some(f => f.type === "stall") ? "ON" : "off"} (P = ${fc.p_stall})`;
  const sch = check.flags?.schedule || doc.schedule;
  const otherFlags = (fc.flags || []).filter(f => f.type !== "uncalibrated_condition");
  return `${unc.map(f => `<div class="as-flag"><b>UNCALIBRATED CONDITION</b> ${esc(f.reason)}</div>`).join("")}
    <section class="st-panel--solid as-box">
      <div class="st-kicker">Figure A · closure curve</div>
      <p class="as-caption">${esc(doc.model)} · ${esc(doc.fold)} · ${cal ? `calibrated ${Math.round(doc.level * 100)}% band` : "band uncalibrated"}</p>
      ${curveSVG(fc, { cutoff: doc.cutoff_hours, t, calibrated: cal })}
    </section>
    <section class="st-panel--solid as-box">
      <div class="st-kicker">Key numbers · from the forecast at ${doc.cutoff_hours} h</div>
      <div class="st-row"><span>P(90% closed by ${doc.p_close_by_T_hours} h)</span><span>${fc.p_close_by_T}</span></div>
      <div class="st-row"><span>Time to 50% closed</span><span>${esc(fmtEvent(fc.t50))}</span></div>
      <div class="st-row"><span>Time to 90% closed</span><span>${esc(fmtEvent(fc.t90))}</span></div>
      <div class="st-row"><span>Stall flag</span><span>${esc(stallTxt)}</span></div>
      ${doc.summary ? `<div class="st-row"><span>Area at ${HORIZON_H} h (q05 · q50 · q95)</span><span>${doc.summary.area_q05_last} · ${doc.summary.area_q50_last} · ${doc.summary.area_q95_last}</span></div>` : ""}
      ${sch ? `<div class="st-row"><span>Schedule advice</span><span>${esc(sch.call || sch.action)}${sch.next_image_hours != null ? ` · ${sch.next_image_hours} h` : ""}</span></div><p class="as-caption">${esc(sch.evidence)}${sch.untested ? " · untested" : ""}</p>` : ""}
      ${otherFlags.map(f => `<p class="as-flagline">⚠ ${esc(f.type)}: ${esc(f.reason)}</p>`).join("")}
    </section>
    <p class="as-caption">${esc(doc.notes || "")}</p>`;
}

// ---------- Images tab ----------
export function imagesTab(images, check, run) {
  const fc = check?.fc, sq = fc?.segmentation_quality;
  let out = "";
  if (!images) {
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">Images</div>
      <p class="as-note">No images for held-out WHAD replays. These runs replay recorded WHAD area curves (manual masks); the raw frames are not in the repo.</p></section>`;
  } else {
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">Uploaded images · mask outline in amber</div>
      <div class="as-thumbs">${images.frames.map((im, i) => `<figure><div class="as-img"><img src="${esc(im.src)}" alt="image ${i + 1}">${im.mask ? `<canvas data-mask="${esc(im.mask)}"></canvas>` : ""}</div>
        <figcaption>image ${i + 1}${im.t != null ? ` · ${im.t} h` : ""}${im.area != null ? `<br>wound area ${Math.round(im.area * 100)}%` : ""}${im.mask ? "" : "<br>no mask"}</figcaption></figure>`).join("")}</div>
      <p class="as-caption">${esc(images.note || "Masks come from the classical segmenter; no LLM looks at pixels. More images narrow the band.")}</p>
      <div class="as-btns"><button class="st-btn" data-act="upload">${ICON.upload}Add image</button></div></section>`;
  }
  if (sq) {
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">QC · refuse or flag rules</div>
      <div class="st-row"><span>Status</span><span>${esc(sq.status.replace("_", " ").toUpperCase())}${sq.status === "flagged" ? " · forecast still shown" : ""}</span></div>
      ${(sq.reasons || []).map(r => `<p class="as-caption">“${esc(r)}”</p>`).join("")}
      ${fc.observed ? `<div class="st-row"><span>Images up to t0</span><span>${fc.observed.t_hours.filter(h => h <= check.doc.cutoff_hours + 1e-9).length}</span></div>` : ""}
      ${run?.intakeApplied ? Object.entries(run.intakeApplied.applied).map(([k, v]) => `<div class="st-row"><span>${esc(k.replace("_", " "))}</span><span>${esc(v.value)} · ${esc(v.source)}</span></div>`).join("") : ""}
      <p class="as-caption">Flagged = forecast shown with the reason. Refused = no forecast; the card is forced to “data refused, ask a human”.</p></section>`;
  }
  const ik = run?.intake?.output;
  if (ik) {
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">Intake · extraction shown next to its source</div>
      <div class="as-intake"><blockquote>${esc(ik.source_text)}</blockquote>
      <div>${Object.entries(ik.fields || {}).filter(([k]) => k !== "missing").map(([k, v]) => `<div class="st-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div></div>
      ${(ik.unit_notes || []).map(n => `<p class="as-caption">${esc(n)}</p>`).join("")}</section>`;
  }
  return out;
}

// ---------- Why tab ----------
const toolLine = c => {
  const o = c.output || {};
  if (o.error) return `${c.tool} · error: ${o.error}`;
  if (c.tool === "forecast_lookup" || c.tool === "qc_forecast") return o.refused ? `${c.tool} · refused` : `${c.tool} · ${o.model}, t0 = ${o.cutoff_hours} h`;
  if (c.tool === "flags_schedule") { const r = o.results?.[0]; return r ? `flags_schedule · stall ${r.stall?.fired ? "fired" : "off"} (p_stall ${r.stall?.p_stall}), schedule ${r.schedule?.call || r.schedule?.action}` : c.tool; }
  if (c.tool === "investigate") { const h = o.hypotheses?.[0]; return h ? `investigate · best fit ${h.name} (fit error ${h.fit_error}); hypotheses, not causes` : c.tool; }
  if (c.tool === "intake") return `intake · protocol fields extracted (${o.backend})`;
  return c.tool;
};

export function whyTab(run, check, t, approvals) {
  if (!run?.start) return `<p class="as-note">No agent run is recorded for this item, so there is no report or agent timeline.</p>`;
  const rp = run.report, caveats = rp ? [...new Set(rp.caveats || [])] : [];
  let out = "";
  if (check?.decision) {
    const d = check.decision, cr = check.critic;
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">Why this decision · allowed by policy code at ${check.cut_h} h</div>
      <ul class="as-list">${(d.allowed || []).map(a => `<li class="${a.id === d.decision ? "is-chosen" : ""}">${a.id === d.decision ? "▸ " : ""}${esc(a.label)} <span class="as-dim">← ${esc(a.evidence)}${a.irreversible ? " · cannot be undone" : ""}${a.untested ? " · untested" : ""}</span></li>`).join("")}</ul>
      <p class="as-caption">Code set the allowed decisions (source: ${esc(d.source)}${d.fallback_reason ? `, ${esc(d.fallback_reason)}` : ""}); ${d.source === "llm" ? "the LLM picked one and wrote the wording" : "the LLM was not asked"}.
      ${cr ? `The Critic traced ${cr.traced} number${cr.traced === 1 ? "" : "s"} and removed ${cr.untraced}${cr.removed?.length ? ` (${esc(cr.removed.join(", "))})` : ""}.` : ""}</p>
      ${check.investigate ? `<div class="st-kicker">Investigator · hypotheses, not causes</div><ol class="as-list">${(check.investigate.output.hypotheses || []).map(h => `<li>${esc(h.name)} <span class="as-dim">fit error ${h.fit_error} · ${esc(h.description)}</span></li>`).join("")}</ol><p class="as-caption">${esc(check.investigate.output.start || "")}</p>` : ""}
    </section>`;
  }
  out += `<section class="st-panel--solid as-box"><div class="st-kicker">Run steps · agent timeline</div><ol class="as-steps">${run.checks.map(c => {
    const st = c.approval ? (approvals[c.cut_h] || (c.cut_h <= t ? "awaiting approval" : "")) : "";
    return `<li class="${c.cut_h > t + 1e-9 ? "is-future" : ""} ${c === check ? "is-current" : ""}"><b>${c.cut_h} h</b>
      <ul>${c.tools.map(x => `<li>${esc(toolLine(x))}</li>`).join("")}
      <li>decision · ${esc(c.decision.label)} <span class="as-dim">(${esc(c.decision.source)})</span></li>
      ${c.approval ? `<li>approval · ${esc(st || "pending")}</li>` : ""}${c.review ? `<li>human review · ${esc(c.review.note || "")}</li>` : ""}</ul></li>`;
  }).join("")}</ol>
  ${run.end ? `<p class="as-caption">Run end: ${esc(run.end.reason)}${run.end.stop_h != null ? ` at ${run.end.stop_h} h` : ""} · plate hours saved ${run.end.plate_hours_saved} · numbers traced ${run.end.numbers_traced}, untraced ${run.end.numbers_untraced}</p>` : ""}</section>`;
  if (rp) {
    out += `<section class="st-panel--solid as-box"><div class="st-kicker">Report · written at the end of the recorded run</div>
      <p class="as-headline">${esc(rp.headline)}</p><p>${esc(rp.summary)}</p>
      <div class="st-kicker">Next step</div><p>${esc(rp.next_step)}</p>
      <div class="st-kicker">Caveats</div><ul class="as-list">${caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
      ${rp.critic ? `<p class="as-caption">Report Critic: ${rp.critic.traced} traced, ${rp.critic.untraced} untraced.</p>` : ""}</section>`;
  }
  return out;
}
