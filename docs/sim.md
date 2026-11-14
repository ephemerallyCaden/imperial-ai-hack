# Cell simulator: rules and output format (P2, `sim/cellsim.py`)

Run: `python3 sim/cellsim.py --hours 24 --Tm 0.1 [--Td 20] [--out run.npz]` (synthetic straight scratch, ~1 s).
API: `simulate(occ0, Params(...), hours, frame_dt=1.0, seed=0, grain=4) -> dict`; `occ0` is an (H,W) uint8 array, 1 = cell.

## Rules (per step of `dt` hours, all cells in parallel; numpy only, easy to port to JS)
1. One lattice site = one cell (~20 um). Square lattice, Moore (8) neighbourhood.
2. A cell migrates with prob `dt/Tm * rho_local**dens_exp` (rho_local = occupied fraction of its 3x3 block; density-dependent movement). Else it divides with prob `dt/Td` (Migliaccio Pd; `Td=None` = division off, used for WHAD).
3. The target is a random EMPTY neighbour. No empty neighbour = contact inhibited, nothing happens. Division places the daughter there.
4. Wound bias: with prob `bias` (default 7/9) the target is restricted to empty neighbours pointing up the gradient of blurred emptiness (radius `blur`); otherwise any empty neighbour.
5. Two cells claiming one site: random priority wins.
6. Boundary: a band of `edge` sites at the lattice border is refilled every step (cells keep entering the field of view).
Parameters fitted per wound (#23): `Tm`, `bias` (`dens_exp` fixed for now). Time step: `dt` = 0.1 h.

## Output (`np.savez_compressed`, keys of the dict `simulate` returns)
| key | shape / dtype | meaning |
|---|---|---|
| `occ` | (F,H,W) uint8 | agent lattice per frame, 1 = cell |
| `density` | (F,H/g,W/g) float32 | block-mean coarse-grain of `occ` (g = `grain`); this is the NCA's state |
| `t_hours` | (F,) | frame times, hours from start |
| `wound_frac` | (F,) | `1 - mean(occ)`: empty fraction of the lattice (= wound / ROI, same definition as `whad_curves.csv`) |
| `grain` | int | coarse-grain factor |
| `params` | str | repr of the Params used |
Invariant: `density.mean() == occ.mean()` (agent area = density area every frame).
