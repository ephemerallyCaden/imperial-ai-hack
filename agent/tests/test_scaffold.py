import os
import pytest
from agent import llm, runlog, config


def test_stub_call_fills_shape(monkeypatch):
    monkeypatch.setenv("STITCH_PROVIDER", "stub")
    llm.set_stub(lambda m, s, t: {"text": "hi"})
    out = llm.call_model([{"role": "user", "content": "x"}])
    assert out["text"] == "hi" and out["tool_calls"] == [] and out["usage"]["input_tokens"] == 0


def test_bedrock_model_prefix(monkeypatch):
    monkeypatch.setenv("STITCH_MODEL", "claude-opus-5-5")
    assert llm._model_id("bedrock") == "anthropic.claude-opus-5-5"
    assert llm._model_id("anthropic") == "claude-opus-5-5"


def test_runlog_roundtrip_and_append_only(tmp_path):
    rl = runlog.RunLog("t1", runs_dir=str(tmp_path))
    rl.log("tool_call", tool="x", input_fp=runlog.fingerprint({"a": 1}), output={"p": 0.42})
    rl.log("run_end", reason="done")
    recs = runlog.read(rl.path)
    assert [r["seq"] for r in recs] == [0, 1] and recs[0]["output"]["p"] == 0.42
    assert rl.tool_outputs() == [{"p": 0.42}]
    with pytest.raises(FileExistsError):
        runlog.RunLog("t1", runs_dir=str(tmp_path))


def test_allowlist_has_units():
    assert all(u in {"%", "h", "p", "cost"} for _, u in config.ALLOWLIST)
    assert (19.0, "h") in config.ALLOWLIST and (5, "cost") in config.ALLOWLIST


def test_no_secrets_in_agent_code():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for dp, _, fs in os.walk(root):
        for f in fs:
            if f.endswith(".py") and f != "test_scaffold.py":
                t = open(os.path.join(dp, f)).read().lower()
                assert "arn:aws" not in t and "sk-ant-" not in t and "isengard" not in t
