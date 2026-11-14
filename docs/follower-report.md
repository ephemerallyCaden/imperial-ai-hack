# Follower (sheet-like) rule: prototype report (Agent 4, feature/p2-follower)

Status: PROTOTYPE for the lead's switch decision before 04:00. The frozen rules are unchanged on every agent branch;
the new rule is `Params(follow=True)` (default False, bit-identical output when off).

## Rule
A mover connected to the reservoir (Moore path through occupied sites to the refilled border band) pulls the chain of
cells behind it one site, so the vacancy exits at the reservoir and is refilled. In occupancy terms: its target fills
and its source stays occupied. Movers not connected (islands) leave a vacancy as before. Connectivity is the Moore
component of occupied sites containing the reservoir; it only grows (connected moves never vacate), so it is unique and
does not depend on the warm start. Tm, bias, dens_exp, conflicts and reservoir are unchanged. Output format unchanged.
Code: `sim/cellsim.py` (dilate, grow_connected, step, simulate).

## Results
RESULTS_PLACEHOLDER

## Reproduce
- `python3 sim/follower_checks.py 2.0`: size independence, packedness, islands, linearity (about 20 s)
- `python3 sim/follower_refit.py frozen && python3 sim/follower_refit.py follow && python3 sim/follower_refit.py --table`
- `python3 sim/follower_forecast.py /tmp/follower_scratch && python3 /tmp/sanity_keep.py /tmp/follower_scratch/forecasts`
