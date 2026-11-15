# Investigator: hypothesis accuracy on synthetic known-cause wounds

Hypotheses, not causes. SIMULATED wounds (`sim/synthetic/known_cause`, `sim/make_known_cause.py`, #91): this tests whether the Investigator recovers a cause the simulator put in, not biology. 10 wounds = 5 causes x 2 seeds. The Investigator reruns the same simulator with other seeds (101-103) and ranks the 5 hypotheses by fit error (RMSE of area_norm, observed frames after 0 h up to the check). Chance for top-1 is 1 in 5.

| Check (h) | Frames used | True cause ranked first | In top 2 | Slowest wound (s) |
|---|---|---|---|---|
| 1.9 | 1 | 7/10 | 7/10 | 0.5 |
| 3.8 | 3 | 4/10 | 7/10 | 0.4 |
| 5.7 | 5 | 5/10 | 7/10 | 0.6 |
| 9.5 | 9 | 6/10 | 9/10 | 0.9 |
| 19 | 19 | 8/10 | 10/10 | 1.8 |

Top-1 by true cause (all checks pooled):

| True cause | Ranked first |
|---|---|
| normal | 6/10 |
| slow_migration | 10/10 |
| low_density | 1/10 |
| edge_damage | 8/10 |
| partial_stall | 5/10 |

Notes:

- The start is a synthetic band (`forecast.band_start(0.25, seed)`), the same family the known-cause wounds were made from, so this is a best case. On a real wound the start does not match its mask.
- low_density is weakly identifiable under the follower rule (interior holes refill within a few hours; `sim/alt_start.py`), so it is easily confused with normal.
- Early checks see few frames (hourly frames: 1 at 1.9 h); with 10 wounds an early score rests on very little data, so read it as rough.
- In the agent the Investigator only runs when a wound is off track, once per run; it never changes the decision.

Per-wound rows: `investigator.csv`. Regenerate: `python -m agent.investigator`.
