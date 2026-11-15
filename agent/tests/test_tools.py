"""Tool wrappers (#78) on the precomputed WHAD samples (held-out wound exp1_pos2033, see data/upload.py samples())."""
import json
import os

import pytest

from agent import config, tools

SAMPLES = os.path.join(config.REPO, "web", "data", "samples")
LOO = os.path.join(config.REPO, "eval", "forecasts", "whad", "loo_all")
HELD_OUT = "exp1_pos2033"
FRAMES = [os.path.join(SAMPLES, f"sample_frame{k}.png") for k in (1, 2, 3)]
SAMPLE_SCALE = 0.908  # samples are saved at half resolution


def _need(*paths):
    for p in paths:
        if not os.path.exists(p):
            pytest.skip(f"missing {p}")


@pytest.fixture(scope="module")
def qc2(tmp_path_factory):
    _need(*FRAMES[:2])
    out = tmp_path_factory.mktemp("qc")
    return tools.qc_forecast(FRAMES[:2], 1.0, SAMPLE_SCALE, "s2", str(out), exclude_wound=HELD_OUT)


def test_qc_forecast_sample(qc2):
    assert not qc2.get("refused") and qc2["model"] in ("nca_realft3", "edge_speed") and qc2["level"] == 0.9
    f = qc2["forecasts"][0]
    assert all(lo <= hi for lo, hi in zip(f["area_q05"], f["area_q95"]))
    assert qc2["schedule"]["action"] in ("call", "image_again")
    assert os.path.exists(qc2["forecast_path"]) and os.path.exists(qc2["masks_npz_path"])
    json.dumps(qc2, allow_nan=False)
    # matches the precomputed sample (same frames, same held-out wound) when the same forecaster ran: the sample is
    # the real-data NCA (#102); without torch data/upload.py falls back to edge speed and says so in the notes
    ref_doc = json.load(open(os.path.join(SAMPLES, "sample_2frame.json")))
    if qc2["model"] == ref_doc["model"]:
        ref = ref_doc["forecasts"][0]
        assert f["area_q50"] == ref["area_q50"] and f["p_close_by_T"] == ref["p_close_by_T"]
    else:
        assert qc2["model"] == "edge_speed" and "NCA unavailable" in qc2.get("notes", "")


@pytest.mark.parametrize("bad, why", [("bad_blank.png", "blank"), ("bad_blurred.png", "out of focus")])
def test_qc_forecast_refuses_bad_sample(tmp_path, bad, why):
    p = os.path.join(SAMPLES, bad)
    _need(p)
    d = tools.qc_forecast([p], 1.0, SAMPLE_SCALE, "bad", str(tmp_path))
    assert d["refused"] is True and any(why in r for r in d["reasons"])
    assert set(d) == {"refused", "reasons"}


def test_flags_schedule_upload(qc2):
    r = tools.flags_schedule(qc2["forecast_path"])
    assert r["cutoff_hours"] == 1.0 and len(r["results"]) == 1
    s = r["results"][0]
    assert s["stall"]["evaluable"] and s["stall"]["fired"] == (s["stall"]["p_stall"] >= s["stall"]["threshold"])
    assert "10%" in s["stall"]["truth_definition"]
    assert s["schedule"]["action"] == qc2["schedule"]["action"]
    assert tools.flags_schedule(qc2) == r  # dict or path


def test_flags_schedule_held_out_whad():
    p = os.path.join(LOO, "edge_speed_3.8h.json")
    _need(p)
    r = tools.flags_schedule(p)
    by = {x["wound_id"]: x for x in r["results"]}
    doc = json.load(open(p))
    w = next(f["wound_id"] for f in doc["forecasts"] if f.get("wound") == HELD_OUT)
    assert by[w]["stall"]["threshold"] == pytest.approx(0.321)
    for x in r["results"]:
        sch = x["schedule"]
        assert sch["untested"] == (sch["action"] == "call" and sch["p_close_by_T"] >= 0.9)
        if sch["untested"]:
            assert "untested" in sch["evidence"]


