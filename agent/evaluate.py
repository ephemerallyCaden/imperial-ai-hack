"""Agent replay evaluation (design.md 9b "Agent evaluation", issue #83). Simulation, no real model calls.

Every held-out WHAD wound in eval/forecasts/whad/loo_all is replayed at the checks 1.9/3.8/5.7/9.5 h (forecasts exist
only there, as in eval/scheduler.py) under three policies. Every policy sees the agent's forecast per wound and check
(agent.run.loo_forecast: nca_realft3, edge_speed only where the NCA forecast is missing or unusable):
  fixed    image to the 19 h horizon; never stop early
  rules    stop when the stall flag fires (p_stall >= the eval/flags.py threshold); otherwise continue
  agent    agent.run.run_wound with the offline replay model (STITCH_PROVIDER=stub, agent.run.replay_stub)
Assumption: a simulated human approves every proposal. An approved "stall flagged, ask a human" or "stop, unlikely /
likely to close" stops the plate at that check; "ask a human to review" means the human looks and imaging continues.

Truth (same as eval/scheduler.py and eval/flags.py):
  closed     area <= 0.1 of the start (90% closure) at some frame by 19 h
  stall      at a check: area at the last frame >= 90% of the area at that check (less than 10% more closure)
Metrics per policy (summed over wounds unless said):
  plate_hours_saved     horizon minus stop time
  wrong_stall_stop      stopped as stall, but stall truth at the stop check is false
  wrong_closure_call    called "unlikely" but closed by 19 h, or "likely" but did not
  missed_stall          stall truth true at some check the wound was imaged at, and never stopped
  missed_non_closer     did not close by 19 h and never got a closure call ("unlikely to close")
  non_closer_to_end     did not close by 19 h and was never stopped for any reason (imaged to the end)
  stall_stop_error_rate wrong_stall_stop / stall_stops
The "agent" rows ("Forecast policy") use the deterministic offline replay model, not a real LLM. The "real" row is read
from recorded real-model run logs (--real-runs DIR, default agent/runs/practice; #82): WHAD wound runs only
(*-exp1_*.jsonl, not .reject or upload runs). It adds model cost per run (sum of model_call cost_usd) and agreement:
checks where the real model picked the same decision as the replay model would have from the same allowed list.
  frames_used           frames imaged up to the stop time (WHAD: one frame per hour from 0 h)
  total_cost            frames x 1 + plate-hours used x rate, rate = 5 (sensitivity 2 and 20)
Usage: python -m agent.evaluate [--real-runs DIR]   -> agent/results/scoreboard.csv, agent/results/scoreboard.md
"""
import argparse
import csv
import glob
import json
import os
import tempfile

import numpy as np

from agent import config, llm, policy, run, tools

CHECKS = list(config.CHECKS_H)
END = config.HORIZON_H
POLICIES = ("fixed", "rules", "agent")
POLICY_LABELS = {"fixed": "Fixed schedule (image to 19 h)", "rules": "Simple rules (stop on stall flag)",
                 "agent": "Forecast policy (code; replay model, no LLM)"}
REAL_RUNS_DIR = os.path.join(config.REPO, "agent", "runs", "practice")
REPLAY_ORDER = (policy.STOP_UNLIKELY, policy.IMAGE_AGAIN, policy.CONTINUE)   # same pick order as run.replay_stub
RATES = [config.COST_PLATE_HOUR] + list(config.COST_PLATE_HOUR_SENSITIVITY)
SCHEDULER_CSV = os.path.join(config.REPO, "eval", "results", "scheduler.csv")


# ---------------------------------------------------------------- wounds and truth

