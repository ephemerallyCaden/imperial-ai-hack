# Agent layer

Research use only, not for diagnosis or treatment. Design: `docs/design.md` section 9b.

## What it does

At each imaging check (1.9, 3.8, 5.7 and 9.5 h) the agent:

1. runs the fixed steps in code: QC and the calibrated forecast (`data/upload.py`), then the stall flag and schedule advice;
2. works out in code which decisions are allowed (`policy.py`);
3. asks the model to pick one allowed decision and explain it in plain English;
4. checks the pick against policy, then passes the explanation through the scope guard and the Critic;
5. asks a human to approve anything that cannot be undone (stopping a plate);
6. writes every step to a run log.

## Where the gain comes from

The plate-hours saved come from the forecaster and the policy code, not from the LLM. The forecaster gives the chance
of closing and the stall flag; the policy code sets the stop thresholds and forces "stall flagged, ask a human" and
"data refused, ask a human". The LLM only chooses among the options the code allows and explains its choice in plain
English. Every number it writes is checked by the Critic. That is why the scoreboard calls the replay row "Forecast
policy (code; replay model, no LLM)", and why the real-model row reports how often Claude picked the same option.

## What it does not do

- The LLM never makes a number. Every number comes from a tool. The Critic (`critic.py`, plain code) removes any
  number in the explanation that does not match a tool output or an allowlisted constant with its unit, and counts it.
  Numbers in wound names, notes or protocol text never count as evidence. Only scalar fields and short lists (<= 4
  values) count: curves, quantile series and ensemble members are dropped, so a made-up number cannot match some
  point of a long series. The area band at the horizon is kept as `summary` scalars on the forecast output.
- No clinical, treatment or molecule-design text is shown. A keyword filter (`config.SCOPE_TERMS`; a keyword list, not
  a classifier, so a paraphrase can get through) replaces any such explanation with "<label>: <evidence>." and logs a
  `scope` record.
- The LLM never raises or clears a flag. A refusal forces "data refused, ask a human". A fired stall flag forces
  "stall flagged, ask a human". The model is not called for those.
- The LLM can only pick from the allowed list. Anything else is rejected and the loop falls back to the first
  decision that can be undone.
- It never stops a plate on its own. A stop is a proposal a human approves.
- Only the `data/upload.py` band is called "90%". Simulator bands are marked uncalibrated and never drive a decision.
- Text in files and protocols is data, never instructions.

## Modules

| File | What it holds |
|---|---|
| `config.py` | Constants with units (horizon, checks, thresholds, cost units, step and token limits) and the Critic allowlist |
| `llm.py` | `call_model()`, the only place that talks to a model; stub, Anthropic or Bedrock, picked from env |
| `runlog.py` | Append-only JSONL writer to `agent/runs/<run_id>.jsonl` |
| `tools.py` | `qc_forecast`, `flags_schedule`, `simulate`: thin wrappers over the existing code; errors come back as `{error}` |
| `policy.py` | `allowed(state)` and `check(proposal, state)` |
| `critic.py` | `trace(text, tool_outputs)`: returns cleaned text plus traced and untraced counts |
| `prompts.py` | System prompt, the `propose_decision` tool and the delimited data block |
| `run.py` | The hand-written loop and the CLI; `replay_stub` is the offline model |
| `evaluate.py` | Replay scoreboard for the three policies |

Flow: tools -> policy -> model pick -> policy check -> Critic -> approval -> run log.

## Commands

Run from the repo root with the project venv (`.venv/bin/python`). None of these call a real model.

- Tests: `python -m pytest -q agent/tests`
- Replay one held-out WHAD wound with the offline model:
  `python -m agent.run --wound exp1_partII_C61_P1 --run-id demo-1`
  Add `--reject` to have the simulated human reject every stop, `--both-branches` to also record the rejected branch
  (`<run-id>.reject.jsonl`), `--runs-dir DIR` to write elsewhere. `--wound` also takes a path to an upload result JSON.
- Evaluation: `python -m agent.evaluate` writes `agent/results/scoreboard.csv` and `scoreboard.md` (assumptions are in
  the `.md`). Its run logs go to a temp folder, not `agent/runs/`. It also adds a real-model row read from recorded
  logs in `--real-runs DIR` (default `agent/runs/practice`; WHAD wound runs only, no `.reject` or upload runs). The row
  is skipped with a note if the folder has none. It reads logs only; it never calls a model.

