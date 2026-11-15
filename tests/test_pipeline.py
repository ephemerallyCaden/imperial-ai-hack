"""Fast checks of the P1 pipeline (no raw data needed). Run: python -m pytest -q tests/"""
import copy, json, os, sys, zlib

import numpy as np
import pytest
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [os.path.join(ROOT, d) for d in ("data", "eval", "contracts")]

import validate  # contracts/validate.py  # noqa: E402
import score_forecasts as sf  # noqa: E402
import forecast_baselines as FB  # noqa: E402
from segment import segment, texture_p90, FOCUS_FLOOR  # noqa: E402

EXAMPLE = json.load(open(os.path.join(ROOT, "contracts", "example_forecast.json")))
RNG = np.random.default_rng(0)


def scratch_image(wound_frac=0.3, h=1440, w=1920):
    """Textured 'cells' everywhere except a smooth vertical band (the wound), on a slow illumination gradient
    like real phase-contrast frames (blur removes the cell texture but not the gradient)."""
    img = 128 + 10 * np.sin(np.arange(w) / 600 * 2 * np.pi)[None, :] + 35 * RNG.standard_normal((h, w))
    bw = int(w * wound_frac); x0 = (w - bw) // 2
    img[:, x0:x0 + bw] = 128 + 2 * RNG.standard_normal((h, bw))
    return np.clip(img, 0, 255).astype(np.float32)


def test_example_forecast_is_valid():
    assert validate.problems(EXAMPLE) == []


def test_validator_catches_bad_quantiles():
    bad = copy.deepcopy(EXAMPLE)
    f = bad["forecasts"][0]
    f["area_q05"][0], f["area_q95"][0] = f["area_q95"][0], f["area_q05"][0]
    assert any("quantiles out of order" in p for p in validate.problems(bad))


def test_scorer_on_example():
    r = sf.score_series(EXAMPLE["forecasts"][0], EXAMPLE["cutoff_hours"], EXAMPLE["p_close_by_T_hours"])
    assert 0 <= r["coverage"] <= 1 and r["qscore"] >= 0 and r["n_pts"] > 0


def test_conformal_levels_cover_nominal():
    for m in (10, 27, 55):
        lo, hi = FB.q_levels(m)
        assert 0 <= lo < hi <= 1 and hi - lo >= 0.9


def test_segmenter_finds_the_band():
    m = segment(scratch_image(0.3))
    assert abs(m.mean() - 0.3) < 0.05


def test_focus_score_separates_blur():
    img = scratch_image(0.3)
    assert texture_p90(img) >= FOCUS_FLOOR > texture_p90(ndi.gaussian_filter(img, 8))


def _png(tmp_path, name, arr):
    p = tmp_path / f"{name}.png"
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(p)
    return str(p)


def test_upload_refuses_blank_blurred_and_missing_scale(tmp_path):
    import upload
    blank = _png(tmp_path, "blank", np.zeros((720, 960)))
    blurred = _png(tmp_path, "blur", ndi.gaussian_filter(scratch_image(0.3, 720, 960), 8))
    assert upload.run([blank], 1, 0.908, str(tmp_path), "b")["refused"]
    assert upload.run([blurred], 1, 0.908, str(tmp_path), "c")["refused"]
    assert upload.run([blank], None, 0.908, str(tmp_path), "d")["refused"]


def test_upload_forecasts_a_clean_scratch(tmp_path):
    import upload
    frames = [_png(tmp_path, f"f{k}", scratch_image(w, 720, 960)) for k, w in enumerate((0.30, 0.27, 0.24))]
    doc = upload.run(frames, 1, 0.908, str(tmp_path), "ok")
    assert not doc.get("refused") and validate.problems(doc) == []
    assert doc["schedule"]["action"] in ("call", "image_again")


def test_excluded_series_not_loaded():
    assert not (set(FB.load("whad")) & FB.EXCLUDE)


def test_fold_rule_matches_forecast_script():
    pytest.importorskip("torch")
    sys.path.insert(0, os.path.join(ROOT, "nca"))
    import forecast_realft
    for w in ("exp1_pos1027", "exp2_pos1021", "zaritsky_SN29_L1"):
        assert forecast_realft.fold_of(w) == zlib.crc32(w.encode()) % 4


def test_uncalibrated_condition_is_flagged_and_widened(tmp_path):
    import upload
    frames = [_png(tmp_path, f"g{k}", scratch_image(w, 720, 960)) for k, w in enumerate((0.30, 0.27, 0.24))]
    known = upload.run(frames, 1, 0.908, str(tmp_path), "known", condition="CC")["forecasts"][0]
    new = upload.run(frames, 1, 0.908, str(tmp_path), "new", condition="HaCaT")["forecasts"][0]
    width = lambda f: np.mean(np.array(f["area_q95"]) - np.array(f["area_q05"]))
    assert not any(x["type"] == "uncalibrated_condition" for x in known["flags"])
    assert any(x["type"] == "uncalibrated_condition" for x in new["flags"]) and width(new) >= width(known)


def test_upload_uses_the_nca_on_the_demo_sample(tmp_path):
    pytest.importorskip("torch")
    import upload
    frames = [os.path.join(ROOT, "web", "data", "samples", f"sample_frame{k}.png") for k in (1, 2, 3)]
    doc = upload.run(frames, 1, 0.908, str(tmp_path), "nca", exclude_wound="exp1_pos2033", forecaster="nca")
    assert doc["model"] == "nca_realft3" and "never trained on exp1_pos2033" in doc["notes"]
    assert validate.problems(doc) == []
