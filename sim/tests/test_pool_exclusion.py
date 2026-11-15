"""python -I sim/tests/test_pool_exclusion.py: no calibration pool contains the test wound (design.md 5.5, R15).

The unit is the physical wound (expN_posNNNN); part I and part II of a wound are siblings and must never calibrate each
other. Wound identity here comes straight from data/processed/*.csv and the position names, NOT from load()'s "wound"
field, so a bug in that field cannot pass its own check (the asserts in sim/v2.py cmd_gate reuse the same expression and
are tautological). For the gate folds loo_all, loo_manual and CC_to_C61, at every cut-off:
1. the pool forecast_file actually stacks for each test series (captured by wrapping P1's prepare / np.stack, so the
   pool is not re-derived here) holds neither the test series' physical wound nor its sibling part;
2. CC_to_C61: test series are C61 and the pool (and every captured pool) is CC only; loo_manual: pools are manual only;
3. sim/v2.py's empirical-Bayes priors (the other place pool data enters a sim forecast) obey 1 and 2;
4. every eval/forecasts/whad/{fold}/*.json (all models) forecasts exactly P1's test set for that fold and cut-off.
Prints "ok ..." per check and "FAIL ..." per violation; exits 1 on any failure.
"""
import csv, glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path[:0] = [os.path.join(ROOT, "eval"), os.path.join(ROOT, "sim")]
import numpy as np
import forecast_baselines as FB

FOLDS = ("loo_all", "loo_manual", "CC_to_C61")
CUTS, T = [1.9, 3.8, 5.7, 9.5], 19.0  # FB.main() cfg["whad"]
fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)
        print("FAIL", msg)
    return cond


def raw_identity():
    """position -> (physical wound, condition, source) read from the processed CSVs."""
    seen = {}
    for name in ("whad_curves.csv", "whad_auto_curves.csv"):
        for r in csv.DictReader(open(os.path.join(ROOT, "data", "processed", name))):
            exp = r["position"].split("_")[0]
            pos = re.search(r"pos\d{4}", r["wound"]).group()
            seen.setdefault(r["position"], set()).add((f"{exp}_{pos}", r["condition"], r["source"]))
    for k, v in seen.items():
        check(len(v) == 1, f"position {k} has several identities in the CSVs: {sorted(v)}")
    return {k: min(v) for k, v in seen.items()}


def sibling(k):
    return re.sub(r"_part(I|II)_", lambda m: "_partII_" if m.group(1) == "I" else "_partI_", k)


class StackSpy:
    """Stands in for numpy inside forecast_baselines; records each np.stack input (the pool residuals)."""
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        return getattr(np, name)

    def stack(self, arrs, *a, **kw):
        self.calls.append(list(arrs))
        return np.stack(arrs, *a, **kw)


def captured_pools(S, split, test, pool, cut, G_all):
    """(doc, {test id: pool ids}) from one unmodified forecast_file run, with the pool read off what it stacks."""
    bases, spy, prep = [], StackSpy(), FB.prepare

    def prepare(*a, **kw):
        bases.append(prep(*a, **kw))
        return bases[-1]

    G = G_all[G_all > cut + 1e-9]
    G_long = np.arange(G[0], 20 * G_all[-1], min(0.25, float(np.min(np.diff(G_all)))))  # as FB.main()
    FB.prepare, FB.np = prepare, spy
    try:
        doc = FB.forecast_file("whad", split, "lvcf", cut, S, test, pool, G, G_long, T)
    finally:
        FB.prepare, FB.np = prep, np
    owner = {id(b["res"]): c for c, b in bases[0].items()}
    check(len(spy.calls) == len(doc["forecasts"]), f"{split} {cut:g} h: {len(spy.calls)} pools for {len(doc['forecasts'])} forecasts")
    return doc, {fc["wound_id"]: [owner[id(r)] for r in R] for fc, R in zip(doc["forecasts"], spy.calls)}


def leaks(k, ids, ident):
    return sorted(c for c in ids if c == k or c == sibling(k) or ident[c][0] == ident[k][0])


def v2_priors():
    """[(split, series, cut, prior ids)] for every member set sim/v2.py cmd_gate builds; stops before simulating."""
    import v2

    class Stop(Exception):
        pass

    class Track:  # a (test, pool) pair that records which split cmd_gate is unpacking
        def __init__(self, name, pair):
            self.name, self.pair = name, pair

        def __iter__(self):
            cur[0] = self.name
            return iter(self.pair)

    def stop(*a, **kw):
        raise Stop

    rec, cur, orig = [], [None], FB.splits
    saved = v2.load_cubes, v2.members, v2.ProcessPoolExecutor
    v2.load_cubes = lambda rule: {}
    v2.members = lambda kind, k, cut, cubes, S, g, prior_ids, rng: rec.append((cur[0], k, cut, list(prior_ids))) or []
    v2.ProcessPoolExecutor = stop
    FB.splits = lambda *a: {s: Track(s, p) for s, p in orig(*a).items()}
    try:
        v2.cmd_gate(["sim_follow_shrink"])
    except Stop:
        pass
    finally:
        v2.load_cubes, v2.members, v2.ProcessPoolExecutor = saved
        FB.splits = orig
    return rec


