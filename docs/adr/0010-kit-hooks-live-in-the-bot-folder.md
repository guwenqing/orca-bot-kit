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

## Amendment, 2026-09-23 (records what slice 04 built after its review, #88; the owner may overrule)

The newest-transcript fallback in the Decision is not used. A bot's folder
holds the conversations of every one of its sessions and of anything they start
inside themselves, so the newest one there says nothing about whose it is, and
slice 04's review showed a guess going wrong both ways. When the book cannot
name a session's conversation, the kit writes the ones it found and nobody
claims into the book as `unclaimed`, starts the session on a fresh conversation
with its duty, and leaves the choice to a person or Bot Father (README,
"Sessions that come back").
