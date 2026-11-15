"""Agent replay evaluation (#83): metric definitions on tiny hand-made cases. No real model calls."""
import os

import pytest

from agent import config, evaluate as E, llm, run

T = [float(h) for h in range(20)]   # WHAD: one frame per hour, 0..19 h


def _w(closed, stall_true=False, stall_flag=False, p_close=0.5, checks=config.CHECKS_H):
    return {"wound": "x", "t": T, "closed": closed,
            "checks": {c: {"p_close": p_close, "p_stall": None, "stall_flag": stall_flag, "stall_true": stall_true}
                       for c in checks}}


def _o(stop_h=None, kind=None):
    return E._outcome(stop_h, kind)


def test_wrong_stall_stop():
    ws = {"a": _w(False, stall_true=False), "b": _w(False, stall_true=True)}
    r = E.score(ws, {"a": _o(1.9, "stall"), "b": _o(1.9, "stall")})
    assert r["wrong_stall_stop"] == 1 and r["stall_stops"] == 2


def test_wrong_closure_call_both_directions():
    ws = {"a": _w(True), "b": _w(False), "c": _w(False), "d": _w(True)}
    r = E.score(ws, {"a": _o(1.9, "unlikely"), "b": _o(1.9, "unlikely"), "c": _o(3.8, "likely"), "d": _o(3.8, "likely")})
    assert r["wrong_closure_call"] == 2 and r["unlikely_calls"] == 2 and r["likely_calls"] == 2


def test_missed_stall_and_non_closer():
    ws = {"a": _w(False, stall_true=True), "b": _w(False, stall_true=True), "c": _w(False), "d": _w(True)}
    r = E.score(ws, {"a": _o(), "b": _o(1.9, "stall"), "c": _o(5.7, "unlikely"), "d": _o()})
    assert r["missed_stall"] == 1                     # a: stalls, never stopped
    assert r["missed_non_closer"] == 2                # a and b: no closure call (a stall stop is not a call)
    assert r["n_stall"] == 2 and r["n_not_closed"] == 3


def test_hours_frames_and_cost():
    ws = {"a": _w(False), "b": _w(False)}
    r = E.score(ws, {"a": _o(1.9, "stall"), "b": _o()}, rate=5)
    assert r["plate_hours_saved"] == pytest.approx(17.1)
    assert r["frames_used"] == 2 + 20 and r["plate_hours_used"] == pytest.approx(20.9)
    assert r["total_cost"] == pytest.approx(22 + 20.9 * 5) and r["cost_per_run"] == pytest.approx((22 + 104.5) / 2)
    assert r["pct_numbers_traced"] is None and r["model_tokens_per_run"] is None


def test_traced_share_for_text_policies():
    ws = {"a": _w(False)}
    r = E.score(ws, {"a": E._outcome(None, None, traced=3, untraced=1, tokens=0)})
    assert r["pct_numbers_traced"] == 75.0 and r["numbers_untraced"] == 1


def test_fixed_schedule_saves_nothing():
    ws = {"a": _w(False, stall_flag=True, stall_true=True), "b": _w(True)}
    out = {k: E.fixed_schedule(w) for k, w in ws.items()}
    r = E.score(ws, out)
    assert r["plate_hours_saved"] == 0 and r["frames_used"] == 40 and r["missed_stall"] == 1


def test_simple_rules_stop_at_first_stall_flag():
    w = _w(False)
    w["checks"][3.8]["stall_flag"] = w["checks"][9.5]["stall_flag"] = True
    assert E.simple_rules(w) == E._outcome(3.8, "stall")
    assert E.simple_rules(_w(False)) == E._outcome()


def test_scheduler_rule_ignores_stall():
    ws = {"a": _w(False, p_close=0.05), "b": _w(True, p_close=0.95), "c": _w(True, p_close=0.5)}
    assert E.scheduler_calls(ws) == {"a": (1.9, "unlikely"), "b": (1.9, "likely")}


# ---------------------------------------------------------------- real held-out WHAD data

def _need_data():
    if not os.path.exists(os.path.join(run.LOO_DIR, "edge_speed_1.9h.json")):
        pytest.skip("no loo_all forecasts")


