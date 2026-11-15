"""agent/record.py: video upload scale and the leak check (PR #101 review items 1 and 2)."""
from agent import record


def test_video_upload_scale_is_half_resolution():
    assert record.VIDEO_UPLOAD["scale"] == 0.908   # web/data/samples frames are saved at half resolution


def test_leaks_windows_home_does_not_crash(monkeypatch):
    import os
    home = "C:\\Users\\x"                                          # "\\U" is a bad escape if used as a regex
    # patch expanduser itself: on Windows it reads USERPROFILE, not HOME, so setting HOME alone does nothing there
    monkeypatch.setattr(os.path, "expanduser", lambda p: home if p == "~" else p)
    monkeypatch.setenv("USER", "xuser")
    assert record.leaks("a clean run log") == []
    assert record.leaks("written to " + home + "\\runs\\r.jsonl") == ["home folder"]
    assert record.leaks("written to c:\\users\\X\\runs") == ["home folder"]   # Windows paths ignore case


def test_leaks_user_whole_word_only(monkeypatch):
    monkeypatch.setenv("HOME", "/nonexistent-home-for-test")
    monkeypatch.setenv("USER", "ran")
    assert record.leaks("a random number, rang twice, brand new") == []
    assert "username" in record.leaks("recorded by ran on the lab box")
    monkeypatch.setenv("USER", "a.b+c")                                # regex characters are matched literally
    assert record.leaks("aXb+c") == [] and "username" in record.leaks("user a.b+c here")


def test_leaks_still_finds_fixed_patterns(monkeypatch):
    monkeypatch.setenv("HOME", "/nonexistent-home-for-test")
    monkeypatch.setenv("USER", "nobodyhere")
    assert record.leaks("see /home/someone/file") == ["/home/"]
    assert record.leaks("account 123456789012") == [r"\b\d{12}\b"]


def test_json_escaped_windows_home_is_caught(monkeypatch):
    import json, os
    from agent import record
    monkeypatch.setattr(os.path, "expanduser", lambda p: "C:\\Users\\rand" if p == "~" else p)
    line = json.dumps({"path": "C:\\Users\\rand\\stitch\\x.png"})
    assert "home folder" in record.leaks(line)


def test_index_is_leak_checked_and_has_cost(tmp_path, monkeypatch):
    import json
    monkeypatch.setenv("USER", "nobodyhere")
    recs = [{"kind": "run_start", "run_id": "a", "wound": {"kind": "frames"}},
            {"kind": "model_call", "purpose": "intake", "cost_usd": 0.02},
            {"kind": "model_call", "cost_usd": 0.01}, {"kind": "model_call", "purpose": "report", "cost_usd": None},
            {"kind": "report", "headline": "clean"}, {"kind": "run_end"}]
    (tmp_path / "a.jsonl").write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    assert record.write_clean_index(str(tmp_path)) == []
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx["runs"][0]["cost_usd"] == 0.03
    recs[4]["headline"] = "saved under /home/someone/runs"
    (tmp_path / "a.jsonl").write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    assert record.write_clean_index(str(tmp_path)) == ["/home/"]
