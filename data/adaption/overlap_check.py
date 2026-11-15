"""Contamination check (issue #90): shared word 8-grams between the synthetic train.jsonl paragraphs and the real
test set data/adaption/test_real.jsonl (if present). The shared instruction (prompt.INSTRUCTION) is stripped first,
and 8-grams that occur inside the instruction itself are ignored as trivial.
python3 data/adaption/overlap_check.py [--n 8]   -> prints counts and every shared n-gram; exit 1 if any remain."""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from prompt import INSTRUCTION  # noqa: E402


def para(row):
    p = row["prompt"]
    return p[len(INSTRUCTION):] if p.startswith(INSTRUCTION) else p


def grams(text, n):
    w = re.findall(r"[a-z0-9µμ]+(?:[-.'][a-z0-9µμ]+)*", text.lower())
    return {tuple(w[i:i + n]) for i in range(len(w) - n + 1)}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--train", default=os.path.join(HERE, "train.jsonl")); ap.add_argument("--test", default=os.path.join(HERE, "test_real.jsonl"))
    a = ap.parse_args()
    if not os.path.exists(a.test):
        print(f"no {a.test} yet: nothing to compare"); return
    trivial = grams(INSTRUCTION, a.n)
    tr = set().union(*(grams(para(json.loads(l)), a.n) for l in open(a.train, encoding="utf-8") if l.strip()))
    te_rows = [json.loads(l) for l in open(a.test, encoding="utf-8") if l.strip()]
    te = set().union(*(grams(para(r), a.n) for r in te_rows))
    shared = sorted((tr & te) - trivial)
    print(f"train {len(tr)} distinct {a.n}-grams, test {len(te)} ({len(te_rows)} rows), shared (non-trivial): {len(shared)}")
    for g in shared:
        print("  ", " ".join(g))
    sys.exit(1 if shared else 0)


if __name__ == "__main__":
    main()
