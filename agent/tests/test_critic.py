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
    assert trace("46% closed", [{"closure": 0.4612}])["untraced"] == 0
    assert trace("46.1% closed", [{"closure": 0.4612}])["untraced"] == 0
    assert trace("46% closed", [{"closure": 46.2}])["untraced"] == 0       # leaf already in percent
    assert trace("0.46 closed", [{"closure": 46}])["untraced"] == 1        # bare is not a percent


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
    for cb in (True, False):                                    # removed by default (per sentence), and on override
        r = trace(text, out, calibrated_band=cb)
        assert r["removed"] == ["90%"] and r["text"].startswith("The simulator gives a [?]% band")
    assert trace("The forecast's 90% band is 0.3 to 0.5.", out)["untraced"] == 0      # data/upload.py band kept
    assert trace("a 90% bound", [], calibrated_band=False)["untraced"] == 1           # override: any band sentence
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


def test_kind_must_match_field():
    assert trace("5 h", [{"cost": 5}])["untraced"] == 1               # hours only to time fields
    assert trace("5 h", [{"t_last": 5}])["untraced"] == 0
    assert trace("at 11.3 h", [{"t50": {"median": 11.29}}])["untraced"] == 0
    assert trace("at 1.9 h", [{"schedule": {"next_image_hours": 1.9}}])["untraced"] == 0
    assert trace("46% closed", [{"speed": 0.46}])["untraced"] == 1    # percent only to area/closure/probability
    assert trace("46% closed", [{"area_q50": [0.46]}])["untraced"] == 0
    assert trace("P = 0.17", [{"p_close_by_T": 0.17}])["untraced"] == 0
    assert trace("P = 0.17", [{"t_hours": [0.17]}])["untraced"] == 1
    assert trace("12 frames", [{"n_frames": 12}])["untraced"] == 0   # counts to count fields
    assert trace("12 frames", [{"t_hours": [12]}])["untraced"] == 1


def test_per_sentence_band_rule():
    assert trace("The forecast has a 90% band. The simulator agrees.", [])["untraced"] == 0
    r = trace("The forecast has a 90% band. The NCA 90% interval is wider.", [])
    assert r["removed"] == ["90%"] and r["text"] == "The forecast has a 90% band. The NCA [?]% interval is wider."
    for t in ("The sim's 90-percent band", "the emulator 90 percent CI", "ensemble coverage is 90%", "sim 90% range"):
        assert trace(t, [])["untraced"] == 1, t
    assert trace("90% of simulated futures close", [])["untraced"] == 0   # no band word


def test_letter_suffixes_counted():
    for t, unit in (("10x faster", "x"), ("3-fold", "-fold"), ("closes in 12hours", "hours"), ("50um wide", "um")):
        r = trace(t, [])
        assert r["untraced"] == 1 and "[?]" + unit in r["text"], t
    assert trace("closes in 12hours", [{"t": 12}])["untraced"] == 0
    assert trace("Ratio 1.04x", [{"ratio": 1.04}])["untraced"] == 0
    assert trace("10x faster", [{"t": 10}])["untraced"] == 1          # x is not hours


def test_exponent_by_significant_figures():
    assert trace("1e3 cells", [{"n": 600}])["untraced"] == 1
    assert trace("1e3 cells", [{"n": 1000}])["untraced"] == 0
    assert trace("0e9 cells", [{"n": 12345}])["untraced"] == 1
    assert trace("1.5e-2", [{"x": 0.015}])["untraced"] == 0
    assert trace("1.5e-2", [{"x": 0.02}])["untraced"] == 1


def test_range_carries_unit():
    for t in ("3.8-5.7 h", "3.8–5.7 h", "3.8 to 5.7 h"):
        assert trace(t, [])["untraced"] == 0, t                        # both allowlisted hours
    assert trace("3.8-5.7 h", [{"cost": 3.8}])["untraced"] == 0
    assert trace("2.0-5.7 h", [{"area": 2.0}])["untraced"] == 1        # first number is hours, not an area
    assert trace("10-90%", [{"closure": 0.1}])["untraced"] == 0
    assert trace("10-90%", [{"t": 10}])["untraced"] == 1


def test_unicode_minus_and_bare_thresholds():
    assert trace("change of −0.05", [{"d": 0.05}])["untraced"] == 1
    assert trace("change of −0.05", [{"d": -0.05}])["untraced"] == 0
    assert trace("area 0.9 of start", [])["untraced"] == 1
    assert trace("19 h, 0.1", [])["untraced"] == 1
    assert trace("the stop threshold is 0.1", [])["untraced"] == 0
    assert trace("probability 0.9", [])["untraced"] == 0
