# Adaption Intake fine-tune: results (#90)

Status: **run succeeded** (Qwen/Qwen3.5-2B, 1 of 1 iterations; checked 03:0x Sun). Real-set eval pending. Qwen/Qwen3.5-0.8B was deprecated on the platform; two
runs launched by mistake on Mixtral-8x7B were cancelled (`data/adaption/run_ids.cancelled-*.json`).

## Run
| | |
|---|---|
| dataset_id | `8d3f3b8e-4896-4339-940e-28420f4456fb` (train.jsonl, 1,500 templated rows, uploaded raw) |
| run_id | `695c8c20-b2c8-4848-ac36-e1ed443281fb` (`data/adaption/run_ids.json`) |
| model | Qwen/Qwen3.5-2B (smallest chat model that fits local eval; 9B needs ~18 GB disk) |
| settings | training_method instruction, data_format chat, max_iterations 1, target_win_rate 0.7; recommended hyperparams: LoRA r16/alpha32 all-linear, 1 epoch, lr 5e-5 cosine |
| best_win_rate (platform, held-out templated rows) | **0.9471** vs base (target 0.7). Judged by Adaption on a held-out split of OUR synthetic rows, not on the real test set |

## Real test set (30 open-access paragraphs, never trained on)
Pending: human spot-check of `docs/adaption-test-review.md`, then
`python -I data/adaption/score.py data/adaption/test_real.jsonl --compare base=preds_base.jsonl finetuned=preds_ft.jsonl claude=preds_claude.jsonl`.

## Go/no-go (pre-declared)
Ship only if the fine-tune beats the base on the real set in BOTH exact match AND mean per-field accuracy. Pending.
