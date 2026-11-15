"""Intake wired into the agent loop (design.md 9b): uploads with protocol text. Stub Intake and stub LLM only."""
import json
import os

import pytest

from agent import config, intake, llm, policy, prompts, record, run
from agent.runlog import read

SAMPLES = os.path.join(config.REPO, "web", "data", "samples")
FRAMES = [os.path.join(SAMPLES, f"sample_frame{k}.png") for k in (1, 2)]
GOOD = {"frame_interval_h": 1.0, "pixel_um": 0.908, "duration_h": 19.0, "cell_type": "MCF10A", "assay_type": "scratch",
        "imaging": "phase_contrast", "proliferation_blocked": True, "condition": "control", "in_scope": True,
        "missing": []}


def reply(**over):
    d = dict(GOOD, **over)
    d["missing"] = [k for k in intake.prompt_mod().NULLABLE if d[k] is None]
    return json.dumps(d)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("STITCH_INTAKE_ADAPTER", "STITCH_INTAKE_BASE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("STITCH_PROVIDER", "stub")
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "stub")
    llm.set_stub(run.replay_stub)
    yield
    intake.set_stub(None)
    llm.set_stub(None)


def _need():
    for p in FRAMES:
        if not os.path.exists(p):
            pytest.skip(f"missing {p}")


def _wound(**over):
    w = {"frames": FRAMES, "interval_h": 1.0, "scale": 0.908, "name": "s2", "held_out_wound": "exp1_pos2033",
         "protocol_text": record.VIDEO_PROTOCOL}
    w.update(over)
    return {k: v for k, v in w.items() if v is not None}


def _go(tmp_path, wound, run_id="r"):
    out = run.run_wound(run_id, wound, runs_dir=str(tmp_path), approve=lambda d: False)
    return out, read(os.path.join(tmp_path, f"{run_id}.jsonl"))


def _kind(recs, k):
    return [r for r in recs if r["kind"] == k]


def _tools(recs):
    return [r["tool"] for r in _kind(recs, "tool_call")]


def test_protocol_fills_missing_scale(tmp_path):
    _need()
    intake.set_stub(lambda p: reply())
    out, recs = _go(tmp_path, _wound(scale=None))
    assert _tools(recs)[:2] == ["intake", "qc_forecast"]
    qc = next(r for r in _kind(recs, "tool_call") if r["tool"] == "qc_forecast")
    assert qc["input"]["scale"] == 0.908 and not qc["output"].get("refused") and not qc["output"].get("error")
    ap = _kind(recs, "intake_applied")[0]
    assert ap["applied"]["scale"] == {"value": 0.908, "source": "intake"} and ap["applied"]["interval_h"]["source"] == "given"
    assert not _kind(recs, "warning")
    src = run.critic_outputs(recs)   # Intake counts only as the values it applied, never its other fields
    assert {"intake_applied": {"scale": 0.908}} in src
    assert not any("feeds_code" in o or "fields" in o or "source_text" in o for o in src)
    assert out["numbers_untraced"] == 0


def test_disagreement_warns_and_keeps_given(tmp_path):
    _need()
    intake.set_stub(lambda p: reply(pixel_um=0.454))
    _, recs = _go(tmp_path, _wound())
    w = _kind(recs, "warning")
    assert len(w) == 1 and w[0]["field"] == "scale" and w[0]["given"] == 0.908 and w[0]["intake"] == 0.454
    qc = next(r for r in _kind(recs, "tool_call") if r["tool"] == "qc_forecast")
    assert qc["input"]["scale"] == 0.908


def test_small_difference_is_not_a_disagreement(tmp_path):
    _need()
    intake.set_stub(lambda p: reply(pixel_um=0.91))
    _, recs = _go(tmp_path, _wound())
    assert not _kind(recs, "warning")


