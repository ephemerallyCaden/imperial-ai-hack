"""Lead agent loop (design.md 9b, issue #81). Hand-written so every step is logged and code sets every decision.

  run_wound(run_id, wound, checks=config.CHECKS_H, approve=lambda decision: True, record_both_branches=False)
      -> summary dict (the run_end record, plus "branches" when a rejected branch was recorded)

`wound` is one of:
  - a WHAD wound id (wound_id such as "exp1_partII_C61_P1", or its "wound" name): the held-out forecast at each check is
    read from eval/forecasts/whad/loo_all/edge_speed_<cut>h.json
  - an upload result from tools.qc_forecast (one forecast doc, or {"refused": true, "reasons": [...]}): one check at
    its own cut-off
  - a list of forecast docs, one per check (each with cutoff_hours and forecasts)
  - frames to run through tools.qc_forecast: {"frames", "interval_h", "scale", "name"?, "held_out_wound"?}

On a held-out WHAD replay, code sets exclude_wound to the replayed wound (its WHAD name) on every tool call that
accepts it; the model never chooses it.

At each check: code runs the fixed steps (forecast at that cut-off, flags_schedule), policy.allowed() works out the
decisions, a forced decision (refused / stall) skips the model, otherwise the model proposes one via propose_decision,
policy.check() validates it (fallback: first allowed reversible decision), the Critic traces every number in the
explanation, and an irreversible decision (a stop) needs approve(decision). Everything goes to agent/runs/<run_id>.jsonl.

The Critic traces against tool outputs with metadata subtrees (META_KEYS) removed (numbers in wound names, notes or
protocol text are never evidence) and numeric lists longer than config.CRITIC_LIST_MAX dropped (curves, quantile series,
ensemble members): only scalar summary fields and short lists are evidence. Before the Critic, scope_guard (a keyword
filter, config.SCOPE_TERMS) replaces any explanation with clinical / treatment or molecule-design text by a neutral
template from the decision's label and evidence, and logs a "scope" record. Metadata sent to the model is truncated
(META_STR_MAX per string, META_TOTAL_MAX in total); the prompt size is estimated before each call and the call is
skipped (fallback) if it would exceed the token budget left. If the budget runs out on a call, that check still gets its Critic and decision records, then the run
stops. With record_both_branches, <run_id>.reject.jsonl is created before the first approval is asked, so an existing
file fails before any stop (the parent log still gets run_end); run_end lists branch_run_ids.

Investigator (issue #87): when a wound is off track at a check (the stall flag fired, or the first 2 observed frames
after the previous check both fell outside the previous check's forecast band, the eval/flags.py out-of-band rule), code
calls the `investigate` tool once per run with the observed curve up to this check only. It is logged as a tool_call (so
the Critic can trace its fit errors) and its ranked hypotheses go into the model's data block. It never changes the
decision: policy.allowed() sees only the state, which the Investigator does not touch.

What a human answer does (issue #83 replay semantics):
  - "stall flagged, ask a human": approve(decision) is asked; approved = stop the plate at that check (stop_kind
    "stall"), rejected = keep imaging.
  - "stop, unlikely / likely to close": approved = stop at that check (stop_kind "unlikely" / "likely"), rejected =
    keep imaging.
  - "ask a human to review": the human reviews (logged as human_review) and imaging continues.
  - "data refused, ask a human": nothing to image on; the run ends as handed_to_human.

CLI: python -m agent.run --wound <id> --run-id <id>
"""
import argparse
import copy
import json
import os
import re
import time

import numpy as np

from agent import config, critic, llm, policy, prompts, reporter, tools
from agent.runlog import RunLog, fingerprint

LOO_DIR = os.path.join(config.REPO, "eval", "forecasts", "whad", "loo_all")
HANDOVER = {policy.ASK_HUMAN_REFUSED}   # ends the run with no stop
STOP_KIND = {policy.ASK_HUMAN_STALL: "stall", policy.STOP_UNLIKELY: "unlikely", policy.STOP_LIKELY: "likely"}
META_KEYS = ("wound_id", "wound", "condition", "part", "name", "notes", "metadata", "protocol_text", "dataset")
META_STR_MAX, META_TOTAL_MAX = 500, 2000   # chars per metadata string / over all metadata strings
META_JSON_MAX = 4000                       # whole metadata block (keys and numbers too); bigger is dropped
CHARS_PER_TOKEN = 4                        # rough prompt-size estimate used before a model call
MODEL_MAX_TOKENS = 1024
TRUNC = "...[truncated]"


