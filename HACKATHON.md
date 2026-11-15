# Imperial AI Hack Playbook (about 11 in-building hours, 1-4 students)

**Runs:** Sat 14 Nov to Sun 15 Nov 2026. Building starts 12:10 Sat (pre-existing projects not eligible). **Submissions close 12:00 sharp Sun 15 Nov**: Devpost entry = public GitHub repo + demo video up to 2 minutes; video AND last commit must be before 12:00. Building closes 21:00 Sat (no overnight hacking), reopens 10:00 Sun. Venue: Huxley Building, Imperial College London. Teams of 1-4 students. Team name: [TBC]. Verified rules: docs/event-rules.md.

## Tracks

Pick ONE main track; up to 2 bounties from that track; the Figma and Adaption prizes are open to every track and do not count toward the 2 (show in your presentation how you qualify).

Main tracks:
1. Autonomous Agents (Adaption fine-tuning optional)
2. Voice, Vision & Generative Media
3. AI for Science
4. AI Poker Bots
5. Reply Challenge: AI on Campus

Cross-cutting (enter regardless of main track):
- **Best Designed AI Product**: as well designed as it is smart. Designed in Figma (not Figma Make). **Leaning towards this.**
- **Best use of Adaption**: fine-tune a model with Adaption; ranked on Adaption's leaderboard by win rate vs the base model.

Chosen main track: AI for Science (GBP 700: 1st 500, 2nd 200). Project: wound healing forecaster (see docs/wound-plan.md, docs/decisions.md).
Chosen sub-bounty: none yet (Boltz bounty only if a compound-labelled closure table is found; Figma prize is open to every track).

AI for Science marks (0-3 each, weighted): scientific rigour 30, technical execution 25, path to the lab 20, novelty 15, video and answers 10. Bounties judged on how central the partner tool is. Judging Sun 13:00-16:30, 10-minute slot: 2-minute video, 6 minutes of judge questions, no slides and no live demo. Track winners present at 17:00. Full details: docs/event-rules.md.

## Tech partners we have access to
Listed on the event's tech partners slide. Credits/keys and exact offers: [TBC, fill in when received].

| Partner | Area | Possible use |
|---------|------|--------------|
| fal | Generative media API (image/video/audio models) | Fast image/video generation |
| ElevenLabs | Voice AI (TTS, speech, voice agents) | Voice output/input, narration |
| Tavily | Web search/extract API for agents | Live web research and grounding |
| Lovable | AI app builder | Rapid UI prototyping |
| Synthesia | AI avatar video generation | Presenter/avatar videos |
| Anam | Real-time AI avatars/personas | Conversational avatar |
| Boltz | Biomolecular structure prediction | Bio/chem workflows |
| MongoDB | Database (Atlas, vector search) | Storage, vector search |
| Tamarind Bio | Hosted bio/protein modelling tools | Bio/chem workflows |

## Design (Figma)
Because we are targeting Best Designed AI Product: design the 3 demo screens in Figma in hour 0:30-2:00 (one person), then build to the Figma. Keep the file link here: https://www.figma.com/design/vTCApH2oLBShNu4Oi9dsGg. Reserve time at 16:00-18:00 for design polish, not just feature work.


## Timeline

Building starts 12:10 Sat 14 Nov. **Building closes 21:00 Sat (no overnight hacking); reopens 10:00 Sun. Submissions close 12:00 sharp Sun** (video and last commit before 12:00). Working elsewhere overnight is allowed (confirmed, design.md R12); see docs/team-plan.md for the overnight timeline.

| Time | Activity | Who |
|------|----------|-----|
| Sat 12:10-12:40 | Confirm plan, first-hour data checks (docs/wound-plan.md section "Checks to do first"), write SPEC.md | All together |
| Sat 12:40-14:00 | Figma: 3 demo screens (design person). Data loading + simple baselines + scoring (data person). Cell simulator skeleton (model person) | Split |
| Sat 14:00-18:00 | Parallel feature work on own branches (NCA ensemble, calibration, viewer) | Everyone on own branch |
| Sat 18:00-19:30 | First merge. End-to-end run on real data | One person merging |
| Sat 19:30-21:00 | Failure analysis, polish, record a first backup video. Dinner. Building closes 21:00 | All |
| Sun 10:00-11:00 | Fix issues, final merge, README, repo clean-clone check | All |
| Sun 11:00-11:30 | Record/trim the 2-minute video (one real run on screen), submit on Devpost | All together |
| Sun 11:30-12:00 | Buffer. **12:00 hard deadline** | All together |
| Sun 13:00-16:30 | Judging: 10-minute slot (video + 6 min questions). Track winners 17:00, prizes 17:30 | All together |

## Team branches

Each person works on their own branch. Never commit directly to main.

```bash
# At start, each person:
git checkout -b feature/[your-area]

# When feature works:
/ship

# To merge (one person at a time):
git checkout main
git pull
git merge feature/[branch]
# fix conflicts if any
git push
```

## Claude Code tactics

### Each person runs their own Claude session
```bash
# Person A (design + frontend)
claude

# Person B (backend + sponsor/model API integration)
claude

# Person C (integration, deployment, demo)
claude
```

### Skills cheat sheet
| Command | When | What it does |
|---------|------|-------------|
| `/spec` | Sat 12:00 | Interview -> SPEC.md with demo script and team split |
| `/fix` | Something breaks | Paste error, get fix. Max 3 cycles. |
| `/verify` | Before merge | Build, types, lint, tests, diff review. PASS/FAIL report. |
| `/ship` | Feature done | Build, test, commit, push. One command. |
| `/secure` | Before deploying | 5-min security scan: secrets, debug code, exposed endpoints |

### Speed rules
- `/clear` between unrelated tasks. Don't let context get stale.
- After 2 failed corrections, `/clear` and rewrite the prompt with what you learned.
- Use `@filename` to reference files instead of describing them.
- Paste screenshots for UI work. Claude reads images.
- Commit after every working feature. `git commit` is your save button.
- One feature per session. Start fresh for the next feature.
- Claude auto-runs `/verify` after code changes and `/fix` on failures. Let it.

### When stuck
- `/fix [paste the error]` first. Handles 80% of hackathon bugs.
- If `/fix` doesn't work: `/clear` and describe the problem from scratch
- Use the `explorer` agent: "Use the explorer agent to find where X is defined"
- Use the `reviewer` agent before merging: "Use the reviewer agent to check my changes"
- Ask a teammate. 5 min of human conversation beats 30 min of fighting the AI.

## Demo-first development

Build what judges will see, in this order:

1. Demo screens (hardcoded data, looks polished)
2. One real user flow through the whole app
3. Sponsor API integration on the demo path
4. Polish: loading states, transitions, error handling on demo path only

Things that don't matter for the demo: auth, CRUD for non-demo entities, error handling on non-demo paths, caching, tests, CI, responsive design on screen sizes judges won't see.

## Sponsor API quick reference
<!-- Fill in at kickoff: the 2-3 calls you'll actually use -->

### Setup
- API key in `.env` (never in source)
- SDK: [install command]
- Docs: [link]

### Core calls
```
[paste the minimal working snippet for each call on the demo path]
```

### Limits
Check the plan dashboard for rate/usage limits.
Track usage during the hackathon so you don't hit the cap during the demo.
