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

CLI: python -m agent.run --wound <id> --run-id <id>
"""
import argparse
import copy
import json
import os
import time

from agent import config, critic, llm, policy, prompts, tools
from agent.runlog import RunLog, fingerprint

LOO_DIR = os.path.join(config.REPO, "eval", "forecasts", "whad", "loo_all")
HANDOVER = {policy.ASK_HUMAN, policy.ASK_HUMAN_STALL, policy.ASK_HUMAN_REFUSED}
META_KEYS = ("wound_id", "wound", "condition", "part", "name", "notes", "metadata", "protocol_text", "dataset")


# ---------------------------------------------------------------- wound sources

def _loo_doc(cut):
    return json.load(open(os.path.join(LOO_DIR, f"edge_speed_{cut}h.json")))


def _one(doc, wound_id):
    """Forecast doc narrowed to one wound (by wound_id or wound name); None if the wound is not in it."""
    fcs = doc.get("forecasts") or []
    if wound_id is not None:
        fcs = [f for f in fcs if wound_id in (f.get("wound_id"), f.get("wound"))]
    if not fcs:
        return None
    out = {k: v for k, v in doc.items() if k != "forecasts"}
    out["forecasts"] = [fcs[0]]
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
    def __init__(self, run_id, source, approve, record_both, max_steps, token_budget, runs_dir, parent=None):
        self.log = RunLog(run_id, runs_dir=runs_dir) if runs_dir else RunLog(run_id)
        self.run_id, self.src, self.approve, self.record_both = run_id, source, approve, record_both
        self.max_steps, self.token_budget, self.runs_dir = max_steps, token_budget, runs_dir
        self.steps, self.tok_in, self.tok_out, self.traced, self.untraced = 0, 0, 0, 0, 0
        self.inherited_outputs, self.branches, self.last, self.last_cut = [], [], None, None
        if parent is not None:   # a branch shares the parent's counters and evidence up to the branch point
            for k in ("steps", "tok_in", "tok_out", "traced", "untraced", "last", "last_cut"):
                setattr(self, k, copy.deepcopy(getattr(parent, k)))
            self.inherited_outputs = parent.inherited_outputs + parent.log.tool_outputs()

    # -- limits
    def _step(self):
        if self.steps >= self.max_steps:
            raise _Stop("max_steps")
        self.steps += 1

    def _tokens(self):
        return self.tok_in + self.tok_out

    def _outputs(self):
        return self.inherited_outputs + self.log.tool_outputs()

    # -- fixed steps
    def _tool(self, name, inp, fn):
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
                     elapsed_s=round(time.time() - t0, 3))
        return out

    # -- the model's open choice
    def _propose(self, cut, state, allowed, data):
        """-> (decision_id, explanation, fallback_reason or None)."""
        ids = [d["id"] for d in allowed]
        system, tool = prompts.SYSTEM, prompts.decision_tool(ids)
        messages = [{"role": "user", "content": prompts.user_message(cut, allowed, data)}]
        if self._tokens() >= self.token_budget:
            raise _Stop("token_budget")
        self._step()
        t0 = time.time()
        try:
            resp, err = llm.call_model(messages, system=system, tools=[tool], max_tokens=1024), None
        except Exception as e:  # noqa: BLE001 - a failed call falls back like an invalid proposal
            resp, err = None, f"{type(e).__name__}: {e}"
        rec = {"step": self.steps, "input_fp": fingerprint({"system": system, "messages": messages, "tools": [tool]}),
               "elapsed_s": round(time.time() - t0, 3)}
        if resp is None:
            self.log.log("model_call", error=err, **rec)
            return None, None, f"model call failed: {err}"
        u = resp.get("usage") or {}
        self.tok_in += int(u.get("input_tokens") or 0)
        self.tok_out += int(u.get("output_tokens") or 0)
        self.log.log("model_call", model=resp.get("model"), stop_reason=resp.get("stop_reason"), usage=u,
                     tokens_total=self._tokens(), text=resp.get("text", ""), tool_calls=resp.get("tool_calls", []),
                     **rec)
        if self._tokens() >= self.token_budget:
            raise _Stop("token_budget")
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
        doc = self._tool(name, inp, fn)
        if doc.get("error"):
            raise _Stop("no_forecast")
        refused = bool(doc.get("refused"))
        fl = None
        if not refused:
            fl = self._tool("flags_schedule", {"forecast_fp": fingerprint(doc), "cutoff_hours": cut},
                            lambda _: tools.flags_schedule(doc))
            if fl.get("error"):
                raise _Stop("tool_error")
        res = (fl or {}).get("results", [{}])[0] if fl else {}
        stall, sched = res.get("stall") or {}, res.get("schedule") or {}
        state = {"refused": refused, "stall": bool(stall.get("fired")), "p_close": sched.get("p_close_by_T"),
                 "cut_h": cut, "next_check_h": nxt}
        allowed = policy.allowed(state)
        forced = refused or state["stall"]
        proposed, fallback = None, None
        if forced:
            did, source = allowed[0]["id"], "forced"
            expl = f"{allowed[0]['label']}: {allowed[0]['evidence']}."
        else:
            data = {"allowed_decisions": allowed, "state": state, "stall": stall, "schedule": sched,
                    "forecast": _forecast_facts(doc), "wound_metadata": _metadata(doc)}
            proposed, expl, fallback = self._propose(cut, state, allowed, data)
            did, source = proposed, "llm"
            if fallback:
                first = next(d for d in allowed if not d["irreversible"])
                did, source = first["id"], "fallback"
                expl = f"{first['label']}: {first['evidence']}."
        item = next(d for d in allowed if d["id"] == did)
        calibrated = bool(doc.get("model") == "edge_speed" and doc.get("level") == config.BAND_LEVEL) and not refused
        cr = critic.trace(expl, self._outputs(), calibrated_band=calibrated)
        self.traced += cr["traced"]; self.untraced += cr["untraced"]
        self.log.log("critic", cut_h=cut, calibrated_band=calibrated, removed=cr["removed"], traced=cr["traced"],
                     untraced=cr["untraced"], text_in=expl, text_out=cr["text"])
        self.last = {**item, "explanation": cr["text"], "cut_h": cut}
        self.log.log("decision", cut_h=cut, state=state, allowed=[d["id"] for d in allowed], decision=did,
                     label=item["label"], irreversible=item["irreversible"], untested=item["untested"], source=source,
                     proposed=proposed, fallback_reason=fallback, explanation=cr["text"])
        return item, cut

    def _approval(self, item, cut, approved, note=None):
        self.log.log("approval", cut_h=cut, decision=item["id"], approved=approved, approver="human", note=note)

    def run_from(self, k, checks):
        try:
            while k < len(checks):
                item, cut = self._check(k, checks)
                if item["irreversible"]:
                    dec = {**self.last, "run_id": self.run_id}
                    try:
                        ok, note = bool(self.approve(dec)), None
                    except Exception as e:  # noqa: BLE001 - an approver error counts as a reject
                        ok, note = False, f"approver error: {type(e).__name__}: {e}"
                    self._approval(item, cut, ok, note)
                    if ok:
                        if self.record_both:
                            self._branch(item, cut, k, checks)
                        return self._end("stopped", stop_h=cut)
                elif item["id"] in HANDOVER:
                    return self._end("handed_to_human")
                k += 1
            return self._end("schedule_complete")
        except _Stop as s:
            return self._end(s.reason)

    def _branch(self, item, cut, k, checks):
        child = _Run(f"{self.run_id}.reject", self.src, self.approve, False, self.max_steps, self.token_budget,
                     self.runs_dir, parent=self)
        child.log.log("run_start", parent_run_id=self.run_id, branch_seq=self.log.seq - 1, branch_cut_h=cut,
                      wound=self.src.describe(), checks_h=checks, max_steps=self.max_steps,
                      token_budget=self.token_budget, model_provider=llm._provider())
        child._approval(item, cut, False, "recorded rejected branch")
        self.branches.append(child.run_from(k + 1, checks))

    def _end(self, reason, stop_h=None):
        last = self.last or {}
        summary = self.log.log(
            "run_end", reason=reason, decision=last.get("id"), decision_label=last.get("label"),
            explanation=last.get("explanation"), stopped=stop_h is not None, stop_h=stop_h, ended_at_h=self.last_cut,
            horizon_h=config.HORIZON_H,
            plate_hours_saved=round(config.HORIZON_H - stop_h, 3) if stop_h is not None else 0.0,
            steps=self.steps, tokens={"input": self.tok_in, "output": self.tok_out, "total": self._tokens()},
            numbers_traced=self.traced, numbers_untraced=self.untraced)
        out = dict(summary)
        if self.branches:
            out["branches"] = self.branches
        return out


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
    """Free text from files (names, notes, protocol text). Data only: it goes inside the delimited block."""
    meta = {k: doc[k] for k in META_KEYS if k in doc}
    for f in doc.get("forecasts") or []:
        meta.update({f"forecast.{k}": f[k] for k in META_KEYS if k in f})
    return meta


def run_wound(run_id, wound, checks=config.CHECKS_H, approve=lambda decision: True, record_both_branches=False,
              runs_dir=None, max_steps=None, token_budget=None):
    """Run the lead agent on one wound across the checks. Returns the run_end summary (plus "branches")."""
    src = _Source(wound, checks)
    max_steps = config.MAX_STEPS if max_steps is None else max_steps
    token_budget = config.TOKEN_BUDGET if token_budget is None else token_budget
    r = _Run(run_id, src, approve, record_both_branches, max_steps, token_budget, runs_dir)
    r.log.log("run_start", wound=src.describe(), checks_h=src.checks, max_steps=max_steps, token_budget=token_budget,
              record_both_branches=record_both_branches, model_provider=llm._provider(),
              model_id=os.environ.get("STITCH_MODEL", llm.DEFAULT_MODEL))
    return r.run_from(0, src.checks)


# ---------------------------------------------------------------- CLI

def replay_stub(messages, system, tools_):
    """Deterministic offline model for STITCH_PROVIDER=stub: follows the schedule advice, quotes the evidence."""
    allowed = tools_[0]["input_schema"]["properties"]["decision_id"]["enum"]
    text = messages[-1]["content"]
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
        wound = json.load(open(wound))
    if llm._provider() == "stub" and llm._stub_handler is None:
        llm.set_stub(replay_stub)
    out = run_wound(a.run_id, wound, checks=a.checks, approve=(lambda d: not a.reject),
                    record_both_branches=a.both_branches, runs_dir=a.runs_dir)
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
