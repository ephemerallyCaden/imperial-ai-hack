# Adaption Intake fine-tune data (issue #90, design.md 9b/9c)

Task: a protocol "Methods" paragraph -> the Intake settings JSON (`schema.json`). The fields that feed code are
`frame_interval_h` and `pixel_um` (`data/upload.py --interval --scale`) and `condition` (`sim/upload.py`). The scope
fields `in_scope`, `cell_type` and `proliferation_blocked` drive the "outside the validated scope" messages.

| file | what |
|---|---|
| `schema.json` | fields, canonical key order and normalisation rules (units in h and um/px, vocabularies, null = not stated) |
| `prompt.py` | the fixed instruction, `build_prompt(paragraph)`, `canonical(labels)`; shared by the generator, the real test set and the scorer |
| `make_train.py` | `python3 data/adaption/make_train.py` -> `train.jsonl` (stdlib only, seed 90, reproducible) |
| `train.jsonl` | `{"prompt", "completion"}` rows; completion = `canonical()` JSON, so labels are correct by construction |
| `overlap_check.py` | word 8-gram overlap vs `test_real.jsonl` (the real, hand-labelled test set; never trained on); exit 1 if any non-trivial shared 8-gram |

How the data is made:
- Each row samples the ground truth first, then renders it: units (s / min / h, "hourly", nm/px or um/px), sentence
  order, missing fields (-> null), and distractor numbers (seeding density, doses, wavelengths, gap widths, recovery
  and transfection times, passages).
- Pixel size is stated in about half the rows. Otherwise only a magnification or camera is named, which means null.
- About 17% of rows are out of scope: transwell, laser ablation in embryos or monolayers, 3D spheroid invasion,
  fluorescence-only and DIC/holographic imaging.
- Every template sentence was written for this file. No text was taken from papers, so the real test set stays
  uncontaminated (`overlap_check.py`).

**Rows:** 1500 (seed 90). In scope: 1248 (83%), out of scope: 252.

**Field distribution** (null = not stated in the paragraph, listed in `missing`):

| field | null | values |
|---|---|---|
| frame_interval_h | 300 | 18 distinct, 0.0042-6 |
| pixel_um | 800 | 12 distinct, 0.108-2 |
| duration_h | 505 | 15 distinct, 0.5-72 |
| cell_type | 147 | fibroblast 121, HeLa 120, other 119, A549 114, MDCK 113, MDA-MB-231 108, U2OS 103, MCF7 99, ... (13 distinct) |
| assay_type | 48 | scratch 892, insert 378, other 124, laser 58 |
| imaging | 261 | phase_contrast 785, brightfield 342, fluorescence 82, other 30 |
| proliferation_blocked | 733 | true 661, false 106 |
| condition | 351 | control 326, drug:dasatinib 40, drug:blebbistatin 36, knockdown:PXN 34, drug:TGF-beta1 33, knockdown:VIM 32, drug:PF-573228 32, drug:EGF 31, ... (33 distinct) |

**10-row sample** (paragraph, then completion; the fixed instruction from `prompt.py` precedes every paragraph):

> HeLa Kyoto cells were maintained in EGM-2 endothelial medium at 37 °C and 5% CO2 and plated in 96-well ImageLock plates (20000 cells/well). After wounding, medium containing 10 ng/ml TGF-beta1 or vehicle (DMSO) was added. Confluent monolayers were scratched with a sterile razor-guided tip, washed twice with PBS and given fresh medium. Medium was replaced 4 h after plating. Bright-field and GFP fluorescence images were acquired at 0.5-h intervals using a Zeiss Axio Observer. Fields were recorded through a 4× lens.

```json
{"frame_interval_h": 0.5, "pixel_um": null, "duration_h": null, "cell_type": "HeLa", "assay_type": "scratch", "imaging": "brightfield", "proliferation_blocked": null, "condition": "drug:TGF-beta1", "in_scope": true, "missing": ["pixel_um", "duration_h", "proliferation_blocked"]}
```

