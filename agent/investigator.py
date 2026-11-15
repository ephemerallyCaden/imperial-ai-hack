"""Investigator, lite (design.md 9b, issue #87). Hypotheses, not causes. numpy only, no model, no network.

  investigate(wound, check_h, condition=None) -> plain JSON
      Reruns the cell simulator (sim/cellsim.py, follower rule, draw-tool preset for the condition) from alternative
      starts (sim/alt_start.py, #91) and ranks them by how well the simulated closure curve fits the observed one at
      the observed frames with 0 < t <= check_h. Frames after the check are never used.
      `wound`: an observed block {"t_hours", "area"} (area normalised to 1 at t = 0), or anything holding one under
      "observed" (a forecast entry, a known-cause label). Returns {"note": "hypotheses, not causes", "hypotheses":
      [{"name", "rank", "fit_error", "description"}], ...} or {"evaluable": false, "reason"} when no frame is in range.

Hypotheses are the ones sim/make_known_cause.py can plant, with the same strengths. The start is the generic synthetic
band forecast.band_start(0.25, seed), not the wound's own mask: the fit is to the shape of the normalised curve only.
fit_error = RMSE of area_norm between the mean of SEEDS simulated curves (alt_start.observed_area, the same observable as
the synthetic truth) and the observed points. Seeds differ from the ones the synthetic wounds were made with.

  python -m agent.investigator   -> hypothesis accuracy on sim/synthetic/known_cause: agent/results/investigator.{md,csv}
"""
import csv
import json
import math
import os
import sys
import time

import numpy as np

from agent import config

SIM = os.path.join(config.REPO, "sim")
KNOWN_CAUSE = os.path.join(SIM, "synthetic", "known_cause", "labels.json")
NOTE = "hypotheses, not causes"
SEEDS = (101, 102, 103)          # fixed; never the known-cause seeds (11, 12)
WF0 = 0.25                       # start wound fraction, as sim/make_known_cause.py
MIN_GAP = 10                     # alt_start.observed_area, as the synthetic truth
MAX_POINTS = 200
FIT_ERROR_DEF = ("RMSE of area_norm (simulated mean of 3 seeds vs observed) at the observed frames after 0 h up to the "
                 "check; lower is a better fit")
START = "forecast.band_start(0.25, seed): a synthetic band, not this wound's own mask"
HYPOTHESES = (   # (name, description); strengths as sim/make_known_cause.py
    ("normal", "default start and preset migration time"),
    ("slow_migration", "migration time x 3 everywhere"),
    ("low_density", "25% of sheet cells missing at the start (weakly identifiable: holes refill)"),
    ("edge_damage", "ragged, wider start wound (cells within 2 sites of the edge lost with probability 0.6)"),
    ("partial_stall", "cells in the lower half of the field never start a move"),
)

_sim = {}


def _sim_mods():
    if not _sim:
        if SIM not in sys.path:
            sys.path.insert(0, SIM)
        import alt_start
        import cellsim
        import forecast
        _sim.update(alt_start=alt_start, cellsim=cellsim, forecast=forecast,
                    presets=json.load(open(os.path.join(SIM, "fits", "whad_fits_follow.json")))["presets"]["draw_tool"])
    return _sim


def _observed(wound):
    obs = wound.get("observed", wound) if isinstance(wound, dict) else None
    if not isinstance(obs, dict) or "t_hours" not in obs or "area" not in obs:
        raise ValueError("wound must be an observed block {t_hours, area} or hold one under 'observed'")
    t, a = obs["t_hours"], obs["area"]
    if not isinstance(t, list) or not isinstance(a, list) or len(t) != len(a) or not 1 <= len(t) <= MAX_POINTS:
        raise ValueError(f"t_hours and area must be lists of the same length (1 to {MAX_POINTS})")
    for v in t + a:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError("t_hours and area must be finite numbers")
    t, a = np.array(t, float), np.array(a, float)
    if (t < 0).any() or (np.diff(t) <= 0).any():
        raise ValueError("t_hours must be >= 0 and increasing")
    return t, a