def test_simple_rules_equal_manual_count():
    _need_data()
    ws = E.load_wounds()
    th = {c: E.tools._data_upload().stall_threshold(c) for c in config.CHECKS_H}
    saved, stops = 0.0, 0
    for w in ws.values():   # manual: first check where p_stall >= threshold
        hit = [c for c in sorted(w["checks"]) if w["checks"][c]["p_stall"] is not None
               and w["checks"][c]["p_stall"] >= th[c]]
        if hit:
            saved += config.HORIZON_H - hit[0]; stops += 1
    r = E.score(ws, {k: E.simple_rules(w) for k, w in ws.items()})
    assert r["stall_stops"] == stops and r["plate_hours_saved"] == pytest.approx(saved, abs=1e-6)
    assert r["wrong_closure_call"] == 0


def test_agent_on_one_wound_matches_rules(tmp_path, monkeypatch):
    _need_data()
    monkeypatch.setenv("STITCH_PROVIDER", "stub")
    llm.set_stub(run.replay_stub)
    try:
        o = E.agent_policy(run_ids := "exp1_partI_C61_P1", str(tmp_path))   # stall flag fires at 1.9 h
        assert o["stop_kind"] == "stall" and o["stop_h"] == 1.9 and o["untraced"] == 0
        assert os.path.exists(tmp_path / f"eval83-{run_ids}.jsonl")
        o = E.agent_policy("exp1_partII_C61_P1", str(tmp_path))            # P(close) 0.094 at 1.9 h
        assert o["stop_kind"] == "unlikely" and o["stop_h"] == 1.9
    finally:
        llm.set_stub(None)


def test_non_closer_imaged_to_end():
    ws = {"a": _w(False, stall_true=True), "b": _w(False, stall_true=True), "c": _w(False), "d": _w(True)}
    r = E.score(ws, {"a": _o(), "b": _o(1.9, "stall"), "c": _o(5.7, "unlikely"), "d": _o()})
    assert r["non_closer_to_end"] == 1                # only a: never stopped for any reason
    assert r["missed_non_closer"] == 2                # a and b (b's stall stop is not a closure call)


def test_stall_stop_error_rate():
    ws = {"a": _w(False, stall_true=False), "b": _w(False, stall_true=True), "c": _w(False, stall_true=False)}
    r = E.score(ws, {"a": _o(1.9, "stall"), "b": _o(1.9, "stall"), "c": _o(1.9, "stall")})
    assert r["stall_stop_error_rate"] == pytest.approx(0.667)
    assert E.score(ws, {k: _o() for k in ws})["stall_stop_error_rate"] is None


def test_scoreboard_says_replay_model(tmp_path):
    ws = {"a": _w(False)}
    rows = [{"policy": p, **E.score(ws, {"a": _o()}, rate)} for rate in E.RATES for p in E.POLICIES]
    xc = {"scheduler_csv_calls_wont_close": None, "scheduler_csv_wrong_calls": None, "scheduler_rule_unlikely_calls": 0,
          "scheduler_rule_wrong": 0, "agent_unlikely_calls": 0, "agent_unlikely_wrong": 0, "same_wound_same_check": 0,
          "agent_only": [], "pre_empted_by_stall": [], "pre_empted_wrong": 0}
    p = tmp_path / "s.md"
    E.write_md(str(p), rows, xc, str(tmp_path))
    md = p.read_text()
    assert "not a real LLM" in md and "#82" in md and "Non-closer imaged to the end" in md
    assert "Stall-stop error rate" in md


# ---------------------------------------------------------------- real-model row from recorded run logs

def _allowed(*ids):
    return [{"id": i, "label": i, "evidence": "", "irreversible": False, "untested": False} for i in ids]


def _log(path, wound_id, decisions, end, costs=(), model_id="claude-opus-5-5"):
    import json
    recs = [{"kind": "run_start", "wound": {"kind": "whad_loo", "wound_id": wound_id}, "model_id": model_id}]
    recs += [{"kind": "model_call", "cost_usd": c} for c in costs]
    recs += [{"kind": "decision", "decision": d, "source": src, "allowed": _allowed(*al),
              "proposed": dec[3] if len(dec) > 3 else (d if src == "llm" else None)}
             for dec in decisions for d, src, al in [dec[:3]]]
    recs.append({"kind": "run_end", **end})
    path.write_text("\n".join(json.dumps(r) for r in recs) + "\n")


