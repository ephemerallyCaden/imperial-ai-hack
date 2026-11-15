# Agent layer

Research use only, not for diagnosis or treatment. Design: `docs/design.md` section 9b.

## What it does

For an upload of frames that comes with protocol (Methods) text, code first calls the `intake` tool once (see Intake
below). Then, at each imaging check (1.9, 3.8, 5.7 and 9.5 h; one check at the last frame for an upload), the agent:

1. runs the fixed steps in code: QC and the calibrated forecast (`data/upload.py`; a held-out WHAD replay reads the
   leave-one-wound-out forecast file instead, see below), then the stall flag and schedule advice;
2. works out in code which decisions are allowed (`policy.py`);
3. asks the model to pick one allowed decision and explain it in plain English;
4. checks the pick against policy, then passes the explanation through the scope guard and the Critic;
5. asks a human to approve anything that cannot be undone (stopping a plate);
6. writes every step to a run log;
7. at the end of the run, the Reporter writes a plain-English report (`reporter.py`), logged before `run_end`.

## Where the gain comes from

The plate-hours saved come from the forecaster and the policy code, not from the LLM. The forecaster gives the chance
of closing and the stall flag; the policy code sets the stop thresholds and forces "stall flagged, ask a human" and
"data refused, ask a human". The LLM only chooses among the options the code allows and explains its choice in plain
English. Every number it writes is checked by the Critic. That is why the scoreboard calls the replay row "Forecast
policy (code; replay model, no LLM)", and why the real-model row reports how often Claude picked the same option.

## Forecaster on held-out replays

Uploads go through `data/upload.py`: the real-data NCA v3 (`nca_realft3`), with edge speed as its automatic fallback.
A held-out WHAD replay (`--wound <id>`) uses the same forecaster from its leave-one-wound-out files,
`eval/forecasts/whad/loo_all/nca_realft3_<cut>h.json` (`run.LOO_MODEL`): each series is rolled out by fold models that
never trained on that wound, and the band is P1's leave-one-wound-out conformal band (level 0.9). The
`nca_realft3_raw_<cut>h.json` files are the raw 50-member quantiles with no calibration (they cover far less than 90%;
`data/upload_nca.py` only uses their residuals to build the upload band), so a replay never reads them.

Per wound and cut-off, `edge_speed_<cut>h.json` (`run.LOO_FALLBACK`) is used only when the NCA file is unreadable,
does not have the wound, or its forecast is unusable (fails the forecast contract, `contracts/validate.py`; band not
a calibrated 90% band; non-finite area quantiles); `run.loo_forecast` makes that choice. The fallback is never silent: every
`forecast_lookup` input names the `model` and `source` file used, and a fallback adds `fallback` (`from`, `reason`)
to that input plus a `warning` record. With neither usable the run ends with `no_forecast`. On the current files all
55 held-out series have a usable NCA forecast at every cut-off they have, so no replay falls back. Runs recorded
before this change show `edge_speed` in that field.

## Investigator (hypotheses, not causes)