# ---------------------------------------------------------------- wound sources

_LOO_CACHE = {}


def _loo_doc(cut):
    """Parsed LOO forecast file for this cut-off, read once per process (callers must not mutate it; _one copies)."""
    path = os.path.join(LOO_DIR, f"edge_speed_{cut}h.json")
    key = (path, os.path.getmtime(path))
    if key not in _LOO_CACHE:
        with open(path) as fh:
            _LOO_CACHE[key] = json.load(fh)
    return _LOO_CACHE[key]


def _one(doc, wound_id):
    """Forecast doc narrowed to one wound (by wound_id or wound name); None if the wound is not in it."""
    fcs = doc.get("forecasts") or []
    if wound_id is not None:
        fcs = [f for f in fcs if wound_id in (f.get("wound_id"), f.get("wound"))]
    if not fcs:
        return None
    out = copy.deepcopy({k: v for k, v in doc.items() if k != "forecasts"})
    out["forecasts"] = [copy.deepcopy(fcs[0])]
    return out


EXCLUDABLE = {t["name"] for t in tools.TOOLS if "exclude_wound" in t["input_schema"]["properties"]}


class _Source:
    """Gives the forecast doc for a check and records where it came from. On a held-out WHAD replay, `held_out` is
    the replayed wound's WHAD name; code (never the model) sets it as exclude_wound on every tool call that takes it."""

    def __init__(self, wound, checks):
        self.wound_id, self.held_out, self.docs = None, None, {}
        if isinstance(wound, str):
            self.wound_id, self.kind, self.checks = wound, "whad_loo", list(checks)
        elif isinstance(wound, dict) and "frames" in wound:   # frames to run through qc_forecast
            self.kind, self.frames = "frames", wound
            self.held_out = wound.get("held_out_wound")
            self.wound_id = self.held_out
            self.checks = [round((len(wound["frames"]) - 1) * float(wound["interval_h"]), 3)]
        elif isinstance(wound, dict):
            self.kind = "upload"
            cut = float(wound.get("cutoff_hours", 0.0))
            self.checks, self.docs[cut] = [cut], wound
        elif isinstance(wound, (list, tuple)):
            self.kind = "docs"
            for d in wound:
                self.docs[float(d["cutoff_hours"])] = d
            self.checks = [c for c in checks if float(c) in self.docs] or sorted(self.docs)
        else:
            raise ValueError("wound must be a WHAD wound id, an upload result, frames or a list of forecast docs")
        if self.kind == "whad_loo":   # resolve the WHAD wound name (the key exclude_wound matches) up front
            for c in self.checks:
                try:
                    one = _one(_loo_doc(c), self.wound_id)
                except (OSError, ValueError):
                    continue
                if one:
                    self.wound_id = one["forecasts"][0].get("wound_id", self.wound_id)
                    self.held_out = one["forecasts"][0].get("wound")
                    break

    def describe(self):
        return {"kind": self.kind, "wound_id": self.wound_id, "held_out_wound": self.held_out, "checks_h": self.checks}

    def step(self, cut):
        """-> (tool name, input, fn) for the forecast step at this cut-off."""
        if self.kind == "frames":
            f = self.frames
            inp = {"frames": list(f["frames"]), "interval_h": f["interval_h"], "scale": f["scale"],
                   "name": f.get("name", "upload")}
            if "exclude_wound" in f:
                inp["exclude_wound"] = f["exclude_wound"]   # overridden by code on held-out replays
            return "qc_forecast", inp, lambda i: _narrow(tools.run_tool("qc_forecast", i))
        if self.kind == "whad_loo":
            inp = {"source": os.path.relpath(os.path.join(LOO_DIR, f"edge_speed_{cut}h.json"), config.REPO),
                   "wound_id": self.wound_id, "cutoff_hours": cut,
                   "exclude_wound": self.held_out, "fold": "loo_all (forecast made with this wound held out)"}

            def fn(_):
                doc = _one(_loo_doc(cut), self.wound_id)
                return doc if doc else {"error": f"no forecast for {self.wound_id} at {cut} h"}
            return "forecast_lookup", inp, fn
        doc = self.docs.get(float(cut))
        inp = {"source": self.kind, "cutoff_hours": cut, "precomputed": True}
        return ("qc_forecast" if self.kind == "upload" else "forecast_lookup"), inp, \
            lambda _: {"error": f"no forecast doc at {cut} h"} if doc is None else _narrow(doc, cut)