def _fake_runs(d):
    full = ("continue", "ask_human", "image_again", "stop_unlikely")
    _log(d / "s-exp1_a.jsonl", "a", [("stop_unlikely", "llm", full)],
         {"stopped": True, "stop_h": 1.9, "stop_kind": "unlikely", "plate_hours_saved": 17.1,
          "numbers_traced": 3, "numbers_untraced": 1, "tokens": {"total": 100}}, costs=(0.02, None))
    _log(d / "s-exp1_b.jsonl", "b", [("ask_human_stall", "forced", ("ask_human_stall",))],
         {"stopped": True, "stop_h": 1.9, "stop_kind": "stall", "plate_hours_saved": 17.1,
          "numbers_traced": 1, "numbers_untraced": 0, "tokens": {"total": 0}})
    _log(d / "s-exp1_c.jsonl", "c", [("image_again", "llm", full[:3]), ("ask_human", "llm", full[:2])],
         {"stopped": False, "stop_h": None, "stop_kind": None, "plate_hours_saved": 0.0,
          "numbers_traced": 4, "numbers_untraced": 0, "tokens": {"total": 300}}, costs=(0.01, 0.03))
    # left out: a reject branch and an upload run
    _log(d / "s-exp1_a.reject.jsonl", "a", [], {"stopped": False, "plate_hours_saved": 0.0}, costs=(9.0,))
    _log(d / "s-video-upload.jsonl", "a", [], {"stopped": False, "plate_hours_saved": 0.0}, costs=(9.0,))


def test_real_model_row_from_fake_logs(tmp_path):
    _fake_runs(tmp_path)
    ws = {"a": _w(True), "b": _w(False, stall_true=False), "c": _w(False, stall_true=True)}
    r = E.real_model_row(ws, str(tmp_path))
    assert r["n_wounds"] == 3 and r["n_with_truth"] == 3
    assert r["plate_hours_saved"] == pytest.approx(34.2)
    assert r["wrong_closure_call"] == 1 and r["wrong_stall_stop"] == 1 and r["missed_stall"] == 1
    assert r["pct_numbers_traced"] == pytest.approx(88.9)
    assert r["model_cost_usd_per_run"] == pytest.approx(0.06 / 3, abs=1e-4)
    assert (r["agree_with_replay"], r["model_checks"]) == (2, 3)   # forced stall left out; ask_human differs
    assert r["label"] == "Real model (Claude, n=3 recorded runs)"


def test_real_model_row_practice_label_and_empty(tmp_path):
    d = tmp_path / "practice"
    d.mkdir()
    assert E.real_model_row({}, str(d)) is None and E.real_model_row({}, str(tmp_path / "missing")) is None
    _fake_runs(d)
    r = E.real_model_row({"a": _w(True)}, str(d))
    assert r["label"] == "Real model (Claude, n=3 practice runs)" and r["n_with_truth"] == 1


def test_scoreboard_real_row_and_skip_note(tmp_path):
    ws = {"a": _w(False)}
    rows = [{"policy": p, **E.score(ws, {"a": _o()}, rate)} for rate in E.RATES for p in E.POLICIES]
    xc = {"scheduler_csv_calls_wont_close": None, "scheduler_csv_wrong_calls": None, "scheduler_rule_unlikely_calls": 0,
          "scheduler_rule_wrong": 0, "agent_unlikely_calls": 0, "agent_unlikely_wrong": 0, "same_wound_same_check": 0,
          "agent_only": [], "pre_empted_by_stall": [], "pre_empted_wrong": 0}
    p = tmp_path / "s.md"
    E.write_md(str(p), rows, xc, str(tmp_path), None, str(tmp_path / "practice"))
    md = p.read_text()
    assert "Forecast policy (code; replay model, no LLM)" in md and "Real model row skipped" in md
    runs = tmp_path / "practice"
    runs.mkdir()
    _fake_runs(runs)
    real = E.real_model_row({"a": _w(True), "b": _w(False), "c": _w(False)}, str(runs))
    E.write_md(str(p), rows, xc, str(tmp_path), real, str(runs))
    md = p.read_text()
    assert "| Real model (Claude, n=3 practice runs) |" in md and "2 / 3 checks" in md
    assert "small sample" in md and "replace them" in md


