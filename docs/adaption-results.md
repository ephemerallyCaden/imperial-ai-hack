# Adaption Intake fine-tune: results (#90)

Status: **dataset uploaded, training run not yet launched** (Qwen/Qwen3.5-0.8B is deprecated on the platform; relaunch
picks the smallest SFT model from `list_models`).

## Run
| | |
|---|---|
| dataset_id | `8d3f3b8e-4896-4339-940e-28420f4456fb` (train.jsonl, 1,500 templated rows, uploaded raw) |
| run_id | pending (`data/adaption/run_ids.json` once launched) |
| model | pending |
| settings | training_method instruction, data_format chat, max_iterations 1, target_win_rate 0.7 |
| best_win_rate (platform, held-out templated rows) | pending |

## Real test set (30 open-access paragraphs, never trained on)
Pending: human spot-check of `docs/adaption-test-review.md`, then
`python -I data/adaption/score.py data/adaption/test_real.jsonl --compare base=preds_base.jsonl finetuned=preds_ft.jsonl claude=preds_claude.jsonl`.

## Go/no-go (pre-declared)
Ship only if the fine-tune beats the base on the real set in BOTH exact match AND mean per-field accuracy. Pending.
