"""Critic (design.md 9b): plain code that removes any number in agent text that no tool produced.

A number is traced if it matches a numeric leaf of the tool outputs OF THE SAME KIND, or an ALLOWLIST constant with the
same unit, after rounding to the precision shown (decimals, or significant figures for exponent notation like 1e3).
Kinds come from the leaf's key (nearest classified key on its path):
  hours ("3.8 h", "12hours")   -> time fields   (t, t_*, t50, t90, cutoff_hours, next_image_hours, *_h, *_hours)
  percent / probability        -> fraction fields (area*, p_*, closure*, *prob*, band*, level, threshold, members)
                                  (46% matches 0.46, 0.4612 or 46.2)
  cost                          -> cost fields
  bare integer                  -> count fields (n, n_*, *_count, *frames) or unclassified fields
  bare decimal                  -> fraction, count or unclassified fields
  other units ("10x", "50um")   -> unclassified fields only
Ranges carry the unit to the first number ("3.8-5.7 h", "10-90%"). "-" and the Unicode minus "−" make a number
negative. Bare 0.1 / 0.9 only trace as the probability thresholds in a sentence about probability / P / thresholds.
"90%" (or "90 percent") is removed from any sentence about a band / CI / interval / bound / range / coverage that also
mentions the simulator, NCA, emulator or ensemble (only the data/upload.py band may be called 90%).
Untraced numbers become "[?]" (the unit text is kept) and are listed in `removed`. Pure: no I/O.
"""
import math
import re

from agent.config import ALLOWLIST, BAND_LEVEL

MINUS = "-−"
NUM = re.compile(r"[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?")
TOKEN_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/:#.")
SKIP_SPANS = [
    re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b"),   # dates / timestamps
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),                          # clock times
    re.compile(r"^[ \t]*\d+[.)](?=\s)", re.M),                            # list markers "1." "2)"
]
UNIT_AFTER = [
    ("%", re.compile(r"\s*(?:%|-?\s*per\s?cent\b)", re.I)),
    ("h", re.compile(r"\s*(?:h|hr|hrs|hours?)\b", re.I)),
    ("cost", re.compile(r"\s*(?:cost\s+units?|units?\s+of\s+cost)\b", re.I)),
    ("um", re.compile(r"\s*(?:um|µm|μm)\b", re.I)),
]
SUFFIX_UNITS = {"h": "h", "hr": "h", "hrs": "h", "hour": "h", "hours": "h", "percent": "%", "x": "x", "fold": "x"}
NOT_UNITS = {"st", "nd", "rd", "th", "d"}                                 # ordinals "1st", dimensions "3d"
COST_BEFORE = re.compile(r"\bcosts?\s*(?:of|is|=|:)?\s*$", re.I)
PROB_BEFORE = re.compile(r"(?:\bP\s*(?:\([^()]*\))?|\bprobability(?:\s+of\s+[^.;]{0,60}?)?)\s*(?:=|≈|is|of|:)?\s*$")
RANGE_GAP = re.compile(r"\s*(?:-|–|—|to)\s*")
SENT_END = re.compile(r"[.!?](?=\s|$)|\n|;")
BAND_WORDS = re.compile(r"\b(?:bands?|CIs?|intervals?|bounds?|ranges?|coverage)\b", re.I)
SIM_WORDS = re.compile(r"\b(?:sims?|simulat\w*|NCA|emulat\w*|ensembles?)\b", re.I)
PROB_WORDS = re.compile(r"\b(?:probabilit(?:y|ies)|thresholds?|chance|likel(?:y|ihood))\b", re.I)
P_WORD = re.compile(r"\bP\b")

KEY_KINDS = [
    ("time", re.compile(r"^t$|^t_|^t\d|_h$|_hours?$|^hours?$|cutoff|horizon|^time")),
    ("cost", re.compile(r"cost")),
    ("count", re.compile(r"^n$|^n_|_n$|count|^num|frames$")),
    ("frac", re.compile(r"^area|^p$|^p_|closure|prob|^band|_band$|^level$|frac|threshold|^members$|coverage")),
]
TEXT_KINDS = {"h": {"time"}, "%": {"frac"}, "p": {"frac"}, "cost": {"cost"}}
EVIDENCE_KEYS = re.compile(r"^(evidence|call|reason|definition|label)$")
_TEXT_NUM = re.compile(r"(\d+(?:\.\d+)?)\s*(%|h\b)?")


def _kind(path):
    """Kind of a leaf from its key path, nearest key first ("t50" -> "median" is time); unclassified -> "other"."""
    for key in reversed(path):
        k = key.lower()
        for kind, rx in KEY_KINDS:
            if rx.search(k):
                return kind
    return "other"


