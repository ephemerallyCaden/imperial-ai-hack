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
    src = run.critic_sources(_kind(recs, "tool_call")[0]["output"])   # Intake numbers are evidence, protocol text is not
    assert src["feeds_code"]["pixel_um"]["value"] == 0.908 and "source_text" not in src
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
