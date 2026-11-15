"""Build data/adaption/test_real.jsonl (issue #90): REAL open-access Methods paragraphs, agent-labelled with source quotes.
NEVER use these paragraphs for training (Agent 2's overlap_check.py must report 0 contamination).

  python -I data/adaption/build_test_real.py [--dl /tmp/a1oa_dl] [--extra data/adaption/test_real_agent3.jsonl ...]

Each row: id, source {citation, doi, pmcid, url, licence}, paragraph (verbatim from the Europe PMC full-text XML, located by a
unique prefix), labels (prompt.finalize), quotes (an exact substring of the paragraph for every non-null field), prompt
(prompt.build_prompt), completion (prompt.canonical). Asserts: paragraph found exactly once, every quote is a substring, labels
valid against the schema vocabularies. Downloads (untrusted) go to --dl, one folder per PMCID.
"""
import argparse, json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prompt as P  # noqa: E402

N = None
# (pmcid, unique paragraph prefix, labels, quotes, note for the human check)
ROWS = [
    ("PMC11429573", "Cell migration was assessed by scratch wound assay using the Woundmaker",
     dict(frame_interval_h=2.0, assay_type="scratch", proliferation_blocked=True, in_scope=True),
     dict(frame_interval_h="imaged every two hours", assay_type="scratch wound assay",
          proliferation_blocked="serum-starved overnight in 0.1% FBS/DMEM"),
     "serum starvation (0.1% FBS) counted as proliferation_blocked=true per schema; imaging modality not stated (IncuCyte only)"),
    ("PMC6208388", "For the scratch wound assay, 65,000 cells",
     dict(assay_type="scratch", in_scope=True), dict(assay_type="For the scratch wound assay"),
     "distractors: 65,000 cells, 5 h, 800 um wound width; compounds unnamed -> condition null"),
    ("PMC5092051", "For live cell imaging EYFP vinculin-expressing MCF10A",
     dict(frame_interval_h=2 / 60, pixel_um=0.16, duration_h=3.0, cell_type="MCF10A", imaging="fluorescence",
          condition="drug:MLN4924", in_scope=False),
     dict(frame_interval_h="recorded every 2 min", pixel_um="pixel size 0.16 µm", duration_h="for up to 180 min",
          cell_type="MCF10A", imaging="TIRF", condition="MLN4924"),
     "TIRF of EYFP-vinculin = fluorescence-only -> out of scope; wound type not stated -> assay_type null"),
    ("PMC13467463", "The ibidi culture-inserts system performed",
     dict(assay_type="insert", in_scope=True), dict(assay_type="ibidi culture-inserts"),
     "4x objective only -> pixel_um null; Lumascope modality not stated"),
    ("PMC13255901", "Scratch wounds were created using a 96-pin",
     dict(frame_interval_h=3.0, duration_h=48.0, assay_type="scratch", imaging="phase_contrast", in_scope=True),
     dict(frame_interval_h="every 3 h", duration_h="over 2 days", assay_type="Scratch wounds were created",
          imaging="equipped with phase"),
     "phase + LED fluorescence illumination -> transmitted-light one (phase_contrast)"),
    ("PMC13233565", "To prepare cells for the scratch assay",
     dict(frame_interval_h=12.0, assay_type="scratch", in_scope=True),
     dict(frame_interval_h="every 12 h", assay_type="scratch assay"),
     "duration stated as a RANGE (84-120 h) -> labelled null; check. 'neural cues' are not a named drug -> condition null"),
    ("PMC8230361", "The chip model is a closed microenvironment",
     dict(frame_interval_h=1.0, duration_h=12.0, assay_type="other", imaging="fluorescence", in_scope=False),
     dict(frame_interval_h="captured every hour", duration_h="over a 12 h period",
          assay_type="preventing use of the scratch wound assay", imaging="CellTracker Green"),
     "single-cell tracking on a chip (explicitly not a scratch) -> other; serum-free medium only for staining -> proliferation null"),
    ("PMC11260685", "For live cell imaging, tGFP-COTL1",
     dict(frame_interval_h=1 / 60, assay_type="scratch", imaging="fluorescence", in_scope=False),
     dict(frame_interval_h="1-minute intervals", assay_type="a scratch was made using a pipette tip",
          imaging="confocal laser scanning system"),
     "confocal of tGFP cells (+ a DIC scan) -> fluorescence; check. distractors: 63x, 1.4NA, 488 nm, 0.4 us pixel dwell"),
    ("PMC7593626", "For the wound scratch assay, cells were grown in 6-well",
     dict(frame_interval_h=4.0, duration_h=8.0, assay_type="scratch", imaging="phase_contrast", proliferation_blocked=True,
          in_scope=True),
     dict(frame_interval_h="immediately (0 h), 4 and 8 h after wounding", duration_h="immediately (0 h), 4 and 8 h after wounding",
          assay_type="scratching the cell layer with a P200 pipette tip", imaging="phase-contrast microscope",
          proliferation_blocked="serum-reduced medium"),
     "timepoints 0/4/8 h -> interval 4 h, duration 8 h; serum-reduced medium counted as blocked; check"),
    ("PMC12915289", "A consistent and controlled wound model",
     dict(frame_interval_h=1.0, duration_h=48.0, assay_type="scratch", in_scope=True),
     dict(frame_interval_h="scan each well hourly", duration_h="over 48 hours", assay_type="Wound maker Tool"),
     "distractors: 40,000 cells, 700-800 um wound width, 100 ul, 5-minute equilibration, 10X objective"),
    ("PMC13703101", "Scratch wound healing assays were performed.",
     dict(assay_type="scratch", imaging="phase_contrast", in_scope=True),
     dict(assay_type="Scratch wound healing assays were performed", imaging="imaged under phase contrast"),
     "only two timepoints (1 h and 7.25 h post-scratch) -> interval and duration null; check"),
    ("PMC10572767", "Keratinocytes (n = 3 independent donors)||pictures every 30 min",
     dict(frame_interval_h=0.5, cell_type="keratinocyte", assay_type="scratch", in_scope=True),
     dict(frame_interval_h="every 30 min", cell_type="Keratinocytes", assay_type="a scratch was made using a 200 µL tip"),
     "72 h is the treatment, not stated as imaging duration -> duration null; Nikon Ti2 modality not stated"),
    ("PMC8996928", "The kinetics of scratch closure was monitored",
     dict(frame_interval_h=0.25, cell_type="other", assay_type="scratch", imaging="phase_contrast", proliferation_blocked=True,
          condition="drug:5-Aza", in_scope=True),
     dict(frame_interval_h="recorded every 15 min", cell_type="JHH-6", assay_type="scratch closure", imaging="NEOFLUAR Ph1",
          proliferation_blocked="proliferation inhibitor mitomycin C", condition="5-Aza"),
     "phase contrast inferred from the Ph1 objective; check. 5X objective -> pixel null"),
    ("PMC8655878", "Collective cell migration assay: Keratinocytes",
     dict(frame_interval_h=0.25, duration_h=24.0, cell_type="keratinocyte", assay_type="scratch", proliferation_blocked=True,
          in_scope=True),
     dict(frame_interval_h="every 15 min", duration_h="for 24 h", cell_type="Keratinocytes",
          assay_type="wounded with a 10 µl pipette tip", proliferation_blocked="in the presence of Mitomycin C"),
     "distractors: 2 mM calcium, 25 uM HEPES, 2-24 h pre-incubation; 'treatment' unnamed -> condition null"),
]


