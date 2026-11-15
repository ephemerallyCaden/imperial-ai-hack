"""Reporter (design.md 9b): the plain-English end-of-run report. Called once by agent/run.py at the end of every run,
just before run_end, and logged as a `report` record.

  summarise(records, steps_left=None, tokens_left=None) -> report dict

`records` is the run log (agent/runs/<run_id>.jsonl, read back or in memory); the last record may be a provisional
`run_end` (run.py passes the end facts before it writes run_end). It also works on any finished log.

Inputs are facts from the run log only: each check's decision (label, evidence, source, approval), the end (reason,
stop time, plate-hours saved), flags, refusals and Investigator hypotheses. Explanations written by the model, wound
names, notes and protocol text are never put in the fact block. The fact block is compact (strings cut to FACT_STR_MAX,
oldest checks dropped past FACTS_MAX characters) and goes inside delimiters as data.

One call_model() call with the strict write_report tool: headline (one sentence), summary (3 to 5 sentences),
next_step (one sentence), caveats (short strings). Every text field passes the scope guard (keyword filter: a hit
replaces that field with the template's) and then the Critic (numbers must trace to the run's tool outputs, the run's
own code-computed end facts, or the allowlist; untraced numbers become "[?]").

Fallback to a deterministic template from the same facts when: no model is set, steps_left <= 0 (MAX_STEPS), the
estimated call would not fit tokens_left (TOKEN_BUDGET), the call fails, the model refuses, or the reply is invalid.
`source` is "llm" or "template". Fixed caveats (research use only; simulated cells are labelled; Investigator results
are hypotheses, not causes, when present; "likely to close" is untested, when it appears; Intake's out-of-scope notes,
when the protocol is outside the validated scope) are always added by code
after the guards. Pure apart from the one call_model() call: no I/O.
"""
import json
import re

from agent import config, critic, llm, policy, prompts

FACTS_MAX = 3000          # characters of fact-block JSON
FACT_STR_MAX = 200        # characters per string in the fact block
REPORT_MAX_TOKENS = 800
FIELD_MAX = {"headline": 300, "summary": 1500, "next_step": 300, "caveat": 200}
CAVEATS_MAX = 6
CHARS_PER_TOKEN = 4

CAVEAT_RESEARCH = "Research use only, not for diagnosis or treatment."
CAVEAT_SIMULATED = "Simulated cells and simulator bands are labelled as simulation, not observation."
CAVEAT_HYPOTHESES = "Investigator results are hypotheses, not causes."
CAVEAT_UNTESTED = '"Stop, likely to close" has never fired on a held-out wound: it is untested.'

CAVEAT_SCOPE = "Protocol outside the validated scope (Intake): "

_LIKELY = re.compile(r"(?<!un)likely to close", re.I)


# ---------------------------------------------------------------- facts from the log

def _cut(s):
    s = str(s)
    return s if len(s) <= FACT_STR_MAX else s[:FACT_STR_MAX] + "...[truncated]"


def _end(records):
    return next((r for r in reversed(records) if r.get("kind") == "run_end"), {})


