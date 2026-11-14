"""Scoring shared by baselines and the NCA ensemble. All CIs are bootstrapped over wounds, not frames
(frames within a wound are correlated, so a per-frame CI would be too narrow)."""
import numpy as np

RNG = np.random.default_rng(0)


def event_time(t, a, level):
    """First time a <= level, or None if it never gets there (censored)."""
    hit = np.nonzero(a <= level)[0]
    return float(t[hit[0]]) if len(hit) else None


def crps_ensemble(samples, y):
    """CRPS per time point. samples: (m, n) ensemble members, y: (n,). For m=1 this equals |error|."""
    s = np.atleast_2d(samples)
    return np.abs(s - y).mean(0) - 0.5 * np.abs(s[:, None, :] - s[None, :, :]).mean((0, 1))


def wound_coverage(lo, hi, y):
    """Fraction of a wound's future points inside [lo, hi]."""
    return float(np.mean((y >= lo) & (y <= hi)))


def boot_ci(per_wound, n=2000, q=(2.5, 97.5)):
    """Mean over wounds with a bootstrap-over-wounds 95% CI."""
    v = np.asarray([x for x in per_wound if x is not None and np.isfinite(x)])
    if len(v) == 0:
        return np.nan, np.nan, np.nan
    means = RNG.choice(v, (n, len(v))).mean(1)
    return float(v.mean()), *map(float, np.percentile(means, q))