def _narrow(doc, cut=None):
    if doc.get("error"):
        return doc
    if doc.get("refused"):
        out = {"refused": True, "reasons": list(doc.get("reasons", []))}
        if cut is not None:
            out["cutoff_hours"] = cut
        return out
    one = _one(doc, None)
    return one if one else {"error": "forecast doc has no forecasts"}


# ---------------------------------------------------------------- the loop

class _Stop(Exception):
    def __init__(self, reason):
        self.reason = reason


class _Run:
    def __init__(self, run_id, source, approve, record_both, max_steps, token_budget, runs_dir, parent=None, log=None):
        self.log = log or (RunLog(run_id, runs_dir=runs_dir) if runs_dir else RunLog(run_id))
        self.run_id, self.src, self.approve, self.record_both = run_id, source, approve, record_both
        self.max_steps, self.token_budget, self.runs_dir = max_steps, token_budget, runs_dir
        self.steps, self.tok_in, self.tok_out, self.traced, self.untraced = 0, 0, 0, 0, 0
        self.inherited_outputs, self.branches, self.last, self.last_cut = [], [], None, None
        self.inherited_records = []   # the parent's records up to the branch point (Reporter facts)
        self.budget_out, self.child_log, self.child_used = False, None, False
        self.investigated, self.prev_doc = False, None
        if parent is not None:   # a branch shares the parent's counters and evidence up to the branch point
            for k in ("steps", "tok_in", "tok_out", "traced", "untraced", "last", "last_cut", "budget_out",
                      "investigated", "prev_doc"):
                setattr(self, k, copy.deepcopy(getattr(parent, k)))
            self.inherited_outputs = parent.inherited_outputs + parent.log.tool_outputs()
            self.inherited_records = parent.inherited_records + list(parent.log.records)

    # -- limits
    def _step(self):
        if self.steps >= self.max_steps:
            raise _Stop("max_steps")
        self.steps += 1

    def _tokens(self):
        return self.tok_in + self.tok_out

    def _outputs(self):
        """Critic sources (critic_sources): tool outputs with metadata subtrees (META_KEYS) removed and long numeric
        series dropped. Numbers in names, notes or protocol text come from files, not tools, so they are never
        evidence; a long curve would let almost any made-up value trace by rounding."""
        return [critic_sources(o) for o in self.inherited_outputs + self.log.tool_outputs()]

    # -- fixed steps
    def _tool(self, name, inp, fn, **extra):
        """Run one fixed step. On a held-out replay, code forces exclude_wound on any tool that accepts it."""
        if self.src.held_out is not None and name in EXCLUDABLE:
            inp = {**inp, "exclude_wound": self.src.held_out}
        self._step()
        t0 = time.time()
        try:
            out = fn(inp)
        except Exception as e:  # noqa: BLE001 - tool errors are logged as data
            out = {"error": f"{type(e).__name__}: {e}"}
        self.log.log("tool_call", step=self.steps, tool=name, input_fp=fingerprint(inp), input=inp, output=out,
                     elapsed_s=round(time.time() - t0, 3), **extra)
        return out

    def _investigate(self, doc, cut, state):
        """Once per run, only when off track: the Investigator on the observed curve up to this check. -> output or None."""
        if self.investigated or doc.get("refused"):
            return None
        trigger = off_track(doc, self.prev_doc, cut, state)
        if trigger is None:
            return None
        f = doc["forecasts"][0]
        obs = f.get("observed") or {}
        pts = [(t, a) for t, a in zip(obs.get("t_hours") or [], obs.get("area") or []) if t <= cut + 1e-9]
        if not any(t > 1e-9 for t, _ in pts):
            return None
        self.investigated = True
        inp = {"observed": {"t_hours": [t for t, _ in pts], "area": [a for _, a in pts]}, "check_h": cut,
               "condition": f.get("condition") if f.get("condition") in ("CC", "C61") else "CC"}
        return self._tool("investigate", inp, lambda i: tools.run_tool("investigate", i), trigger=trigger)

    # -- the model's open choice
    def _propose(self, cut, state, allowed, data):
        """-> (decision_id, explanation, fallback_reason or None)."""
        ids = [d["id"] for d in allowed]
        system, tool = prompts.SYSTEM, prompts.decision_tool(ids)
        messages = [{"role": "user", "content": prompts.user_message(cut, allowed, data)}]
        remaining = self.token_budget - self._tokens()
        est = estimate_tokens(system, messages, [tool]) + MODEL_MAX_TOKENS
        if remaining <= 0 or est > remaining:   # skip the call; this check still gets a (fallback) decision
            why = "token budget exhausted" if remaining <= 0 else \
                f"estimated prompt + reply {est} tokens > {remaining} left in the token budget"
            self.log.log("model_skipped", cut_h=cut, reason=why, estimated_tokens=est, tokens_left=remaining, data=data)
            if remaining <= 0:
                self.budget_out = True
            return None, None, f"model call skipped: {why}"
        self._step()
        t0 = time.time()
        try:
            resp, err = llm.call_model(messages, system=system, tools=[tool], max_tokens=MODEL_MAX_TOKENS), None
        except Exception as e:  # noqa: BLE001 - a failed call falls back like an invalid proposal
            resp, err = None, f"{type(e).__name__}: {e}"
        rec = {"step": self.steps, "input_fp": fingerprint({"system": system, "messages": messages, "tools": [tool]}),
               "elapsed_s": round(time.time() - t0, 3), "estimated_tokens": est, "data": data}
        if resp is None:
            self.log.log("model_call", error=err, **rec)
            return None, None, f"model call failed: {err}"
        u = resp.get("usage") or {}
        self.tok_in += int(u.get("input_tokens") or 0)
        self.tok_out += int(u.get("output_tokens") or 0)
        self.log.log("model_call", model=resp.get("model"), stop_reason=resp.get("stop_reason"), usage=u, cost_usd=resp.get("cost_usd"),
                     tokens_total=self._tokens(), text=resp.get("text", ""), tool_calls=resp.get("tool_calls", []),
                     **rec)
        if self._tokens() >= self.token_budget:   # finish this check (Critic + decision), then stop the run
            self.budget_out = True
        if resp.get("stop_reason") == "refusal":
            return None, None, "model refused (stop_reason=refusal)"
        call = next((c for c in resp.get("tool_calls") or [] if c.get("name") == prompts.TOOL_NAME), None)
        if call is None:
            return None, None, f"no {prompts.TOOL_NAME} call in the reply"
        inp = call.get("input") if isinstance(call.get("input"), dict) else {}
        did, expl = inp.get("decision_id"), inp.get("explanation")
        if not isinstance(did, str) or not isinstance(expl, str) or not expl.strip():
            return None, None, "proposal missing decision_id or explanation"
        ok, why = policy.check(did, state)
        if not ok:
            return did, None, f"policy rejected proposal: {why}"
        return did, expl, None

    def _check(self, k, checks):
        cut = checks[k]
        nxt = checks[k + 1] if k + 1 < len(checks) else None
        self.last_cut = cut
        name, inp, fn = self.src.step(cut)
        doc = self._tool(name, inp, lambda i: _with_summary(fn(i)))
        if doc.get("error"):
            raise _Stop("no_forecast")
        refused = bool(doc.get("refused"))
        fl = None
        if not refused:
            fl = self._tool("flags_schedule", {"forecast_fp": fingerprint(doc), "cutoff_hours": cut},
                            lambda _: tools.flags_schedule(doc))
            if fl.get("error"):
                raise _Stop("tool_error")
        results = (fl or {}).get("results") if fl else None
        res = results[0] if isinstance(results, list) and results and isinstance(results[0], dict) else {}
        if fl is not None and not res:
            self.log.log("warning", cut_h=cut, tool="flags_schedule",
                         message="flags_schedule returned no results; treated as no stall flag and no schedule advice")
        stall, sched = res.get("stall") or {}, res.get("schedule") or {}
        state = {"refused": refused, "stall": bool(stall.get("fired")), "p_close": sched.get("p_close_by_T"),
                 "cut_h": cut, "next_check_h": nxt}
        allowed = policy.allowed(state)
        inv = self._investigate(doc, cut, state)
        self.prev_doc = doc
        forced = refused or state["stall"]
        proposed, fallback = None, None
        if forced:
            did, source = allowed[0]["id"], "forced"
            expl = f"{allowed[0]['label']}: {allowed[0]['evidence']}."
        else:
            meta, meta_trunc = _metadata(doc)
            data = {"allowed_decisions": allowed, "state": state, "stall": stall, "schedule": sched,
                    "forecast": _forecast_facts(doc), "wound_metadata": meta}
            if meta_trunc:
                data["wound_metadata_truncated"] = True
            if inv and inv.get("hypotheses"):
                data["investigation"] = {"note": inv["note"], "check_h": inv["check_h"],
                                         "hypotheses": [{k: h[k] for k in ("name", "rank", "fit_error")}
                                                        for h in inv["hypotheses"]]}
            proposed, expl, fallback = self._propose(cut, state, allowed, data)
            did, source = proposed, "llm"
            if fallback:
                first = next(d for d in allowed if not d["irreversible"])
                did, source = first["id"], "fallback"
                expl = f"{first['label']}: {first['evidence']}."
        item = next(d for d in allowed if d["id"] == did)
        guarded, hits = scope_guard(expl, item)
        if hits:   # every explanation, before it is shown: no clinical / molecule-design text reaches the scientist
            self.log.log("scope", cut_h=cut, decision=did, source=source, matched=hits, text_in=expl, text_out=guarded,
                         reason="out of scope (keyword filter): clinical, treatment or molecule-design text replaced "
                                "by a neutral template")
            expl = guarded
        calibrated = calibrated_band(doc)
        cr = critic.trace(expl, self._outputs(), calibrated_band=calibrated)
        self.traced += cr["traced"]; self.untraced += cr["untraced"]
        self.log.log("critic", cut_h=cut, calibrated_band=calibrated, removed=cr["removed"], traced=cr["traced"],
                     untraced=cr["untraced"], text_in=expl, text_out=cr["text"])
        self.last = {**item, "explanation": cr["text"], "cut_h": cut}
        self.log.log("decision", cut_h=cut, state=state, allowed=[_allowed_item(d) for d in allowed], decision=did,
                     label=item["label"], irreversible=item["irreversible"], untested=item["untested"], source=source,
                     proposed=proposed, fallback_reason=fallback, explanation=cr["text"])
        return item, cut

    def _approval(self, item, cut, approved, note=None):
        self.log.log("approval", cut_h=cut, decision=item["id"], approved=approved, approver="human", note=note)

    def run_from(self, k, checks):
        try:
            while k < len(checks):
                item, cut = self._check(k, checks)
                if item["irreversible"] or item["id"] == policy.ASK_HUMAN_STALL:   # approved = stop the plate
                    if self.record_both:
                        self._reserve_branch()   # an existing <run_id>.reject log fails here, before approval
                    dec = {**self.last, "run_id": self.run_id}
                    try:
                        ok, note = bool(self.approve(dec)), None
                    except Exception as e:  # noqa: BLE001 - an approver error counts as a reject
                        ok, note = False, f"approver error: {type(e).__name__}: {e}"
                    self._approval(item, cut, ok, note)
                    if ok:
                        if self.record_both:
                            self._branch(item, cut, k, checks)
                        return self._end("stopped", stop_h=cut, stop_kind=STOP_KIND[item["id"]])
                elif item["id"] == policy.ASK_HUMAN:
                    self.log.log("human_review", cut_h=cut, decision=item["id"], note="human reviewed; imaging continues")
                elif item["id"] in HANDOVER:
                    return self._end("handed_to_human")
                if self.budget_out:
                    raise _Stop("token_budget")
                k += 1
            return self._end("schedule_complete")
        except _Stop as s:
            return self._end(s.reason)
        except FileExistsError as e:   # the rejected-branch log already exists: end this run cleanly, then fail
            self._end("branch_log_exists", error=str(e))
            raise

    def _reserve_branch(self):
        if self.child_log is None:
            kw = {"runs_dir": self.runs_dir} if self.runs_dir else {}
            self.child_log = RunLog(f"{self.run_id}.reject", **kw)

    def _branch(self, item, cut, k, checks):
        self._reserve_branch()
        child = _Run(self.child_log.run_id, self.src, self.approve, False, self.max_steps, self.token_budget,
                     self.runs_dir, parent=self, log=self.child_log)
        self.child_used = True
        child.log.log("run_start", parent_run_id=self.run_id, branch_seq=self.log.seq - 1, branch_cut_h=cut,
                      wound=self.src.describe(), checks_h=checks, max_steps=self.max_steps,
                      token_budget=self.token_budget, model_provider=llm._provider(), model_id=_model_id())
        child._approval(item, cut, False, "recorded rejected branch")
        if child.budget_out:   # the branch point already used up the budget
            self.branches.append(child._end("token_budget"))
        else:
            self.branches.append(child.run_from(k + 1, checks))

    def _report(self, end):
        """Reporter (reporter.summarise), once per run log, just before run_end. The report call counts against
        MAX_STEPS and TOKEN_BUDGET; with none left it is the template. A Reporter error never blocks run_end."""
        recs = self.inherited_records + list(self.log.records) + [{"kind": "run_end", **end}]
        try:
            rep = reporter.summarise(recs, steps_left=self.max_steps - self.steps,
                                     tokens_left=self.token_budget - self._tokens())
        except Exception as e:  # noqa: BLE001 - the run must still end with run_end
            self.log.log("report", source="error", error=f"{type(e).__name__}: {e}")
            return
        if rep.get("model_called"):
            self.steps += 1
            self.tok_in += rep["usage"]["input_tokens"]
            self.tok_out += rep["usage"]["output_tokens"]
            rep["step"] = self.steps
        self.log.log("report", **rep)

    def _end(self, reason, stop_h=None, stop_kind=None, **extra):
        last = self.last or {}
        if self.child_log is not None and not self.child_used and not self.child_log.records:
            try:   # reserved for a rejected branch that was never needed (the stop was rejected): drop the empty file
                os.remove(self.child_log.path)
            except OSError:
                pass
            self.child_log = None
        end = dict(reason=reason, decision=last.get("id"), decision_label=last.get("label"),
                   explanation=last.get("explanation"), stopped=stop_h is not None, stop_h=stop_h, stop_kind=stop_kind,
                   ended_at_h=self.last_cut, horizon_h=config.HORIZON_H,
                   plate_hours_saved=round(config.HORIZON_H - stop_h, 3) if stop_h is not None else 0.0)
        self._report(end)
        summary = self.log.log(
            "run_end", **end,
            steps=self.steps, tokens={"input": self.tok_in, "output": self.tok_out, "total": self._tokens()},
            numbers_traced=self.traced, numbers_untraced=self.untraced,
            branch_run_ids=[b["run_id"] for b in self.branches], **extra)
        out = dict(summary)
        if self.branches:
            out["branches"] = self.branches
        return out


