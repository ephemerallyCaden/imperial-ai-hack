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