def _leaves(obj, path=()):
    """(value, kind) for every numeric leaf in nested dicts/lists/tuples (bools excluded)."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        if math.isfinite(obj):
            yield float(obj), _kind(path)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _leaves(v, path + (str(k),))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _leaves(v, path)
    elif isinstance(obj, str) and path and EVIDENCE_KEYS.search(path[-1].lower()):
        # code-written evidence text (e.g. schedule_advice: "right 89% of the time") counts, with its unit
        for m in _TEXT_NUM.finditer(obj):
            v, unit = float(m.group(1)), m.group(2)
            if unit == "%":
                yield v / 100.0, "frac"
            elif unit == "h":
                yield v, "time"
            elif "." in m.group(1):   # bare decimals in evidence text (e.g. band width 0.59 of the starting area)
                yield v, "frac"


def _precision(raw):
    """("sig", n significant figures) for exponent notation, else ("dec", decimals shown)."""
    s = raw.replace(",", "").lstrip(MINUS)
    mant, e, _ = s.lower().partition("e")
    if e:
        digits = mant.replace(".", "").lstrip("0")
        return "sig", max(1, len(digits))
    return "dec", len(mant.split(".")[1]) if "." in mant else 0


def _rounds_to(x, shown, prec):
    mode, n = prec
    if mode == "sig":
        if shown == 0:
            return abs(x) < 1e-12
        return float(f"{x:.{n - 1}e}") == float(f"{shown:.{n - 1}e}")
    return abs(x - shown) <= 0.5 * 10.0 ** (-n) + 1e-9


def _token(text, start, end):
    """Classify the token around a number: ("id", _) for identifiers (CC_P3, t00, run_42, exp1/part_II),
    ("unit", u, token_end) for a letter suffix (10x, 3-fold, 12hours, 50um), else ("num", None, end)."""
    a, b = start, end
    while a > 0 and text[a - 1] in TOKEN_CHARS and not (text[a - 1] == "." and (a < 2 or not text[a - 2].isalnum())):
        a -= 1
    while b < len(text) and text[b] in TOKEN_CHARS:
        b += 1
    while b > end and text[b - 1] in ".-/:":       # trailing punctuation is not part of the token
        b -= 1
    left, right = text[a:start], text[end:b]
    if any(c.isalpha() or c in "_#" for c in left):
        return "id", None, end
    if not right or re.match(r"[-–]?\d", right):    # bare, or a range "3.8-5.7"
        return "num", None, end
    m = re.fullmatch(r"-?([A-Za-z]+)", right)
    if not m:
        return "id", None, end                     # "12ab3", "1/part"
    suf = m.group(1).lower()
    if suf in NOT_UNITS:
        return "id", None, end
    return "unit", SUFFIX_UNITS.get(suf, suf), b


def _unit_after(text, start, end):
    for unit, rx in UNIT_AFTER:
        m = rx.match(text, end)
        if m:
            return unit, m.end()
    before = text[max(0, start - 80):start]
    if COST_BEFORE.search(before):
        return "cost", end
    if PROB_BEFORE.search(before):
        return "p", end
    return None, end


def _sentence(bounds, text, start):
    a = max([e for e in bounds if e <= start] or [0])
    b = min([e for e in bounds if e > start] or [len(text)])
    return text[a:b]


def _traced(value, prec, unit, leaves, prob_sentence):
    if unit in TEXT_KINDS:
        kinds = TEXT_KINDS[unit]
    elif unit is None:
        kinds = {"count", "other"} if prec == ("dec", 0) else {"frac", "count", "other"}
    else:
        kinds = {"other"}                          # x, um, any other letter unit
    for x, k in leaves:   # a "%" number traces to a fraction only as value x 100, never its raw value ("1%" != 1.0)
        if k in kinds and _rounds_to(x * 100.0 if unit == "%" else x, value, prec):
            return True
    for c, cu in ALLOWLIST:
        if cu == unit and _rounds_to(float(c), value, prec):
            return True
        # bare 0.1 / 0.9 thresholds, only in a sentence about probability
        if unit is None and cu == "p" and prob_sentence and prec[0] == "dec" and prec[1] > 0 and 0 <= value <= 1 \
                and _rounds_to(float(c), value, prec):
            return True
    return False


def _numbers(text):
    """[(start, end, unit_end, raw, unit)] for every countable number, with range units carried to the first number."""
    skip = [(m.start(), m.end()) for rx in SKIP_SPANS for m in rx.finditer(text)]
    toks = []
    for m in NUM.finditer(text):
        s, e, raw = m.start(), m.end(), m.group()
        if raw[0] in MINUS and s > 0 and not text[s - 1].isspace() and text[s - 1] not in "(=[:~≈":
            s, raw = s + 1, raw[1:]                 # "3.8-5.7" is a range, "run-42" an identifier
        if any(a <= s < b for a, b in skip):
            continue
        what, unit, uend = _token(text, s, e)
        if what == "id":
            continue
        if what == "num":
            unit, uend = _unit_after(text, s, e)
        toks.append([s, e, uend, raw, unit])
    for i in range(len(toks) - 1):
        cur, nxt = toks[i], toks[i + 1]
        if cur[4] is None and nxt[4] not in (None, "p", "cost") and RANGE_GAP.fullmatch(text, cur[2], nxt[0]):
            cur[4] = nxt[4]
    return toks


def trace(text, tool_outputs, calibrated_band=True):
    """Check every number in `text` against `tool_outputs` and the ALLOWLIST.

    Returns {"text": cleaned, "removed": [original strings], "traced": n, "untraced": n}.
    By default "90%" is removed per sentence when that sentence is about a band/interval/... AND mentions the simulator,
    NCA, emulator or ensemble. `calibrated_band=False` overrides: the band under discussion is not the data/upload.py band,
    so "90%" is removed from every band/interval sentence, simulator mentioned or not.
    """
    leaves = list(_leaves(tool_outputs))
    bounds = [m.end() for m in SENT_END.finditer(text)]
    band_pct = BAND_LEVEL * 100.0
    out, removed, traced, untraced, pos = [], [], 0, 0, 0
    for s, e, uend, raw, unit in _numbers(text):
        value = float(raw.replace(",", "").replace("−", "-"))
        prec = _precision(raw)
        sent = _sentence(bounds, text, s)
        prob_sentence = bool(PROB_WORDS.search(sent) or P_WORD.search(sent))
        ok = _traced(value, prec, unit, leaves, prob_sentence)
        if ok and unit == "%" and _rounds_to(band_pct, value, prec) and BAND_WORDS.search(sent) \
                and (SIM_WORDS.search(sent) or not calibrated_band):
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
