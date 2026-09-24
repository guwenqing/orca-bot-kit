# ADR 0003: `AGENTS.md` is compiled from rule units

Date: 2026-09-19. Status: superseded by [ADR 0013](0013-agents-md-is-compiled-from-rule-units.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

Each bot starts as if its folder were the root of a project, with its own instructions shared by all its sessions. The kit wants to give common rules to all bots while the user customises freely. Claude Code reads `AGENTS.md` directly only in some setups.

## Decision

A bot's `AGENTS.md` is built from rule units: the kit's common rules, the user's own rules, and per-bot overrides, plus the bot's charter. Defaults set what every bot gets. The build writes a marked region; text outside it is kept; a hand edit inside it stops the build and shows the conflict. `CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`. The kit does not rely on any user-level rules file.

## Consequences

- Rule text from the kit ends up as generated text in the user's repo. This is the one exception to "no kit content is copied".
- Only a short set of always-on rules belongs here; depth lives in skills.
- Both harnesses read the same file.
