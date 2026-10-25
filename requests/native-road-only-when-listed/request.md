# native-road-only-when-listed
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-25 the owner's words, snapshot origin/2026-10-25-owner-words.md

## Organized requirement

<!-- R1 from:2026-10-25-owner-words.md -->

### R1 The native road only to a session the sender's Claude Code lists

For two Claude sessions in the same approval class, `obk message to` MUST name the native road only when the sender's own Claude Code lists the receiver as a live session: its registry of live sessions (`sessions/` under `CLAUDE_CONFIG_DIR`, or under `~/.claude` when that is not set) holds the receiver's address with a process that runs. Otherwise it MUST name the Orca mailbox road and say why, and `obk message send` MUST carry the message there. A receiver that the sender's Claude Code lists MUST still get no mailbox send from the kit, so a refused native send still has no second road.

<!-- R2 from:2026-10-25-owner-words.md -->

### R2 The core reads CLAUDE_CONFIG_DIR

The list in PRD 6.1 of the environment settings that the core reads MUST name `CLAUDE_CONFIG_DIR`, because R1 reads it to find the sender's registry, as Claude Code itself does.
Signed off: 2026-10-25 owner, origin/2026-10-25-signoff.md
