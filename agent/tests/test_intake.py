"""Intake helper (agent/intake.py): offline only. Stub and mocked backends; no model, no download."""
import io
import json
import os
import sys
import tarfile

import pytest

from agent import intake, llm, tools

GOOD = {"frame_interval_h": 1.0, "pixel_um": 0.454, "duration_h": 19.0, "cell_type": "MCF10A", "assay_type": "scratch",
        "imaging": "phase_contrast", "proliferation_blocked": True, "condition": "knockdown:CYR61", "in_scope": True,
        "missing": []}
TEXT = ("MCF10A cells were treated with mitomycin C and scratched with a pipette tip. CYR61 was silenced by shRNA. "
        "Phase-contrast images were taken every hour for 19 h; pixel size 0.454 um.")


def reply(**over):
    d = dict(GOOD, **over)
    d["missing"] = [k for k in intake.prompt_mod().NULLABLE if d[k] is None]
    return json.dumps(d)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for k in ("STITCH_INTAKE_BACKEND", "STITCH_INTAKE_ADAPTER", "STITCH_INTAKE_BASE", "STITCH_PROVIDER",
              "STITCH_INTAKE_PROMPT_STYLE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("STITCH_PROVIDER", "stub")
    yield
    intake.set_stub(None)
    llm.set_stub(None)


def use_stub(monkeypatch, handler):
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "stub")
    intake.set_stub(handler)


def llm_says(text, seen=None):
    def h(messages, system, tools_):
        if seen is not None:
            seen.append((messages, system))
        return {"text": text, "model": "stub-claude"}
    llm.set_stub(h)


def test_prompt_is_training_prompt(monkeypatch):
    got = []
    use_stub(monkeypatch, lambda p: got.append(p) or reply())
    intake.extract(TEXT)
    assert got == [intake.prompt_mod().build_prompt(TEXT)]


def test_happy_path_feeds_code_and_scope_ok(monkeypatch):
    use_stub(monkeypatch, lambda p: "```json\n" + reply() + "\n```")
    r = intake.extract(TEXT)
    assert r["ok"] and r["backend"] == "stub" and r["fallback_reason"] is None
    assert r["fields"] == json.loads(reply())
    assert r["feeds_code"]["frame_interval_h"]["value"] == 1.0
    assert r["feeds_code"]["pixel_um"]["value"] == 0.454
    assert r["feeds_code"]["condition"]["value"] == "C61"
    assert r["scope_ok"] is True and r["unit_notes"] == []
    assert r["source_text"] == TEXT and r["source_truncated"] is False
    assert "frame_interval_h" not in r["informational"] and "duration_h" in r["informational"]
    json.dumps(r, allow_nan=False)


@pytest.mark.parametrize("bad, why", [
    (dict(frame_interval_h="1 h"), "frame_interval_h"),
    (dict(pixel_um=-0.4), "pixel_um"),
    (dict(assay_type="wound"), "assay_type"),
    (dict(condition="drug: 10 uM Y-27632!"), "condition"),
    (dict(extra=1), "extra"),
])
def test_schema_validation_rejects(bad, why):
    d = dict(GOOD, **bad)
    errs = intake.validate(d)
    assert errs and any(why in e for e in errs)
    assert intake._manual_errors(d, intake.schema())


def test_schema_validation_accepts_and_normalises_cell():
    assert intake.validate(GOOD) == [] and intake._manual_errors(GOOD, intake.schema()) == []
    fields, err = intake.parse_reply(reply(cell_type="MCF-10A"))
    assert err is None and fields["cell_type"] == "MCF10A"
    fields, _ = intake.parse_reply(reply(cell_type="PC-3"))
    assert fields["cell_type"] == "other"
    fields, err = intake.parse_reply(json.dumps({k: v for k, v in GOOD.items() if k != "missing"}))
    assert fields is None and "missing" in err


