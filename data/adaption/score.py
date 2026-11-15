"""Score Intake predictions against the REAL test set (issue #90). Stdlib only.

  python data/adaption/score.py data/adaption/test_real.jsonl preds.jsonl
  python data/adaption/score.py data/adaption/test_real.jsonl --compare base=base.jsonl finetuned=ft.jsonl claude=claude.jsonl

Predictions: JSONL rows {"id": ..., "completion": "<model reply>"}. The reply is parsed leniently (code fences and text around the
first JSON object are ignored); an unparseable reply, or a missing id, scores 0 on every field.
Per field (the 9 value fields; `missing` is derived from them and not scored separately):
  numbers (frame_interval_h, pixel_um, duration_h): within 2% relative or 1e-6 absolute
  strings (cell_type, condition): case-insensitive after normalising whitespace, dashes and spaces around ':'
  enums (assay_type, imaging) and booleans (proliferation_blocked, in_scope): exact (booleans must be JSON booleans)
  null must match null, both ways.
Exact match = all 9 fields correct. Prints a markdown table.
"""
import argparse, json, re, sys

NUM = ["frame_interval_h", "pixel_um", "duration_h"]
STR = ["cell_type", "condition"]
ENUM = ["assay_type", "imaging"]
BOOL = ["proliferation_blocked", "in_scope"]
FIELDS = ["frame_interval_h", "pixel_um", "duration_h", "cell_type", "assay_type", "imaging", "proliferation_blocked",
          "condition", "in_scope"]


def parse(reply):
    """First JSON object in the reply (fences / prose ignored); None if there is none."""
    if not isinstance(reply, str):
        return reply if isinstance(reply, dict) else None
    s = re.sub(r"```(?:json)?", "", reply)
    start = s.find("{")
    while start != -1:
        depth, instr, esc = 0, False, False
        for i in range(start, len(s)):
            c = s[i]
            if instr:
                esc = (c == "\\" and not esc)
                if c == '"' and not esc:
                    instr = False
                continue
            if c == '"':
                instr = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        d = json.loads(s[start:i + 1])
                        return d if isinstance(d, dict) else None
                    except json.JSONDecodeError:
                        break
        start = s.find("{", start + 1)
    return None


def norm(x):
    x = re.sub(r"[‐-―−]", "-", str(x)).strip().lower()
    return re.sub(r"\s*:\s*", ":", re.sub(r"\s+", " ", x))


def same(field, g, p):
    if g is None or p is None:
        return g is None and p is None
    if field in NUM:
        if isinstance(p, bool) or not isinstance(p, (int, float)):
            return False
        return abs(p - g) <= max(1e-6, 0.02 * abs(g))
    if field in STR:
        return isinstance(p, str) and norm(p) == norm(g)
    if field in BOOL:
        return isinstance(p, bool) and p == g
    return p == g  # enums


def load(path):
    return [json.loads(l) for l in open(path) if l.strip()]


def gold_labels(row):
    return row["labels"] if "labels" in row else json.loads(row["completion"])


def score(gold, preds):
    P = {r["id"]: r.get("completion") for r in preds}
    per = {f: 0 for f in FIELDS}
    exact = fails = 0
    for r in gold:
        g = gold_labels(r)
        p = parse(P.get(r["id"]))
        if p is None:
            fails += 1
            continue
        ok = [same(f, g[f], p.get(f)) for f in FIELDS]
        for f, o in zip(FIELDS, ok):
            per[f] += o
        exact += all(ok)
    return dict(per=per, exact=exact, fails=fails, n=len(gold))


def table(results):
    names = list(results)
    n = next(iter(results.values()))["n"]
    pct = lambda k, v: f"{v / n:.0%} ({v}/{n})"
    lines = ["| field | " + " | ".join(names) + " |", "|" + "---|" * (len(names) + 1)]
    for f in FIELDS:
        lines.append(f"| {f} | " + " | ".join(pct(f, results[m]["per"][f]) for m in names) + " |")
    lines.append("| **exact match (all 9)** | " + " | ".join(pct("x", results[m]["exact"]) for m in names) + " |")
    lines.append("| unparseable replies | " + " | ".join(str(results[m]["fails"]) for m in names) + " |")
    mean = {m: sum(results[m]["per"].values()) / (len(FIELDS) * n) for m in names}
    lines.append("| mean field accuracy | " + " | ".join(f"{mean[m]:.1%}" for m in names) + " |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gold")
    ap.add_argument("preds", nargs="?")
    ap.add_argument("--compare", nargs="+", metavar="NAME=PATH")
    a = ap.parse_args()
    gold = load(a.gold)
    if a.compare:
        res = {kv.split("=", 1)[0]: score(gold, load(kv.split("=", 1)[1])) for kv in a.compare}
    elif a.preds:
        res = {"model": score(gold, load(a.preds))}
    else:
        sys.exit("give a predictions file or --compare NAME=PATH ...")
    print(f"Real test set: {len(gold)} paragraphs ({a.gold})\n")
    print(table(res))


if __name__ == "__main__":
    main()
