"""Simple point forecasters. Each takes observed (t, a) and future times tf, returns predicted a(tf).

a is normalised wound area (1.0 = area at frame 0). Curve fits use the history from its peak onward,
so the early recoil/expansion of embryo wounds is not fitted as closure.
"""
from collections import Counter
import numpy as np
from scipy.optimize import curve_fit

FALLBACKS = Counter()  # how often a fit failed and fell back to a simpler model


def _post_peak(t, a):
    i = int(np.argmax(a))
    return t[i:], a[i:]


def lvcf(t, a, tf):
    """Last value carried forward: the wound stays as it is now."""
    return np.full(len(tf), a[-1], dtype=float)


def linear(t, a, tf):
    """Straight-line extrapolation of area (post-peak least squares), floored at 0."""
    tp, ap = _post_peak(t, a)
    if len(tp) < 2:
        FALLBACKS["linear"] += 1
        return lvcf(t, a, tf)
    m, c = np.polyfit(tp, ap, 1)
    if m >= 0:
        return lvcf(t, a, tf)
    return np.clip(m * tf + c, 0, None)


def edge_speed(t, a, tf):
    """Constant edge speed: sqrt(area) falls linearly (circular front at constant speed).
    This is Fisher-KPP's travelling-wave prediction (c = 2*sqrt(D*r)) expressed on area alone."""
    tp, ap = _post_peak(t, a)
    if len(tp) < 2:
        FALLBACKS["edge_speed"] += 1
        return lvcf(t, a, tf)
    m, c = np.polyfit(tp, np.sqrt(ap), 1)
    if m >= 0:
        return lvcf(t, a, tf)
    return np.clip(m * tf + c, 0, None) ** 2


def _logistic(x, A, k, t50):
    return A / (1 + np.exp(np.clip(k * (x - t50), -50, 50)))


def logistic(t, a, tf):
    """Decreasing logistic A / (1 + exp(k (t - t50)))."""
    tp, ap = _post_peak(t, a)
    span = tp[-1] - tp[0] + 1e-9
    if len(tp) < 4:
        FALLBACKS["logistic"] += 1
        return linear(t, a, tf)
    try:
        p, _ = curve_fit(_logistic, tp, ap, p0=[ap[0] * 1.2, 2 / span, tp[-1] + span],
                         bounds=([0, 1e-6, tp[0]], [5, 10, tp[0] + 50 * span]), maxfev=5000)
    except Exception:
        FALLBACKS["logistic"] += 1
        return linear(t, a, tf)
    return _logistic(tf, *p)


def gompertz(t, a, tf):
    """Decreasing Gompertz A exp(-b (exp(c (t - t0)) - 1)), t0 = start of post-peak history."""
    tp, ap = _post_peak(t, a)
    t0, span = tp[0], tp[-1] - tp[0] + 1e-9
    if len(tp) < 4:
        FALLBACKS["gompertz"] += 1
        return linear(t, a, tf)
    f = lambda x, A, b, c: A * np.exp(-b * (np.exp(np.clip(c * (x - t0), -50, 50)) - 1))
    try:
        p, _ = curve_fit(f, tp, ap, p0=[ap[0], 0.1, 1 / span], bounds=([0, 1e-6, 1e-6], [5, 100, 10]), maxfev=5000)
    except Exception:
        FALLBACKS["gompertz"] += 1
        return linear(t, a, tf)
    return f(tf, *p)


BASELINES = {"lvcf": lvcf, "linear": linear, "edge_speed": edge_speed, "logistic": logistic, "gompertz": gompertz}