# Sources not in Europe PMC: paragraph stored verbatim here (checked by Agent 1 against its own pdftotext extraction of the
# open PDF; superscript exponents written as 10^6 / 10^5, degree sign as °C). Same label/quote asserts as above.
WHAD_SRC = dict(citation="Iheme et al. 2024, Collection: Wound Healing Assay Dataset (WHAD) and Cell Adhesion and Motility Assay "
                         "Dataset (CAMAD). IEEE Data Descriptions 1:95-102",
                doi="10.1109/IEEEDATA.2024.3481394", pmcid=None,
                url="https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=10720536",
                licence="CC BY 4.0 (printed on p. 95; IEEE metadata CCBY)")
EXTERNAL = [
    ("real_29", dict(WHAD_SRC, section="Wound Healing Assay Protocols, p. 98"),
     "The main steps of the wound healing assay are illustrated in Fig. 1. Briefly, cells were seeded on 12-well plates at the "
     "density of 1 × 10^6 cells/well and 7.5 × 10^5 cells/well, for MCF10A and MCF7 cells, respectively. A 2-h treatment with "
     "10 µg/mL mitomycin C was applied to block proliferation. The phase-contrast images of defined positions were recorded every "
     "hour for 48 or 72 h with Leica DMI8 confocal microscope supplemented with 5% CO2 at 37 °C.",
     dict(frame_interval_h=1.0, cell_type="MCF10A", imaging="phase_contrast", proliferation_blocked=True, in_scope=True),
     dict(frame_interval_h="recorded every hour", cell_type="MCF10A", imaging="phase-contrast images",
          proliferation_blocked="mitomycin C was applied to block proliferation"),
     "WHAD protocol. Two lines named (MCF10A, MCF7): labelled the first, check. '48 or 72 h' is not one value -> duration null. "
     "Scratch only in Fig. 1 -> assay_type null (wound-healing assay described -> in scope). 'confocal microscope' but phase-contrast "
     "images -> phase_contrast. Distractors: cell densities, 2-h, 10 ug/mL, 5% CO2, 37 C."),
    ("real_30", dict(WHAD_SRC, section="Validation and Quality, p. 98"),
     "Spatial resolution was satisfied by using 10× and 40× objectives to give pixel size of 0.454 × 0.454 µm and of 0.117 × 0.117 "
     "µm for WHAD and CAMAD, respectively.",
     dict(pixel_um=0.454, in_scope=False),
     dict(pixel_um="0.454 × 0.454 µm"),
     "Pixel size for the WHAD wound images by 'respectively' (0.117 um is CAMAD, 3D adhesion). No assay described -> in_scope false "
     "under the strict rule; check."),
]

