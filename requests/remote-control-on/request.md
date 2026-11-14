# remote-control-on
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md
- 2026-11-14 kit-dev/architect's second ruling for the owner (no upgrade notice; the limit for a session's own `--settings`), snapshot origin/2026-11-14-github-com-guwenqing-orca-bot-kit-issues-755.md

## Organized requirement

<!-- R1 from:2026-11-14-github-com-guwenqing-orca-bot-kit-issues-755.md -->

### R1 Remote Control is on for every Claude Code session, unless the user set it off

Every Claude Code session that the kit starts, temporary sessions included, MUST start with Claude Code's Remote Control on, unless the user set it off for that session. When Remote Control cannot start, the session MUST still start, and `obk health` MUST say that Remote Control is off for it. Codex and Pi sessions do not change.

"Set off" means off at a start and at a resume by the kit. It does not hold after Orca's cold restore. It does not hold either when the session's own extra arguments carry `--settings`, because that replaces the kit's settings.