# ---------------------------------------------------------------- PR #101 review (items 6, 7, 8; evaluate() state)

_END = {"stopped": True, "stop_h": 1.9, "stop_kind": "unlikely", "plate_hours_saved": 17.1,
        "numbers_traced": 1, "numbers_untraced": 0, "tokens": {"total": 10}}


def test_real_row_skips_log_without_run_end(tmp_path):
    import json
    _log(tmp_path / "s-exp1_a.jsonl", "a", [("stop_unlikely", "llm", ("image_again", "stop_unlikely"))], _END)
    cut = tmp_path / "t-exp1_b.jsonl"   # Ctrl-C during recording: no run_end
    cut.write_text(json.dumps({"kind": "run_start", "wound": {"wound_id": "b"}, "model_id": "claude-x"}) + "\n")
    assert E.read_real_run(str(cut)) is None
    r = E.real_model_row({"a": _w(False), "b": _w(False)}, str(tmp_path))
    assert r["n_wounds"] == 1 and r["n_with_truth"] == 1 and r["n_skipped_no_run_end"] == 1
    only_cut = tmp_path / "only"
    only_cut.mkdir()
    (only_cut / "t-exp1_b.jsonl").write_text(cut.read_text())
    assert E.real_model_row({"b": _w(False)}, str(only_cut)) is None


def test_real_row_counts_each_session_once(tmp_path):
    al = ("image_again", "stop_unlikely")
    _log(tmp_path / "s1-exp1_a.jsonl", "a", [("stop_unlikely", "llm", al)], _END)        # wrong call: a closed
    _log(tmp_path / "s2-exp1_a.jsonl", "a", [("image_again", "llm", al)],
         {"stopped": False, "plate_hours_saved": 0.0, "numbers_traced": 2, "numbers_untraced": 0, "tokens": {"total": 5}})
    _log(tmp_path / "s3-exp1_z.jsonl", "z", [("stop_unlikely", "llm", al)], _END)        # no truth for z
    r = E.real_model_row({"a": _w(True)}, str(tmp_path))
    assert r["n_wounds"] == 3 and r["n_with_truth"] == 2 and r["n_distinct_wounds"] == 1
    assert r["wrong_closure_call"] == 1 and r["unlikely_calls"] == 1                   # both sessions scored
    assert r["plate_hours_saved"] == pytest.approx(17.1)                                # same 2 runs as the counters
    assert r["frames_used"] == 2 + 20 and r["model_checks"] == 2                        # z is left out of every total


def test_agree_uses_proposed_and_skips_fallback(tmp_path):
    al = ("continue", "image_again", "stop_unlikely")
    _log(tmp_path / "s-exp1_a.jsonl", "a",
         [("image_again", "llm", al, "stop_unlikely"),     # model proposed the replay pick; final decision differs
          ("image_again", "fallback", al, "stop_likely"),  # policy rejected the proposal: not the model's pick
          ("continue", "llm", al, "continue")], _END)       # replay would pick stop_unlikely
    r = E.read_real_run(str(tmp_path / "s-exp1_a.jsonl"))
    assert (r["agree"], r["model_checks"]) == (1, 2)


def test_evaluate_restores_provider_and_stub(monkeypatch, tmp_path):
    monkeypatch.setenv("STITCH_PROVIDER", "anthropic")
    mine = lambda m, s, t: {}   # noqa: E731
    llm.set_stub(mine)
    monkeypatch.setattr(E, "load_wounds", lambda: {"a": _w(False)})
    monkeypatch.setattr(E, "agent_policy", lambda k, d: (_ for _ in ()).throw(RuntimeError("boom")))
    try:
        with pytest.raises(RuntimeError):
            E.evaluate(runs_dir=str(tmp_path), write=False, real_runs=None)
        assert os.environ["STITCH_PROVIDER"] == "anthropic" and llm._stub_handler is mine
        monkeypatch.delenv("STITCH_PROVIDER")
        monkeypatch.setattr(E, "agent_policy", lambda k, d: E._outcome())
        E.evaluate(runs_dir=str(tmp_path), write=False, real_runs=None)
        assert "STITCH_PROVIDER" not in os.environ and llm._stub_handler is mine
    finally:
        llm.set_stub(None)