def text(e):
    return " ".join("".join(e.itertext()).split())


def get(url, path, tries=5):
    import time
    for k in range(tries):
        try:
            urllib.request.urlretrieve(url, path)
            return
        except Exception as e:  # Europe PMC returns transient 503s
            if k == tries - 1:
                raise
            print(f"retry {url[:70]} ({e})", file=sys.stderr)
            time.sleep(3 * (k + 1))


def fetch(pmcid, dl):
    d = os.path.join(dl, pmcid)
    os.makedirs(d, exist_ok=True)
    x, m = os.path.join(d, "full.xml"), os.path.join(d, "meta.json")
    if not os.path.exists(x) or os.path.getsize(x) < 1000:
        get(f"https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML", x)
    if not os.path.exists(m):
        get(f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=PMCID:{pmcid}&format=json&resultType=core", m)
    return ET.parse(x).getroot(), json.load(open(m))["resultList"]["result"][0]


def source(meta, pmcid):
    j = meta.get("journalInfo", {})
    auth = meta.get("authorList", {}).get("author", [])
    first = auth[0].get("lastName", "?") if auth else "?"
    cit = (f"{first}{' et al.' if len(auth) > 1 else ''} {meta.get('pubYear')}, {meta.get('title', '').rstrip('.')}. "
           f"{j.get('journal', {}).get('isoabbreviation', '')} {j.get('volume', '')}:{meta.get('pageInfo', j.get('issue', ''))}")
    return dict(citation=re.sub(r"<[^>]+>", "", cit), doi=meta.get("doi"), pmcid=pmcid,
                url=f"https://europepmc.org/article/PMC/{pmcid}",
                licence=(meta.get("license") or "?").upper() + " (Europe PMC open-access metadata)")


def check_labels(lab):
    assert lab["cell_type"] in P.CELL_TYPES + [None], lab["cell_type"]
    assert lab["assay_type"] in P.ASSAY_TYPES + [None], lab["assay_type"]
    assert lab["imaging"] in P.IMAGING + [None], lab["imaging"]
    c = lab["condition"]
    assert c is None or re.fullmatch(r"control|knockdown:[A-Za-z0-9-]+|drug:[A-Za-z0-9 .-]+", c), c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dl", default="/tmp/a1oa_dl")
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--out", default=os.path.join(HERE, "test_real.jsonl"))
    a = ap.parse_args()
    out = []
    for i, (pmcid, prefix, lab, quotes, note) in enumerate(ROWS, 1):
        root, meta = fetch(pmcid, a.dl)
        pre, _, must = prefix.partition("||")  # optional: a substring that must also occur (disambiguates)
        hits = [t for t in (text(p) for p in root.iter("p")) if t.startswith(pre) and must in t]
        assert len(set(hits)) == 1, f"{pmcid}: paragraph prefix matched {len(set(hits))} paragraphs"
        para = hits[0]
        labels = P.finalize({k: lab.get(k) for k in P.NULLABLE} | {"in_scope": lab["in_scope"]})
        check_labels(labels)
        for k in P.NULLABLE:
            if labels[k] is not None:
                assert k in quotes, f"{pmcid}: no quote for {k}"
                assert quotes[k] in para, f"{pmcid}: quote for {k} not in paragraph: {quotes[k]!r}"
        assert set(quotes) <= {k for k in P.NULLABLE if labels[k] is not None}, f"{pmcid}: quote for a null field"
        out.append(dict(id=f"real_{i:02d}", source=source(meta, pmcid), paragraph=para, labels=labels, quotes=quotes,
                        note=note, labelled_by="agent (pending human check)", prompt=P.build_prompt(para),
                        completion=P.canonical(labels)))
    extra = [json.loads(l) for p in a.extra for l in open(p)]
    if not a.extra and os.path.exists(a.out):  # default: carry over Agent 3's merged rows from the current file
        extra = [json.loads(l) for l in open(a.out) if json.loads(l)["id"].startswith("a3_")]
    for r in extra:  # Agent 3's rows: re-verify quotes, re-derive prompt/completion with prompt.py
        if True:
            labels = P.finalize({k: r["labels"].get(k) for k in P.NULLABLE} | {"in_scope": r["labels"]["in_scope"]})
            check_labels(labels)
            for k in P.NULLABLE:
                if labels[k] is not None:
                    assert r["quotes"].get(k) and r["quotes"][k] in r["paragraph"], f"{r['id']}: bad quote for {k}"
            r.update(labels=labels, prompt=P.build_prompt(r["paragraph"]), completion=P.canonical(labels))
            r.setdefault("labelled_by", "agent 3 (pending human check)")
            out.append(r)
    for rid, src, para, lab, quotes, note in EXTERNAL:
        labels = P.finalize({k: lab.get(k) for k in P.NULLABLE} | {"in_scope": lab["in_scope"]})
        check_labels(labels)
        for k in P.NULLABLE:
            if labels[k] is not None:
                assert quotes.get(k) and quotes[k] in para, f"{rid}: bad quote for {k}"
        assert set(quotes) <= {k for k in P.NULLABLE if labels[k] is not None}, f"{rid}: quote for a null field"
        out.append(dict(id=rid, source=src, paragraph=para, labels=labels, quotes=quotes, note=note,
                        labelled_by="agent (pending human check)", prompt=P.build_prompt(para), completion=P.canonical(labels)))
    ids = [r["id"] for r in out]
    assert len(ids) == len(set(ids)), "duplicate ids"
    paras = [r["paragraph"] for r in out]
    assert len(paras) == len(set(paras)), "duplicate paragraphs"
    with open(a.out, "w") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} rows -> {os.path.relpath(a.out)}; in_scope true {sum(r['labels']['in_scope'] for r in out)}")


if __name__ == "__main__":
    main()
