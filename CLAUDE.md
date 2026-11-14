# [PROJECT NAME] — Imperial AI Hack

> [One sentence: what it does and who it is for]

Event: Imperial AI Hack, Huxley Building, 12:00 Sat 14 Nov to 12:00 Sun 15 Nov 2026. Submit by 12:00 Sun (aim for 11:30). See HACKATHON.md for tracks and judging.

## Stack
<!-- Fill in at kickoff -->
- Framework:
- UI:
- Database:
- External APIs: [sponsor API + anything else]
- Deploy target:

## Commands
<!-- Fill in once stack is chosen -->
- `[dev command]` to start dev server
- `[build command]` to build
- `[test command]` to run tests
- `[lint command]` to lint
- P2 sim (sim/, docs/sim.md): `python sim/calibrate.py` (fits), `python sim/forecast.py` (sim_ensemble gate files), `python sim/upload.py` (masks -> forecast JSON)
- P2 NCA (nca/, see docs/nca.md; needs torch from requirements.txt): `python nca/gen_data.py --out /tmp/nca_data.npz`, `python -u nca/train.py --data /tmp/nca_data.npz --out nca/weights.pt`, `python nca/forecast_gate.py` (nca_* gate files)
- Score all forecasts: `python eval/score_forecasts.py eval/forecasts --gate nca_ensemble` (compare against statistical baselines only; gate() counts P2 models as baselines too)
- P2 browser code: `sim/js/` (copied to `web/public/sim/js/`); integration guide `docs/p2-handoff.md`; JS checks `node sim/js/parity.mjs`, `node sim/js/draw_check.mjs`

## Architecture
<!-- Fill in after initial scaffolding -->
- Entry point:
- API routes:
- Components:

## Sponsor API
<!-- Fill in at kickoff -->
- API key in `.env` as `[SPONSOR]_API_KEY`
- Docs: [link]
- SDK: [install command]

## Rules
- Read files before editing. Don't guess what exists.
- No features beyond what was asked. Hackathon scope is tight.
- Match existing patterns. Don't refactor adjacent code.
- Build/lint/test are slow. Run them ONCE, only after all other work for the current request is finished (all edits made, all other checks done). Never run them between intermediate edits. Fix what you break, then re-run once.
- Commit after every working feature. Small commits, clear messages.
- If unsure, ask. Don't assume and build the wrong thing.
- No abstractions for one-time code. Inline is fine for 24 hours.
- Skip error handling except on the demo path.

## Context management
- When context feels long (50+ tool calls, or responses getting shorter): write your current plan to PLAN.md, then run `/compact`.
- Compact AFTER: finishing a research phase, fixing a bug, completing a feature.
- Do NOT compact DURING: active implementation, multi-file changes, debugging.
- After compacting: read PLAN.md and SPEC.md back to restore state.

## Agent auto-routing
Use these agents and skills proactively without being asked:
- When all edits for the request are done (not after each edit): run `/verify` once to check build/types/lint/tests. Use cheap checks (typecheck on touched files, reading the diff) while working instead.
- When a build or test fails: run `/fix` with the error output
- Before committing: run `git diff` and scan for debug code, hardcoded secrets, console.logs
- When starting a new feature: read SPEC.md first to check scope and team ownership, and skim `docs/` for related brainstorming and decisions
- When brainstorming or a choice is made: write it to `docs/brainstorm.md` or `docs/decisions.md` (see `docs/README.md`), then commit and push
- When exploring unfamiliar code: use the `explorer` agent, don't read files one by one

## Team
Three developers working in parallel on feature branches.
- Merge to `main` only when your feature works and builds.
- Coordinate with teammates before touching shared files.
- Each person owns their branch. Don't edit others' branches.