def main():
    import warnings
    warnings.filterwarnings("ignore")
    ident = raw_identity()
    S = FB.load("whad")
    sp = FB.splits("whad", S)
    G_all = np.unique(np.concatenate([s["t"] for s in S.values()]))

    # the sibling relation from names agrees with the CSVs' physical wound
    pairs = [k for k in S if sibling(k) in S]
    for k in pairs:
        check(ident[k][0] == ident[sibling(k)][0], f"{k} and {sibling(k)} are different physical wounds in the CSVs")
    print(f"ok {len(S)} series, {len({ident[k][0] for k in S})} physical wounds, {len(pairs) // 2} part I/II pairs")

    expected = {}
    for split in FOLDS:
        test, pool = sp[split]
        if split == "CC_to_C61":
            check(test and all(ident[k][1] == "C61" for k in test), "CC_to_C61 test set is not all C61")
            check(pool and all(ident[k][1] == "CC" for k in pool), f"CC_to_C61 pool has non-CC: {sorted(k for k in pool if ident[k][1] != 'CC')}")
        if split == "loo_manual":
            check(all(ident[k][2] == "manual" for k in pool), "loo_manual pool has auto-segmented series")
        for cut in CUTS:
            doc, pools = captured_pools(S, split, test, pool, cut, G_all)
            expected[(split, cut)] = set(pools)
            n_bad = 0
            for k, ids in pools.items():
                bad = leaks(k, ids, ident)
                n_bad += bool(bad)
                check(not bad, f"{split} {cut:g} h: pool for {k} ({ident[k][0]}) contains {bad}")
                check(set(ids) <= pool, f"{split} {cut:g} h: pool for {k} has series outside the fold pool")
                if split == "CC_to_C61":
                    check(all(ident[c][1] == "CC" for c in ids), f"CC_to_C61 {cut:g} h: pool for {k} is not CC only")
                if split == "loo_manual":
                    check(all(ident[c][2] == "manual" for c in ids), f"loo_manual {cut:g} h: pool for {k} is not manual only")
            if not n_bad:
                sizes = [len(v) for v in pools.values()]
                print(f"ok {split:10} cut {cut:4g} h: {len(pools)} test series, pools {min(sizes)}-{max(sizes)} series, "
                      "none holds the test wound or its sibling")

    rec = v2_priors()  # sim/v2.py priors: cmd_gate builds one per series in test | pool of every split
    for split in FOLDS:
        rs = [r for r in rec if r[0] == split]
        bad = [(k, cut, b) for _, k, cut, ids in rs if (b := leaks(k, ids, ident))]
        for k, cut, b in bad:
            check(False, f"v2 prior {split} {cut:g} h for {k} ({ident[k][0]}) contains {b}")
        if split == "CC_to_C61":
            check(all(ident[c][1] == "CC" for r in rs for c in r[3]), "v2 CC_to_C61 prior is not CC only")
        if check(rs, f"v2 built no priors for {split}") and not bad:
            print(f"ok v2 priors {split:10}: {len(rs)} (series, cut) priors, none holds the series' wound or its sibling")

    # forecast files: same wound_id set as P1's test set for the fold and cut-off
    for split in FOLDS:
        by_model = {}
        paths = sorted(glob.glob(os.path.join(ROOT, "eval", "forecasts", "whad", split, "*.json")))
        check(paths, f"no forecast files for {split}")
        for path in paths:
            d, rel = json.load(open(path)), os.path.relpath(path, ROOT)
            cut = min(CUTS, key=lambda c: abs(c - float(d["cutoff_hours"])))
            if not check(abs(cut - float(d["cutoff_hours"])) < 1e-6, f"{rel}: cut-off {d['cutoff_hours']} is not one of {CUTS}"):
                continue
            check(d.get("fold", split) == split, f"{rel} says fold {d.get('fold')}")
            got, want = {f["wound_id"] for f in d["forecasts"]}, expected[(split, cut)]
            if got != want:
                by_model.setdefault(d["model"], []).append(f"{cut:g}h extra {sorted(got - want)} missing {sorted(want - got)}")
            else:
                by_model.setdefault(d["model"], [])
        for model, bad in sorted(by_model.items()):
            if bad:
                check(False, f"forecast set {split}/{model}: " + "; ".join(bad))
        good = sorted(m for m, b in by_model.items() if not b)
        print(f"{'ok' if len(good) == len(by_model) else '--'} forecast sets {split:10}: {len(good)}/{len(by_model)} models "
              "match P1's test set at every cut-off")

    print(f"{len(fails)} failure(s)" if fails else "all checks passed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