def facts(records):
    """-> (facts dict for the model, truncated flag). Code-extracted facts only; no model text, no wound metadata."""
    approvals = {}
    for r in records:
        if r.get("kind") == "approval":
            approvals[r.get("cut_h")] = bool(r.get("approved"))   # last answer per check (a branch overrides)
    checks, flags, refusals = [], [], []
    for r in records:
        if r.get("kind") != "decision":
            continue
        item = next((a for a in r.get("allowed") or [] if a.get("id") == r.get("decision")), {})
        c = {"cut_h": r.get("cut_h"), "decision": r.get("decision"), "label": _cut(r.get("label")),
             "evidence": _cut(item.get("evidence", "")), "source": r.get("source")}
        if r.get("untested"):
            c["untested"] = True
        if r.get("cut_h") in approvals and (r.get("irreversible") or r.get("decision") == policy.ASK_HUMAN_STALL):
            c["human_approved"] = approvals[r.get("cut_h")]
        checks.append(c)
        st = r.get("state") or {}
        if st.get("stall"):
            flags.append({"cut_h": r.get("cut_h"), "type": "stall"})
    for r in records:
        if r.get("kind") != "tool_call":
            continue
        out = r.get("output") or {}
        if not isinstance(out, dict):
            continue
        if out.get("refused"):
            refusals.append({"cut_h": out.get("cutoff_hours", (r.get("input") or {}).get("cutoff_hours")),
                             "reasons": [_cut(x) for x in (out.get("reasons") or [])][:4]})
        for f in out.get("forecasts") or []:
            for fl in (f.get("flags") or []) if isinstance(f, dict) else []:
                t = fl.get("type") if isinstance(fl, dict) else fl
                if t and {"cut_h": out.get("cutoff_hours"), "type": _cut(t)} not in flags:
                    flags.append({"cut_h": out.get("cutoff_hours"), "type": _cut(t)})
    inv = None
    for r in records:
        if r.get("kind") == "tool_call" and r.get("tool") == "investigate":
            out = r.get("output") or {}
            hyps = sorted((h for h in out.get("hypotheses") or [] if isinstance(h, dict)),
                          key=lambda h: h.get("rank", 99))[:3]
            if hyps:
                inv = {"note": "hypotheses, not causes", "check_h": out.get("check_h"), "trigger": r.get("trigger"),
                       "hypotheses": [{"name": _cut(h.get("name")), "rank": h.get("rank"),
                                       "fit_error": h.get("fit_error")} for h in hyps]}
    scope = None
    for r in records:   # Intake (uploads with protocol text): code-written out-of-scope notes, never the protocol text
        out = r.get("output") if r.get("kind") == "tool_call" and r.get("tool") == "intake" else None
        if isinstance(out, dict) and out.get("ok") and out.get("scope_ok") is False:
            scope = [_cut(n) for n in out.get("scope_notes") or [] if "outside the validated scope" in str(n)][:3]
    e = _end(records)
    start = next((r for r in records if r.get("kind") == "run_start"), {})
    out = {"input_kind": (start.get("wound") or {}).get("kind"), "checks": checks,
           "end": {k: e.get(k) for k in ("reason", "stopped", "stop_h", "stop_kind", "plate_hours_saved", "horizon_h",
                                         "ended_at_h")},
           "flags": flags, "refusals": refusals}
    if inv:
        out["investigation"] = inv
    if scope:
        out["intake_scope"] = scope
    truncated = False
    while len(json.dumps(out, default=str)) > FACTS_MAX and len(out["checks"]) > 1:
        out["checks"].pop(0)
        truncated = True
    if truncated:
        out["checks_truncated"] = True
    return out, truncated


def _sources(records, f):
    """Critic sources: the run's tool outputs (metadata and long series removed, as for decisions) plus the end facts
    and the code-written evidence / refusal reasons (computed by code from the tool outputs)."""
    from agent.run import critic_sources   # late import: run.py imports this module
    outs = [critic_sources(r["output"]) for r in records if r.get("kind") == "tool_call" and "output" in r]
    e = f["end"]
    run_facts = {"stop_h": e.get("stop_h"), "ended_at_h": e.get("ended_at_h"), "horizon_h": e.get("horizon_h"),
                 "plate_hours_saved": e.get("plate_hours_saved"), "n_checks": len(f["checks"]),
                 "evidence": [c["evidence"] for c in f["checks"]]
                 + [x for rf in f["refusals"] for x in rf["reasons"]]}
    return outs + [run_facts]


# ---------------------------------------------------------------- template

def _h(x):
    return f"{x} h"