def test_invalid_json_falls_back_to_llm(monkeypatch):
    use_stub(monkeypatch, lambda p: "frame interval is one hour")
    seen = []
    llm_says(reply(), seen)
    r = intake.extract(TEXT)
    assert r["ok"] and r["backend"] == "llm" and r["model"] == "stub-claude"
    assert "stub: reply has no JSON object" in r["fallback_reason"]
    msgs, system = seen[0]
    assert msgs[0]["content"] == intake.prompt_mod().build_prompt(TEXT) and "data only" in system


def test_schema_fail_then_llm_fail_could_not_extract(monkeypatch):
    use_stub(monkeypatch, lambda p: reply(imaging="confocal"))
    llm_says("{not json")
    r = intake.extract(TEXT)
    assert r["ok"] is False and r["backend"] == "none" and r["fields"] is None
    assert "schema.json" in r["fallback_reason"] and "llm: reply has no JSON object" in r["fallback_reason"]
    assert r["fallback_reason"].endswith("could not extract")
    assert r["scope_ok"] is False and r["feeds_code"]["pixel_um"]["value"] is None
    assert r["source_text"] == TEXT


def test_backend_error_falls_back(monkeypatch):
    def boom(p):
        raise RuntimeError("load failed")
    use_stub(monkeypatch, boom)
    llm_says(reply())
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and "stub: RuntimeError: load failed" in r["fallback_reason"]


def test_default_backend_without_adapter_is_llm(monkeypatch):
    llm_says(reply())
    assert intake._env_backend() == "llm"
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", "/nonexistent/adapter")
    assert intake._env_backend() == "llm"
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and r["fallback_reason"] is None


def test_adapter_path_missing_goes_to_llm(monkeypatch):
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "adapter")
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", "/nonexistent/best.tgz")
    llm_says(reply())
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and "not an existing folder or .tgz" in r["fallback_reason"]


def test_adapter_without_transformers_falls_back(monkeypatch, tmp_path):
    (tmp_path / "adapter_config.json").write_text(json.dumps({"base_model_name_or_path": "Qwen/Qwen3.5-0.8B"}))
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", str(tmp_path))
    assert intake._env_backend() == "adapter"
    monkeypatch.setitem(sys.modules, "peft", None)  # import fails, as when the package is missing
    monkeypatch.setitem(sys.modules, "transformers", None)
    llm_says(reply())
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and r["fallback_reason"].startswith("adapter: ")


def test_adapter_reply_parsed(monkeypatch, tmp_path):
    (tmp_path / "adapter_config.json").write_text("{}")
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", str(tmp_path))
    monkeypatch.setitem(intake.BACKENDS, "adapter", lambda p: (reply(), "Qwen/Qwen3.5-0.8B + LoRA adapter"))
    r = intake.extract(TEXT)
    assert r["backend"] == "adapter" and r["ok"] and r["model"].startswith("Qwen")


def _tgz(path, members):
    """members: (name, kind) with kind "file", "symlink", "hardlink" or "dir"."""
    with tarfile.open(path, "w:gz") as t:
        for name, kind in members:
            info = tarfile.TarInfo(name)
            if kind == "file":
                data = b"{}"
                info.size = len(data)
                t.addfile(info, io.BytesIO(data))
                continue
            info.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "dir": tarfile.DIRTYPE}[kind]
            if kind != "dir":
                info.linkname = "adapter_config.json"
            t.addfile(info)
    return str(path)


@pytest.fixture
def cache(monkeypatch, tmp_path):
    root = tmp_path / "cache"
    monkeypatch.setenv("STITCH_INTAKE_CACHE", str(root))
    monkeypatch.setattr(intake, "_unpacked", {})
    return root


def test_tgz_unpacked_safely(tmp_path, cache, monkeypatch):
    tgz = _tgz(tmp_path / "best.tgz", [("run/best/adapter_config.json", "file")])
    d = intake._adapter_dir(tgz)
    assert os.path.isfile(os.path.join(d, "adapter_config.json")) and d.endswith(os.path.join("run", "best"))
    assert d.startswith(str(cache)) and (os.stat(cache).st_mode & 0o777) == 0o700
    assert [p for p in os.listdir(cache) if p.startswith("unpack_")] == []   # no temp folder left behind
    monkeypatch.setattr(intake.hashlib, "sha256", lambda: (_ for _ in ()).throw(AssertionError("re-hashed")))
    assert intake._adapter_dir(tgz) == d  # cached by path + mtime + size: not hashed again
    (tmp_path / "empty").mkdir()
    with pytest.raises(FileNotFoundError):
        intake._adapter_dir(str(tmp_path / "empty"))


