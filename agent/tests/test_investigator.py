"""Investigator lite (#87): ranking, trigger only when off track, once per run, numbers traced. Stub model only."""
import json
import os

import pytest

from agent import config, critic, investigator, llm, policy, prompts, run, tools
from agent.runlog import read

STALL_MANY = "exp1_partI_C61_P2"      # stall flag fires at every check
OOB = "exp2_partII_NC_P2"             # no stall; out of band at 3.8 h (and later)
CALM = "exp1_partII_C61_P1"           # never off track


@pytest.fixture(autouse=True)
def _stub_env(monkeypatch):
    monkeypatch.setenv("STITCH_PROVIDER", "stub")
    yield
    llm.set_stub(None)


def _labels():
    if not os.path.exists(investigator.KNOWN_CAUSE):
        pytest.skip("no known-cause set")
    return {w["cause"]: w for w in json.load(open(investigator.KNOWN_CAUSE))["wounds"]}


def _go(tmp_path, wound, run_id="r", **kw):
    out = run.run_wound(run_id, wound, runs_dir=str(tmp_path), **kw)
    return out, read(os.path.join(tmp_path, f"{run_id}.jsonl"))


def _inv(recs):
    return [r for r in recs if r["kind"] == "tool_call" and r["tool"] == "investigate"]


def _stub(quote_inv=False):
    def h(messages, system, tools_):
        allowed = tools_[0]["input_schema"]["properties"]["decision_id"]["enum"]
        pick = next(d for d in (policy.STOP_UNLIKELY, policy.IMAGE_AGAIN, policy.CONTINUE) if d in allowed)
        data = json.loads(messages[-1]["content"].split(f"<{prompts.DATA_TAG}>", 1)[1].split(f"</{prompts.DATA_TAG}>")[0])
        expl = f"Proposing {pick}."
        if quote_inv and "investigation" in data:
            h0 = data["investigation"]["hypotheses"][0]
            expl += f" Best-fitting hypothesis (not a cause): {h0['name']}, fit error {h0['fit_error']}; also 0.777."
        return {"tool_calls": [{"id": "t", "name": prompts.TOOL_NAME, "input": {"decision_id": pick, "explanation": expl}}],
                "stop_reason": "tool_use", "usage": {"input_tokens": 10, "output_tokens": 5}}
    return h


def test_ranks_true_cause_first_on_known_cause_wound():
    w = _labels()["partial_stall"]
    out = investigator.investigate(w, 19.0, "CC")
    assert out["note"] == "hypotheses, not causes" and out["evaluable"]
    assert [h["rank"] for h in out["hypotheses"]] == [1, 2, 3, 4, 5]
    errs = [h["fit_error"] for h in out["hypotheses"]]
    assert errs == sorted(errs) and out["hypotheses"][0]["name"] == "partial_stall"
    assert investigator.investigate(w, 19.0, "CC") == out           # deterministic seeds
    json.dumps(out, allow_nan=False)


def test_never_uses_frames_after_the_check():
    w = _labels()["edge_damage"]
    obs = w["observed"]
    cut = {"t_hours": obs["t_hours"][:6], "area": obs["area"][:6]}      # frames 0-5 h
    a = investigator.investigate({"observed": obs}, 5.7)
    b = investigator.investigate({"observed": cut}, 5.7)
    assert a == b and a["n_points"] == 5
    assert investigator.investigate({"observed": {"t_hours": [0.0], "area": [1.0]}}, 1.9)["evaluable"] is False


def test_tool_strict_input():
    w = _labels()["normal"]
    ok = tools.run_tool("investigate", {"observed": w["observed"], "check_h": 3.8})
    assert ok["hypotheses"] and "error" not in ok
    assert "error" in tools.run_tool("investigate", {"observed": w["observed"], "check_h": 3.8, "why": "x"})
    assert "error" in tools.run_tool("investigate", {"observed": {"t_hours": [0, 1], "area": [1]}, "check_h": 3.8})


def test_not_called_when_on_track(tmp_path):
    llm.set_stub(_stub())
    _, recs = _go(tmp_path, CALM, approve=lambda d: False)
    assert not _inv(recs)


def test_out_of_band_triggers_once_and_decision_unchanged(tmp_path, monkeypatch):
    llm.set_stub(_stub(quote_inv=True))
    out, recs = _go(tmp_path, OOB, run_id="with", approve=lambda d: False)
    inv = _inv(recs)
    assert len(inv) == 1 and inv[0]["trigger"] == "out_of_band" and inv[0]["input"]["check_h"] == 3.8
    assert max(inv[0]["input"]["observed"]["t_hours"]) <= 3.8
    assert out["steps"] <= config.MAX_STEPS and out["reason"] == "schedule_complete"
    # the model saw the hypotheses; the Critic traced the fit error and removed the made-up number
    mc = [r for r in recs if r["kind"] == "model_call"]
    assert any("investigation" in r.get("data", {}) for r in mc)
    cr = [r for r in recs if r["kind"] == "critic" and "fit error" in r["text_in"]]
    top = inv[0]["output"]["hypotheses"][0]
    assert cr and f"fit error {top['fit_error']}" in cr[0]["text_out"] and "0.777" not in cr[0]["text_out"]
    assert "0.777" in cr[0]["removed"]
    # same decisions with the Investigator switched off
    monkeypatch.setattr(run._Run, "_investigate", lambda self, doc, cut, state: None)
    _, recs2 = _go(tmp_path, OOB, run_id="without", approve=lambda d: False)
    dec = lambda rs: [(r["cut_h"], r["decision"]) for r in rs if r["kind"] == "decision"]  # noqa: E731
    assert dec(recs) == dec(recs2) and not _inv(recs2)


def test_stall_at_every_check_investigates_once(tmp_path):
    llm.set_stub(_stub())
    _, recs = _go(tmp_path, STALL_MANY, approve=lambda d: False)
    assert [r["state"]["stall"] for r in recs if r["kind"] == "decision"] == [True] * len(config.CHECKS_H)
    inv = _inv(recs)
    assert len(inv) == 1 and inv[0]["trigger"] == "stall_flag" and inv[0]["input"]["check_h"] == config.CHECKS_H[0]
    assert inv[0]["output"]["note"] == "hypotheses, not causes"


def test_fit_errors_trace_through_critic(tmp_path):
    llm.set_stub(_stub())
    _, recs = _go(tmp_path, STALL_MANY, approve=lambda d: False)
    outs = [run.critic_sources(r["output"]) for r in recs if r["kind"] == "tool_call"]
    h = _inv(recs)[0]["output"]["hypotheses"]
    text = f"The best fit is {h[0]['name']} (fit error {h[0]['fit_error']}), then {h[1]['name']} ({h[1]['fit_error']})."
    res = critic.trace(text, outs)
    assert res["untraced"] == 0 and res["traced"] == 2