def template(f):
    """Deterministic report from the facts (no model). -> {"headline", "summary", "next_step", "caveats"}."""
    e, checks = f["end"], f["checks"]
    last = checks[-1] if checks else {}
    reason, at = e.get("reason"), e.get("stop_h") if e.get("stop_h") is not None else e.get("ended_at_h")
    kind = e.get("stop_kind")
    if reason == "stopped" and kind == "stall":
        head = f"Stopped at {_h(at)} after the stall flag fired, with human approval."
        nxt = "Have a human look at the wound before trusting the stall call: the stall flag is often wrong."
    elif reason == "stopped" and kind == "likely":
        head = f"Stopped at {_h(at)}: likely to close (untested), with human approval."
        nxt = "Check the last frames by eye, since this stop has never been tested on a held-out wound."
    elif reason == "stopped":
        head = f"Stopped at {_h(at)}: unlikely to close by the horizon, with human approval."
        nxt = "Review the decision card and the run log before reusing the plate slot."
    elif reason == "handed_to_human":
        head = "The upload was refused by quality checks and handed to a human."
        nxt = "Check the frames and the refusal reasons, then upload new frames if they can be fixed."
    elif reason == "schedule_complete":
        head = f"Imaged to the last check at {_h(at)} with no early stop."
        nxt = "Compare the next frames with the forecast band to see how the wound ends."
    elif reason in ("max_steps", "token_budget"):
        what = "step limit" if reason == "max_steps" else "token budget"
        head = f"The run ended early at {_h(at)}: the {what} was reached."
        nxt = "Review the run log by hand, or rerun with a new run ID."
    else:
        head = f"The run ended without a full result ({reason})."
        nxt = "Review the run log and the tool errors before rerunning."
    s = []
    if checks:
        cuts = ", ".join(_h(c["cut_h"]) for c in checks)
        s.append(f"The agent made {len(checks)} decision{'s' if len(checks) != 1 else ''}, at {cuts}.")
        ev = f" ({last['evidence']})" if last.get("evidence") else ""
        s.append(f"The last decision was \"{last.get('label')}\"{ev}.")
    else:
        s.append("The agent made no decision before the run ended.")
    if e.get("stopped"):
        s.append(f"Plate-hours saved: {e.get('plate_hours_saved')} against imaging to {_h(e.get('horizon_h'))} "
                 f"(simulated lab, human approval assumed).")
    else:
        s.append("No plate-hours were saved, because imaging was not stopped early.")
    for fl in f["flags"]:
        if fl["type"] == "stall":
            s.append(f"The stall flag fired at {_h(fl['cut_h'])}.")
            break
    if f["refusals"]:
        rs = "; ".join(f["refusals"][0]["reasons"]) or "no reason given"
        s.append(f"Quality checks refused the upload: {rs}.")
    inv = f.get("investigation")
    if inv and len(s) < 5:
        b = inv["hypotheses"][0]
        s.append(f"The Investigator's best-fitting start was \"{b['name']}\" (fit error {b['fit_error']}), "
                 f"a hypothesis, not a cause.")
    return {"headline": head, "summary": " ".join(s[:5]), "next_step": nxt, "caveats": []}


def fixed_caveats(f, texts=()):
    out = [CAVEAT_RESEARCH, CAVEAT_SIMULATED]
    if f.get("investigation"):
        out.append(CAVEAT_HYPOTHESES)
    out += [CAVEAT_SCOPE + n for n in f.get("intake_scope") or []]
    likely = any(c.get("decision") == policy.STOP_LIKELY or c.get("untested") for c in f["checks"]) \
        or f["end"].get("stop_kind") == "likely" or any(_LIKELY.search(t or "") for t in texts)
    if likely:
        out.append(CAVEAT_UNTESTED)
    return out


# ---------------------------------------------------------------- model call

def _valid(inp):
    """-> (fields, None) or (None, why). Strict: the four fields, right types, non-empty, bounded length."""
    if not isinstance(inp, dict):
        return None, "report input is not an object"
    extra = set(inp) - {"headline", "summary", "next_step", "caveats"}
    if extra:
        return None, f"unexpected report fields: {sorted(extra)}"
    for k in ("headline", "summary", "next_step"):
        v = inp.get(k)
        if not isinstance(v, str) or not v.strip():
            return None, f"report field {k} missing or empty"
        if len(v) > FIELD_MAX[k]:
            return None, f"report field {k} over {FIELD_MAX[k]} characters"
    cv = inp.get("caveats")
    if not isinstance(cv, list) or not all(isinstance(c, str) for c in cv):
        return None, "report caveats is not a list of strings"
    cv = [c.strip() for c in cv if c.strip()]
    if len(cv) > CAVEATS_MAX or any(len(c) > FIELD_MAX["caveat"] for c in cv):
        return None, "report caveats too many or too long"
    return {"headline": inp["headline"].strip(), "summary": inp["summary"].strip(),
            "next_step": inp["next_step"].strip(), "caveats": cv}, None