def off_track(doc, prev_doc, cut, state):
    """-> "stall_flag", "out_of_band" or None. Out of band = eval/flags.py rule: the first 2 observed frames after the
    previous check's cut-off (both at or before this check) are both outside that check's forecast band."""
    if state.get("stall"):
        return "stall_flag"
    try:
        p, f = prev_doc["forecasts"][0], doc["forecasts"][0]
        pc = float(prev_doc["cutoff_hours"])
        obs = f["observed"]
        nxt = [(t, a) for t, a in zip(obs["t_hours"], obs["area"]) if pc + 1e-9 < t <= cut + 1e-9][:2]
        if len(nxt) < 2:
            return None
        ft = p["t_hours"]
        interp = lambda t, k: float(np.interp(t, ft, p[k]))  # noqa: E731
        out = [a < interp(t, "area_q05") or a > interp(t, "area_q95") for t, a in nxt]
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return "out_of_band" if all(out) else None


SIM_MODELS = ("sim_ensemble", "nca_ensemble")   # sim/upload.py bands: never a calibrated 90% band


def calibrated_band(doc):
    """True when the forecast's band is the calibrated data/upload.py band (any model data/upload.py returns:
    nca_realft3, edge_speed, whad_population_prior; or the LOO edge_speed files) with level 0.9. Simulator / NCA
    ensemble bands from sim/upload.py (tools.simulate marks them calibrated: false) are never calibrated."""
    if not isinstance(doc, dict) or doc.get("refused") or doc.get("error"):
        return False
    if doc.get("model") in SIM_MODELS or doc.get("calibrated") is False:
        return False
    flags = [fl for f in doc.get("forecasts", []) if isinstance(f, dict) for fl in f.get("flags", []) or []]
    if any(isinstance(fl, dict) and fl.get("type") == "uncalibrated_condition" for fl in flags):
        return False   # condition outside the calibration set: band widened, not a calibrated 90% band (#108)
    lvl = doc.get("level")
    return isinstance(lvl, (int, float)) and not isinstance(lvl, bool) and abs(float(lvl) - config.BAND_LEVEL) < 1e-9


