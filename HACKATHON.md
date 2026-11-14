# Imperial AI Hack Playbook (24 hours, 3 people)

**Runs:** 12:00 Sat 14 Nov to 12:00 Sun 15 Nov 2026. Submission deadline: 12:00 Sun 15 Nov (aim for 11:30; confirmed with organisers). Venue: Huxley Building, Imperial College London. Team name: [TBC].

## Tracks

Pick ONE main track and at most ONE sub-bounty (organisers recommend one of each for a solid product).

Main tracks:
1. Autonomous Agents (Adaption fine-tuning optional)
2. Voice, Vision & Generative Media
3. AI for Science
4. AI Poker Bots
5. Reply Challenge: AI on Campus

Cross-cutting (enter regardless of main track):
- **Best Designed AI Product**: as well designed as it is smart. Designed in Figma (not Figma Make). **Leaning towards this.**
- **Best use of Adaption**: fine-tune a model with Adaption; ranked on Adaption's leaderboard by win rate vs the base model.

Chosen main track: [TBC, leaning towards the least-applied track]
Chosen sub-bounty: [TBC]

Track details, judging criteria, sponsor APIs and rules: [TBC, fill in when received]

## Design (Figma)
Because we are targeting Best Designed AI Product: design the 3 demo screens in Figma in hour 0:30-2:00 (one person), then build to the Figma. Keep the file link here: [Figma link]. Reserve time at 16:00-18:00 for design polish, not just feature work.


## Timeline

Start 12:00 Sat 14 Nov. **Submission deadline 12:00 Sun 15 Nov** (aim for 11:30). The table below was drafted for a 10:00 deadline; everything after 09:00 has 2 extra hours of slack.

| Time | Activity | Who |
|------|----------|-----|
| Sat 12:00-12:30 | Idea + track chosen. Run `/spec` to write SPEC.md | All together |
| Sat 12:30-13:00 | Choose stack, scaffold project, fill in CLAUDE.md | One person |
| Sat 13:00-14:00 | Design 3 demo screens in Figma | Design + frontend person |
| Sat 13:00-14:00 | Backend skeleton + sponsor/model API integration | Backend person |
| Sat 14:00-20:00 | Parallel feature work on branches (build to the Figma) | Everyone on own branch |
| Sat 20:00-21:00 | First merge. Run `/integrator` or merge manually. Dinner | One person |
| Sat 21:00-01:00 | Wire real data into demo screens. Integrate sponsor API | Everyone |
| Sun 01:00-04:00 | Sleep in shifts: at least one person awake and merging | Rotate |
| Sun 04:00-06:00 | Second merge. Polish demo path and design only | One person merging |
| Sun 06:00-07:30 | Deploy. Test on production URL | One person |
| Sun 07:30-09:00 | Presentation prep. Record backup demo video | All together |
| Sun 09:00-09:30 | Submit everything. Do not wait for the deadline | All together |
| Sun 09:30-10:00 | Buffer. **10:00 deadline** | All together |
| Sun 10:00-12:00 | Demos/judging, practise the pitch | All together |

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
| `/demo` | Sun 07:30 | Write pitch script from what's actually built |
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
