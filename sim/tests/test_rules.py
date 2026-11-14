"""python3 sim/tests/test_rules.py (or pytest): simulator rule checks.

1. The default rule ("free") reproduces the merged simulator bit for bit (hashes from origin/main 9e5037d sim/cellsim.py).
2. Unknown rules are rejected.
3. "follow": connected movers never open holes (empty sites stay inside the start's empty set) and area never grows.
4. "follow": the incremental reservoir component equals a from-scratch recomputation every step, with islands present.
"""
import hashlib, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import numpy as np
from cellsim import Params, simulate, straight_scratch, step, refill, reservoir_mask, grow_connected, join_islands


def _start():
    o = straight_scratch(32, 44, 12)
    o[10:14, 30:33] = 0  # a second hole inside the sheet
    return o


def _hash(r):
    return hashlib.sha256(r["occ"].tobytes() + r["density"].tobytes() + r["wound_frac"].tobytes()
                          + r["t_hours"].tobytes()).hexdigest()[:16]


def test_free_default_bit_identical():
    o = _start()
    assert Params().rule == "free"
    assert _hash(simulate(o, Params(Tm=0.5, bias=0.7), 19, seed=7)) == "80fedc0c7884f90d"
    assert _hash(simulate(o, Params(Tm=1.0, Td=20.0), 12, frame_dt=0.5, seed=3)) == "28c9f03c8de14a63"


def test_unknown_rule_rejected():
    try:
        simulate(_start(), Params(rule="sheet"), 1)
    except AssertionError:
        return
    raise AssertionError("unknown rule accepted")


def test_follow_no_new_holes():
    o = _start()
    for Tm, seed in ((0.5, 0), (4.0, 1)):
        r = simulate(o, Params(Tm=Tm, bias=0.7, rule="follow"), 19, frame_dt=0.5, seed=seed)
        assert not ((r["occ"] == 0) & (o == 1)[None]).any(), "follow opened a hole in the sheet"
        assert (np.diff(r["wound_frac"]) <= 1e-12).all(), "follow area grew"
    assert r["wound_frac"][-1] < 0.5 * r["wound_frac"][0]


def test_follow_connectivity_incremental():
    o = straight_scratch(32, 44, 16)
    o[8:11, 20:23] = 1; o[20:22, 25:27] = 1  # islands inside the wound
    p, rng = Params(Tm=0.3, bias=0.7, rule="follow"), np.random.default_rng(5)
    occ = o.copy(); res = reservoir_mask(occ, p.edge); refill(occ, res)
    conn = grow_connected(res.copy(), occ)
    assert conn.sum() < occ.sum()  # islands are present at the start
    for _ in range(200):
        step(occ, p, rng, conn); refill(occ, res); join_islands(conn, occ)
        assert (conn == grow_connected(res.copy(), occ)).all()


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith("test_"):
            f(); print("ok", name)