@pytest.mark.parametrize("members, why", [
    ([("../evil/adapter_config.json", "file")], "'..' path"),
    ([("/abs/adapter_config.json", "file")], "absolute"),
    ([("adapter_config.json", "file"), ("link", "symlink")], "link or special file"),
    ([("adapter_config.json", "file"), ("hard", "hardlink")], "link or special file"),
])
def test_tgz_traversal_and_links_refused(tmp_path, cache, members, why):
    tgz = _tgz(tmp_path / "bad.tgz", members)
    with pytest.raises(ValueError, match=why):
        intake._adapter_dir(tgz)
    assert not (tmp_path / "evil").exists() and not any(n.startswith("intake_adapter_") for n in os.listdir(cache))


def test_tgz_refused_member_falls_back_with_basename_only(tmp_path, cache, monkeypatch):
    tgz = _tgz(tmp_path / "bad.tgz", [("adapter_config.json", "file"), ("link", "symlink")])
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "adapter")
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", tgz)
    llm_says(reply())
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and "adapter: ValueError" in r["fallback_reason"]
    assert str(tmp_path) not in json.dumps(r)


def test_cache_owned_by_others_or_shared_refused(tmp_path, cache, monkeypatch):
    cache.mkdir(mode=0o700)
    os.chmod(cache, 0o777)
    tgz = _tgz(tmp_path / "best.tgz", [("adapter_config.json", "file")])
    with pytest.raises(PermissionError, match="writable by other users"):
        intake._adapter_dir(tgz)
    os.chmod(cache, 0o700)
    me = os.getuid()
    monkeypatch.setattr(intake.os, "getuid", lambda: me + 1)
    with pytest.raises(PermissionError, match="not owned by this user"):
        intake._adapter_dir(tgz)


def test_errors_and_model_names_have_no_local_paths(tmp_path, monkeypatch):
    (tmp_path / "adapter").mkdir()
    monkeypatch.setenv("STITCH_INTAKE_BACKEND", "adapter")
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", str(tmp_path / "adapter"))
    llm_says(reply())
    r = intake.extract(TEXT)   # no adapter_config.json in the folder
    assert "adapter: FileNotFoundError: no adapter_config.json under adapter" in r["fallback_reason"]
    assert str(tmp_path) not in json.dumps(r)
    assert intake._model_name(str(tmp_path / "models" / "qwen-base")) == "qwen-base"
    assert intake._model_name("Qwen/Qwen3.5-0.8B") == "Qwen/Qwen3.5-0.8B"


# ---------------------------------------------------------------- prompt style (open item: explicit, recorded)

class FakeTok:
    def __init__(self, template=True):
        self.chat_template = "tmpl" if template else None
        self.pad_token_id, self.eos_token_id, self.seen = 0, 0, []

    def apply_chat_template(self, msgs, tokenize, add_generation_prompt, enable_thinking):
        assert not tokenize and add_generation_prompt and enable_thinking is False and msgs[0]["role"] == "user"
        return "<|user|>" + msgs[0]["content"] + "<|assistant|>"

    def __call__(self, text, return_tensors):
        import torch
        self.seen.append(text)
        return {"input_ids": torch.zeros((1, 3), dtype=torch.long)}

    def decode(self, ids, skip_special_tokens):
        return reply()


class FakeModel:
    def generate(self, input_ids, max_new_tokens, do_sample, num_beams, pad_token_id):
        import torch
        assert do_sample is False and num_beams == 1
        return torch.zeros((1, 5), dtype=torch.long)


