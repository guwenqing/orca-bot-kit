# remote-control-on
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md
- 2026-11-14 kit-dev/architect's second ruling for the owner (no upgrade notice; the limit for a session's own `--settings`), snapshot origin/2026-11-14-github-com-guwenqing-orca-bot-kit-issues-755.md

## Organized requirement

<!-- R1 from:2026-11-14-github-com-guwenqing-orca-bot-kit-issues-755.md -->

### R1 Remote Control is on for every Claude Code session, unless the user set it off

Every Claude Code session that the kit starts, temporary sessions included, MUST start with Claude Code's Remote Control on, unless the user set it off for that session. When Remote Control cannot start, the session MUST still start, and `obk health` MUST say that Remote Control is off for it. Codex and Pi sessions do not change.

"Set off" means off at a start and at a resume by the kit. It does not hold after Orca's cold restore. It does not hold either when the session's own extra arguments carry `--settings`, because that replaces the kit's settings.
Signed off: 2026-11-14 owner, origin/2026-11-14-signoff.md

## Outcome

Concluded 2026-11-15 with al conclude, on the working tree at f8e5c11.

- R1 Remote Control is on for every Claude Code session, unless the user set it off, version 3, signed in S1:
  - KIT-17 scope: in docs/prd/prd.md, serves it
  - KIT-22 rule: in docs/prd/prd.md, serves it
  - KIT-26 rule: in docs/prd/prd.md, serves it
- Not known: whether the code, tests and documents do what the paragraphs say; whether the work has ended: the tool does not take a merged task or a reconciled spec as evidence of that.