When a wound is off track (the stall flag fired, or the first 2 frames after the previous check fell outside that
check's band, the `eval/flags.py` rule), code calls `investigate` once per run. It reruns the cell simulator from five
starts the `sim/alt_start.py` helper supports (normal, slow migration, low starting density, edge damage, partial stall;
fixed seeds, about 1 s) and ranks them by fit error to the observed curve up to the check, never later frames. It is
logged as a `tool_call` (with `trigger`), so the Critic can trace its fit errors. The model sees the ranking and may
mention it; it never changes the decision. Accuracy on the simulated known-cause wounds is in
`results/investigator.md` (`python -m agent.investigator`). The start is a synthetic band, not the wound's own mask.

## Intake (protocol text -> settings)

`agent/intake.py` `extract(protocol_text)` (also the `intake` tool) sends the exact training prompt from
`data/adaption/prompt.py` to a model, validates the reply against `data/adaption/schema.json`, then code checks units
(interval in hours, scale in um/px, sane ranges, non-hourly and non-WHAD-scale notes), maps the condition to CC or C61
and checks scope (MCF10A plus mitomycin, 2D monolayer, transmitted light). Returns `fields`, `feeds_code` (interval,
scale, condition), `informational`, `unit_notes`, `scope_ok`, `scope_notes`, `backend`, `fallback_reason` and the
(truncated) `source_text` so the UI can show the extraction next to the source.

- Backend: `STITCH_INTAKE_BACKEND=adapter|llm|stub`; default adapter when `STITCH_INTAKE_ADAPTER` is an existing folder
  or `.tgz`, else llm (`call_model`). Adapter = transformers + peft on the base in `adapter_config.json`
  (`STITCH_INTAKE_BASE` overrides, `STITCH_INTAKE_OFFLINE=1` uses the local cache only), greedy decoding. A `.tgz` is
  checked (regular files and folders only: links, devices, absolute and `..` paths are refused), unpacked once into a
  per-user cache (`STITCH_INTAKE_CACHE`, default `~/.cache/stitch`, 0700, refused if another user owns it) and looked
  up by path + mtime + size, so it is hashed once per process. Log messages carry the exception type and a short
  message with paths cut to basenames; a local base path is logged by its folder name only.
- Prompt style (OPEN ITEM for P2): `STITCH_INTAKE_PROMPT_STYLE=chat` (default: the tokenizer's chat template, one user
  turn, thinking off) or `raw` (the training prompt as is). The Adaption docs do not say how AutoScientist formats
  `prompt`/`completion` rows for `training_method="instruction"` (they only say it "Maps `prompt` and `completion` for
  SFT"), so we do not know which style matches training. The style is an explicit setting: it is in every Intake
  result (`prompt_style`, so in the run log), printed by `--eval`, and `--eval --backend base` runs the base model with
  the same style, so the fine-tune vs base comparison is like for like. `chat` with a tokenizer that has no chat
  template is an error, never a silent switch to `raw`. P2: ask Adaption (support or Discord) and score both styles.
- Fallback: adapter or stub -> llm -> "could not extract" (`ok: false`); each skipped step is in `fallback_reason`.
- In the loop (`run.py`): only for frame uploads whose wound dict has `protocol_text`, one `intake` tool call before
  the first check, logged as a `tool_call`. Intake output is not Critic evidence (its fields come from protocol text,
  so "imaged for 37.3 h" in a protocol must not trace): only the `interval_h` / `scale` values Intake filled in for the
  run count (`run.critic_outputs`, also used by the Reporter). A missing `interval_h` or `scale` is filled from
  `feeds_code` (code-checked values only), a missing `condition` from its CC / C61 code (the Investigator's simulator
  uses it). Intake's hosted-model calls (llm backend) are logged as `model_call` records (`purpose: intake`, usage,
  `cost_usd`) and count against `TOKEN_BUDGET`; so is the Reporter's call (`purpose: report`), so the cost sums in
  `agent.record`, `agent.evaluate` and `index.json` include them. A given value that differs from Intake by more than 2% is kept and a `warning` is logged. An
  `intake_applied` record lists each value and where it came from. If `scope_ok` is false, the out-of-scope notes are
  added to every decision's evidence and to the Reporter caveats; the decision never changes because of Intake. If
  Intake fails or returns `ok: false`, a `warning` is logged and the given values are used; a still-missing interval
  or scale is refused by QC ("data refused, ask a human"). `agent.record`'s video upload carries a short Methods
  paragraph (MCF10A, mitomycin C, hourly, 0.908 um/px) so the demo shows Intake.
- Scope: "mitomycin" counts only when it is not negated in the same clause ("not used", "no", "without", "omitted",
  "wasn't added"); a negated mention makes `scope_ok` false.
- Eval: `python -m agent.intake --eval [--backend adapter|base|llm|stub] [--preds out.jsonl]` scores one backend (no
  fallback) on `data/adaption/test_real.jsonl` with `score.py` and prints the prompt style. It calls the configured model, so it is not run in tests.

## Reporter (end of run)

`reporter.summarise(records, steps_left, tokens_left)` runs once per run log (branch logs too), just before `run_end`.
Its inputs are code-extracted facts from the log only: each check's decision (label, evidence, source, human answer),
the end (reason, stop time, plate-hours saved), flags, refusal reasons and Investigator hypotheses. Model explanations,
wound names, notes and protocol text are never in the fact block. The block is compact (strings cut to 200 characters,
oldest checks dropped past 3000 characters) and sent inside `<run_facts>` delimiters as data. One `call_model()` call
with the strict `write_report` tool returns `headline` (one sentence), `summary` (3 to 5 sentences), `next_step` (one
sentence) and `caveats`. Each field goes through the scope guard (a hit replaces that field with the template's, or
drops that caveat) and then the Critic (sources: the run's tool outputs, the code-computed end facts such as
plate-hours saved, and the allowlist). With no model, no step or token budget left (the call counts against
`MAX_STEPS` and `TOKEN_BUDGET`), a failed call, a refusal or an invalid reply, a deterministic template from the same
facts is used (`source: template`). Code always adds the fixed caveats: research use only; simulated cells are
labelled; Investigator results are hypotheses, not causes (when present); "likely to close" is untested (when it
appears). It also works on a finished log read back with `runlog.read`.

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
- Only the calibrated forecast band (`data/upload.py`, or the replay's LOO file) is called "90%". Simulator bands are
  marked uncalibrated and never drive a decision. The Critic removes "90%" from a band sentence that names the
  simulator, emulator, an ensemble, the live NCA or a drawn wound, and from every band sentence when the forecast's
  band is not calibrated. "NCA" alone is allowed: "the NCA forecast's 90% band" is the calibrated `nca_realft3` band.
- Text in files and protocols is data, never instructions.

## Modules

| File | What it holds |
|---|---|
| `config.py` | Constants with units (horizon, checks, thresholds, cost units, step and token limits) and the Critic allowlist |
| `llm.py` | `call_model()`, the only place that talks to a model; stub, Anthropic or Bedrock, picked from env |
| `runlog.py` | Append-only JSONL writer to `agent/runs/<run_id>.jsonl` |
| `tools.py` | `qc_forecast`, `flags_schedule`, `simulate`, `investigate`, `intake`: thin wrappers over the existing code; errors come back as `{error}` |
| `policy.py` | `allowed(state)` and `check(proposal, state)` |
| `critic.py` | `trace(text, tool_outputs)`: returns cleaned text plus traced and untraced counts |
| `prompts.py` | System prompt, the `propose_decision` tool and the delimited data block |
| `run.py` | The hand-written loop and the CLI; `replay_stub` is the offline model |
| `reporter.py` | `summarise(records)`: the end-of-run report from run-log facts; one model call, scope guard and Critic on every field, template fallback |
| `evaluate.py` | Replay scoreboard for the three policies |

| `intake.py` | Intake (#90, 9b): protocol text -> interval, scale, condition with the fine-tune's prompt and schema; unit and scope checks in code |
| `investigator.py` | Investigator lite (#87): reruns the simulator from alternative starts and ranks them by fit to the observed curve; hypotheses, not causes |

Flow: (upload with protocol text: Intake) -> tools -> policy -> model pick -> policy check -> Critic -> approval ->
Reporter -> run log.

## Commands

Run from the repo root with the project venv (`.venv/bin/python`). None of these call a real model.

- Tests: `python -m pytest -q agent/tests`
- Replay one held-out WHAD wound with the offline model:
  `python -m agent.run --wound exp1_partII_C61_P1 --run-id demo-1`
  Add `--reject` to have the simulated human reject every stop, `--both-branches` to also record the rejected branch
  (`<run-id>.reject.jsonl`), `--runs-dir DIR` to write elsewhere. `--wound` also takes a path to an upload result JSON.
- Evaluation: `python -m agent.evaluate` writes `agent/results/scoreboard.csv` and `scoreboard.md` (assumptions are in
  the `.md`). Every policy (fixed, rules, agent) uses the same per-wound, per-check forecast as the replay
  (`run.loo_forecast`), so the rows compare like with like. Its run logs go to a temp folder, not `agent/runs/`. It also adds a real-model row read from recorded
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
- `python -m agent.record --out agent/runs` for the final re-record on the submission account (these are committed).
  It adds a new timestamped set; `index.json` and the scoreboard's real-model row read every log in the folder, so
  `git rm` the set it replaces first.
- The four recorded WHAD wounds (`record.WOUNDS`) were picked to show each decision type: stop early, stall, stop
  later, imaged to the end. The third, `exp1_partII_C61_P2`, is a wrong "unlikely to close" call (it closed by 19 h).
  They are a demo, not a sample: the scoreboard replays every held-out WHAD series in `loo_all` (55 series from 28
  wounds, as `eval/scheduler.py`), and only its real-model row is limited to the recorded runs.

`python -m agent.evaluate --real-runs agent/runs` then scores the final runs instead of the practice ones.

## Run log records (for the UI)

One JSON object per line. Every record has `run_id`, `seq`, `ts` and `kind`.

| kind | When | Main fields |
|---|---|---|
| `run_start` | first line | `wound`, `checks_h`, `max_steps`, `token_budget`, `model_provider`, `model_id`; branch logs add `parent_run_id`, `branch_seq`, `branch_cut_h` |
| `tool_call` | each fixed step | `step`, `tool`, `input`, `input_fp` (sha256), `output`, `elapsed_s`; `investigate` adds `trigger` (`stall_flag` or `out_of_band`); a replay's `forecast_lookup` input has `model` and `source`, plus `fallback` (`from`, `reason`) after a fallback |
| `model_call` | each model call | `model`, `usage`, `tokens_total`, `text`, `tool_calls`, `data`, `input_fp`; or `error` |
| `model_skipped` | call would go over the token budget | `reason`, `estimated_tokens`, `tokens_left` |
| `warning` | a tool returned nothing usable, or a replay forecast fell back to edge speed | `tool`, `message`; a fallback adds `cut_h`, `model`, `fallback_from`, `reason` |
| `scope` | explanation had clinical / molecule terms | `decision`, `matched` (`kind`, `term`), `text_in`, `text_out`, `reason` |
| `critic` | each check | `text_in`, `text_out`, `removed`, `traced`, `untraced`, `calibrated_band` |
| `decision` | each check | `decision`, `label`, `allowed`, `state`, `source` (`forced`, `llm` or `fallback`), `fallback_reason`, `explanation`, `irreversible`, `untested` |
| `approval` | at a stop or stall | `decision`, `approved`, `note` |
| `human_review` | "ask a human to review" | `decision`, `note` |
| `report` | once per log, just before `run_end` | `headline`, `summary`, `next_step`, `caveats`, `source` (`llm` or `template`), `fallback_reason`, `facts`, `critic` (`removed`, `traced`, `untraced`), `scope`, `model`, `model_called`, `usage`; `step` when the model was called |
| `run_end` | last line | `reason`, `decision`, `stopped`, `stop_h`, `stop_kind`, `plate_hours_saved`, `steps`, `tokens`, `numbers_traced`, `numbers_untraced`, `branch_run_ids` |

`run_end.reason` is one of `stopped`, `schedule_complete`, `handed_to_human`, `max_steps`, `token_budget`,
`no_forecast`, `tool_error` or `branch_log_exists`.

## Known limitations

- The agent rows in the scoreboard use the offline replay model (`replay_stub`), not a real LLM. It always takes
  "stop, unlikely" when allowed, else "image again". Real-model numbers come only from recorded runs, and the
  real-model row is a small sample of practice runs until the final re-record replaces them.
- The stall threshold (`eval/results/flag_thresholds.json`) is tuned on all WHAD wounds, so the stall flag in the replay
  is not strictly leave-one-out. The forecasts are. It is also tuned on edge speed's `p_stall`; the NCA's `p_stall`
  (same definition, from its own calibrated ensemble) is compared against the same thresholds, in replay and on uploads.
- The stall flag is often wrong: about half of stall stops in the replay are on wounds that kept closing (see
  `scoreboard.md`). In replay the simulated human approves every one.
- "Stop, likely to close" has never fired on a held-out WHAD wound. It is labelled "untested".
- `simulate` with 2 or more frames needs the WHAD raw masks (`WHAD_DIR`, default `~/whad-data/...`, see
  `sim/start_state.py`). Without them it returns an `{error}`. One-frame simulation works from a clean clone.
- `simulate` drops the `level` field on purpose (its bands are not 90%), so its output does not pass
  `contracts/forecast.schema.json`.
