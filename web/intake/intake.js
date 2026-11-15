// Intake panel (#116): shows a cached Intake proposal (data/adaption/intake.py) next to its source text for review.
//   import { mountIntake } from './intake/intake.js'; mountIntake(el, './data/intake/whad_protocol_intake.json');
// The model never runs in the browser (R10: offline, cached). Values are proposals: the panel says so and offers
// "use" only through the onConfirm callback the shell provides; nothing is applied by this module.
const FIELDS = [['frame_interval_h', 'Frame interval', 'h'], ['pixel_um', 'Pixel size', 'µm/px'], ['duration_h', 'Duration', 'h'],
  ['cell_type', 'Cell line'], ['assay_type', 'Assay'], ['imaging', 'Imaging'], ['proliferation_blocked', 'Proliferation blocked'],
  ['condition', 'Condition'], ['in_scope', 'In scope']];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function mountIntake(host, url, { onConfirm } = {}) {
  const doc = await (await fetch(url)).json();
  const f = doc.fields || {}, v = (k, u) => (f[k] == null ? '<span style="color:var(--dim)">not stated</span>' : esc(f[k]) + (u ? ' ' + u : ''));
  host.innerHTML = `
    <div class="st-kicker">Intake · proposed settings</div>
    <p class="st-caption">${esc(doc.status)}. Model: ${esc(doc.model)}.</p>
    <blockquote style="margin:8px 0;padding:8px 12px;border-left:2px solid var(--hair);color:var(--dim);font:italic 11px/1.5 var(--font-serif)">${esc(doc.source_text)}<br><span style="font-style:normal">${esc(doc.source || '')}</span></blockquote>
    ${FIELDS.map(([k, label, u]) => `<div class="st-row"><span>${label}</span><span>${v(k, u)}</span></div>`).join('')}
    ${(doc.notes || []).map((n) => `<p class="st-chip st-chip--flag" style="display:block;white-space:normal;margin:6px 0">${esc(n)}</p>`).join('')}
    <p class="st-chip ${doc.scope?.in_validated_scope ? 'st-chip--honesty' : 'st-chip--flag'}" style="display:block;white-space:normal">${doc.scope?.in_validated_scope ? 'Within the validated scope (MCF10A, phase contrast, proliferation blocked)' : 'Outside the validated scope: ' + esc((doc.scope?.reasons || []).join('; ') || 'no scope check in this proposal')}</p>
    <p class="st-caption">${esc(doc.evaluation)}</p>
    ${onConfirm ? '<button class="st-btn st-btn--primary" type="button">Use these settings</button>' : ''}`;
  host.querySelector('button')?.addEventListener('click', () => onConfirm(doc.proposed_upload_settings, doc));
  return doc;
}
