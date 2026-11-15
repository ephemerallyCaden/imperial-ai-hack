"""Synthetic training set for the Adaption Intake fine-tune (issue #90): protocol Methods paragraph -> Intake JSON.

python3 data/adaption/make_train.py [--n 1500] [--seed 90] [--out data/adaption/train.jsonl]
Stdlib only, seeded, reproducible. Every paragraph is assembled from templates written for this file (no sentences
from real papers, so the real test set stays uncontaminated; check with overlap_check.py). Labels are correct by
construction: each field is sampled first, then rendered into text in one of many phrasings, units and orders,
or left out (-> null). Distractor numbers (seeding density, doses, wavelengths, gap widths, recovery times) are added
so the model learns which numbers are settings.
"""
import argparse, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from prompt import build_prompt, canonical  # noqa: E402

# ----------------------------------------------------------------------------------------------- vocabularies
CELLS = {  # canonical -> surface forms
    "MCF10A": ["MCF10A cells", "MCF-10A cells", "non-transformed MCF10A mammary epithelial cells", "MCF 10A breast epithelial cells"],
    "MDCK": ["MDCK cells", "Madin-Darby canine kidney (MDCK) cells", "MDCK II epithelial cells", "MDCK monolayers"],
    "HaCaT": ["HaCaT keratinocytes", "HaCaT cells", "immortalised HaCaT cells"],
    "A549": ["A549 cells", "A549 lung adenocarcinoma cells", "A-549 cells"],
    "NIH3T3": ["NIH3T3 fibroblasts", "NIH/3T3 cells", "NIH-3T3 mouse fibroblasts"],
    "HUVEC": ["HUVECs", "human umbilical vein endothelial cells (HUVECs)", "primary HUVEC", "HUVEC monolayers"],
    "keratinocyte": ["primary human keratinocytes", "normal human epidermal keratinocytes", "neonatal keratinocytes"],
    "fibroblast": ["primary dermal fibroblasts", "human foreskin fibroblasts", "mouse embryonic fibroblasts"],
    "MCF7": ["MCF7 cells", "MCF-7 breast cancer cells"],
    "MDA-MB-231": ["MDA-MB-231 cells", "MDA-MB-231 triple-negative breast cancer cells"],
    "HeLa": ["HeLa cells", "HeLa Kyoto cells"],
    "U2OS": ["U2OS osteosarcoma cells", "U-2 OS cells"],
    "other": ["RPE-1 cells", "Caco-2 cells", "PC-3 prostate cancer cells", "HEK293T cells", "IMCD3 cells", "SH-SY5Y cells",
              "BEAS-2B bronchial cells", "LoVo cells"],
}
GENES = ["CYR61", "RAC1", "CDC42", "RHOA", "ITGB1", "CDH1", "PTK2", "YAP1", "WWTR1", "VIM", "KRT14", "MMP9", "PXN",
         "TLN1", "ARPC2", "MYH9", "CTNNA1", "EZR", "FSCN1", "SNAI2"]
DRUGS = [("Y-27632", "uM", [5, 10, 20]), ("blebbistatin", "uM", [10, 25, 50]), ("cytochalasin D", "uM", [0.1, 0.5, 1]),
         ("nocodazole", "nM", [50, 100, 200]), ("PF-573228", "uM", [1, 5, 10]), ("latrunculin A", "nM", [100, 250]),
         ("EGF", "ng/mL", [10, 20, 50]), ("TGF-beta1", "ng/mL", [2, 5, 10]), ("SB-431542", "uM", [5, 10]),
         ("ML-7", "uM", [10, 20]), ("CK-666", "uM", [50, 100]), ("dasatinib", "nM", [50, 100])]
MU = ["µm", "μm", "um"]  # micro sign variants
UNIT = {"uM": ["µM", "μM", "uM"], "nM": ["nM"], "ng/mL": ["ng/mL", "ng ml-1", "ng/ml"]}


