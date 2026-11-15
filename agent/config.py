"""Agent constants (design.md 9b). The Critic's allowlist lives here: a number in agent text is traced only if it
matches a tool output or one of these constants WITH its unit."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RUNS_DIR = os.path.join(HERE, "runs")
RESULTS_DIR = os.path.join(HERE, "results")

HORIZON_H = 19.0
CHECKS_H = [1.9, 3.8, 5.7, 9.5]          # forecasts exist only at these cut-offs (eval/scheduler.py)
BAND_LEVEL = 0.90                         # only the data/upload.py band may be called "90%"
P_UNLIKELY = 0.1                          # schedule_advice: stop, unlikely to reach 90% closure by 19 h
P_LIKELY = 0.9                            # schedule_advice: stop, likely to close ("untested")
COST_IMAGE = 1                            # scoreboard cost units (stated assumptions)
COST_PLATE_HOUR = 5
COST_PLATE_HOUR_SENSITIVITY = [2, 20]

# Critic sources (agent/run.py): numeric lists longer than this (curves, quantile series, ensemble members) are dropped
# before tracing, so a made-up number cannot trace by rounding to some point of a long series. Scalars and short
# lists (<= 4 values) stay.
CRITIC_LIST_MAX = 4

# Scope guard (agent/run.py scope_guard): a plain KEYWORD FILTER, not a classifier. If an explanation contains any of
# these (case-insensitive regex, word-start match) it is replaced by a neutral template built from the decision's label
# and evidence, and a "scope" record is logged. It catches the obvious words only: a paraphrase that avoids every term
# gets through, and a legitimate sentence that happens to use a term is replaced (safe direction). Keep it short.
SCOPE_TERMS = {
    "clinical": [r"patients?", r"diagnos\w*", r"treat(?:s|ed|ing|ments?)?", r"antibiotics?", r"drugs?",
                 r"dos(?:e|es|ing|age)", r"prescri\w*", r"infect\w*"],
    "molecule": [r"molecul\w*", r"compounds?", r"SMILES"],
}

MAX_STEPS = 13                            # per run (4 checks x 3 steps + one Investigator call); a run that hits either limit stops and is logged
TOKEN_BUDGET = 60000

# (value, unit) pairs the Critic accepts. Units: "%", "h", "p" (probability), "cost".
ALLOWLIST = (
    [(BAND_LEVEL * 100, "%"), (50, "%"), (90, "%"), (HORIZON_H, "h")]
    + [(c, "h") for c in CHECKS_H]
    + [(P_UNLIKELY, "p"), (P_LIKELY, "p")]
    + [(COST_IMAGE, "cost"), (COST_PLATE_HOUR, "cost")] + [(c, "cost") for c in COST_PLATE_HOUR_SENSITIVITY]
)
