# Stitch

Forecast the rest of a wound-closure time-lapse from its first part, with an honest uncertainty band.

> Research prototype. Advisory only. Not a medical device. No clinical or drug-effect claims.

## Problem

Scratch-assay and wound-healing experiments are measured after they finish. An assay scientist watching a plate has no calibrated early answer to "will this well close, and when?" Stitch forecasts the closure curve from the first 20-30% of the series, gives time to 50% / 90% closed with ranges, and flags wells that look off-track.

## What we built

_TODO: fill in as features land._

## How it works

_TODO: NCA ensemble + conformal calibration; cell layer; viewer._

## Results

_TODO: scorecard vs baselines, calibration, failure cases._ Baseline numbers: `eval/results/`.

## Repo layout

```
data/     fetch.py, build_*.py (raw -> data/processed/*.csv), segment.py (texture segmenter)
contracts/ forecast.schema.json + validate.py (forecast file format)
eval/     baselines.py (simple forecasters), run_baselines.py (scoring), results/
nca/      NCA ensemble + calibration
sim/      cell-layer simulator
web/      viewer / report page
```

## Reproduce

```bash
pip install -r requirements.txt
export CLOSURECALL_DATA=/path/outside/repo   # raw data is ~2.5 GB; default is data/raw
python data/fetch.py
python -I data/build_curves.py
python eval/run_baselines.py
```

## Datasets

| Dataset | Licence | Use |
|---|---|---|
| WHAD (Iheme et al. 2024), Zenodo [10.5281/zenodo.12806149](https://doi.org/10.5281/zenodo.12806149) | CC BY 4.0 | Main benchmark: MCF10A scratch assays, 9 wounds with manual masks + 22 auto-segmented |
| WHiM-BC (Garcia-Moreno et al. 2024), Zenodo [10.5281/zenodo.8131123](https://doi.org/10.5281/zenodo.8131123) | CC BY 4.0 | MCF-7 monolayer (12) vs cancer-stem-cell sphere (12) wells, held-out condition |
| Drosophila embryo laser wounds, Zenodo [10.5281/zenodo.7660424](https://doi.org/10.5281/zenodo.7660424) | CC BY 4.0 | Wound-area curves (62 sequences) |
| Zaritsky et al. 2015, *GigaScience* 4:8, GigaDB [10.5524/100118](https://doi.org/10.5524/100118) | CC0 | Scratch-assay gap curves, DA3 and MDCK, +/- HGF/SF, Met inhibitor |
| Jin et al. 2016 PC-3 scratch-assay density profiles, via [jlager/BINNs](https://github.com/jlager/BINNs) | not stated; cited, not re-hosted | 1D density profiles, 6 initial densities |

Derived curves in `data/processed/` are redistributed under each source's licence with attribution above. Jin data is not committed.

## Open-source libraries

numpy, scipy, pandas, tifffile, Pillow, jsonschema. _TODO: add as used._

## Models / APIs

_TODO._
