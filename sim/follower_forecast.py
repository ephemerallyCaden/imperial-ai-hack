"""PROTOTYPE: sim_ensemble forecasts with Params(follow=True), written to a scratch dir (never sim/forecasts/).

  python3 sim/follower_forecast.py <scratch_dir>
Runs calibrate.run_all() (manual fits + presets) and forecast.main() unchanged, with local overrides reaching the
workers via fork: Params(follow=True), TM_GRID geomspace(0.05, 50, 31), and every output path under <scratch_dir>.
"""
import functools, multiprocessing as mp, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import calibrate as cal, forecast as fc
from cellsim import Params

out = os.path.abspath(sys.argv[1])
assert not out.startswith(os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))), "scratch dir must be outside the repo"
mp.set_start_method("fork", force=True)
cal.Params = fc.Params = functools.partial(Params, follow=True)
cal.TM_GRID = np.geomspace(0.05, 50.0, 31)
frozen = [cal.OUT, fc.AUTO_FITS] + [os.path.join(fc.OUT_DIR, f) for f in os.listdir(fc.OUT_DIR)]
stamp = {f: os.path.getmtime(f) for f in frozen if os.path.exists(f)}
cal.OUT = os.path.join(out, "whad_fits_follow.json")
fc.AUTO_FITS = os.path.join(out, "whad_auto_fits_follow.json")
if hasattr(cal, "AUTO_FITS"):
    cal.AUTO_FITS = fc.AUTO_FITS
fc.OUT_DIR = os.path.join(out, "forecasts")
cal.run_all()
fc.main()
assert all(os.path.getmtime(f) == t for f, t in stamp.items()), "a frozen fits/forecast file was modified"
print("frozen fits and forecasts untouched:", len(stamp), "files")