def _with_summary(doc):
    """Forecast doc plus a "summary" of scalars taken from its curves: the area quantiles at the last forecast time
    (the horizon). The Critic drops long series (critic_sources), so these are the curve values it can still trace;
    they are the same values the model sees in the data block (_forecast_facts)."""
    if not isinstance(doc, dict) or doc.get("error") or doc.get("refused") or not doc.get("forecasts"):
        return doc
    f = doc["forecasts"][0]
    last = lambda k: (f.get(k) or [None])[-1]  # noqa: E731
    return {**doc, "summary": {"area_q05_last": last("area_q05"), "area_q50_last": last("area_q50"),
                               "area_q95_last": last("area_q95")}}


def _forecast_facts(doc):
    """Short view of the forecast for the model (all numbers are tool output)."""
    if doc.get("refused"):
        return {"refused": True, "reasons": doc.get("reasons", [])}
    f = doc["forecasts"][0]
    t = f.get("t_hours") or []
    pick = lambda k: (f.get(k) or [None])[-1]  # noqa: E731
    return {"model": doc.get("model"), "band_level": doc.get("level"), "cutoff_hours": doc.get("cutoff_hours"),
            "horizon_hours": t[-1] if t else None, "area_q50_at_horizon": pick("area_q50"),
            "area_q05_at_horizon": pick("area_q05"), "area_q95_at_horizon": pick("area_q95"),
            "t50": f.get("t50"), "t90": f.get("t90"), "p_close_by_T": f.get("p_close_by_T"),
            "p_stall": f.get("p_stall"), "flags": f.get("flags")}