def fmt(x):
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return s


def times(r):
    return r.choice(["×", "x", "X"])


# ----------------------------------------------------------------------------------------------- field renderers
def r_interval(r, h):
    """Render a frame interval of h hours."""
    m = h * 60
    opts = []
    if m < 3:
        s = round(h * 3600)
        opts += [f"every {s} s", f"at {s}-s intervals", f"with a frame interval of {s} seconds", f"once every {s} sec"]
    if m.is_integer() and m < 180:
        mi = int(m)
        opts += [f"every {mi} min", f"at {mi}-min intervals", f"every {mi} minutes", f"at intervals of {mi} min",
                 f"with a {mi}-minute frame interval", f"once every {mi} min", f"every {mi * 60} s"]
    if (h * 2).is_integer() and h >= 0.5:
        hh = fmt(h)
        opts += [f"every {hh} h", f"at {hh}-h intervals", f"every {hh} hours", f"at intervals of {hh} hours"]
    if h == 1:
        opts += ["hourly", "once per hour", "every hour", "at 1-h intervals"]
    if h == 0.5:
        opts += ["twice per hour", "every half hour"]
    return r.choice(opts)


def r_duration(r, d):
    opts = [f"for {fmt(d)} h", f"over {fmt(d)} hours", f"for a total of {fmt(d)} h", f"over a {fmt(d)}-h period",
            f"for {int(d * 60)} min"]
    if d % 24 == 0:
        k = int(d // 24)
        opts += [f"over {k} day{'s' if k > 1 else ''}", f"for {k} d"]
    return r.choice(opts)


def r_pixel(r, p):
    u = r.choice(MU)
    nm = round(p * 1000)
    return r.choice([
        f"The pixel size was {fmt(p)} {u}.", f"Images had a resolution of {fmt(p)} {u}/pixel.",
        f"Spatial calibration: {fmt(p)} {u} per pixel.", f"One pixel corresponded to {fmt(p)} {u}.",
        f"The effective pixel size at the sample was {nm} nm.", f"Calibration was {nm} nm/px.",
        f"Pixel dimensions were {fmt(p)} × {fmt(p)} {u}.", f"Each pixel spans {fmt(p)} {u} in the final images.",
        f"Image scale was set to {fmt(p)} {u} px-1 for analysis."])


def r_no_pixel(r):
    """Instrument detail that does NOT give a pixel size (-> pixel_um null)."""
    obj = r.choice([4, 5, 10, 20, 40])
    cam = r.choice(["a Hamamatsu ORCA-Flash4.0 camera", "an Andor Zyla sCMOS camera", "a Photometrics Prime 95B camera",
                    "a Nikon DS-Qi2 camera", "a monochrome CCD camera", "an IncuCyte ZOOM system", "a Leica DFC camera"])
    return r.choice([f"A {obj}{times(r)} objective was used.", f"Images were taken with a {obj}{times(r)} objective and {cam}.",
                     f"Acquisition used {cam}.", f"We used {cam} on an inverted microscope.",
                     f"Fields were recorded through a {obj}{times(r)} lens.", ""])


# ----------------------------------------------------------------------------------------------- scenario sampling
def sample(r):
    """Sample ground-truth fields + a scenario; returns (labels, scenario)."""
    sc = r.choices(["scratch", "insert", "transwell", "embryo_laser", "spheroid", "fluo_scratch", "dic_scratch",
                    "monolayer_laser", "unstated_wound"], weights=[52, 22, 3.5, 3, 3, 3, 2, 1.5, 3])[0]
    lab = {}
    lab["cell_type"] = r.choice(list(CELLS)) if r.random() < 0.9 else None
    if sc == "embryo_laser":
        lab["cell_type"] = "other"  # whole embryos / larvae, not a listed cell type
    lab["assay_type"] = {"scratch": "scratch", "insert": "insert", "transwell": "other", "embryo_laser": "laser",
                         "spheroid": "other", "fluo_scratch": "scratch", "dic_scratch": "scratch",
                         "monolayer_laser": "laser", "unstated_wound": None}[sc]
    if sc in ("fluo_scratch", "embryo_laser"):
        lab["imaging"] = "fluorescence"
    elif sc == "dic_scratch":
        lab["imaging"] = "other"
    elif sc in ("transwell",):
        lab["imaging"] = r.choice(["brightfield", None])
    else:
        lab["imaging"] = r.choices(["phase_contrast", "brightfield", None, "fluorescence"], weights=[55, 25, 17, 3])[0]
        if sc in ("scratch", "insert", "unstated_wound") and lab["imaging"] == "fluorescence":
            lab["imaging"] = "phase_contrast"  # keep the in-scope classes in scope; fluorescence-only has its own scenario
    timed = sc not in ("transwell",)
    lab["frame_interval_h"] = (r.choice([5, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360]) / 60
                               if timed and r.random() < 0.85 else None)
    if sc == "embryo_laser" and lab["frame_interval_h"] is not None:
        lab["frame_interval_h"] = r.choice([15, 30, 60, 90, 120]) / 3600
    lab["duration_h"] = (r.choice([6, 8, 12, 16, 18, 20, 24, 30, 36, 48, 72]) if r.random() < 0.7 else None)
    if sc == "embryo_laser" and lab["duration_h"] is not None:
        lab["duration_h"] = r.choice([0.5, 1, 1.5, 2])
    if sc == "transwell":
        lab["duration_h"] = None  # end-point assay: the migration time is not a time-lapse duration
        lab["_migr"] = r.choice([6, 12, 16, 24, 48])
    lab["pixel_um"] = r.choice([0.108, 0.16, 0.325, 0.454, 0.5, 0.65, 0.8, 0.91, 1.24, 1.29, 1.6, 2.0]) if r.random() < 0.5 else None
    lab["proliferation_blocked"] = r.choices([True, False, None], weights=[45, 8, 47])[0]
    if sc in ("embryo_laser",):
        lab["proliferation_blocked"] = None
    c = r.choices(["knockdown", "drug", "control", None], weights=[30, 25, 20, 25])[0]
    if c == "knockdown":
        g = r.choice(GENES); lab["condition"] = f"knockdown:{g}"; lab["_cond"] = ("kd", g)
    elif c == "drug":
        d = r.choice(DRUGS); lab["condition"] = f"drug:{d[0]}"; lab["_cond"] = ("drug", d)
    elif c == "control":
        lab["condition"] = "control"; lab["_cond"] = ("ctrl", None)
    else:
        lab["condition"] = None; lab["_cond"] = None
    lab["in_scope"] = (lab["assay_type"] in ("scratch", "insert", None) and lab["imaging"] in ("phase_contrast", "brightfield", None)
                       and sc not in ("transwell", "embryo_laser", "spheroid", "monolayer_laser"))
    return lab, sc


# ----------------------------------------------------------------------------------------------- sentence builders
def s_culture(r, lab, sc=None):
    if sc == "embryo_laser":
        return r.choice(["Embryos were dechorionated, aligned on glass coverslips and covered with halocarbon oil.",
                         "Larvae were anaesthetised and mounted laterally in 1% low-melting agarose.",
                         "Staged embryos were mounted ventral side down for live imaging."])
    cell = r.choice(CELLS[lab["cell_type"]]) if lab["cell_type"] else r.choice(["Cells", "The cells", "Epithelial cells"])
    plate = r.choice(["24-well plates", "12-well plates", "96-well ImageLock plates", "35-mm glass-bottom dishes",
                      "6-well plates", "µ-Slide 8-well chambers"])
    dens = r.choice([f"{r.choice([1, 2, 2.5, 3, 5, 8])} × 10^{r.choice([4, 5])} cells per well", f"{r.choice([20000, 40000, 50000, 150000])} cells/well",
                     f"{r.choice([70, 90, 95, 100])}% confluence"])
    med = r.choice(["DMEM/F12 with 5% horse serum", "DMEM supplemented with 10% FBS", "RPMI-1640 with 10% fetal bovine serum",
                    "EGM-2 endothelial medium", "MEM with 10% FCS"])
    return r.choice([
        f"{cell[0].upper() + cell[1:]} were seeded in {plate} at {dens} and grown in {med}.",
        f"{cell[0].upper() + cell[1:]} were maintained in {med} at 37 °C and 5% CO2 and plated in {plate} ({dens}).",
        f"For migration experiments, {cell} were plated at {dens} in {plate}.",
        f"We cultured {cell} in {med}; for assays they were grown to {r.choice(['a confluent monolayer', 'confluence', 'full confluence'])} in {plate}."])


def s_prolif(r, lab):
    v = lab["proliferation_blocked"]
    if v is True:
        if r.random() < 0.6:
            return r.choice([
                f"To exclude proliferation, monolayers were incubated with mitomycin C ({r.choice([5, 10, 25])} µg/mL) for {r.choice([1, 2, 3])} h before wounding.",
                f"Cell division was blocked with {r.choice([5, 10])} µg/ml mitomycin-C.",
                f"Mitomycin C ({r.choice([2, 5, 10])} µg/mL, {r.choice([90, 120])} min) was applied to inhibit proliferation.",
                "Proliferation was inhibited by pre-treatment with mitomycin C."])
        return r.choice([
            "Cells were serum-starved overnight before the assay to limit proliferation.",
            f"To minimise proliferation, cells were kept in serum-free medium for {r.choice([12, 16, 24])} h prior to and during migration.",
            "Migration was performed under serum starvation to suppress cell division."])
    if v is False:
        return r.choice(["No proliferation inhibitor was used.", "Mitomycin C was not added, so closure includes proliferation.",
                         "Cells were not treated with any anti-proliferative agent.", "Proliferation was not blocked in these experiments."])
    return ""


def s_condition(r, lab):
    c = lab["_cond"]
    if c is None:
        return ""
    if c[0] == "kd":
        g = c[1]
        return r.choice([
            f"Cells were transfected with siRNA targeting {g} or a non-targeting control {r.choice([48, 72])} h before wounding.",
            f"Stable {g} knockdown lines were generated with lentiviral shRNA (sh{g}); scrambled shRNA served as control.",
            f"{g} was depleted using two independent siRNAs ({r.choice([10, 20, 50])} nM) delivered with Lipofectamine RNAiMAX.",
            f"CRISPR/Cas9 was used to knock out {g}, and wounds in these cells were compared with parental controls.",
            f"We silenced {g} by siRNA transfection {r.choice([24, 48])} h prior to scratching."])
    if c[0] == "drug":
        name, unit, doses = c[1]
        dose = r.choice(doses); u = r.choice(UNIT[unit])
        return r.choice([
            f"After wounding, medium containing {fmt(dose)} {u} {name} or vehicle (DMSO) was added.",
            f"Where indicated, cells were treated with {name} ({fmt(dose)} {u}) immediately after wounding.",
            f"{name[0].upper() + name[1:]} was added at {fmt(dose)} {u} {r.choice([30, 60])} min before imaging.",
            f"To test the role of this pathway, wounds were closed in the presence of {fmt(dose)} {u} {name}."])
    return r.choice(["Untreated cells were used throughout.", "All wells received vehicle only (0.1% DMSO) and served as controls.",
                     "Wild-type control monolayers were analysed.", "Only non-targeting control cells were imaged in this set."])


def s_wound(r, lab, sc):
    if sc in ("scratch", "fluo_scratch", "dic_scratch"):
        tool = r.choice(["a sterile 200-µl pipette tip", "a 10-µL pipette tip", "a P200 tip", "an IncuCyte WoundMaker",
                         "a 96-pin wound-making tool", "a sterile razor-guided tip"])
        w = r.choice([300, 400, 500, 600, 700])
        return r.choice([
            f"Confluent monolayers were scratched with {tool}, washed twice with PBS and given fresh medium.",
            f"A linear wound (about {w} {r.choice(MU)} wide) was made across each well with {tool}.",
            f"Wounds were introduced using {tool} and debris was removed by rinsing.",
            f"We made a single scratch per well with {tool}."])
    if sc == "insert":
        g = r.choice([500, 400, 300])
        return r.choice([
            f"Two-well silicone culture inserts (ibidi) were removed to leave a cell-free gap of {g} {r.choice(MU)}.",
            f"Gaps were created by lifting removable culture-insert stoppers after cells had attached.",
            f"Cells were seeded on either side of a silicone insert, which was removed after {r.choice([12, 24])} h to create a defined {g}-{r.choice(MU)} gap.",
            "Oris cell-seeding stoppers were withdrawn to open a circular exclusion zone."])
    if sc == "transwell":
        return r.choice([
            f"Migration was measured in Transwell chambers with {r.choice([8, 5])}-{r.choice(MU)} pores; cells were added to the upper compartment.",
            "Boyden-chamber assays were used: cells migrating through the porous membrane towards serum were counted.",
            "Chemotaxis was assessed in Transwell inserts, and cells on the lower surface were stained with crystal violet."])
    if sc == "embryo_laser":
        return r.choice([
            f"Wounds were made in the ventral epidermis of stage {r.choice([14, 15, 16])} Drosophila embryos with a pulsed UV laser.",
            "Single-cell wounds were induced in zebrafish larval fin epidermis by laser ablation.",
            f"Laser ablation ({r.choice([355, 405])} nm) was used to wound the epidermis of mounted embryos."])
    if sc == "monolayer_laser":
        return r.choice(["Wounds were created by laser ablation of a row of cells in the monolayer.",
                         f"A {r.choice([355, 532])}-nm pulsed laser was used to ablate cells and open a wound in the sheet."])
    if sc == "spheroid":
        return r.choice([
            "Spheroids formed in ultra-low-attachment plates were embedded in collagen I and invasion into the matrix was followed.",
            "Tumour spheroids were embedded in Matrigel, and 3D invasion was quantified from the spheroid outline."])
    return r.choice(["Closure of the denuded area was then followed.", "Wound closure was then monitored."])


def s_imaging(r, lab, sc):
    im = lab["imaging"]
    iv = lab["frame_interval_h"]; du = lab["duration_h"]
    t = []
    if iv is not None:
        t.append(r_interval(r, iv))
    if du is not None:
        t.append(r_duration(r, du))
    r.shuffle(t)
    when = (" " + " ".join(t)) if t else ""
    mode = {"phase_contrast": r.choice(["phase-contrast", "phase contrast"]), "brightfield": r.choice(["bright-field", "brightfield", "transmitted-light"]),
            "fluorescence": r.choice(["fluorescence", "spinning-disc confocal", "epifluorescence"]),
            "other": r.choice(["DIC", "differential interference contrast", "quantitative phase (holographic)"]), None: None}[im]
    if im == "fluorescence" and sc in ("fluo_scratch", "embryo_laser"):
        lab_txt = r.choice(["of cells expressing H2B-mCherry", "of E-cadherin-GFP embryos" if sc == "embryo_laser" else "of nuclei stained with SiR-DNA",
                            "of membrane-labelled cells"])
        mode = f"{mode} imaging {lab_txt}"
    sys_ = r.choice(["on an inverted microscope with a stage-top incubator", "in an IncuCyte S3 live-cell system",
                     "on a Nikon Ti2 equipped with an environmental chamber", "using a Zeiss Axio Observer", "in a humidified chamber at 37 °C"])
    if sc == "transwell":
        mg = lab["_migr"]
        if im == "brightfield":
            return r.choice([f"After {mg} h, membranes were fixed and five {r.choice(['bright-field', 'brightfield'])} fields were counted per insert.",
                             f"Cells were allowed to migrate for {mg} h, fixed, and imaged in bright field."])
        return r.choice([f"After {mg} h, membranes were fixed and migrated cells were counted.",
                         f"Cells were allowed to migrate for {mg} h before fixation and counting."])
    if mode is None:
        return r.choice([f"Time-lapse images were acquired{when} {sys_}.", f"The wounds were recorded{when}.",
                         f"Images were collected{when} at {r.choice([3, 4, 6, 9])} positions per well."]) if when else \
            r.choice([f"Images were acquired {sys_}.", "The same fields were re-imaged at each time point."])
    if mode and r.random() < 0.25 and im in ("phase_contrast", "brightfield"):  # mixed modality, transmitted light wins
        mode = f"{mode} and GFP fluorescence"
    return r.choice([f"{mode[0].upper() + mode[1:]} images were acquired{when} {sys_}.",
                     f"Wound closure was followed by {mode} time-lapse microscopy{when}.",
                     f"Using {mode} optics, we imaged each wound{when}.",
                     f"Time-lapse {mode} movies were recorded{when} {sys_}."])


def s_distractor(r):
    return r.choice([
        f"Excitation was at {r.choice([405, 488, 561, 640])} nm with emission collected at {r.choice([450, 525, 600, 700])} nm.",
        f"Plates were equilibrated for {r.choice([20, 30, 45])} min in the incubator before the first image.",
        f"Each condition was run in {r.choice(['triplicate', 'quadruplicate', 'duplicate'])} and repeated {r.choice([2, 3, 4])} times.",
        f"Gap area was measured in Fiji using a {r.choice([3, 5, 7])}-pixel variance filter.",
        f"Cells between passages {r.choice([4, 5, 6])} and {r.choice([12, 15, 20])} were used.",
        f"Focus was maintained by hardware autofocus every {r.choice([2, 3, 5])} positions.",
        f"Data are mean ± SEM of n = {r.choice([3, 4, 5, 6])} experiments.",
        f"Medium was replaced {r.choice([2, 4, 6])} h after plating.",
        ""])


def s_scale(r, lab):
    return r_pixel(r, lab["pixel_um"]) if lab["pixel_um"] is not None else r_no_pixel(r)


def paragraph(r, lab, sc):
    parts = [s_culture(r, lab, sc), s_prolif(r, lab), s_condition(r, lab), s_wound(r, lab, sc), s_imaging(r, lab, sc),
             s_scale(r, lab), s_distractor(r), s_distractor(r) if r.random() < 0.4 else ""]
    head, tail = parts[:1], parts[1:]
    if r.random() < 0.7:  # usually culture first, rest shuffled; sometimes fully shuffled
        r.shuffle(tail); parts = head + tail
    else:
        r.shuffle(parts)
    text = " ".join(p for p in parts if p)
    if r.random() < 0.15:
        text = r.choice(["Scratch-wound assay. ", "Wound healing. ", "Migration assay: ", "Live imaging of wound closure. "]) + text
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1500); ap.add_argument("--seed", type=int, default=90)
    ap.add_argument("--out", default=os.path.join(HERE, "train.jsonl"))
    a = ap.parse_args()
    r = random.Random(a.seed)
    rows, seen = [], set()
    while len(rows) < a.n:
        lab, sc = sample(r)
        p = paragraph(r, lab, sc)
        if p in seen:
            continue
        seen.add(p)
        lab.pop("_cond", None); lab.pop("_migr", None)
        rows.append({"prompt": build_prompt(p), "completion": canonical(lab)})
    with open(a.out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} rows -> {a.out}")


if __name__ == "__main__":
    main()
