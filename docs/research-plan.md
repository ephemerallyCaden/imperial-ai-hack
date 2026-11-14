# Research plan: AI for Science (molecules, cells, materials)

Goal: find a well-evidenced, unsolved problem we can build a demo around in the hackathon window. Output feeds `docs/brainstorm.md` and `docs/decisions.md`.

## Skill roles (what each does, and its limits)
| Skill | Role in plan | Limit |
|---|---|---|
| `paper-lookup` | Find papers/preprints/citations across 18 APIs (arXiv, bioRxiv, PubMed, OpenAlex, Semantic Scholar...) | Retrieval only |
| `literature-review` / `systematic-literature-review` | Scoped reviews per domain; coverage tracking | Systematic one is arXiv-centric |
| `deep-research` | Multi-source "state of the art" reports with citations (quick/standard/deep modes) | Web-based; verify claims |
| `academic-paper-review` | Critical review of one key paper (method, contribution, positioning) | One paper at a time |
| `gap-finder` | Per-paper theoretical gaps (hidden assumptions, loose bounds, uncovered settings) | Tuned to math/theory papers; weak for purely empirical bio/chem. Do not use on surveys. |
| `hypothesis-generation` | Turn a gap into testable hypotheses, rival explanations, predictions | Does not validate |
| `scientific-brainstorming` | Rank candidate directions with adversarial review | Ideation only |
| `citation-management` | Verify DOIs, produce BibTeX for the pitch | Housekeeping |

## Phases

### Stage A: Diverge (about 1 h)
1. **Scope.** One `deep-research` quick pass per domain (molecules, cells, materials), plus `scientific-brainstorming`. Output: 5 to 8 candidate high-level ideas per domain, cited.
2. **Pitch cards.** Cut to 6 to 10 ideas total. Each is a card with:
   - **Idea:** one sentence, plain English.
   - **Open problem:** what is unsolved, with a citation.
   - **Why judges care (mandatory):** why it is either (a) technically impressive at first impression, or (b) has an instantly personable or intuitively cool selling point, which a judge gets within seconds of seeing the demo. Name the specific first-5-seconds moment (a visual, a number, a before/after, a relatable story). If neither holds, drop the idea.
   - **Rough feasibility:** public data/benchmark, hosted compute needed, demoable in 20 h (yes/maybe/no).
   - **Risk:** biggest reason it could fail.

### HUMAN GATE (stop here)
Claude presents the pitch cards and asks you to pick (via AskUserQuestion, up to 3 favourites, or reject all and re-run Stage A with your steer). No Stage B work starts before you choose. Log the pick in `docs/decisions.md`.

### Stage B: Deepen (about 3 h, only the chosen idea(s))
3. **Landscape.** `paper-lookup` + `literature-review`: last 12 to 24 months of work, benchmarks, datasets, and who already did this.
4. **Gap extraction.** 2 to 3 anchor papers.
   - Empirical papers: `science-gap-finder`.
   - Theory-heavy papers: `gap-finder`.
   - Single key paper needing a full critique: `academic-paper-review`.
   - Check each gap is not already addressed (fake-gap rule).
5. **Hypotheses.** `hypothesis-generation` on each surviving gap; `scientific-brainstorming` to rank.
6. **Feasibility and demo check.** Re-test: data exists, doable in ~20 h with available compute, and the first-5-seconds "why judges care" moment is still real and buildable. Choose 1 primary, 1 backup.
7. **Write-up.** `citation-management` for verified refs. Log in `docs/decisions.md` and `docs/brainstorm.md`.

## Rules
- Every claim needs a source; mark inferred items as inferred.
- Treat model outputs as hypotheses, not discoveries.
- Timebox Stages A and B to about 4 h total. Then build.
- Judge-appeal justification is required for every idea, at both stages.

## Open questions
- Is the demo evaluated on novelty of the research finding or on the product? Check the track judging criteria when received.
- Which compute and credits are available (Boltz/Tamarind still TBC)?
