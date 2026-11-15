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


@pytest.mark.parametrize("bad", ["../x", "a/b", "..", ".", "", "a b", "x..y", None, "a\\b"])
def test_runlog_rejects_bad_run_id(tmp_path, bad):
    with pytest.raises(ValueError):
        runlog.RunLog(bad, runs_dir=str(tmp_path))
    assert os.listdir(tmp_path) == []


def test_runlog_exclusive_create(tmp_path, monkeypatch):
    """The file is created with mode 'x' at construction, so a log written between check and open is never appended to."""
    modes = []
    real_open = open
    monkeypatch.setattr("builtins.open", lambda p, m="r", *a, **k: (modes.append(m), real_open(p, m, *a, **k))[1])
    rl = runlog.RunLog("run_1.ok-x", runs_dir=str(tmp_path))
    assert modes[0] == "x" and os.path.exists(rl.path)
    monkeypatch.undo()
    (tmp_path / "taken.jsonl").write_text("{}\n")
    with pytest.raises(FileExistsError):
        runlog.RunLog("taken", runs_dir=str(tmp_path))
    assert (tmp_path / "taken.jsonl").read_text() == "{}\n"


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


def test_claude_cli_provider_parses_structured_output(monkeypatch):
    import subprocess, json as _j
    monkeypatch.setenv("STITCH_PROVIDER", "claude_cli")
    fake = {"structured_output": {"decision_id": "continue", "explanation": "ok"}, "result": "{}", "is_error": False,
            "usage": {"input_tokens": 2, "cache_creation_input_tokens": 100, "output_tokens": 50},
            "modelUsage": {"m": {}}, "total_cost_usd": 0.01}
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, _j.dumps(fake), ""))
    tool = {"name": "propose_decision", "input_schema": {"type": "object"}}
    out = llm.call_model([{"role": "user", "content": "x"}], system="s", tools=[tool])
    assert out["tool_calls"][0]["input"]["decision_id"] == "continue" and out["usage"]["input_tokens"] == 102


def test_runlog_never_writes_local_paths(tmp_path):
    import os
    rl = runlog.RunLog("p1", runs_dir=str(tmp_path))
    home = os.path.expanduser("~")
    rl.log("tool_call", output={"frames": [os.path.join(config.REPO, "web", "x.png"), "/tmp/abc/y.npz", home + "/z"]})
    text = open(rl.path).read()
    assert home not in text and "/tmp/" not in text and "web/x.png" in text