@pytest.mark.parametrize("style, template, expect", [
    ("chat", True, "<|user|>{p}<|assistant|>"),
    (None, True, "<|user|>{p}<|assistant|>"),   # default is chat
    ("raw", True, "{p}"),
    ("raw", False, "{p}"),
])
def test_adapter_reply_prompt_style(monkeypatch, style, template, expect):
    tok = FakeTok(template)
    monkeypatch.setattr(intake, "_load_adapter", lambda path: (FakeModel(), tok, "/local/models/qwen-base"))
    if style:
        monkeypatch.setenv("STITCH_INTAKE_PROMPT_STYLE", style)
    else:
        monkeypatch.delenv("STITCH_INTAKE_PROMPT_STYLE", raising=False)
    p = intake.prompt_mod().build_prompt(TEXT)
    text, model = intake._adapter_reply(p)
    assert tok.seen == [expect.format(p=p)] and text == reply()
    assert model == f"qwen-base + LoRA adapter (greedy, {style or 'chat'})"   # base path cut to its name


def test_chat_style_without_template_is_an_error_not_raw(monkeypatch, tmp_path):
    monkeypatch.setattr(intake, "_load_adapter", lambda path: (FakeModel(), FakeTok(template=False), "Qwen/Qwen3.5-0.8B"))
    with pytest.raises(ValueError, match="no chat template"):
        intake._adapter_reply("x")
    (tmp_path / "adapter_config.json").write_text("{}")
    monkeypatch.setenv("STITCH_INTAKE_ADAPTER", str(tmp_path))
    llm_says(reply())
    r = intake.extract(TEXT)
    assert r["backend"] == "llm" and "no chat template" in r["fallback_reason"] and r["prompt_style"] == "chat"


def test_prompt_style_recorded_and_validated(monkeypatch):
    use_stub(monkeypatch, lambda p: reply())
    monkeypatch.setenv("STITCH_INTAKE_PROMPT_STYLE", "raw")
    assert intake.extract(TEXT)["prompt_style"] == "raw"
    monkeypatch.setenv("STITCH_INTAKE_PROMPT_STYLE", "jinja")
    assert intake.extract(TEXT)["prompt_style"].startswith("invalid")
    with pytest.raises(ValueError):
        intake.prompt_style()


def test_eval_base_uses_same_style_and_prints_it(monkeypatch, capsys):
    gold = intake.score_mod().load(os.path.join(intake.ADAPTION, "test_real.jsonl"))
    tok = FakeTok()
    monkeypatch.setattr(intake, "_load_base", lambda: (FakeModel(), tok, "Qwen/Qwen3.5-0.8B"))
    monkeypatch.setenv("STITCH_INTAKE_PROMPT_STYLE", "chat")
    intake.main(["--eval", "--backend", "base"])
    out = capsys.readouterr().out
    assert "prompt style chat" in out and "base:Qwen/Qwen3.5-0.8B (base, no adapter) (greedy, chat)" in out
    assert len(tok.seen) == len(gold) and all(t.startswith("<|user|>") for t in tok.seen)


def test_llm_usage_and_cost_returned(monkeypatch):
    llm.set_stub(lambda m, s, t: {"text": "not json", "model": "stub-claude", "cost_usd": 0.01,
                                  "usage": {"input_tokens": 700, "output_tokens": 20}})
    r = intake.extract(TEXT)   # unusable reply: its tokens still count
    assert r["ok"] is False and r["usage"] == {"input_tokens": 700, "output_tokens": 20} and r["cost_usd"] == 0.01
    assert r["model_calls"][0]["backend"] == "llm" and r["model_calls"][0]["usage"]["input_tokens"] == 700
    use_stub(monkeypatch, lambda p: reply())
    r = intake.extract(TEXT)
    assert r["model_calls"] == [] and r["usage"] == {"input_tokens": 0, "output_tokens": 0} and r["cost_usd"] is None


@pytest.mark.parametrize("over, note", [
    (dict(frame_interval_h=20.0), "outside 0.004-12.0 h"),
    (dict(frame_interval_h=None), "frame interval not stated"),
    (dict(frame_interval_h=0.3333), "not a whole number of hours"),
    (dict(pixel_um=650.0), "outside 0.05-20.0 um/px"),
    (dict(pixel_um=None), "not from magnification"),
    (dict(pixel_um=1.29), "resamples"),
    (dict(condition="drug:Y-27632"), "not a calibrated preset"),
])
def test_unit_checks(monkeypatch, over, note):
    use_stub(monkeypatch, lambda p: reply(**over))
    r = intake.extract(TEXT)
    assert any(note in n for n in r["unit_notes"]), r["unit_notes"]
    key = next(iter(over))
    if "outside" in note or "not stated" in note or "magnification" in note:
        assert r["feeds_code"][key]["value"] is None