def _metadata(doc):
    """Free text from files (names, notes, protocol text). Data only: it goes inside the delimited block.
    -> (metadata, truncated). Each string is cut to META_STR_MAX chars and all strings together to META_TOTAL_MAX;
    if the whole block is still over META_JSON_MAX chars of JSON it is dropped."""
    meta = {k: doc[k] for k in META_KEYS if k in doc}
    for f in doc.get("forecasts") or []:
        meta.update({f"forecast.{k}": f[k] for k in META_KEYS if k in f})
    left = [META_TOTAL_MAX]
    cut = [False]

    def trunc(o):
        if isinstance(o, str):
            n = min(len(o), META_STR_MAX, left[0])
            left[0] -= n
            if n < len(o):
                cut[0] = True
                return o[:n] + TRUNC
            return o
        if isinstance(o, dict):
            return {str(k)[:META_STR_MAX]: trunc(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [trunc(v) for v in o]
        return o
    meta = trunc(meta)
    if len(json.dumps(meta, default=str)) > META_JSON_MAX:
        return {"dropped": f"wound metadata over {META_JSON_MAX} characters"}, True
    return meta, cut[0]


_SCOPE_RX = {kind: re.compile(r"\b(?:" + "|".join(terms) + r")\b", re.I) for kind, terms in config.SCOPE_TERMS.items()}


def scope_guard(text, item):
    """Keyword filter (config.SCOPE_TERMS), not a classifier. -> (text, matched). If `text` contains a clinical /
    treatment or molecule-design term, it is replaced by the neutral template "<label>: <evidence>." for the decision
    and `matched` lists {"kind", "term"} per distinct term found; otherwise (text, [])."""
    hits, seen = [], set()
    for kind, rx in _SCOPE_RX.items():
        for m in rx.finditer(text or ""):
            term = m.group(0).lower()
            if (kind, term) not in seen:
                seen.add((kind, term))
                hits.append({"kind": kind, "term": term})
    if not hits:
        return text, []
    return f"{item['label']}: {item['evidence']}.", hits


def critic_sources(obj):
    """Copy of a tool output for the Critic: META_KEYS subtrees removed (at any depth) and numeric lists longer than
    config.CRITIC_LIST_MAX dropped (curves, quantile series, ensemble members), so a made-up number cannot trace by
    rounding to one point of a long series. Scalar summary fields and short lists stay."""
    if isinstance(obj, dict):
        return {k: critic_sources(v) for k, v in obj.items() if k not in META_KEYS and not _long_series(v)}
    if isinstance(obj, (list, tuple)):
        return [critic_sources(v) for v in obj if not _long_series(v)]
    return obj


def _long_series(v):
    return isinstance(v, (list, tuple)) and len(v) > config.CRITIC_LIST_MAX and \
        all(x is None or (isinstance(x, (int, float)) and not isinstance(x, bool)) for x in v)


def _allowed_item(d):
    return {k: d[k] for k in ("id", "label", "evidence", "irreversible", "untested")}


def estimate_tokens(system, messages, tools_):
    """Rough prompt size in tokens (characters / CHARS_PER_TOKEN, rounded up)."""
    chars = len(system) + len(json.dumps(messages, default=str)) + len(json.dumps(tools_, default=str))
    return -(-chars // CHARS_PER_TOKEN)


def _model_id():
    return llm._model_id(os.environ.get("STITCH_PROVIDER", "stub").strip().lower())


def run_wound(run_id, wound, checks=config.CHECKS_H, approve=lambda decision: True, record_both_branches=False,
              runs_dir=None, max_steps=None, token_budget=None):
    """Run the lead agent on one wound across the checks. Returns the run_end summary (plus "branches")."""
    src = _Source(wound, checks)
    max_steps = config.MAX_STEPS if max_steps is None else max_steps
    token_budget = config.TOKEN_BUDGET if token_budget is None else token_budget
    r = _Run(run_id, src, approve, record_both_branches, max_steps, token_budget, runs_dir)
    r.log.log("run_start", wound=src.describe(), checks_h=src.checks, max_steps=max_steps, token_budget=token_budget,
              record_both_branches=record_both_branches, model_provider=llm._provider(),
              model_id=_model_id())
    return r.run_from(0, src.checks)


# ---------------------------------------------------------------- CLI

def replay_stub(messages, system, tools_):
    """Deterministic offline model for STITCH_PROVIDER=stub: follows the schedule advice, quotes the evidence."""
    text = messages[-1]["content"]
    if tools_[0]["name"] == prompts.REPORT_TOOL:   # the Reporter: the template from the fact block, as the "reply"
        facts = json.loads(text.split(f"<{prompts.REPORT_TAG}>", 1)[1].split(f"</{prompts.REPORT_TAG}>", 1)[0])
        return {"tool_calls": [{"id": "stub_r", "name": prompts.REPORT_TOOL, "input": reporter.template(facts)}],
                "stop_reason": "tool_use", "model": "replay_stub"}
    allowed = tools_[0]["input_schema"]["properties"]["decision_id"]["enum"]
    data = json.loads(text.split(f"<{prompts.DATA_TAG}>", 1)[1].split(f"</{prompts.DATA_TAG}>", 1)[0])
    pick = next(d for d in (policy.STOP_UNLIKELY, policy.IMAGE_AGAIN, policy.CONTINUE) if d in allowed)
    item = next(d for d in data["allowed_decisions"] if d["id"] == pick)
    return {"tool_calls": [{"id": "stub_1", "name": prompts.TOOL_NAME,
                            "input": {"decision_id": pick, "explanation": f"{item['label']}: {item['evidence']}."}}],
            "stop_reason": "tool_use", "model": "replay_stub"}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Run the lead agent on one wound (design.md 9b).")
    ap.add_argument("--wound", required=True, help="WHAD wound id, or a path to an upload result JSON")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--checks", type=float, nargs="*", default=config.CHECKS_H)
    ap.add_argument("--reject", action="store_true", help="simulated human rejects every stop (default approves)")
    ap.add_argument("--both-branches", action="store_true", help="also record the rejected branch (<run-id>.reject)")
    ap.add_argument("--runs-dir", default=None)
    a = ap.parse_args(argv)
    wound = a.wound
    if wound.endswith(".json") and os.path.isfile(wound):
        with open(wound) as fh:
            wound = json.load(fh)
    if llm._provider() == "stub" and llm._stub_handler is None:
        llm.set_stub(replay_stub)
    out = run_wound(a.run_id, wound, checks=a.checks, approve=(lambda d: not a.reject),
                    record_both_branches=a.both_branches, runs_dir=a.runs_dir)
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