def test_out_of_scope_cell_line_adds_caveat_not_decision(tmp_path):
    _need()
    intake.set_stub(lambda p: reply())
    _, base = _go(tmp_path, _wound(), run_id="in")
    intake.set_stub(lambda p: reply(cell_type="MDCK"))
    out, recs = _go(tmp_path, _wound(), run_id="out")
    d_in, d_out = _kind(base, "decision")[0], _kind(recs, "decision")[0]
    assert d_out["decision"] == d_in["decision"] and d_out["state"] == d_in["state"]
    assert [a["id"] for a in d_out["allowed"]] == [a["id"] for a in d_in["allowed"]]
    assert all("cell line MDCK" in a["evidence"] and "Intake scope" in a["evidence"] for a in d_out["allowed"])
    assert not any("Intake scope" in a["evidence"] for a in d_in["allowed"])
    rep = _kind(recs, "report")[0]
    assert any("cell line MDCK" in c and "outside the validated scope" in c for c in rep["caveats"])
    assert not any("Intake" in c for c in _kind(base, "report")[0]["caveats"])
    assert not _kind(recs, "scope") and out["numbers_untraced"] == 0


def test_intake_failure_falls_back_to_given(tmp_path):
    _need()
    def boom(p):
        raise RuntimeError("adapter down")
    intake.set_stub(boom)
    llm.set_stub(lambda m, s, t: run.replay_stub(m, s, t) if t else {"text": "not json"})   # Intake's llm step fails too
    out, recs = _go(tmp_path, _wound())
    assert _tools(recs)[:2] == ["intake", "qc_forecast"]
    assert _kind(recs, "tool_call")[0]["output"]["ok"] is False
    w = _kind(recs, "warning")
    assert len(w) == 1 and w[0]["tool"] == "intake" and "given values are used" in w[0]["message"]
    assert not _kind(recs, "intake_applied")
    qc = next(r for r in _kind(recs, "tool_call") if r["tool"] == "qc_forecast")
    assert qc["input"]["scale"] == 0.908 and not qc["output"].get("refused")


def test_intake_failure_with_missing_scale_is_refused(tmp_path):
    _need()
    intake.set_stub(lambda p: "no json here")
    llm.set_stub(lambda m, s, t: run.replay_stub(m, s, t) if t else {"text": "not json"})
    out, recs = _go(tmp_path, _wound(scale=None))
    qc = next(r for r in _kind(recs, "tool_call") if r["tool"] == "qc_forecast")
    assert qc["output"]["refused"] is True
    assert _kind(recs, "decision")[0]["decision"] == policy.ASK_HUMAN_REFUSED and out["reason"] == "handed_to_human"


def test_no_protocol_text_no_intake_call(tmp_path):
    _need()
    seen = []
    intake.set_stub(lambda p: seen.append(p) or reply())
    _, recs = _go(tmp_path, _wound(protocol_text=None))
    assert "intake" not in _tools(recs) and seen == [] and not _kind(recs, "intake_applied")


def test_whad_replay_no_intake_call(tmp_path):
    seen = []
    intake.set_stub(lambda p: seen.append(p) or reply())
    _, recs = _go(tmp_path, "exp1_partII_C61_P1")
    assert "intake" not in _tools(recs) and seen == []


def test_record_video_upload_has_protocol():
    t = record.VIDEO_UPLOAD["protocol_text"]
    assert "MCF10A" in t and "mitomycin C" in t and "every hour" in t and "0.908" in t
    assert record.leaks(t) == []


def _says(extra):
    """replay_stub with `extra` added to each decision explanation (a model repeating what it read)."""
    def h(m, s_, t):
        out = run.replay_stub(m, s_, t)
        for c in out["tool_calls"]:
            if c["name"] == prompts.TOOL_NAME:
                c["input"]["explanation"] += " " + extra
        return out
    return h


def test_protocol_numbers_never_trace(tmp_path):
    """Regression: Intake's extracted duration (37.3 h, from the protocol) was Critic evidence. Only the applied
    interval / scale trace now; in the decision and in the Reporter."""
    _need()
    intake.set_stub(lambda p: reply(duration_h=37.3))
    llm.set_stub(_says("Imaged for 37.3 h at 0.908 um per pixel."))
    out, recs = _go(tmp_path, _wound(scale=None, protocol_text=record.VIDEO_PROTOCOL + " Imaged for 37.3 h."))
    cr = _kind(recs, "critic")[0]
    assert "37.3 h" in cr["removed"] and "37.3" not in cr["text_out"] and "0.908 um" in cr["text_out"]
    srcs = run.critic_outputs(recs)
    from agent import reporter
    rep_srcs = reporter._sources(recs, reporter.facts(recs)[0])
    assert {"intake_applied": {"scale": 0.908}} in srcs and {"intake_applied": {"scale": 0.908}} in rep_srcs
    from agent import critic
    assert critic.trace("The wound was imaged for 37.3 h.", rep_srcs)["removed"] == ["37.3 h"]


