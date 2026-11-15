from agent.critic import trace


def test_traced_numbers_kept():
    r = trace("Closure is 46% at 3.8 h, P = 0.91.", [{"closure": 0.46, "p_close": 0.91}])
    assert r["text"] == "Closure is 46% at 3.8 h, P = 0.91." and r["traced"] == 3 and r["untraced"] == 0


def test_untraced_number_removed():
    r = trace("Closure will be 73% by 12.4 h.", [{"closure": 0.46}])
    assert r["text"] == "Closure will be [?]% by [?] h." and r["removed"] == ["73%", "12.4 h"]
    assert r["untraced"] == 2 and r["traced"] == 0


def test_rounding_to_shown_decimals():
    out = [{"speed": 0.4237, "t": 6.149}]
    assert trace("speed 0.42", out)["untraced"] == 0
    assert trace("speed 0.424", out)["untraced"] == 0
    assert trace("speed 0.43", out)["untraced"] == 1
    assert trace("at 6.1 h", out)["untraced"] == 0


def test_percent_vs_fraction():
    assert trace("46% closed", [{"c": 0.4612}])["untraced"] == 0
    assert trace("46.1% closed", [{"c": 0.4612}])["untraced"] == 0
    assert trace("46% closed", [{"c": 46.2}])["untraced"] == 0       # leaf already in percent
    assert trace("0.46 closed", [{"c": 46}])["untraced"] == 1        # bare is not a percent


def test_unit_must_match_allowlist():
    assert trace("a plate-hour is 5 cost units", [])["untraced"] == 0
    r = trace("stop at 5 h", [])                                      # cost 5 must not trace 5 h
    assert r["untraced"] == 1 and r["text"] == "stop at [?] h"
    assert trace("checks at 3.8 h and 19 h", [])["untraced"] == 0
    assert trace("threshold 0.1", [])["untraced"] == 0                # bare probability constant
    assert trace("P(90% closed by 19 h) = 0.9", [])["traced"] == 3


def test_wrong_band_90_percent_removed():
    text = "The simulator gives a 90% band of 0.3 to 0.5."
    out = [{"lo": 0.3, "hi": 0.5}]
    assert trace(text, out)["untraced"] == 0
    r = trace(text, out, calibrated_band=False)
    assert r["removed"] == ["90%"] and r["text"].startswith("The simulator gives a [?]% band")
    assert trace("90% closure by 19 h", [], calibrated_band=False)["untraced"] == 0   # not about a band


def test_identifiers_and_list_markers_ignored():
    text = "1. Wound CC_P3 frame t00 in run_20261115_ab12 (exp1/part_II, run-42, #80)\n2) done on 2026-11-15 at 09:30"
    r = trace(text, [])
    assert r["traced"] == 0 and r["untraced"] == 0 and r["text"] == text


def test_nested_outputs_and_ranges():
    out = [{"forecast": {"band": [0.31, 0.58], "checks": [{"t": 5.7, "closure": {"mean": 0.44}}]}}, [7, {"n": 12}]]
    r = trace("Band 31%-58% at 5.7 h; mean 0.44; 12 of 7 frames.", out)
    assert r["untraced"] == 0 and r["traced"] == 6
    assert trace("flag True", [{"ok": True}])["traced"] == 0
    assert trace("value 1", [{"ok": True}])["untraced"] == 1        # bools are not numeric leaves
