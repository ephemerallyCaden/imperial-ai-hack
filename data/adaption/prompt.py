"""Shared by the training generator, the real test set and the scorer (issue #90): the fixed instruction, the canonical
key order, vocabularies and the canonical serialisation. Stdlib only."""
import json

KEYS = ["frame_interval_h", "pixel_um", "duration_h", "cell_type", "assay_type", "imaging", "proliferation_blocked",
        "condition", "in_scope", "missing"]
NULLABLE = KEYS[:8]  # fields that can be null and are then listed in "missing"
CELL_TYPES = ["MCF10A", "MDCK", "HaCaT", "A549", "NIH3T3", "HUVEC", "keratinocyte", "fibroblast", "MCF7", "MDA-MB-231",
              "HeLa", "U2OS", "other"]
ASSAY_TYPES = ["scratch", "insert", "laser", "other"]
IMAGING = ["phase_contrast", "brightfield", "fluorescence", "other"]

INSTRUCTION = (
    "Extract the wound-healing assay settings from the Methods paragraph below. Reply with one JSON object only, keys in "
    "this order: frame_interval_h, pixel_um, duration_h, cell_type, assay_type, imaging, proliferation_blocked, condition, "
    "in_scope, missing.\n"
    "- frame_interval_h: hours between frames (20 min = 0.3333); pixel_um: micrometres per pixel, only if a pixel size is "
    "stated (not from magnification or camera names); duration_h: total imaging time in hours. Round numbers to 4 decimals.\n"
    "- cell_type: one of " + ", ".join(CELL_TYPES) + ".\n"
    "- assay_type: scratch, insert, laser or other. imaging: phase_contrast, brightfield, fluorescence or other.\n"
    "- proliferation_blocked: true for mitomycin C or serum starvation, false only if explicitly not blocked.\n"
    "- condition: \"knockdown:GENE\", \"drug:NAME\" (no dose) or \"control\".\n"
    "- in_scope: true only for a 2D monolayer scratch or insert assay imaged by phase contrast or bright field.\n"
    "- Use null for anything not stated and list those keys in missing. Ignore numbers that are not these settings "
    "(seeding density, concentrations, wavelengths, temperatures).\n\nParagraph:\n")


def build_prompt(paragraph):
    return INSTRUCTION + paragraph.strip()


def finalize(d):
    """Fill missing from nulls, round numbers, return a dict in canonical key order."""
    out = {}
    for k in NULLABLE:
        v = d.get(k)
        out[k] = round(float(v), 4) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
    out["in_scope"] = bool(d["in_scope"])
    out["missing"] = [k for k in NULLABLE if out[k] is None]
    return out


def canonical(d):
    """The exact completion string: compact JSON, canonical key order."""
    return json.dumps(finalize(d), ensure_ascii=False, separators=(", ", ": "))