> MCF7 cells were maintained in DMEM supplemented with 10% FBS at 37 °C and 5% CO2 and plated in 6-well plates (95% confluence). Cells were transfected with siRNA targeting EZR or a non-targeting control 72 h before wounding. Confluent monolayers were scratched with a P200 tip, washed twice with PBS and given fresh medium. Gap area was measured in Fiji using a 3-pixel variance filter. Pixel dimensions were 1.29 × 1.29 µm. Data are mean ± SEM of n = 4 experiments. To minimise proliferation, cells were kept in serum-free medium for 16 h prior to and during migration. Transmitted-light and GFP fluorescence images were acquired over a 16-h period using a Zeiss Axio Observer.

```json
{"frame_interval_h": null, "pixel_um": 1.29, "duration_h": 16.0, "cell_type": "MCF7", "assay_type": "scratch", "imaging": "brightfield", "proliferation_blocked": true, "condition": "knockdown:EZR", "in_scope": true, "missing": ["frame_interval_h"]}
```

> Migration assay: For migration experiments, Cells were plated at 50000 cells/well in 6-well plates. No proliferation inhibitor was used. Fields were recorded through a 20× lens. Excitation was at 405 nm with emission collected at 450 nm. We silenced PXN by siRNA transfection 24 h prior to scratching. Confluent monolayers were scratched with a P200 tip, washed twice with PBS and given fresh medium. Time-lapse bright-field movies were recorded for 720 min every 30 minutes on a Nikon Ti2 equipped with an environmental chamber.

```json
{"frame_interval_h": 0.5, "pixel_um": null, "duration_h": 12.0, "cell_type": null, "assay_type": "scratch", "imaging": "brightfield", "proliferation_blocked": false, "condition": "knockdown:PXN", "in_scope": true, "missing": ["pixel_um", "cell_type"]}
```

> HUVEC monolayers were maintained in MEM with 10% FCS at 37 °C and 5% CO2 and plated in 6-well plates (20000 cells/well). The pixel size was 0.5 μm. Cells were serum-starved overnight before the assay to limit proliferation. Cells between passages 6 and 20 were used. Bright-field images were acquired over 6 hours every 6 hours in an IncuCyte S3 live-cell system. Tumour spheroids were embedded in Matrigel, and 3D invasion was quantified from the spheroid outline. To test the role of this pathway, wounds were closed in the presence of 10 μM ML-7.

```json
{"frame_interval_h": 6.0, "pixel_um": 0.5, "duration_h": 6.0, "cell_type": "HUVEC", "assay_type": "other", "imaging": "brightfield", "proliferation_blocked": true, "condition": "drug:ML-7", "in_scope": false, "missing": []}
```

> Scratch-wound assay. We cultured PC-3 prostate cancer cells in DMEM/F12 with 5% horse serum; for assays they were grown to full confluence in 35-mm glass-bottom dishes. Proliferation was inhibited by pre-treatment with mitomycin C. Pixel dimensions were 0.454 × 0.454 µm. Medium was replaced 6 h after plating. Wound closure was followed by quantitative phase (holographic) time-lapse microscopy for 360 min with a 90-minute frame interval. Wounds were introduced using an IncuCyte WoundMaker and debris was removed by rinsing. MYH9 was depleted using two independent siRNAs (10 nM) delivered with Lipofectamine RNAiMAX.

```json
{"frame_interval_h": 1.5, "pixel_um": 0.454, "duration_h": 6.0, "cell_type": "other", "assay_type": "scratch", "imaging": "other", "proliferation_blocked": true, "condition": "knockdown:MYH9", "in_scope": false, "missing": []}
```

> HUVEC monolayers were maintained in MEM with 10% FCS at 37 °C and 5% CO2 and plated in 96-well ImageLock plates (1 × 10^5 cells per well). Wound closure was followed by phase contrast time-lapse microscopy every 5 minutes. Gap area was measured in Fiji using a 5-pixel variance filter. Cells were transfected with siRNA targeting PXN or a non-targeting control 72 h before wounding. Wounds were introduced using a 10-µL pipette tip and debris was removed by rinsing. We used a monochrome CCD camera on an inverted microscope.

```json
{"frame_interval_h": 0.0833, "pixel_um": null, "duration_h": null, "cell_type": "HUVEC", "assay_type": "scratch", "imaging": "phase_contrast", "proliferation_blocked": null, "condition": "knockdown:PXN", "in_scope": true, "missing": ["pixel_um", "duration_h", "proliferation_blocked"]}
```