def test_flags_schedule_one_frame_and_refused(tmp_path):
    _need(FRAMES[0])
    d = tools.qc_forecast(FRAMES[:1], 1.0, SAMPLE_SCALE, "s1", str(tmp_path), exclude_wound=HELD_OUT)
    s = tools.flags_schedule(d)["results"][0]
    assert s["stall"]["evaluable"] is False and s["stall"]["fired"] is False
    assert tools.flags_schedule({"refused": True, "reasons": ["x"]}) == {"refused": True, "reasons": ["x"]}


def test_simulate_one_frame_uncalibrated():
    p = os.path.join(SAMPLES, "sample_1frame_masks.npz")
    _need(p)
    r = tools.simulate(p, 1.0, "CC", exclude_wound=HELD_OUT)
    assert "error" not in r and not r.get("refused")
    doc = r["sim_ensemble"]
    assert doc["calibrated"] is False and "level" not in doc and "90% band" not in json.dumps(doc).replace("not a 90% band", "")
    fc = doc["forecasts"][0]
    assert fc["calibrated"] is False and fc["raw_band"]["calibrated"] is False
    assert fc["band_kind"] == doc["band_kind"] == "raw_ensemble" and fc["band_label"] == tools.SIM_BAND_LABEL
    if r["nca_ensemble"] is not None:  # only with torch + weights
        assert r["nca_ensemble"]["calibrated"] is False and r["nca_ensemble"]["forecasts"][0]["label"] == "emulator"
    json.dumps(r, allow_nan=False)


def test_simulate_multi_frame_never_raises():
    """2+ frames also need the raw WHAD masks for sim/upload.py's pool; without them the tool returns an error dict."""
    p = os.path.join(SAMPLES, "sample_2frame_masks.npz")
    _need(p)
    r = tools.run_tool("simulate", {"masks_npz_path": p, "interval_h": 1.0, "condition": "CC", "exclude_wound": HELD_OUT})
    assert isinstance(r, dict)
    if "error" not in r:
        assert all(f["calibrated"] is False for f in r["sim_ensemble"]["forecasts"])
        doc = r["sim_ensemble"]
        assert doc["band_kind"] == "conformal_on_sim" and doc["band_label"] == tools.SIM_CONFORMAL_LABEL
        assert "90% band" not in json.dumps(doc).replace("not a 90% band", "")


def test_simulate_labels_conformal_band(monkeypatch, tmp_path):
    """2+ frames: sim/upload.py swaps area_q05/q95 for a conformal band; the tool labels it, never as 90%."""
    import numpy as np

    class FakeSim:
        @staticmethod
        def refusal(masks, um, sq):
            return None

        @staticmethod
        def forecast_upload(masks, *a):
            fc = {"area_q05": [0.5], "area_q95": [0.9], "raw_band": {"label": "uncalibrated spread"},
                  "band": "90% band = P1's leave-one-wound-out conformal ..."}
            return {"sim_ensemble": {"model": "sim_ensemble", "level": 0.9, "forecasts": [fc]}}

    monkeypatch.setattr(tools, "_sim_upload", lambda: FakeSim)
    p = tmp_path / "m_masks.npz"
    np.savez(p, masks=np.ones((2, 8, 8), np.uint8), um_per_px=1.0)
    r = tools.simulate(str(p), 1.0)
    doc = r["sim_ensemble"]
    fc = doc["forecasts"][0]
    assert fc["band_kind"] == doc["band_kind"] == "conformal_on_sim" and fc["calibrated"] is False
    assert "band" not in fc and "level" not in doc
    assert "90% band" not in json.dumps(doc).replace("not a 90% band", "")


def test_qc_forecast_refuses_oversized_image(monkeypatch, tmp_path):
    _need(FRAMES[0])
    monkeypatch.setattr(tools, "MAX_PIXELS", 1000)
    d = tools.qc_forecast(FRAMES[:1], 1.0, SAMPLE_SCALE, "big", str(tmp_path))
    assert d["refused"] is True and "size limit" in d["reasons"][0]


