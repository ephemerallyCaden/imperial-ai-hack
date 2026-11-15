"""Critic (design.md 9b): plain code that removes any number in agent text that no tool produced.

A number is traced if it matches a numeric leaf of the tool outputs, or an ALLOWLIST constant with the same unit,
after rounding to the decimals shown. Percentages also compare as fractions (46% matches 0.46 or 0.4612).
Untraced numbers become "[?]" (the unit text is kept) and are listed in `removed`. Pure: no I/O.
"""
import math
import re

from agent.config import ALLOWLIST, BAND_LEVEL

NUM = re.compile(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][-+]?\d+)?|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
TOKEN_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/:#.")
HOUR_SUFFIX = ("h", "hr", "hrs")
SKIP_SPANS = [
    re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b"),   # dates / timestamps
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),                          # clock times
    re.compile(r"^[ \t]*\d+[.)](?=\s)", re.M),                            # list markers "1." "2)"
]
UNIT_AFTER = [
    ("%", re.compile(r"\s*%")),
    ("h", re.compile(r"\s*(?:h|hr|hrs|hours?)\b", re.I)),
    ("cost", re.compile(r"\s*(?:cost\s+units?|units?\s+of\s+cost)\b", re.I)),
]
COST_BEFORE = re.compile(r"\bcosts?\s*(?:of|is|=|:)?\s*$", re.I)
PROB_BEFORE = re.compile(r"(?:\bP\s*(?:\([^()]*\))?|\bprobability(?:\s+of\s+[^.;]{0,60}?)?)\s*(?:=|≈|is|of|:)?\s*$")
BAND_WORDS = re.compile(r"\b(?:band|interval|coverage)s?\b", re.I)


def _leaves(obj):
    """Every numeric leaf in nested dicts/lists/tuples (bools excluded)."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        if math.isfinite(obj):
            yield float(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _leaves(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _leaves(v)


def _decimals(s):
    s = s.replace(",", "").lstrip("-")
    mant, _, exp = s.lower().partition("e")
    d = len(mant.split(".")[1]) if "." in mant else 0
    return d - (int(exp) if exp else 0)


def _rounds_to(x, shown, d):
    return abs(x - shown) <= 0.5 * 10.0 ** (-d) + 1e-9


def _is_identifier(text, start, end):
    """True if the number sits inside a token with letters/underscores (CC_P3, t00, run_42, exp1/part_II)."""
    a, b = start, end
    while a > 0 and text[a - 1] in TOKEN_CHARS and not (text[a - 1] == "." and (a < 2 or not text[a - 2].isalnum())):
        a -= 1
    while b < len(text) and text[b] in TOKEN_CHARS:
        b += 1
    while b > end and text[b - 1] in ".-/:":       # trailing punctuation is not part of the token
        b -= 1
    left, right = text[a:start], text[end:b]
    if right.lower() in HOUR_SUFFIX and not any(c.isalpha() or c == "_" for c in left):
        return False
    return any(c.isalpha() or c in "_#" for c in left + right)


def _unit(text, start, end):
    after = text[end:]
    for unit, rx in UNIT_AFTER:
        m = rx.match(after)
        if m:
            return unit, end + m.end()
    before = text[max(0, start - 80):start]
    if COST_BEFORE.search(before):
        return "cost", end
    if PROB_BEFORE.search(before):
        return "p", end
    return None, end


def _traced(value, d, unit, leaves):
    for x in leaves:
        if _rounds_to(x, value, d) or (unit == "%" and _rounds_to(x * 100.0, value, d)):
            return True
    for c, cu in ALLOWLIST:
        if cu == unit and _rounds_to(float(c), value, d):
            return True
        # bare decimals in [0, 1] read as probabilities (thresholds 0.1 / 0.9 are usually written bare)
        if unit is None and cu == "p" and d > 0 and 0 <= value <= 1 and _rounds_to(float(c), value, d):
            return True
    return False


def _sentence(text, start, end):
    a = max(text.rfind(".", 0, start - 1) if start > 1 else -1, text.rfind("\n", 0, start), text.rfind(";", 0, start))
    b_cands = [i for i in (text.find(". ", end), text.find("\n", end), text.find(";", end)) if i != -1]
    return text[a + 1:min(b_cands) if b_cands else len(text)]


def trace(text, tool_outputs, calibrated_band=True):
    """Check every number in `text` against `tool_outputs` and the ALLOWLIST.

    Returns {"text": cleaned, "removed": [original strings], "traced": n, "untraced": n}.
    `calibrated_band=False` means the band under discussion is not the data/upload.py band, so "90%" next to
    "band"/"interval" is removed even though 90% is allowlisted.
    """
    leaves = list(_leaves(tool_outputs))
    skip = [(m.start(), m.end()) for rx in SKIP_SPANS for m in rx.finditer(text)]
    band_pct = BAND_LEVEL * 100.0
    out, removed, traced, untraced, pos = [], [], 0, 0, 0
    for m in NUM.finditer(text):
        s, e, raw = m.start(), m.end(), m.group()
        if raw.startswith("-") and s > 0 and not text[s - 1].isspace() and text[s - 1] not in "(=[":
            s, raw = s + 1, raw[1:]                     # "3.8-5.7" is a range, "run-42" an identifier
        if any(a <= s < b for a, b in skip) or _is_identifier(text, s, e):
            continue
        value, d = float(raw.replace(",", "")), _decimals(raw)
        unit, uend = _unit(text, s, e)
        ok = _traced(value, d, unit, leaves)
        if ok and not calibrated_band and unit == "%" and _rounds_to(band_pct, value, d) \
                and BAND_WORDS.search(_sentence(text, s, e)):
            ok = False
        if ok:
            traced += 1
            continue
        untraced += 1
        removed.append(text[s:uend])
        out.append(text[pos:s] + "[?]")
        pos = e
    out.append(text[pos:])
    return {"text": "".join(out), "removed": removed, "traced": traced, "untraced": untraced}
