"""Fail (exit 1) if the app's copy of the glass-dish look differs from the mockup's source.

design/prototypes/glass-dish/look.js is the source; web/vendor-design/look.js is a byte copy used by web/assay/tissue.js.
Fix a mismatch with: cp design/prototypes/glass-dish/look.js web/vendor-design/look.js
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, COPY = ROOT / "design/prototypes/glass-dish/look.js", ROOT / "web/vendor-design/look.js"

if SRC.read_bytes() != COPY.read_bytes():
    print(f"look.js out of sync: {COPY.relative_to(ROOT)} differs from {SRC.relative_to(ROOT)}\n"
          f"  fix: cp {SRC.relative_to(ROOT)} {COPY.relative_to(ROOT)}")
    sys.exit(1)
print("look.js in sync")