def load_wounds(checks=CHECKS):
    """-> {wound_id: {"wound", "closed", "t", "checks": {cut: {"p_close", "p_stall", "stall_flag", "stall_true",
    "model"}}}}. Same wounds as eval/scheduler.py (its EXCLUDE list dropped). Each wound and check uses the forecast the
    agent would use (run.loo_forecast), so the rules and agent policies see the same forecasts."""
    U = tools._data_upload()
    exclude = set(getattr(U.FB, "EXCLUDE", ()))
    out = {}
    for c in checks:
        ids = []
        for m in (run.LOO_MODEL, run.LOO_FALLBACK):
            try:
                ids += [f["wound_id"] for f in run._loo_doc(c, m)["forecasts"]]
            except OSError:
                pass
        th = U.stall_threshold(c)
        for wid in dict.fromkeys(ids):
            if wid in exclude:
                continue
            one, info = run.loo_forecast(c, wid)
            if one is None:
                continue
            f = one["forecasts"][0]
            t, a = np.array(f["observed"]["t_hours"], float), np.array(f["observed"]["area"], float)
            hit = np.nonzero(a <= 0.1)[0]
            w = out.setdefault(f["wound_id"], {"wound": f.get("wound", f["wound_id"]), "t": t.tolist(), "checks": {},
                                               "closed": bool(len(hit) and t[hit[0]] <= END)})
            ps = f.get("p_stall")
            w["checks"][c] = {"p_close": f.get("p_close_by_T"), "p_stall": ps,
                              "stall_flag": bool(ps is not None and th is not None and ps >= th),
                              "stall_true": bool(a[-1] >= 0.9 * a[t <= c + 1e-9][-1]), "model": info["model"]}
    return out


def stalls(w):
    return any(c["stall_true"] for c in w["checks"].values())


# ---------------------------------------------------------------- policies -> outcome per wound

def _outcome(stop_h=None, stop_kind=None, **extra):
    return {"stop_h": END if stop_h is None else float(stop_h), "stop_kind": stop_kind, **extra}


def fixed_schedule(w):
    return _outcome()


def simple_rules(w):
    for c in sorted(w["checks"]):
        if w["checks"][c]["stall_flag"]:
            return _outcome(c, "stall")
    return _outcome()


def agent_policy(wound_id, runs_dir, run_prefix="eval83"):
    """Lead agent on one held-out wound, offline model, simulated human approves everything."""
    s = run.run_wound(f"{run_prefix}-{wound_id}", wound_id, checks=CHECKS, approve=lambda d: True, runs_dir=runs_dir)
    return _outcome(s["stop_h"] if s.get("stopped") else None, s.get("stop_kind") if s.get("stopped") else None,
                    reason=s["reason"], traced=s["numbers_traced"], untraced=s["numbers_untraced"],
                    tokens=s["tokens"]["total"], steps=s["steps"])


# ---------------------------------------------------------------- recorded real-model runs

def real_run_files(runs_dir):
    """WHAD wound runs only: *-exp1_*.jsonl, not .reject branches or upload runs."""
    return sorted(f for f in glob.glob(os.path.join(runs_dir, "*-exp1_*.jsonl")) if not f.endswith(".reject.jsonl"))


def replay_pick(allowed_ids):
    return next((d for d in REPLAY_ORDER if d in allowed_ids), None)


def read_real_run(path):
    """One recorded run -> {wound_id, model_id, outcome, cost_usd, agree, model_checks}, or None when the log has no
    run_end (the recording was stopped part-way, e.g. Ctrl-C)."""
    with open(path) as fh:
        recs = [json.loads(l) for l in fh if l.strip()]
    start = next((r for r in recs if r.get("kind") == "run_start"), None)
    end = next((r for r in recs if r.get("kind") == "run_end"), None)
    if start is None or end is None:
        return None
    agree = checks = 0
    for d in (r for r in recs if r.get("kind") == "decision" and r.get("source") not in ("forced", "fallback")):
        checks += 1   # forced (refusal, stall) never call the model; a fallback is code's pick, not the model's
        agree += d.get("proposed") == replay_pick([a["id"] for a in d.get("allowed", [])])
    out = _outcome(end.get("stop_h") if end.get("stopped") else None, end.get("stop_kind") if end.get("stopped") else None,
                   traced=end.get("numbers_traced", 0), untraced=end.get("numbers_untraced", 0),
                   tokens=(end.get("tokens") or {}).get("total", 0))
    return {"wound_id": (start.get("wound") or {}).get("wound_id"), "model_id": start.get("model_id"), "outcome": out,
            "plate_hours_saved": end.get("plate_hours_saved") or 0.0, "agree": agree, "model_checks": checks,
            "cost_usd": sum(r.get("cost_usd") or 0 for r in recs if r.get("kind") == "model_call")}