def _estimate(system, messages, tools_):
    chars = len(system) + len(json.dumps(messages, default=str)) + len(json.dumps(tools_, default=str))
    return -(-chars // CHARS_PER_TOKEN) + REPORT_MAX_TOKENS


def _ask_model(f, steps_left, tokens_left):
    """-> (fields or None, fallback_reason or None, call info dict)."""
    tool = prompts.report_tool()
    messages = [{"role": "user", "content": prompts.report_message(f)}]
    info = {"model_called": False, "usage": {"input_tokens": 0, "output_tokens": 0}, "model": None,
            "estimated_tokens": _estimate(prompts.REPORT_SYSTEM, messages, [tool])}
    if llm._provider() == "stub" and llm._stub_handler is None:
        return None, "no model set", info
    if steps_left is not None and steps_left <= 0:
        return None, "step limit reached (MAX_STEPS)", info
    if tokens_left is not None and (tokens_left <= 0 or info["estimated_tokens"] > tokens_left):
        return None, (f"token budget: estimated {info['estimated_tokens']} tokens > {max(tokens_left, 0)} left"), info
    info["model_called"] = True
    try:
        resp = llm.call_model(messages, system=prompts.REPORT_SYSTEM, tools=[tool], max_tokens=REPORT_MAX_TOKENS)
    except Exception as e:  # noqa: BLE001 - a failed call falls back to the template
        info["error"] = f"{type(e).__name__}: {e}"
        return None, f"model call failed: {info['error']}", info
    u = resp.get("usage") or {}
    info.update(model=resp.get("model"), stop_reason=resp.get("stop_reason"), cost_usd=resp.get("cost_usd"),
                usage={"input_tokens": int(u.get("input_tokens") or 0), "output_tokens": int(u.get("output_tokens") or 0)})
    if resp.get("stop_reason") == "refusal":
        return None, "model refused (stop_reason=refusal)", info
    call = next((c for c in resp.get("tool_calls") or [] if c.get("name") == prompts.REPORT_TOOL), None)
    if call is None:
        return None, f"no {prompts.REPORT_TOOL} call in the reply", info
    fields, why = _valid(call.get("input"))
    if why:
        info["raw"] = call.get("input")
        return None, f"invalid report: {why}", info
    info["raw"] = fields
    return fields, None, info


# ---------------------------------------------------------------- guards

def _guard(fields, tmpl, sources, calibrated):
    """Scope guard then Critic on every text field. -> (fields, scope hits, critic summary)."""
    from agent.run import scope_guard   # late import: run.py imports this module
    hits, removed, traced, untraced = [], [], 0, 0
    item = {"label": "Report", "evidence": "see the decision card"}
    out = {}
    for k in ("headline", "summary", "next_step"):
        _, h = scope_guard(fields[k], item)
        text = fields[k]
        if h:
            hits.append({"field": k, "matched": h})
            text = tmpl[k]
        cr = critic.trace(text, sources, calibrated_band=calibrated)
        removed += cr["removed"]; traced += cr["traced"]; untraced += cr["untraced"]
        out[k] = cr["text"]
    cav = []
    for i, c in enumerate(fields["caveats"]):
        _, h = scope_guard(c, item)
        if h:   # an out-of-scope caveat is dropped (the fixed caveats are added after this)
            hits.append({"field": f"caveats[{i}]", "matched": h})
            continue
        cr = critic.trace(c, sources, calibrated_band=calibrated)
        removed += cr["removed"]; traced += cr["traced"]; untraced += cr["untraced"]
        cav.append(cr["text"])
    out["caveats"] = cav
    return out, hits, {"removed": removed, "traced": traced, "untraced": untraced}


def _calibrated(records):
    from agent.run import calibrated_band
    docs = [r.get("output") for r in records if r.get("kind") == "tool_call"
            and r.get("tool") in ("forecast_lookup", "qc_forecast")]
    return bool(docs) and all(calibrated_band(d) for d in docs)


def summarise(records, steps_left=None, tokens_left=None):
    """End-of-run report from the run log. See the module docstring. -> dict (the fields of the `report` record)."""
    f, truncated = facts(records)
    tmpl = template(f)
    fields, why, info = _ask_model(f, steps_left, tokens_left)
    source = "llm" if fields else "template"
    sources = _sources(records, f)
    guarded, hits, cr = _guard(fields or tmpl, tmpl, sources, _calibrated(records))
    texts = [guarded["headline"], guarded["summary"], guarded["next_step"]] + guarded["caveats"]
    fixed = fixed_caveats(f, texts)
    caveats = fixed + [c for c in guarded["caveats"] if c not in fixed]
    rep = {"headline": guarded["headline"], "summary": guarded["summary"], "next_step": guarded["next_step"],
           "caveats": caveats, "source": source, "fallback_reason": why, "facts": f, "facts_truncated": truncated,
           "critic": cr, "scope": hits, "model": info.get("model"), "model_called": info["model_called"],
           "usage": info["usage"], "estimated_tokens": info["estimated_tokens"]}
    for k in ("stop_reason", "cost_usd", "error", "raw"):
        if k in info:
            rep[k] = info[k]
    return rep
