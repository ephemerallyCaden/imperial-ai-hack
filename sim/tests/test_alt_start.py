"""python3 sim/tests/test_alt_start.py (or pytest): alternative starts (#91) leave every default unchanged.

1. Default starts are bit-identical to before: mask_to_lattice and simulate (free and follow) match hashes from
   origin/main 7b7f610, and alt_start(occ0) with default arguments returns an identical copy.
2. tm_map=None and an all-ones tm_map give the same run as before.
3. density / edge_damage vacate what they claim, never the reservoir band, and are seeded.
4. A stalled region (tm_map = inf) never starts a move; observed_area ignores small holes.
5. The committed known-cause set is consistent (labels.json vs curves.csv, neutral ids, contract `observed` block).
"""
import csv, hashlib, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import numpy as np
from cellsim import Params, simulate, straight_scratch, reservoir_mask
from start_state import mask_to_lattice
from alt_start import alt_start, region_tm_map, observed_area

KC = os.path.join(HERE, "..", "synthetic", "known_cause")


def _h(*a):
    return hashlib.sha256(b"".join(np.ascontiguousarray(x).tobytes() for x in a)).hexdigest()[:16]


def _run_hash(r):
    return _h(r["occ"], r["density"], r["wound_frac"], r["t_hours"])


def _mask():
    yy, xx = np.mgrid[:1440, :1920]
    return ((xx - 900) ** 2 / 300 ** 2 + (yy - 700) ** 2 / 500 ** 2) < 1  # synthetic wound, no data on disk needed


def test_default_start_bit_identical():
    occ0 = mask_to_lattice(_mask(), 0.454, 20.0)
    assert _h(occ0) == "b5e6049403a58121"  # origin/main 7b7f610 start_state.mask_to_lattice
    a = alt_start(occ0)
    assert a is not occ0 and a.dtype == np.uint8 and np.array_equal(a, occ0)
    o = straight_scratch(32, 44, 12)
    assert _run_hash(simulate(alt_start(o), Params(Tm=4.0, bias=0.7, rule="follow"), 19, seed=3)) == "557fbbdb7ffb9226"


def test_tm_map_none_or_ones_identical():
    o = straight_scratch(32, 44, 12)
    ones = np.ones(o.shape)
    for p, seed in ((Params(Tm=0.5, bias=0.7), 7), (Params(Tm=4.0, bias=0.7, rule="follow"), 3)):
        base = simulate(o, p, 19, seed=seed)
        assert _run_hash(simulate(o, p, 19, seed=seed, tm_map=None)) == _run_hash(base)
        assert _run_hash(simulate(o, p, 19, seed=seed, tm_map=ones)) == _run_hash(base)


def test_density_and_edge_damage():
    o = straight_scratch(32, 44, 12)
    band = reservoir_mask(np.ones_like(o), 2)
    n = int(((o == 1) & ~band).sum())
    a = alt_start(o, density=0.8, seed=4)
    assert int(((o == 1) & (a == 0)).sum()) == round(0.2 * n)
    assert (a[band] == o[band]).all() and not ((o == 0) & (a == 1)).any()
    assert np.array_equal(a, alt_start(o, density=0.8, seed=4)) and not np.array_equal(a, alt_start(o, density=0.8, seed=5))
    d = alt_start(o, edge_damage=2, damage_prob=1.0, seed=0)
    lost = (o == 1) & (d == 0)
    cols = np.nonzero(lost.any(0))[0]
    assert lost.any() and (d[band] == o[band]).all() and set(cols) <= set(range(14, 16)) | set(range(28, 30))


def test_stall_region_never_starts_moves():
    o = straight_scratch(32, 44, 12)
    region = np.zeros(o.shape, bool); region[:, 28:] = True  # right side of the scratch
    r = simulate(o, Params(Tm=0.5, bias=0.7), 12, frame_dt=0.05, seed=1, tm_map=region_tm_map(o.shape, region, np.inf))
    occ = r["occ"]
    assert not ((occ[:-1] == 1) & (occ[1:] == 0))[:, region].any(), "a stalled cell moved"
    assert ((occ[:-1] == 1) & (occ[1:] == 0))[:, ~region].any()


def test_observed_area_ignores_small_holes():
    occ = np.ones((20, 20), np.uint8)
    occ[5, 5] = 0                 # 1-site hole: not visible
    occ[10:13, 2:6] = 0           # 12-site wound: visible
    assert observed_area(occ)[0] == 12 / 400
    assert observed_area(occ, min_gap=1)[0] == 13 / 400


def test_known_cause_set_consistent():
    lab = json.load(open(os.path.join(KC, "labels.json")))
    assert len(lab["wounds"]) >= 5 and len({w["cause"] for w in lab["wounds"]}) >= 5
    rows = list(csv.DictReader(open(os.path.join(KC, "curves.csv"))))
    for w in lab["wounds"]:
        assert not any(c in w["wound_id"] for c in lab["causes"]), "wound id leaks the cause"
        assert os.path.exists(os.path.join(KC, w["playback"]))
        pb = json.load(open(os.path.join(KC, w["playback"])))
        assert "cause" not in json.dumps(pb["meta"]).replace("cause and parameters are in labels.json", "")
        area = [float(r["area_norm"]) for r in rows if r["position"] == w["wound_id"]]
        assert np.allclose(area, w["observed"]["area"], atol=1e-5) and w["observed"]["area"][0] == 1.0
    try:
        import jsonschema
    except ImportError:
        return
    schema = json.load(open(os.path.join(HERE, "..", "..", "contracts", "forecast.schema.json")))
    obs_schema = schema["$defs"]["forecast"]["properties"]["observed"]
    for w in lab["wounds"]:
        jsonschema.validate(w["observed"], obs_schema)


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith("test_"):
            f(); print("ok", name)