> A549 lung adenocarcinoma cells were seeded in 12-well plates at 20000 cells/well and grown in DMEM supplemented with 10% FBS. Cells were serum-starved overnight before the assay to limit proliferation. A 4× objective was used. Wound closure was followed by phase contrast and GFP fluorescence time-lapse microscopy once every 20 min for 960 min. We made a single scratch per well with a P200 tip. Data are mean ± SEM of n = 6 experiments.

```json
{"frame_interval_h": 0.3333, "pixel_um": null, "duration_h": 16.0, "cell_type": "A549", "assay_type": "scratch", "imaging": "phase_contrast", "proliferation_blocked": true, "condition": null, "in_scope": true, "missing": ["pixel_um", "condition"]}
```

> Caco-2 cells were maintained in RPMI-1640 with 10% fetal bovine serum at 37 °C and 5% CO2 and plated in 96-well ImageLock plates (150000 cells/well). Images were taken with a 40× objective and a Hamamatsu ORCA-Flash4.0 camera. Cells between passages 5 and 12 were used. Boyden-chamber assays were used: cells migrating through the porous membrane towards serum were counted. Cells were allowed to migrate for 48 h, fixed, and imaged in bright field. Gap area was measured in Fiji using a 5-pixel variance filter.

```json
{"frame_interval_h": null, "pixel_um": null, "duration_h": null, "cell_type": "other", "assay_type": "other", "imaging": "brightfield", "proliferation_blocked": null, "condition": null, "in_scope": false, "missing": ["frame_interval_h", "pixel_um", "duration_h", "proliferation_blocked", "condition"]}
```

> Wounds were introduced using a 10-µL pipette tip and debris was removed by rinsing. Cell division was blocked with 5 µg/ml mitomycin-C. Focus was maintained by hardware autofocus every 5 positions. To test the role of this pathway, wounds were closed in the presence of 200 nM nocodazole. MCF10A cells were seeded in 96-well ImageLock plates at 1 × 10^5 cells per well and grown in EGM-2 endothelial medium. Using phase-contrast optics, we imaged each wound over 30 hours. Images were taken with a 10x objective and an Andor Zyla sCMOS camera.

```json
{"frame_interval_h": null, "pixel_um": null, "duration_h": 30.0, "cell_type": "MCF10A", "assay_type": "scratch", "imaging": "phase_contrast", "proliferation_blocked": true, "condition": "drug:nocodazole", "in_scope": true, "missing": ["frame_interval_h", "pixel_um"]}
```

> We cultured HeLa cells in EGM-2 endothelial medium; for assays they were grown to a confluent monolayer in 12-well plates. Data are mean ± SEM of n = 6 experiments. Time-lapse brightfield movies were recorded over a 8-h period every 30 min in an IncuCyte S3 live-cell system. Migration was performed under serum starvation to suppress cell division. To test the role of this pathway, wounds were closed in the presence of 50 nM dasatinib. Images were taken with a 20X objective and a Hamamatsu ORCA-Flash4.0 camera. We made a single scratch per well with a P200 tip.

```json
{"frame_interval_h": 0.5, "pixel_um": null, "duration_h": 8.0, "cell_type": "HeLa", "assay_type": "scratch", "imaging": "brightfield", "proliferation_blocked": true, "condition": "drug:dasatinib", "in_scope": true, "missing": ["pixel_um"]}
```

## Open item for P2: prompt style at inference

The Adaption docs (Running AutoScientist, Overview, Create a dataset, Run on non-adapted data, Download the model,
Supported models; checked 2026-11-15) do not say whether AutoScientist applies the base model's chat template to the
`prompt` column for `training_method="instruction"`. The only formatting statement is "Maps `prompt` and `completion`
for SFT". So `agent/intake.py` makes it an explicit setting, `STITCH_INTAKE_PROMPT_STYLE=chat|raw` (default chat), records
it in every Intake result and in `--eval` output, and `python -m agent.intake --eval --backend base` runs the base model
with the same style. To do: ask Adaption which format training used, and score both styles on the real test set
before the go/no-go (pre-declare which style is primary).
