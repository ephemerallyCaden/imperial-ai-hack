from agent import policy as P, config


def st(**kw):
    s = {"refused": False, "stall": False, "p_close": 0.5, "cut_h": 3.8, "next_check_h": 5.7}
    s.update(kw)
    return s


def ids(state):
    return [d["id"] for d in P.allowed(state)]


def test_refusal_forces_ask_human():
    assert ids(st(refused=True, stall=True, p_close=0.05)) == [P.ASK_HUMAN_REFUSED]


def test_stall_forces_ask_human():
    assert ids(st(stall=True, p_close=0.95)) == [P.ASK_HUMAN_STALL]


def test_open_choice_middle_p():
    assert ids(st()) == [P.CONTINUE, P.ASK_HUMAN, P.IMAGE_AGAIN]


def test_threshold_edges():
    assert P.STOP_UNLIKELY in ids(st(p_close=config.P_UNLIKELY))
    assert P.STOP_UNLIKELY not in ids(st(p_close=0.1001))
    assert P.STOP_LIKELY in ids(st(p_close=config.P_LIKELY))
    assert P.STOP_LIKELY not in ids(st(p_close=0.8999))


def test_no_p_no_stops():
    assert ids(st(p_close=None)) == [P.CONTINUE, P.ASK_HUMAN, P.IMAGE_AGAIN]


def test_no_next_check():
    assert ids(st(next_check_h=None)) == [P.CONTINUE, P.ASK_HUMAN]


def test_item_shape_and_flags():
    items = {d["id"]: d for d in P.allowed(st(p_close=0.9))}
    for d in items.values():
        assert set(d) == {"id", "label", "irreversible", "untested", "evidence"} and d["evidence"]
    assert items[P.STOP_LIKELY]["untested"] is True and items[P.STOP_LIKELY]["irreversible"] is True
    assert "untested" in items[P.STOP_LIKELY]["label"]
    assert items[P.CONTINUE]["irreversible"] is False and items[P.CONTINUE]["untested"] is False
    unl = {d["id"]: d for d in P.allowed(st(p_close=0.1))}[P.STOP_UNLIKELY]
    assert unl["irreversible"] is True and unl["untested"] is False


def test_check_accepts_and_rejects():
    assert P.check(P.CONTINUE, st()) == (True, "allowed")
    ok, why = P.check(P.STOP_UNLIKELY, st())
    assert not ok and "not allowed" in why
    ok, _ = P.check(P.CONTINUE, st(refused=True))
    assert not ok
    ok, why = P.check("launch_rocket", st())
    assert not ok and "unknown" in why


def test_ask_human_always_offered_when_not_forced():
    from agent import policy
    st = {"refused": False, "stall": False, "p_close": 0.5, "cut_h": 1.9, "next_check_h": 3.8}
    assert policy.ASK_HUMAN in [d["id"] for d in policy.allowed(st)]
