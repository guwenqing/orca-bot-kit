# remote-control-on
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md

## Organized requirement

<!-- R1 from:2026-11-14-owner-words.md -->

### R1 Remote Control is on for every Claude Code session, unless the user set it off

Every Claude Code session that the kit starts, temporary sessions included, MUST start with Claude Code's Remote Control on, unless the user set it off for that session. When Remote Control cannot start, the session MUST still start, and `obk health` MUST say that Remote Control is off for it. `obk up` MUST say, once, that sessions now start with Remote Control on and how to set one off. Codex and Pi sessions do not change.

"Set off" means off at a start and at a resume by the kit, not after Orca's cold restore.
