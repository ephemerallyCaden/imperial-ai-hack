// Turns an agent run log (agent/runs/*.jsonl, kinds in agent/README.md) into checks the UI can play.
// Nothing is computed here beyond picking records apart; every number shown comes from a tool output.

export const HORIZON_H = 19;

// forecast doc -> the forecast entry for this wound (forecast_lookup docs hold every wound; qc_forecast holds one)
export function pickForecast(doc, woundId) {
  if (!doc || doc.refused || doc.error || !Array.isArray(doc.forecasts)) return null;
  return doc.forecasts.find(f => f.wound_id === woundId) || doc.forecasts[0] || null;
}

// same rule as agent/run.py calibrated_band(): level 0.9, not a simulator model, no uncalibrated_condition flag
export function isCalibrated(doc, fc) {
  if (!doc || doc.refused || doc.error) return false;
  if (["sim_ensemble", "nca_ensemble"].includes(doc.model) || doc.calibrated === false) return false;
  // any forecast in the doc carrying the flag makes the doc's band uncalibrated (as agent/run.py checks every forecast)
  const all = [...(Array.isArray(doc.forecasts) ? doc.forecasts : []), fc].filter(Boolean);
  if (all.some(f => (f.flags || []).some(x => x?.type === "uncalibrated_condition"))) return false;
  return typeof doc.level === "number" && Math.abs(doc.level - 0.9) < 1e-9;
}

export function parseRun(records) {
  const run = { start: null, checks: [], report: null, end: null, intake: null, records };
  let pending = { tools: [], warnings: [], scope: [] }, last = null;
  for (const r of records) {
    switch (r.kind) {
      case "run_start": run.start = r; break;
      case "tool_call":
        pending.tools.push(r);
        if (r.tool === "intake") run.intake = r;
        break;
      case "intake_applied": run.intakeApplied = r; break;
      case "model_call": pending.model = r; break;
      case "warning": pending.warnings.push(r); break;
      case "scope": pending.scope.push(r); break;
      case "critic": pending.critic = r; break;
      case "decision": {
        const fcCall = [...pending.tools].reverse().find(t => t.tool === "forecast_lookup" || t.tool === "qc_forecast");
        const flCall = [...pending.tools].reverse().find(t => t.tool === "flags_schedule");
        const inv = pending.tools.find(t => t.tool === "investigate");
        last = { cut_h: r.cut_h, decision: r, tools: pending.tools, critic: pending.critic, model: pending.model,
          warnings: pending.warnings, scope: pending.scope, forecastCall: fcCall || null, flagsCall: flCall || null,
          investigate: inv || null, approval: null, review: null };
        run.checks.push(last); pending = { tools: [], warnings: [], scope: [] };
        break;
      }
      case "approval":
        if (last && last.cut_h === r.cut_h) last.approval = r;
        else run.branchApproval = r;          // first line of a .reject branch: the rejected approval
        break;
      case "human_review": if (last) last.review = r; break;
      case "report": run.report = r; break;
      case "run_end": run.end = r; break;
    }
  }
  // carry the last forecast doc forward so every check has one
  let doc = null, woundId = run.start?.wound?.wound_id;
  for (const c of run.checks) {
    if (c.forecastCall) doc = c.forecastCall.output;
    c.doc = c.forecastCall ? c.forecastCall.output : doc;
    c.fc = pickForecast(c.doc, c.forecastCall?.input?.wound_id || woundId);
    c.flags = c.flagsCall?.output?.results?.find(x => x.wound_id === (c.fc?.wound_id ?? x.wound_id)) || c.flagsCall?.output?.results?.[0] || null;
    c.needsApproval = !!c.approval;
  }
  return run;
}

// a .reject branch log only holds the checks after the rejected approval: prepend the parent's checks up to the cut
export function mergeBranch(main, branch) {
  const cut = branch.start?.branch_cut_h;
  const before = main.checks.filter(c => c.cut_h <= cut).map(c => c.cut_h === cut ? { ...c, approval: branch.branchApproval || c.approval } : c);
  return { ...branch, checks: [...before, ...branch.checks.filter(c => c.cut_h > cut)], intake: main.intake, parent: main };
}

// a forecast doc that is not from a run (samples, web/data): one pseudo-check, no agent decision
export function docAsChecks(doc) {
  if (doc.refused) return { refused: doc, checks: [], report: null, end: null };
  const fc = pickForecast(doc);
  return { checks: [{ cut_h: doc.cutoff_hours, doc, fc, decision: null, flags: null, critic: null, tools: [], needsApproval: false }], report: null, end: null };
}