def real_label(runs_dir, n, model_ids):
    who = "Claude" if model_ids and all(str(m).startswith("claude") for m in model_ids) else ", ".join(sorted(map(str, model_ids)))
    kind = "practice runs" if os.path.basename(os.path.normpath(runs_dir)) == "practice" else "recorded runs"
    return f"Real model ({who}, n={n} {kind})"


def real_model_row(wounds, runs_dir, rate=config.COST_PLATE_HOUR):
    """Scoreboard row from recorded real-model runs, or None if there are none. Each run log counts once (two
    sessions on one wound are two runs). Every total in the row (errors, plate-hours, frames, cost, agreement) uses the
    same runs: those whose wound has truth in load_wounds(). Logs with no run_end are skipped and counted."""
    files = real_run_files(runs_dir) if runs_dir and os.path.isdir(runs_dir) else []
    parsed = [(f, read_real_run(f)) for f in files]
    done = [(f, r) for f, r in parsed if r is not None]
    if not done:
        return None
    truth = [(f, r) for f, r in done if r["wound_id"] in wounds]
    row = {"policy": "real", **score({f: wounds[r["wound_id"]] for f, r in truth},
                                     {f: r["outcome"] for f, r in truth}, rate)}
    runs = [r for _, r in truth]
    row.update(n_wounds=len(done), n_with_truth=len(truth), n_skipped_no_run_end=len(parsed) - len(done),
               n_distinct_wounds=len({r["wound_id"] for r in runs}),
               model_cost_usd_per_run=round(sum(r["cost_usd"] for r in runs) / len(runs), 4) if runs else None,
               agree_with_replay=sum(r["agree"] for r in runs), model_checks=sum(r["model_checks"] for r in runs),
               label=real_label(runs_dir, len(done), {r["model_id"] for _, r in done}))
    return row


# ---------------------------------------------------------------- metrics

def frames_used(w, stop_h):
    return int(sum(1 for x in w["t"] if x <= stop_h + 1e-9))


def score(wounds, outcomes, rate=config.COST_PLATE_HOUR):
    """wounds: load_wounds() dict; outcomes: {wound_id: _outcome(...)} -> one scoreboard row (dict)."""
    r = dict(n_wounds=len(outcomes), plate_hours_saved=0.0, wrong_stall_stop=0, wrong_closure_call=0, missed_stall=0,
             missed_non_closer=0, non_closer_to_end=0, stall_stops=0, unlikely_calls=0, likely_calls=0, frames_used=0, plate_hours_used=0.0,
             n_stall=0, n_not_closed=0)
    traced = untraced = tokens = 0
    has_text = False
    for wid, o in outcomes.items():
        w, k, h = wounds[wid], o["stop_kind"], o["stop_h"]
        r["plate_hours_saved"] += END - h
        r["plate_hours_used"] += h
        r["frames_used"] += frames_used(w, h)
        r["n_stall"] += stalls(w)
        r["n_not_closed"] += not w["closed"]
        if k == "stall":
            r["stall_stops"] += 1
            r["wrong_stall_stop"] += not w["checks"][h]["stall_true"]
        elif k == "unlikely":
            r["unlikely_calls"] += 1
            r["wrong_closure_call"] += w["closed"]
        elif k == "likely":
            r["likely_calls"] += 1
            r["wrong_closure_call"] += not w["closed"]
        if k is None and stalls(w):
            r["missed_stall"] += 1
        if not w["closed"] and k not in ("unlikely", "likely"):
            r["missed_non_closer"] += 1
        if not w["closed"] and k is None:
            r["non_closer_to_end"] += 1
        if "traced" in o:
            has_text = True
            traced += o["traced"]; untraced += o["untraced"]; tokens += o.get("tokens", 0)
    n = max(len(outcomes), 1)
    r["plate_hours_saved"] = round(r["plate_hours_saved"], 3)
    r["plate_hours_used"] = round(r["plate_hours_used"], 3)
    r["cost_rate_plate_hour"] = rate
    r["stall_stop_error_rate"] = round(r["wrong_stall_stop"] / r["stall_stops"], 3) if r["stall_stops"] else None
    r["total_cost"] = round(r["frames_used"] * config.COST_IMAGE + r["plate_hours_used"] * rate, 3)
    r["cost_per_run"] = round(r["total_cost"] / n, 3)
    r["pct_numbers_traced"] = (round(100.0 * traced / (traced + untraced), 1) if traced + untraced else None) \
        if has_text else None
    r["numbers_untraced"] = untraced if has_text else None
    r["model_tokens_per_run"] = round(tokens / n, 1) if has_text else None
    return r


