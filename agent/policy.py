"""Decision policy (design.md 9b, "Who decides what"). Plain code works out which decisions are allowed; the LLM only
picks among them and explains. Every proposal is checked here before it is shown. Pure: no I/O."""
from agent import config

CONTINUE = "continue"
IMAGE_AGAIN = "image_again"
STOP_UNLIKELY = "stop_unlikely"
STOP_LIKELY = "stop_likely"
ASK_HUMAN_STALL = "ask_human_stall"
ASK_HUMAN_REFUSED = "ask_human_refused"
ASK_HUMAN = "ask_human"   # the LLM may always choose to hand over to a human (design 9b open choice)

LABELS = {
    CONTINUE: "Continue",
    IMAGE_AGAIN: "Image again at the next check",
    STOP_UNLIKELY: "Stop, unlikely to close",
    STOP_LIKELY: "Stop, likely to close (untested)",
    ASK_HUMAN_STALL: "Stall flagged, ask a human",
    ASK_HUMAN_REFUSED: "Data refused, ask a human",
    ASK_HUMAN: "Ask a human to review",
}
IRREVERSIBLE = {STOP_UNLIKELY, STOP_LIKELY}   # stopping a plate cannot be undone: needs human approval


def _item(did, evidence):
    return {"id": did, "label": LABELS[did], "irreversible": did in IRREVERSIBLE,
            "untested": did == STOP_LIKELY, "evidence": evidence}


def allowed(state):
    """state: {"refused", "stall", "p_close", "cut_h", "next_check_h"} -> list of allowed decision dicts."""
    cut = state["cut_h"]
    if state.get("refused"):   # refusal wins over stall: a refused upload has no forecast to flag
        return [_item(ASK_HUMAN_REFUSED, f"upload refused by QC at {cut} h")]
    if state.get("stall"):
        return [_item(ASK_HUMAN_STALL, f"stall flag fired at {cut} h")]
    out = [_item(CONTINUE, f"no refusal or stall at {cut} h"), _item(ASK_HUMAN, "a human can review at any check")]
    nxt = state.get("next_check_h")
    if nxt is not None:
        out.append(_item(IMAGE_AGAIN, f"next check at {nxt} h; more frames will narrow the band"))
    p = state.get("p_close")
    if p is not None:
        if p <= config.P_UNLIKELY:
            out.append(_item(STOP_UNLIKELY, f"P(90% closed by {config.HORIZON_H} h) = {p} <= {config.P_UNLIKELY}"))
        if p >= config.P_LIKELY:
            out.append(_item(STOP_LIKELY, f"P(90% closed by {config.HORIZON_H} h) = {p} >= {config.P_LIKELY}"))
    return out


def check(proposal_id, state):
    """-> (ok, reason). Rejects any proposal not in allowed(state)."""
    ids = [d["id"] for d in allowed(state)]
    if proposal_id in ids:
        return True, "allowed"
    if proposal_id not in LABELS:
        return False, f"unknown decision {proposal_id!r}"
    return False, f"{proposal_id!r} not allowed here; allowed: {', '.join(ids)}"
