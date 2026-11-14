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

### 1. Front-like closure (frame strip `docs/follower-strip-C61_P2.png`)
exp1_partII_C61_P2, seed 0. Frozen Tm 0.5 / bias 0.78 (fit); follow Tm 4 / bias 0.78 (hand-picked before the refit).
Rows: agents frozen, agents follow, smoothed + area-matched outline frozen, the same for follow.

| t (h) | 4 | 8 | 12 | 16 | 19 |
|---|---|---|---|---|---|
| data wound_frac | 0.201 | 0.140 | 0.071 | 0.012 | 0.002 |
| frozen | 0.207 | 0.134 | 0.077 | 0.048 | 0.035 |
| follow | 0.202 | 0.141 | 0.081 | 0.021 | 0.002 |

Follow: the band narrows from both edges, pinches off at about 12-16 h and is closed at 19 h, with no holes in the
sheet. The smoothed view and outline read as a closing wound to the end. Frozen: scattered vacancies from about 4 h.

### 2. Packed sheet and islands (C61_P2; `sim/follower_checks.py 2.0`)
| | t (h) | empties inside original wound | isolated empty sites | moves leaving a vacancy |
|---|---|---|---|---|
| frozen | 4 / 8 / 12 / 19 | 0.63 / 0.48 / 0.48 / 0.41 | 30 / 58 / 66 / 40 | 1.00 |
| follow (Tm 2) | 4 / 8 | 1.00 / 1.00 | 2 / 2 | 0.00 (no island movers) |

### 3. Size independence (12-site wavy scratch, mean of 3 seeds; area_norm at 4/8/12/19/24 h)
| field | frozen Tm 0.5 | follow Tm 2 |
|---|---|---|
| 44x44 | 0.85 0.60 0.37 0.20 0.13 | 0.47 0.05 0 0 0 |
| 44x456 | 0.97 0.79 0.58 0.36 0.27 | 0.60 0.17 0 0 0 |
| 120x168 | 0.97 0.93 0.89 0.85 0.82 | 0.57 0.14 0 0 0 |

Follow: 44x456 and 120x168 agree; 44x44 is slightly faster because the wound ends touch the border reservoir.
Frozen closure depends on the field size, because vacancies diffuse out through the border.

### 4. Linearity (R^2 of a line to area_norm while above 0.1)
Follow 0.999 and frozen 0.949 (44x44 scratch); WHAD part II data 0.978-0.996 (C61_P2, CC_P4, N61_P1, CC_P2).

### 5. Refit (`sim/follower_refit.py`, cost = wound_frac MSE as calibrate.py)
REFIT_PLACEHOLDER

### 6. Ensemble coverage (`sim/follower_forecast.py` + `/tmp/sanity_keep.py`, loo)
COVERAGE_PLACEHOLDER

### 7. Impact
- **JS (Agent 3, `sim/js/engine.js`):** small. Add `follow` to the params, a Moore dilation, `growConnected` (loop to a
  fixpoint after each step's refill) and one condition on the vacate line, about 25 lines. Connectivity is unique
  (the reservoir's occupied Moore component), so JS can recompute it from scratch each step and still match Python.
  Parity test as before (20 seeds, area at 4/12/24 h). Estimate 30-45 min. The draw tool would then heal at the same
  speed on any canvas size, so the "draw at 32x44" workaround in docs/p2-handoff.md could go.
- **NCA (Agent 2, `nca/`):** large. Under follow the sheet stays packed (rho = 1 everywhere except the wound), and
  mass reaches the front through fully packed cells. The current NCA's flux is capped by the target's room
  (1 - rho), so no mass can pass through rho = 1 cells: it cannot represent this. Options: (a) let the existing
  source term act for WHAD as "inflow from beyond the field of view" (a front source, learned from the data; mass
  stays bounded by 1 and the reservoir floor stays); (b) a hidden pressure channel that allows flux through packed
  cells. (a) is the smaller change. Either way: regenerate the 3000 training runs under follow (minutes) and retrain
  (hours under the current load). The density state becomes close to binary, which is easier to learn. The
  parameter channel normalisation `p0` uses ln 5 as the Tm maximum and must change to the new Tm range.
- **Fits and forecasts (Agent 1):** Tm means something different (about 4-8x larger for the same wound); the Tm grid
  becomes 0.05-50 h. whad_fits.json, the auto fits, sim_ensemble forecasts and draw-tool presets all need regenerating
  (`calibrate.py --all` and `forecast.py`, about 1 h of CPU at the current load).

## Reproduce
- `python3 sim/follower_checks.py 2.0`: size independence, packedness, islands, linearity (about 20 s)
- `python3 sim/follower_refit.py frozen && python3 sim/follower_refit.py follow && python3 sim/follower_refit.py --table`
- `python3 sim/follower_forecast.py /tmp/follower_scratch && python3 /tmp/sanity_keep.py /tmp/follower_scratch/forecasts`