# ---------------------------------------------------------------- cross-check against eval/scheduler.py

def scheduler_calls(wounds, lo=config.P_UNLIKELY, hi=config.P_LIKELY):
    """eval/scheduler.py's rule (no stall flag): first check with p <= lo or p >= hi -> {wid: (cut, "unlikely"|"likely")}."""
    out = {}
    for wid, w in wounds.items():
        for c in sorted(w["checks"]):
            p = w["checks"][c]["p_close"]
            if p is not None and (p <= lo or p >= hi):
                out[wid] = (c, "likely" if p >= hi else "unlikely")
                break
    return out


def cross_check(wounds, agent_out):
    sched = scheduler_calls(wounds)
    s_unl = {k for k, v in sched.items() if v[1] == "unlikely"}
    a_unl = {k for k, o in agent_out.items() if o["stop_kind"] == "unlikely"}
    ref = None
    if os.path.exists(SCHEDULER_CSV):
        for row in csv.DictReader(open(SCHEDULER_CSV)):
            if row["model"] == run.LOO_MODEL and row["thresholds"] == f"<= {config.P_UNLIKELY} or >= {config.P_LIKELY}":
                ref = row
    pre_empted = sorted(s_unl - a_unl)
    return {
        "scheduler_csv_calls_wont_close": int(ref["calls_wont_close"]) if ref else None,
        "scheduler_csv_wrong_calls": int(ref["wrong_calls"]) if ref else None,
        "scheduler_rule_unlikely_calls": len(s_unl),
        "scheduler_rule_wrong": sum(wounds[k]["closed"] for k in s_unl),
        "agent_unlikely_calls": len(a_unl),
        "agent_unlikely_wrong": sum(wounds[k]["closed"] for k in a_unl),
        "same_wound_same_check": sum(1 for k in a_unl & s_unl if agent_out[k]["stop_h"] == sched[k][0]),
        "agent_only": sorted(a_unl - s_unl),
        "pre_empted_by_stall": [(k, agent_out[k]["stop_kind"], agent_out[k]["stop_h"], sched[k][0])
                                for k in pre_empted],
        "pre_empted_wrong": sum(wounds[k]["closed"] for k in pre_empted),
        "forecast_fallbacks": sum(c["model"] != run.LOO_MODEL for w in wounds.values() for c in w["checks"].values()),
    }


# ---------------------------------------------------------------- output

COLS = ["policy", "label", "cost_rate_plate_hour", "n_wounds", "plate_hours_saved", "wrong_stall_stop", "wrong_closure_call",
        "missed_stall", "missed_non_closer", "non_closer_to_end", "stall_stops", "stall_stop_error_rate", "unlikely_calls", "likely_calls", "frames_used",
        "plate_hours_used", "total_cost", "cost_per_run", "pct_numbers_traced", "numbers_untraced",
        "model_tokens_per_run", "n_stall", "n_not_closed", "model_cost_usd_per_run", "agree_with_replay", "model_checks",
        "n_with_truth", "n_distinct_wounds", "n_skipped_no_run_end"]


def _fmt(v):
    return "n/a" if v is None else (f"{v:g}" if isinstance(v, float) else str(v))


def _label(r):
    return r.get("label") or POLICY_LABELS[r["policy"]]