def test_given_values_mean_intake_adds_no_evidence(tmp_path):
    _need()
    intake.set_stub(lambda p: reply(duration_h=37.3))
    _, recs = _go(tmp_path, _wound())
    assert not any("intake_applied" in o for o in run.critic_outputs(recs))


def test_intake_llm_usage_counts_and_is_logged(tmp_path, monkeypatch):
    _need()
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "llm")
    def h(m, s_, t):
        if not t:   # Intake's call (no tools)
            return {"text": reply(), "model": "stub-claude", "cost_usd": 0.02,
                    "usage": {"input_tokens": 900, "output_tokens": 60}}
        out = run.replay_stub(m, s_, t)
        out["usage"], out["cost_usd"] = {"input_tokens": 10, "output_tokens": 5}, 0.001
        return out
    llm.set_stub(h)
    out, recs = _go(tmp_path, _wound())
    mc = _kind(recs, "model_call")
    assert [r.get("purpose") for r in mc] == ["intake", None, "report"]
    assert mc[0]["usage"] == {"input_tokens": 900, "output_tokens": 60} and mc[0]["cost_usd"] == 0.02
    assert mc[2]["cost_usd"] == 0.001 and mc[2]["model"] == "replay_stub"
    assert out["tokens"]["input"] == 900 + 10 + 10 and out["tokens"]["output"] == 60 + 5 + 5
    assert record._cost(recs) == pytest.approx(0.022)


def test_intake_usage_over_budget_stops_after_first_check(tmp_path, monkeypatch):
    _need()
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "llm")
    llm.set_stub(lambda m, s_, t: run.replay_stub(m, s_, t) if t else
                 {"text": reply(), "usage": {"input_tokens": config.TOKEN_BUDGET, "output_tokens": 0}})
    out, recs = _go(tmp_path, _wound())
    assert out["reason"] == "token_budget" and out["tokens"]["total"] >= config.TOKEN_BUDGET
    assert _kind(recs, "decision")[0]["source"] == "fallback"   # no budget left for the decision call


def test_intake_condition_reaches_simulator(tmp_path, monkeypatch):
    _need()
    intake.set_stub(lambda p: reply(condition="knockdown:CYR61"))
    monkeypatch.setattr(run, "off_track", lambda *a: "out_of_band")
    _, recs = _go(tmp_path, _wound())
    assert _kind(recs, "intake_applied")[0]["applied"]["condition"] == {"value": "C61", "source": "intake"}
    inv = [r for r in _kind(recs, "tool_call") if r["tool"] == "investigate"]
    assert inv and inv[0]["input"]["condition"] == "C61"
    _, recs = _go(tmp_path, _wound(condition="CC"), run_id="given")   # a given condition wins
    ap = _kind(recs, "intake_applied")[0]["applied"]["condition"]
    assert ap == {"value": "CC", "source": "given", "intake": "C61"}
    assert [r for r in _kind(recs, "tool_call") if r["tool"] == "investigate"][0]["input"]["condition"] == "CC"


def test_tool_error_logs_basenames_only(tmp_path):
    _need()
    intake.set_stub(lambda p: reply())
    missing = os.path.join(str(tmp_path), "deep", "dir", "frame_missing.png")
    _, recs = _go(tmp_path, _wound(frames=[missing, missing]))
    blob = json.dumps(recs)
    assert str(tmp_path) not in blob and "deep/dir" not in blob


def test_missing_interval_key_filled_from_intake(tmp_path):
    """Regression: an upload with no interval_h key at all crashed in refresh_checks (KeyError)."""
    _need()
    intake.set_stub(lambda p: reply())
    w = _wound()
    del w["interval_h"]
    out, recs = _go(tmp_path, w)
    qc = next(r for r in _kind(recs, "tool_call") if r["tool"] == "qc_forecast")
    assert qc["input"]["interval_h"] == 1.0 and _kind(recs, "intake_applied")[0]["checks_h"] == [1.0]