def test_control_maps_to_cc(monkeypatch):
    use_stub(monkeypatch, lambda p: reply(condition="control"))
    assert intake.extract(TEXT)["feeds_code"]["condition"]["value"] == "CC"


@pytest.mark.parametrize("over, text, note", [
    (dict(cell_type="HeLa"), TEXT, "cell line HeLa"),
    (dict(cell_type=None), TEXT, "cell line not stated"),
    (dict(proliferation_blocked=None), "MCF10A scratch, phase contrast.", "no mitomycin"),
    (dict(proliferation_blocked=True), "MCF10A cells were serum-starved.", "without mitomycin"),
    (dict(in_scope=False, assay_type="other"), TEXT, "outside the validated scope"),
    (dict(proliferation_blocked=False), "MCF10A cells; mitomycin C was not used.", "mitomycin stated as not used"),
    (dict(proliferation_blocked=True), "MCF10A cells; mitomycin C was not used.", "mitomycin stated as not used"),
    (dict(), "MCF10A cells were scratched without mitomycin C. Phase contrast.", "mitomycin stated as not used"),
    (dict(), "MCF10A cells; no mitomycin was added.", "mitomycin stated as not used"),
    (dict(), "MCF10A cells. Mitomycin C (0.5 ug/ml) was omitted.", "mitomycin stated as not used"),
])
def test_scope_notes(monkeypatch, over, text, note):
    use_stub(monkeypatch, lambda p: reply(**over))
    r = intake.extract(text)
    assert r["scope_ok"] is False and any(note in n for n in r["scope_notes"]), r["scope_notes"]


@pytest.mark.parametrize("text, used", [
    ("Cells were treated with mitomycin C (0.5 ug/ml) for 2 h.", True),
    ("Cell division was blocked with 5 ug/ml mitomycin-C.", True),
    ("We did not use serum. Cells got mitomycin C.", True),
    ("Mitomycin C (10 ug/ml) wasn't added; cells divided.", False),
    ("Phase contrast only.", None),
])
def test_mitomycin_used(text, used):
    assert intake.mitomycin_used(text) is used


def test_empty_and_long_text(monkeypatch):
    r = intake.extract("   ")
    assert r["ok"] is False and r["fallback_reason"].startswith("empty protocol text")
    got = []
    use_stub(monkeypatch, lambda p: got.append(p) or reply())
    r = intake.extract(TEXT + " x" * 20_000)
    assert r["source_truncated"] and len(r["source_text"]) == intake.MAX_SOURCE_CHARS
    assert "cut to" in r["fallback_reason"] and len(got[0]) <= len(intake.prompt_mod().INSTRUCTION) + intake.MAX_INPUT_CHARS


def test_intake_tool(monkeypatch):
    use_stub(monkeypatch, lambda p: reply())
    r = tools.run_tool("intake", {"protocol_text": TEXT})
    assert r["ok"] and r["feeds_code"]["condition"]["value"] == "C61"
    assert "error" in tools.run_tool("intake", {"text": TEXT})


def test_eval_scores_stub(monkeypatch, tmp_path, capsys):
    gold = intake.score_mod().load(os.path.join(intake.ADAPTION, "test_real.jsonl"))
    by_par = {r["paragraph"].strip(): json.dumps(r["labels"]) for r in gold}
    use_stub(monkeypatch, lambda p: by_par[p[len(intake.prompt_mod().INSTRUCTION):]])
    out = tmp_path / "preds.jsonl"
    intake.main(["--eval", "--preds", str(out)])
    table = capsys.readouterr().out
    assert f"100% ({len(gold)}/{len(gold)})" in table and "stub:stub" in table
    assert len(out.read_text().splitlines()) == len(gold)