def test_qc_forecast_decompression_bomb_is_refusal(monkeypatch, tmp_path):
    _need(FRAMES[0])
    from PIL import Image
    with Image.open(FRAMES[0]) as im:
        n = im.size[0] * im.size[1]
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", int(n * 0.75))   # PIL warns (not errors) between 1x and 2x
    d = tools.qc_forecast(FRAMES[:1], 1.0, SAMPLE_SCALE, "bomb", str(tmp_path))
    assert d["refused"] is True and "too large" in d["reasons"][0]


def test_simulate_refuses_blank_mask(tmp_path):
    import numpy as np
    p = tmp_path / "blank_masks.npz"
    np.savez(p, masks=np.zeros((1, 360, 480), np.uint8), t_hours=np.zeros(1), um_per_px=1.816)
    r = tools.simulate(str(p), 1.0)
    assert r["refused"] is True and r["reasons"]


def _walk_objects(schema):
    yield schema
    for v in schema.get("properties", {}).values():
        if v.get("type") == "object":
            yield from _walk_objects(v)
        if v.get("type") == "array" and v["items"].get("type") == "object":
            yield from _walk_objects(v["items"])


def test_tools_schema_valid():
    names = [t["name"] for t in tools.TOOLS]
    assert names == ["qc_forecast", "flags_schedule", "simulate", "investigate", "intake"] and set(names) == set(tools._FUNCS)
    unsupported = {"minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"}
    for t in tools.TOOLS:
        assert set(t) == {"name", "description", "input_schema", "strict"} and t["strict"] is True
        s = t["input_schema"]
        assert s["type"] == "object" and set(s["required"]) <= set(s["properties"])
        for obj in _walk_objects(s):
            assert obj["additionalProperties"] is False
        assert not unsupported & set(json.dumps(s).replace('"', " ").split())
        json.dumps(t)
    try:
        import jsonschema
    except ImportError:
        return
    for t in tools.TOOLS:
        jsonschema.Draft202012Validator.check_schema(t["input_schema"])


@pytest.mark.parametrize("name, inp", [
    ("nope", {}),
    ("qc_forecast", {"frames": ["/etc/passwd"], "interval_h": 1, "scale": 0.454}),
    ("qc_forecast", {"frames": [], "interval_h": 1, "scale": 0.454}),
    ("qc_forecast", {"frames": FRAMES[:1], "interval_h": -1, "scale": 0.454}),
    ("qc_forecast", {"frames": FRAMES[:1], "interval_h": 1}),
    ("qc_forecast", {"frames": FRAMES[:1], "interval_h": 1, "scale": 0.454, "ignore_rules": True}),
    ("flags_schedule", {"forecast_path": os.path.join(config.REPO, "missing.json")}),
    ("flags_schedule", "not a dict"),
    ("simulate", {"masks_npz_path": os.path.join(SAMPLES, "sample_frame1.png"), "interval_h": 1}),
    ("simulate", {"masks_npz_path": os.path.join(SAMPLES, "sample_1frame_masks.npz"), "interval_h": 1, "condition": "X"}),
])
def test_errors_returned_not_raised(name, inp):
    r = tools.run_tool(name, inp)
    assert set(r) == {"error"} and isinstance(r["error"], str) and r["error"]


def test_run_tool_round_trip(tmp_path):
    _need(*FRAMES[:2])
    d = tools.run_tool("qc_forecast", {"frames": FRAMES[:2], "interval_h": 1.0, "scale": SAMPLE_SCALE,
                                       "name": "rt", "exclude_wound": HELD_OUT})
    assert "error" not in d
    r = tools.run_tool("flags_schedule", {"forecast_path": d["forecast_path"]})
    assert "error" not in r and r["results"][0]["schedule"]["action"] == d["schedule"]["action"]