def write_md(path, rows, xc, runs_dir, real=None, real_dir=None):
    main = [r for r in rows if r["cost_rate_plate_hour"] == config.COST_PLATE_HOUR]
    n = main[0]["n_wounds"]
    L = ["# Agent scoreboard (replay of held-out WHAD wounds; simulation)", "",
         "Generated by `python -m agent.evaluate` (issue #83, design.md 9b). No real model calls.", "",
         "**The \"agent\" rows use the deterministic offline replay model (`agent/run.py` `replay_stub`), not a real "
         "LLM.** They show what the loop, policy, Critic and approvals do when the model always follows the schedule "
         "advice. The \"Real model\" row is read from recorded real-model run logs (#82), not simulated here.",
         "", f"Held-out WHAD wounds: {n}. Stall at some check: {main[0]['n_stall']}. "
         f"Did not reach 90% closure by {END:g} h: {main[0]['n_not_closed']} ({100 * main[0]['n_not_closed'] / n:.0f}%).",
         "", f"## Main table (1 image = {config.COST_IMAGE}, 1 plate-hour = {config.COST_PLATE_HOUR})", "",
         "| Policy | Plate-hours saved | Wrong stall stop | Wrong closure call | Missed stall | Missed non-closer "
         "| Non-closer imaged to the end | Frames used | % numbers traced | Cost per run | Model tokens per run "
         "| Model cost per run (USD) | Same pick as replay model |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in main + ([real] if real else []):
        agree = f"{r['agree_with_replay']} / {r['model_checks']} checks" if r.get("model_checks") is not None else "n/a"
        L.append(f"| {_label(r)} | {_fmt(r['plate_hours_saved'])} | {r['wrong_stall_stop']} "
                 f"| {r['wrong_closure_call']} | {r['missed_stall']} | {r['missed_non_closer']} | {r['non_closer_to_end']} "
                 f"| {r['frames_used']} "
                 f"| {_fmt(r['pct_numbers_traced'])} | {_fmt(r['cost_per_run'])} | {_fmt(r['model_tokens_per_run'])} "
                 f"| {_fmt(r.get('model_cost_usd_per_run'))} | {agree} |")
    rel = os.path.relpath(real_dir, config.REPO) if real_dir else "n/a"
    if real:
        L += ["", f"**Real model row: a small sample.** {real['n_wounds']} recorded run(s) from `{rel}` (WHAD wound runs "
              "only; `.reject` branches and upload runs are left out), not the 55 held-out wounds above, so its totals "
              "are not comparable with the other rows. " + ("These are practice runs; the final re-record on the "
              "submission account (`python -m agent.record --out agent/runs`) will replace them. "
              if "practice" in real["label"] else "") + "Error counts use the same truth "
              f"as the other rows; every column uses the {real['n_with_truth']} of {real['n_wounds']} runs that have "
              "truth, and each run log counts once (repeat sessions on one wound are separate runs; "
              f"{real['n_distinct_wounds']} distinct wound(s))." + (f" {real['n_skipped_no_run_end']} log(s) with no "
              "`run_end` (recording stopped part-way) left out." if real.get("n_skipped_no_run_end") else "") +
              " \"Same pick as replay model\" counts the checks where the real model was asked and its own proposal "
              "was used (forced stall or refusal checks and fallbacks are left out) and compares the model's proposed "
              "decision with what the replay model would have chosen from the same allowed list. Model cost is the "
              "sum of `cost_usd` over the run's model calls."]
    else:
        L += ["", f"Real model row skipped: no recorded WHAD wound runs (`*-exp1_*.jsonl`) in `{rel}`."]
    L += ["", "Stops by kind (stall / unlikely / likely): " + "; ".join(
        f"{r['policy']} {r['stall_stops']} / {r['unlikely_calls']} / {r['likely_calls']}" for r in main), "",
        "## Finding: the stall flag is often wrong", "",
        "Stall-stop error rate (wrong stall stops / stall stops, simulated human approves every stall stop): " + "; ".join(
            f"{r['policy']} {r['wrong_stall_stop']} / {r['stall_stops']}"
            + (f" = {100 * r['stall_stop_error_rate']:.0f}%" if r['stall_stop_error_rate'] is not None else " (n/a)")
            for r in main if r["policy"] != "fixed") + ". A wrong stall stop ends imaging on a wound that went on to "
        "keep closing (more than 10% further after the check). The flag only asks a human; a human who looks at the frames "
        "can reject it, but in this replay every stall stop is approved, so these errors count in full.", "",
        "## Cost sensitivity (total cost over all wounds, cost per run in brackets)", "",
        "| Policy | " + " | ".join(f"plate-hour = {k}" for k in RATES) + " |", "|---|" + "---|" * len(RATES)]
    for p in POLICIES:
        cells = [next(r for r in rows if r["policy"] == p and r["cost_rate_plate_hour"] == k) for k in RATES]
        L.append(f"| {POLICY_LABELS[p]} | " + " | ".join(f"{_fmt(c['total_cost'])} ({_fmt(c['cost_per_run'])})"
                                                        for c in cells) + " |")
    L += ["", "## Assumptions", "",
          "- A simulated human approves every proposal. Approved \"stall flagged, ask a human\" and \"stop, unlikely / "
          "likely to close\" stop the plate at that check; \"ask a human to review\" means imaging continues.",
          f"- Checks only at {', '.join(f'{c:g}' for c in CHECKS)} h (forecasts exist only there). A wound with no "
          f"forecast at a later check (4 wounds have fewer than 4 checks) and no stop is imaged to {END:g} h.",
          f"- Forecasts: every policy uses the agent's held-out forecast per wound and check, the `{run.LOO_MODEL}` "
          f"leave-one-wound-out files (calibrated 90% band), with `{run.LOO_FALLBACK}` only where that forecast is "
          f"missing or unusable ({xc['forecast_fallbacks']} wound-checks here). Truth (closed by 19 h, stall) comes from the "
          "observed curves, which are the same in every forecast file.",
          f"- Costs are relative units: 1 image = {config.COST_IMAGE}, 1 plate-hour = {config.COST_PLATE_HOUR}, "
          f"sensitivity at {' and '.join(str(k) for k in config.COST_PLATE_HOUR_SENSITIVITY)}. Total cost = frames used "
          "x 1 + plate-hours used x rate. Frames: WHAD images once an hour from 0 h, so a stop at 1.9 h has used 2 frames.",
          "- \"Missed stall\" = stall truth true at some check the wound was imaged at and the plate never stopped.",
          f"- \"Missed non-closer\" = did not reach 90% closure by {END:g} h and never got a closure call (\"unlikely "
          "to close\"); a stall stop of a non-closer still counts as missed there. \"Non-closer imaged to the end\" = "
          f"did not reach 90% closure by {END:g} h and was never stopped for any reason (stall or closure call), so the "
          "plate was imaged to the horizon for nothing. A stall stop of a non-closer is missed in the first column but "
          "not in the second.",
          "- The agent's model is the offline replay model (`agent/run.py` `replay_stub`): it proposes \"stop, unlikely\""
          " when allowed, else \"image again\", else \"continue\"; it never asks a human of its own accord and never "
          "proposes \"stop, likely\". Model tokens are 0 for it. A real model's choices may differ; real-model "
          "numbers come from recorded runs (#82).",
          "- % numbers traced: share of numbers in the agent's explanations that the Critic traced to a tool output or "
          "an allowlisted constant. The other policies write no text (n/a).",
          "",
          "## Limitations", "",
          "- The stall threshold (`eval/results/flag_thresholds.json`) is tuned on all WHAD wounds, so the stall flag "
          "used here is not strictly leave-one-out (eval/flags.py reports the leave-one-wound-out precision/recall). "
          "It is also tuned on edge speed's p_stall; here it is applied to the replay forecaster's p_stall (same "
          "definition). The forecasts themselves are leave-one-wound-out (loo_all).",
          "- Plate-hours saved is a simulation on recorded series, not a lab result. 55 wounds from one dataset.",
          "", f"## Cross-check against eval/results/scheduler.csv ({run.LOO_MODEL}, <= 0.1 or >= 0.9)", "",
          f"- scheduler.csv: {_fmt(xc['scheduler_csv_calls_wont_close'])} \"won't close\" calls, "
          f"{_fmt(xc['scheduler_csv_wrong_calls'])} wrong. Same rule recomputed here: "
          f"{xc['scheduler_rule_unlikely_calls']} calls, {xc['scheduler_rule_wrong']} wrong.",
          f"- Agent: {xc['agent_unlikely_calls']} \"unlikely to close\" calls, {xc['agent_unlikely_wrong']} wrong; "
          f"{xc['same_wound_same_check']} of them on the same wound at the same check as the scheduler; "
          f"{len(xc['agent_only'])} calls the scheduler did not make.",
          f"- Difference: {len(xc['pre_empted_by_stall'])} scheduler calls are pre-empted in the agent because the stall"
          " flag fired at the same or an earlier check (a fired stall flag forces \"stall flagged, ask a human\", "
          f"which the simulated human approves as a stall stop). {xc['pre_empted_wrong']} of these were wrong "
          "scheduler calls (the wound did close).",
          ""]
    if xc["pre_empted_by_stall"]:
        L += ["| Wound | Agent stop | Agent stop h | Scheduler call h |", "|---|---|---|---|"]
        L += [f"| {k} | {kind} | {sh:g} | {sc:g} |" for k, kind, sh, sc in xc["pre_empted_by_stall"]]
        L.append("")
    L += ["Agent run logs for this evaluation were written to a temporary directory, not agent/runs/.", ""]
    open(path, "w").write("\n".join(L))


def evaluate(runs_dir=None, out_dir=config.RESULTS_DIR, write=True, real_runs=REAL_RUNS_DIR):
    prev_provider, prev_stub = os.environ.get("STITCH_PROVIDER"), llm._stub_handler
    os.environ["STITCH_PROVIDER"] = "stub"          # never a real model call here
    llm.set_stub(run.replay_stub)
    try:
        runs_dir = runs_dir or tempfile.mkdtemp(prefix="agent_eval_runs_")
        wounds = load_wounds()
        outs = {"fixed": {k: fixed_schedule(w) for k, w in wounds.items()},
                "rules": {k: simple_rules(w) for k, w in wounds.items()},
                "agent": {k: agent_policy(k, runs_dir) for k in wounds}}
    finally:   # leave the caller's provider and stub as they were
        llm.set_stub(prev_stub)
        if prev_provider is None:
            os.environ.pop("STITCH_PROVIDER", None)
        else:
            os.environ["STITCH_PROVIDER"] = prev_provider
    rows = [{"policy": p, "label": POLICY_LABELS[p], **score(wounds, outs[p], rate)} for rate in RATES for p in POLICIES]
    xc = cross_check(wounds, outs["agent"])
    real = real_model_row(wounds, real_runs)
    if write:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "scoreboard.csv"), "w", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=COLS)
            wr.writeheader()
            wr.writerows({k: r.get(k) for k in COLS} for r in rows + ([real] if real else []))
        write_md(os.path.join(out_dir, "scoreboard.md"), rows, xc, runs_dir, real, real_runs)
    return rows, xc, outs, runs_dir, real


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent replay scoreboard (no real model calls).")
    ap.add_argument("--real-runs", default=REAL_RUNS_DIR, help="dir of recorded real-model run logs (default %(default)s)")
    a = ap.parse_args(argv)
    rows, xc, _, runs_dir, real = evaluate(real_runs=a.real_runs)
    print("Agent replay evaluation, held-out WHAD wounds (simulation; simulated human approves every proposal;"
          " agent = offline replay model, not a real LLM)")
    for r in rows:
        if r["cost_rate_plate_hour"] == config.COST_PLATE_HOUR:
            print(f"  {r['policy']:6} saved {r['plate_hours_saved']:7.1f} h  wrong stall {r['wrong_stall_stop']}  "
                  f"wrong call {r['wrong_closure_call']}  missed stall {r['missed_stall']}  "
                  f"missed non-closer {r['missed_non_closer']}  non-closer to end {r['non_closer_to_end']}  "
                  f"stall-stop error {_fmt(r['stall_stop_error_rate'])}  frames {r['frames_used']}  "
                  f"traced {_fmt(r['pct_numbers_traced'])}%  cost/run {r['cost_per_run']:.1f}")
    if real:
        print(f"  real   {real['label']}: saved {real['plate_hours_saved']:.1f} h  wrong stall {real['wrong_stall_stop']}  "
              f"wrong call {real['wrong_closure_call']}  traced {_fmt(real['pct_numbers_traced'])}%  "
              f"USD/run {real['model_cost_usd_per_run']}  same pick as replay {real['agree_with_replay']}/{real['model_checks']}")
    else:
        print(f"  real   skipped: no WHAD wound runs in {a.real_runs}")
    print(f"  cross-check: scheduler.csv {xc['scheduler_csv_calls_wont_close']} calls ({xc['scheduler_csv_wrong_calls']}"
          f" wrong); agent {xc['agent_unlikely_calls']} ({xc['agent_unlikely_wrong']} wrong); "
          f"{len(xc['pre_empted_by_stall'])} pre-empted by stall ({xc['pre_empted_wrong']} were wrong calls)")
    print(f"  -> {os.path.relpath(config.RESULTS_DIR, config.REPO)}/scoreboard.csv, scoreboard.md; run logs in {runs_dir}")


if __name__ == "__main__":
    main()
