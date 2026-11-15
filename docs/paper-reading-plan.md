# Plan: reading papers that APIs and plain fetches cannot reach (Playwright + Firefox)

Why: many pages returned 403, cookie walls or blank JavaScript shells to our scouts (PubMed, Devpost, ScienceDirect, Research Square, Zenodo file lists). A real browser can read what a person can read. It cannot, and must not, get around paywalls.

## Rules (safety and legality)
- Read-only browsing in a fresh, isolated Firefox profile. No saved logins, no passwords, no account sign-ups, no form submissions; ask first before any login or API-key sign-up.
- No CAPTCHA solving, no bot-evasion tricks, no bulk crawling. One page at a time, a few seconds between pages, honour site terms.
- No paywall bypass (no Sci-Hub or similar). Legal routes only, in this order:
  1. Open-access page or publisher HTML (PLoS, PMC, Royal Society Open Science, arXiv, bioRxiv, Zenodo).
  2. Europe PMC / PMC author manuscript; Unpaywall's legal open-access copy.
  3. The publisher page from the user's own Imperial network or VPN (institutional access by IP is legitimate use; I do not enter credentials).
  4. Ask the user to download the PDF in their own logged-in browser and drop it in the inbox folder.
- Downloaded files are untrusted data: each batch goes into its own new empty directory outside the repo (`/tmp/papers/<date>-<batch>/`); scripts live elsewhere (`/tmp/paper-scripts/`); Python runs with `-I`; never execute anything from the downloads; do not commit PDFs (copyright).
- Only short notes and brief quotes are written into `docs/papers/` (one file per paper); no full-text copies.

## Pipeline
1. **Queue** (table below) with priority, why it matters, preferred access route.
2. **Fetch**: Playwright Firefox opens the page, waits for rendering, saves visible text and, where the PDF is openly reachable, the PDF; logs status (ok / paywalled / blocked / needs user).
3. **Extract**: `pdftotext -layout` for PDFs; save page text for HTML.
4. **Read**: use the `science-gap-finder` skeleton (claims, data, evaluation, validation level, baselines, leakage, failure modes) and write a note with page/section pointers. Scouts can read the extracted text in parallel.
5. **Record**: update `docs/stage-b-findings.md` / `docs/wound-plan.md` when a claim changes (for example licence terms, frame intervals, baseline numbers).

## Queue (priority order)
| # | Item | Why we need it | Preferred route |
|---|---|---|---|
| 1 | Devpost rules and project gallery (imperial-ai-hackathon.devpost.com) | Confirm judges, video rule, bounty text | Public page |
| 2 | Jin et al. 2016 JTB (doi 10.1016/j.jtbi.2015.10.040) and its supplement page | Full methods, data licence, replicates and time points | Publisher page via Imperial network; else author manuscript |
| 3 | Zenodo 4991621 record and paper (Royal Society Open Science, doi 10.1098/rsos.172421) | What is inside the mitomycin and CK666 zips, cell type, frame interval | Public (open access) |
| 4 | Zenodo 7660424 record and paper | Pixel size, field of view, mask details | Public |
| 5 | Nardini and Gevertz arXiv 2606.10873 (HTML) | Exact forecast protocol, parameters | arXiv |
| 6 | MNCA arXiv 2506.20486 and NeuralCPM arXiv 2502.02129 | Training losses, division handling, numbers | arXiv |
| 7 | Richardson et al. PLoS CB 2024 (doi 10.1371/journal.pcbi.1011589) | Remaining 15k characters, supplement, code link | Open access |
| 8 | Portela et al. 2025 conformal paper (doi 10.1371/journal.pcbi.1013098) | Coverage numbers, small-sample behaviour | Open access |
| 9 | Clinical anchors: Sheehan 2003, Warriner 2011, Cardinal 2009, Serena 2024 | Baseline numbers for the 4-week rule | PMC / Europe PMC; else user download |
| 10 | Bobadilla 2019 (irregular wounds), Lagergren 2020 (BINNs), Nardini 2021 (equation learning) | Baselines and metrics | Open access / Imperial network |
| 11 | 2026 Research Square audit "Sensitivity of image-derived wound-healing proxies" (doi 10.21203/rs.3.rs-10420381/v1) | Possible open longitudinal wound sets | Public preprint page |
| 12 | Open datasets with diabetic, infected or fibrotic conditions (Zenodo, Figshare, Mendeley, Kaggle searches) | Support for the application claims | Public search pages |

## Success criteria for the first pass
- At least 8 of 12 items read with a note each; each failure logged with its reason and the legal fallback.
- Updated facts: Jin licence and data layout, 4991621 zip contents, embryo pixel size, Devpost judges and rules.
- A short list of papers the user must download manually.

## Pilot results (batch 1, 14 Nov 2026, Firefox headless via Playwright; saved text in /tmp/papers/2026-11-14-batch1, not committed)
Worked (8 of 10): Devpost rules, Zenodo 4991621, Zenodo 7660424, arXiv HTML of Nardini and Gevertz (2606.10873), MNCA (2506.20486) and NeuralCPM (2502.02129), PLoS full text of Richardson 2024 and Portela 2025. Full text is now available for reading notes.
Blocked (not bypassed, per rules): Jin 2016 on ScienceDirect (human-verification page) and the Royal Society Open Science paper (Cloudflare 403). Both are legitimate for the user to open in their own browser (the machine is on an Imperial IP, so institutional access should work); then drop the PDFs in `/tmp/papers/inbox/` and I will extract and read them with `pdftotext`.
Still to fetch: items 9 to 12 of the queue (clinical anchors, other baselines, the 2026 Research Square audit, disease-condition dataset searches).

### Facts confirmed from the pages
- Devpost rules match `docs/event-rules.md`: 1-4 student teams, valid luma ticket, all members added to the Devpost project, one track, up to 2 bounties from own track, 2-minute video plus public repo, closes 12:00 sharp, 10-minute slot (video then 6 min questions), AI for Science weights (rigour 30, execution 25, path to the lab 20, novelty 15, video/answers 10), bounty = how central the partner tool is, prize verification checks repo, last commit and partner-tool use. Questions go to aisociety@imperial.ac.uk (use it for the open questions on prep, overnight work, Boltz credits and the demo-video wording). Participants listed: 31.
- Zenodo 4991621 (Tlili et al., Dryad, CC0, 2018): MDCK monolayer migrating in a 4 mm x 1 mm strip with mitomycin C (no division); movie 26 h (10 min frames, 5 min in the originals); movie 2 has histone-GFP nuclei and movies 4-6 are 5-min zooms at the front, middle and back, so individual cells are trackable in small files (6-16 MB each); movie 7 adds CK666 after 4 h (6-min frames). The two large zips (881 MB, 630 MB) are described as velocity data folders (PIV fields), with small kymograph zips (2-4 MB). It is a strip-migration experiment, not a scratch assay, and has no proliferating control in this record.
- Zenodo 7660424 (Backova et al., 2023): 61 Drosophila laser wounds, sqh-GFP myosin, 1 frame/min, about 120 frames, raw 1152x1152 at 4.6 um/pixel; processed clips are 256x256 crops downsampled to 128x128 (about 9.2 um/pixel), with skeletonised wound segmentations. Individual cells are not resolvable.
- Jin 2016 supplement and licence: not read (ScienceDirect human check).
