# Imperial AI Hack

Claude Code setup for a 3-person team at Imperial AI Hack (12:00 14 Nov to 12:00 15 Nov 2026, 24 hours).

## Quick start

```bash
cp .env.example .env
# Add sponsor/API keys to .env
```

## First 30 minutes

1. Pick one main track and at most one sub-bounty (see HACKATHON.md)
2. Run `/spec` to turn the idea into a buildable spec
3. Choose the stack, fill in CLAUDE.md
4. Each teammate: `git checkout -b feature/[name]`
5. Design the core screens in Figma first (cross-cutting track: Best Designed AI Product)

## What's included

```
.claude/
  settings.json            Auto-approved commands, desktop notifications
  agents/
    reviewer.md            Demo-focused code review (opus)
    explorer.md            Fast codebase search (haiku)
    integrator.md          Branch merging assistant (sonnet)
  skills/
    spec/SKILL.md          /spec: idea -> SPEC.md via interview
    fix/SKILL.md           /fix: paste error, get fix
    verify/SKILL.md        /verify: build + types + lint + tests + diff review
    ship/SKILL.md          /ship: build, test, commit, push
    demo/SKILL.md          /demo: generate pitch script from codebase
CLAUDE.md                  Fill in at kickoff (with agent auto-routing rules)
HACKATHON.md               Timeline, tactics, sponsor API reference
```

## Workflow

```
/spec -> build features -> /fix when broken -> /verify before merge -> /ship -> /demo for the pitch
```

## Agent auto-routing

Claude uses agents proactively without being asked:
- After writing code: auto-runs `/verify`
- On build failure: auto-runs `/fix`
- Before commits: scans diff for debug code and secrets
- When exploring: uses the `explorer` agent

Read `HACKATHON.md` for the full playbook.
