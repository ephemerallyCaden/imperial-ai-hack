# Adaption fine-tune (#90, design 9c): handoff for a fresh session

Read this first if you are a new Claude session picking up #90. It is self-contained.

## Goal and prize
- **Prize:** "Best use of Adaption: fine-tune a model with Adaption; ranked on Adaption's leaderboard by win rate vs the base model" (HACKATHON.md). Show the evidence in the demo.
- **Task (P2 decision):** turn a protocol "Methods" paragraph into Intake settings JSON (schema in `data/adaption/schema.json`).
- **Rule (design 9c):** ship it only if it beats the base model on the REAL test set.
- **Timing:** launch training by ~01:30 Sun, because a run takes ~1-3 h plus queue. Go/no-go recorded by 05:00 at the latest. Submissions close 12:00.

## Files (P2 agents built these; nothing here needs credentials)
| File | Branch (until merged to main) | What |
|---|---|---|
| `data/adaption/schema.json` | `feature/p2-adaption-train` | Intake fields, types, canonical key order |
| `data/adaption/prompt.py` | `feature/p2-adaption-train` | The single instruction used for train, test and eval |
| `data/adaption/make_train.py` -> `train.jsonl` | `feature/p2-adaption-train` | >= 1,200 templated rows `{prompt, completion}`, labels correct by construction, seeded |
| `data/adaption/overlap_check.py` | `feature/p2-adaption-train` | 8-gram contamination check, train vs test (must be 0) |
| `data/adaption/test_real.jsonl` | `feature/p2-adaption-test` | 24-30 REAL open-access Methods paragraphs, labels with quoted spans; **never train on these** |
| `docs/adaption-test-review.md` | `feature/p2-adaption-test` | Table for the human spot-check (~10 min) before freezing |
| `data/adaption/score.py` | `feature/p2-adaption-test` | Per-field and exact-match scorer; `--compare` for several prediction files |

## Steps
0. **Credits and key.** Claim the 1,250 Adaption credits under "My Pass" on the hackathon site. Put the key in the environment as `ADAPTION_API_KEY`. **Never commit it**: `.env` is gitignored, and `.env.example` only holds the name.
1. **Install:** `pip install adaption` (verified v0.19.0, PyPI; base URL https://api.prod.adaptionlabs.ai; docs https://docs.adaptionlabs.ai).
2. **Data:** `git fetch origin && git checkout feature/p2-adaption-train`, or main once merged, then `python -I data/adaption/make_train.py`. Check the row count is >= 1,200 (every model needs >= 1,000 effective rows).
3. **Upload raw.** This is the cheapest path: no credits for adaptation and no adapt wait.
   ```python
   from adaption import Adaption; c = Adaption()          # reads ADAPTION_API_KEY
   d = c.datasets.upload_file("data/adaption/train.jsonl", processing_mode="raw",
         column_mapping={"prompt": "prompt", "completion": "completion"})
   c.datasets.wait_for_completion(d.dataset_id)
   print(c.autoscientist.recommend_hyperparams(dataset_id=d.dataset_id))   # dry look, no run
   ```
   Optional, only if the credit estimate fits: `c.datasets.expand(d.dataset_id, rows=N, estimate=True)`. Expand costs 1 credit per 100 rows and may return 400 if it isn't enabled for our org. `estimate=True` exists on invent/run/adapt/expand, **not** on autoscientist.create.
4. **Train** (launch ASAP):
   ```python
   run = c.autoscientist.create(dataset_id=d.dataset_id, model="Qwen/Qwen3.5-0.8B",
         training_method="instruction", target_win_rate=0.7, max_iterations=1)
   print(run.id)                                   # record the run ID in docs/adaption-results.md
   run = c.autoscientist.wait_for_completion(run.id)   # default timeout 4 h; check status + best_win_rate
   ```
   Model alternatives: `google/gemma-3-4b-it`, `meta-llama/Llama-3.2-3B-Instruct`, `Qwen/Qwen3.5-4B`. Use 0.8B for speed. A status of "succeeded" can still miss the target, so read `best_win_rate`.
5. **Download** the best LoRA adapter (tar.gz with `adapter_model.safetensors`, `adapter_config.json`, tokenizer):
   ```python
   with c.autoscientist.with_streaming_response.download(run.id) as r: r.stream_to_file("best.tgz")
   ```
   No doc says fine-tuned models are served, so run it locally: transformers + peft on top of `Qwen/Qwen3.5-0.8B`. Keep `best.tgz` out of git (add it to `.gitignore` or keep it outside the repo).
6. **Evaluate on the REAL test set**, after the human spot-check has frozen it:
   - Base model predictions: the same prompt from `prompt.py`, greedy decoding -> `preds_base.jsonl` `{id, completion}`.
   - Fine-tuned predictions -> `preds_ft.jsonl`.
   - Claude predictions -> `preds_claude.jsonl`. Label how they were made (model + "zero-shot, same prompt").
   - `python -I data/adaption/score.py --compare preds_base.jsonl preds_ft.jsonl preds_claude.jsonl` -> per-field table + exact match.
7. **Go/no-go**, pre-declared: ship only if the fine-tuned model beats the base on the real set in BOTH exact match AND mean per-field accuracy. Otherwise record a no-go with the numbers. Do not change the test set, prompt or decoding after seeing results.
8. **Record:**
   - `docs/adaption-results.md`: run ID, dataset ID, model, settings, `best_win_rate`, the real-set table, and a leaderboard screenshot (`docs/img/`).
   - The go/no-go line in `docs/design.md` 9c and a comment on #90.
   - A README table (coordinate with P1/P3).
   - Ask the Adaption reps or Discord how a run gets onto the leaderboard; it isn't in the docs.

## Honesty notes (for the README and video)
- Adaption's win rate is computed by the platform on evaluations derived from OUR dataset, i.e. a held-out split of the templated rows, judged by the platform. It is not our real test set. Report both, and say which is which.
- The training data is synthetic (templates); the test set is real open-access paragraphs, agent-labelled with quoted spans and spot-checked by a human. Contamination check: 0 shared 8-grams.
- Wire-up (design 9c step 7): Intake uses the fine-tuned model locally if shipped, with Claude as the fallback.