Run IDs must be new: a log is never overwritten.

## Recording real runs

Set these in a local `.env` (git-ignored; names are listed in `.env.example`). Never commit values.

- `STITCH_PROVIDER`: `stub` (default), `anthropic` or `bedrock`
- `STITCH_MODEL`: model id (default `claude-opus-5-5`)
- `STITCH_EFFORT`: `low` to `max` (default `high`)
- `ANTHROPIC_API_KEY` for `anthropic`, or `AWS_PROFILE` and `AWS_REGION` for `bedrock`

The scripts do not read `.env` themselves, so load it into the shell first:

```
set -a; . ./.env; set +a
python -m agent.run --wound exp1_partII_C61_P1 --run-id video-1 --both-branches
```

For video runs use `--both-branches` so the UI can play either answer at an approval point.

To record the demo set in one go (four WHAD wounds, the first with both branches, plus a real-frame upload run), and
check no file holds a username, path, account id or key:

- `python -m agent.record --out agent/runs/practice` for practice runs (git-ignored)
- `python -m agent.record --out agent/runs` for the final re-record on the submission account (these are committed)

`python -m agent.evaluate --real-runs agent/runs` then scores the final runs instead of the practice ones.

## Run log records (for the UI)

One JSON object per line. Every record has `run_id`, `seq`, `ts` and `kind`.

| kind | When | Main fields |
|---|---|---|
| `run_start` | first line | `wound`, `checks_h`, `max_steps`, `token_budget`, `model_provider`, `model_id`; branch logs add `parent_run_id`, `branch_seq`, `branch_cut_h` |
| `tool_call` | each fixed step | `step`, `tool`, `input`, `input_fp` (sha256), `output`, `elapsed_s` |
| `model_call` | each model call | `model`, `usage`, `tokens_total`, `text`, `tool_calls`, `data`, `input_fp`; or `error` |
| `model_skipped` | call would go over the token budget | `reason`, `estimated_tokens`, `tokens_left` |
| `warning` | a tool returned nothing usable | `tool`, `message` |
| `scope` | explanation had clinical / molecule terms | `decision`, `matched` (`kind`, `term`), `text_in`, `text_out`, `reason` |
| `critic` | each check | `text_in`, `text_out`, `removed`, `traced`, `untraced`, `calibrated_band` |
| `decision` | each check | `decision`, `label`, `allowed`, `state`, `source` (`forced`, `llm` or `fallback`), `fallback_reason`, `explanation`, `irreversible`, `untested` |
| `approval` | at a stop or stall | `decision`, `approved`, `note` |
| `human_review` | "ask a human to review" | `decision`, `note` |
| `run_end` | last line | `reason`, `decision`, `stopped`, `stop_h`, `stop_kind`, `plate_hours_saved`, `steps`, `tokens`, `numbers_traced`, `numbers_untraced`, `branch_run_ids` |

`run_end.reason` is one of `stopped`, `schedule_complete`, `handed_to_human`, `max_steps`, `token_budget`,
`no_forecast`, `tool_error` or `branch_log_exists`.

## Known limitations

- The agent rows in the scoreboard use the offline replay model (`replay_stub`), not a real LLM. It always takes
  "stop, unlikely" when allowed, else "image again". Real-model numbers come only from recorded runs, and the
  real-model row is a small sample of practice runs until the final re-record replaces them.
- The stall threshold (`eval/results/flag_thresholds.json`) is tuned on all WHAD wounds, so the stall flag in the replay
  is not strictly leave-one-out. The forecasts are.
- The stall flag is often wrong: about half of stall stops in the replay are on wounds that kept closing (see
  `scoreboard.md`). In replay the simulated human approves every one.
- "Stop, likely to close" has never fired on a held-out WHAD wound. It is labelled "untested".
- `simulate` with 2 or more frames needs the WHAD raw masks (`WHAD_DIR`, default `~/whad-data/...`, see
  `sim/start_state.py`). Without them it returns an `{error}`. One-frame simulation works from a clean clone.
- `simulate` drops the `level` field on purpose (its bands are not 90%), so its output does not pass
  `contracts/forecast.schema.json`.