def _curve(name, prm, hours, seed):
    S = _sim_mods()
    A, C = S["alt_start"], S["cellsim"]
    occ0 = S["forecast"].band_start(WF0, seed)
    Tm, tm_map = prm["Tm"], None
    if name == "slow_migration":
        Tm = 3 * Tm
    elif name == "low_density":
        occ0 = A.alt_start(occ0, density=0.75, seed=seed)
    elif name == "edge_damage":
        occ0 = A.alt_start(occ0, edge_damage=2, damage_prob=0.6, seed=seed)
    elif name == "partial_stall":
        H, W = occ0.shape
        region = np.zeros((H, W), bool)
        region[H // 2:] = True
        tm_map = A.region_tm_map((H, W), region, np.inf)
    r = C.simulate(occ0, C.Params(Tm=Tm, bias=prm["bias"], rule="follow"), hours, seed=seed, tm_map=tm_map)
    a = A.observed_area(r["occ"], MIN_GAP)
    return r["t_hours"], a / a[0]


def investigate(wound, check_h, condition=None):
    if isinstance(check_h, bool) or not isinstance(check_h, (int, float)) or not math.isfinite(check_h) or check_h <= 0:
        raise ValueError("check_h must be a positive number")
    check_h = float(check_h)
    if condition is None and isinstance(wound, dict):
        condition = wound.get("condition")
    condition = condition if condition in ("CC", "C61") else "CC"
    t, a = _observed(wound)
    use = (t > 1e-9) & (t <= check_h + 1e-9)
    base = {"note": NOTE, "check_h": check_h, "condition": condition, "n_points": int(use.sum())}
    if not use.any():
        return {**base, "evaluable": False, "reason": "no observed frame after 0 h up to the check"}
    prm = _sim_mods()["presets"][condition]
    hours = int(math.ceil(t[use][-1]))
    hyps = []
    for name, desc in HYPOTHESES:
        curves = []
        for s in SEEDS:
            st, sa = _curve(name, prm, hours, s)
            curves.append(np.interp(t[use], st, sa))
        err = float(np.sqrt(np.mean((np.mean(curves, 0) - a[use]) ** 2)))
        hyps.append({"name": name, "fit_error": round(err, 4), "description": desc})
    hyps.sort(key=lambda h: h["fit_error"])   # stable: ties keep the HYPOTHESES order
    for i, h in enumerate(hyps, 1):
        h["rank"] = i
    return {**base, "evaluable": True, "simulated": True, "rule": "follow", "seeds": list(SEEDS), "start": START,
            "fit_error_definition": FIT_ERROR_DEF, "hypotheses": hyps}


# ---------------------------------------------------------------- hypothesis accuracy on known-cause wounds

def accuracy(checks=None, labels_path=KNOWN_CAUSE):
    """-> (rows, summary). One row per synthetic wound and check: true cause, top hypothesis, rank of the truth."""
    checks = list(checks or (config.CHECKS_H + [config.HORIZON_H]))
    wounds = json.load(open(labels_path))["wounds"]
    rows = []
    for w in wounds:
        for c in checks:
            t0 = time.time()
            out = investigate(w, c, "CC")
            el = time.time() - t0
            hy = {h["name"]: h for h in out["hypotheses"]}
            rows.append({"wound_id": w["wound_id"], "true_cause": w["cause"], "check_h": c, "n_points": out["n_points"],
                         "top": out["hypotheses"][0]["name"], "true_rank": hy[w["cause"]]["rank"],
                         **{f"err_{n}": hy[n]["fit_error"] for n, _ in HYPOTHESES}, "elapsed_s": round(el, 2)})
    summ = []
    for c in checks:
        r = [x for x in rows if x["check_h"] == c]
        summ.append({"check_h": c, "n": len(r), "top1": sum(x["true_rank"] == 1 for x in r),
                     "top2": sum(x["true_rank"] <= 2 for x in r), "max_s": max(x["elapsed_s"] for x in r)})
    return rows, summ


def _write(rows, summ, out_dir=config.RESULTS_DIR):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "investigator.csv"), "w", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0]))
        wr.writeheader()
        wr.writerows(rows)
    causes = [n for n, _ in HYPOTHESES]
    lines = ["# Investigator: hypothesis accuracy on synthetic known-cause wounds", "",
             "Hypotheses, not causes. SIMULATED wounds (`sim/synthetic/known_cause`, `sim/make_known_cause.py`, #91): this "
             "tests whether the Investigator recovers a cause the simulator put in, not biology. 10 wounds = 5 causes x 2 "
             "seeds. The Investigator reruns the same simulator with other seeds (101-103) and ranks the 5 hypotheses by "
             "fit error (RMSE of area_norm, observed frames after 0 h up to the check). Chance for top-1 is 1 in 5.", "",
             "| Check (h) | Frames used | True cause ranked first | In top 2 | Slowest wound (s) |", "|---|---|---|---|---|"]
    for s in summ:
        npts = sorted({x["n_points"] for x in rows if x["check_h"] == s["check_h"]})
        lines.append(f"| {s['check_h']:g} | {'/'.join(map(str, npts))} | {s['top1']}/{s['n']} | {s['top2']}/{s['n']} | "
                     f"{s['max_s']:.1f} |")
    lines += ["", "Top-1 by true cause (all checks pooled):", "", "| True cause | Ranked first |", "|---|---|"]
    for c in causes:
        r = [x for x in rows if x["true_cause"] == c]
        lines.append(f"| {c} | {sum(x['true_rank'] == 1 for x in r)}/{len(r)} |")
    lines += ["", "Notes:", "",
              "- The start is a synthetic band (`forecast.band_start(0.25, seed)`), the same family the known-cause wounds "
              "were made from, so this is a best case. On a real wound the start does not match its mask.",
              "- low_density is weakly identifiable under the follower rule (interior holes refill within a few hours; "
              "`sim/alt_start.py`), so it is easily confused with normal.",
              "- Early checks see few frames (hourly frames: 1 at 1.9 h); with 10 wounds an early score rests on very little "
              "data, so read it as rough.",
              "- In the agent the Investigator only runs when a wound is off track, once per run; it never changes the "
              "decision.", "", "Per-wound rows: `investigator.csv`. Regenerate: `python -m agent.investigator`."]
    open(os.path.join(out_dir, "investigator.md"), "w").write("\n".join(lines) + "\n")


def main():
    rows, summ = accuracy()
    _write(rows, summ)
    for s in summ:
        print(f"{s['check_h']:>5g} h: true cause first {s['top1']}/{s['n']}, top 2 {s['top2']}/{s['n']}, "
              f"slowest {s['max_s']:.1f} s")


if __name__ == "__main__":
    main()
