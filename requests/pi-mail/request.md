# pi-mail
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-18 the owner's words, snapshot origin/2026-10-18-owner-words.md

## Organized requirement

R1: Fleet mail MUST reach a Pi session as it reaches a Claude Code or Codex session, by the one road and the one signal: `obk message to` names the Orca mailbox as the road to and from a Pi session, the letter goes into the Pi session's Orca mailbox, Orca's own notice tells the session, and the session reads its mail with `obk message check`. The kit MUST add no reminder of its own for a Pi session. Amends: [PRD-11], [PRD-16]

Assumed: this is slice 2 of #547 (#634). Pi has no messaging between sessions of its own, so every letter to or from a Pi session goes by the Orca mailbox, never by a native road. `obk message send --interrupt` works for a busy Pi receiver as for the other harnesses: one Escape, then the letter. Pi stops a command it was running at an Escape, so the send says nothing about a background terminal, as it does for Codex. The facts are from Pi 1.3.0 and Orca 1.4.225.
Out: temporary sessions on Pi, rules and skills for Pi, health of a Pi session (#630's mail finding included), and `/new` in a Pi tab: later slices of #547.
Signed off: 2026-10-18 owner, origin/2026-10-18-signoff.md
