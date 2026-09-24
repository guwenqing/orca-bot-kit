# ADR 0002: The kit's book is the authority for session ids

Date: 2026-09-19. Status: superseded by [ADR 0012](0012-the-book-is-the-authority-for-session-ids.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

Sessions must come back after a reboot, a killed tab or a restart asked for by Bot Father, and `/clear` creates a new session id that must not be lost. Orca stores resume records per pane and drops them when a tab is closed. Orca's session history can find old transcripts but does not know which bot and session they belonged to.

## Decision

Each bot has a book with the current session id of every session and the history of old ids with the reason they ended. The kit writes it; Orca's own resume is only a bonus for tabs that are still alive. The owner's condition: the kit keeps the authority unless Orca one day handles this fully, including clear and killed-tab recovery.

## Consequences

- The fleet can be brought back from the book alone.
- Old session ids stay available for `obk-recall` and grooming.
- The book must be kept fresh by a hook (ADR 0010); if the hook fails, the book goes stale, so the kit's health check compares it with the harness's own records.
