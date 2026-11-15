"""Synthetic wounds with a KNOWN cause, for scoring the Investigator (#91, design.md 9b). Simulated, not real data.

  python3 sim/make_known_cause.py        -> sim/synthetic/known_cause/{labels.json, curves.csv, syn01.json ... syn10.json}

5 causes x 2 seeds. Start: forecast.band_start(0.25, seed) on the WHAD 32x44 lattice (a synthetic vertical band, as for
auto-segmented wounds). Rule "follow"; Tm and bias = the follow draw-tool CC preset (sim/fits/whad_fits_follow.json
presets.draw_tool.CC); 19 h, hourly frames. Causes (sim/alt_start.py):
  normal          preset Tm, full-density start
  slow_migration  Tm x 3 everywhere
  low_density     alt_start(density=0.75): 25% of sheet cells vacated (weakly identifiable under the follower rule)
  edge_damage     alt_start(edge_damage=2, damage_prob=0.6): ragged, wider start wound
  partial_stall   region_tm_map(lower half of the field, inf): cells there never start a move
Observed curve = alt_start.observed_area (visible wound: empty 4-connected components >= 10 sites), as area_norm in the
forecast contract's `observed` block {t_hours, area}. Wound ids are neutral (syn01..syn10, shuffled with a fixed seed) and
the playback files carry no cause or parameters, so an agent reading them cannot see the label: labels.json is the key.
"""
import json, os, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forecast as F
from cellsim import Params, simulate
from alt_start import alt_start, region_tm_map, observed_area

OUT = os.path.join(HERE, "synthetic", "known_cause")
SEEDS, HOURS, WF0, MIN_GAP = (11, 12), 19, 0.25, 10
CAUSES = ("normal", "slow_migration", "low_density", "edge_damage", "partial_stall")


def build(cause, seed, Tm, bias):
    occ0 = F.band_start(WF0, seed)
    H, W = occ0.shape
    prm = dict(rule="follow", Tm=Tm, bias=bias, start=f"forecast.band_start({WF0}, {seed})", density=1.0, edge_damage=0,
               damage_prob=None, tm_factor=1.0, tm_region=None)
    tm_map = None
    if cause == "slow_migration":
        prm["Tm"] = 3 * Tm
    elif cause == "low_density":
        occ0 = alt_start(occ0, density=0.75, seed=seed); prm["density"] = 0.75
    elif cause == "edge_damage":
        occ0 = alt_start(occ0, edge_damage=2, damage_prob=0.6, seed=seed); prm.update(edge_damage=2, damage_prob=0.6)
    elif cause == "partial_stall":
        region = np.zeros((H, W), bool); region[H // 2:] = True
        tm_map = region_tm_map((H, W), region, np.inf); prm.update(tm_factor="inf", tm_region=f"rows {H // 2}-{H - 1} (lower half)")
    r = simulate(occ0, Params(Tm=prm["Tm"], bias=bias, rule="follow"), HOURS, seed=seed, tm_map=tm_map)
    return prm, r


def main():
    preset = json.load(open(os.path.join(HERE, "fits", "whad_fits_follow.json")))["presets"]["draw_tool"]["CC"]
    os.makedirs(OUT, exist_ok=True)
    jobs = [(c, s) for c in CAUSES for s in SEEDS]
    order = np.random.default_rng(91).permutation(len(jobs))
    labels, rows = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for n, j in enumerate(order, 1):
            cause, seed = jobs[j]
            wid = f"syn{n:02d}"
            prm, r = build(cause, seed, preset["Tm"], preset["bias"])
            a = observed_area(r["occ"], MIN_GAP)
            t = r["t_hours"]
            obs = dict(t_hours=[round(float(x), 3) for x in t], area=[round(float(x / a[0]), 5) for x in a])
            labels.append(dict(wound_id=wid, cause=cause, seed=seed, params=prm, observed=obs,
                               visible_wound_frac0=round(float(a[0]), 5), playback=f"{wid}.json"))
            rows += [f"{wid},{wid},synthetic,CC,{k},{t[k]:g},{a[k]:.6f},{a[k] / a[0]:.6f},{1 - a[k] / a[0]:.6f},synthetic"
                     for k in range(len(t))]
            r["meta"] = json.dumps(dict(wound_id=wid, synthetic=True, note="simulated wound; cause and parameters are in "
                                        "labels.json (kept out of this file on purpose)"))
            npz = os.path.join(tmp, f"{wid}.npz")
            np.savez_compressed(npz, **r)
            subprocess.run([sys.executable, os.path.join(HERE, "export_playback.py"), npz, wid, "--agents", "--fine", "2",
                            "--outdir", OUT], check=True, stdout=subprocess.DEVNULL)
            print(f"{wid} {cause:15s} seed {seed}: visible wound {a[0]:.3f}, area_norm at 6/12/18 h "
                  f"{a[6] / a[0]:.2f} {a[12] / a[0]:.2f} {a[18] / a[0]:.2f}", flush=True)
    doc = dict(note=("Synthetic wounds with a known cause (sim/make_known_cause.py, #91). SIMULATED, not real data: they test "
                     "whether the Investigator recovers a cause the simulator put in, not biology. Observed = "
                     f"alt_start.observed_area(min_gap={MIN_GAP}) as area_norm. low_density is weakly identifiable under the "
                     "follower rule (interior holes refill within a few hours)."),
               causes=list(CAUSES), wounds=sorted(labels, key=lambda d: d["wound_id"]))
    json.dump(doc, open(os.path.join(OUT, "labels.json"), "w"), indent=1)
    with open(os.path.join(OUT, "curves.csv"), "w") as fh:
        fh.write("position,wound,part,condition,frame,t_hours,wound_frac,area_norm,closure,source\n" + "\n".join(rows) + "\n")
    print(f"wrote {len(labels)} wounds -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
