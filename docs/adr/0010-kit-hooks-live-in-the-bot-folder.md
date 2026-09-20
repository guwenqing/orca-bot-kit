# ADR 0010: Kit hooks live in the bot folder, not in user settings

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

The book must learn a new session id when a session starts, resumes or is cleared, and the start prompt must be re-sent after `/clear`. Tools such as Orca write their own hooks into the user-level settings file; that file had to be taken out of version control because of it.

## Decision

The kit's hook lives in the bot's own folder inside the bots repo, for each harness in the place that harness reads. Through it the kit updates the book and makes sure the session has its start prompt again after a clear. The kit never writes to user-level settings. If a Codex hook does not report the new id, the kit falls back to the newest transcript for that bot folder.

## Consequences

- Bot-level settings are versioned with the bot and do not collide with other tools.
- Codex requires hooks to be trusted once; init handles it or tells the user the one step.
- The hook must be fast and must never block the session if `obk` is missing.
