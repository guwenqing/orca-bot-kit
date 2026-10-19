# pi-new
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-19 the owner's words, snapshot origin/2026-10-19-owner-words.md

## Organized requirement

R1: When a new conversation starts in a Pi session's tab, by a person's `/new` there, the book MUST hold the new conversation's id, and that session's history MUST keep the old one. A restart then resumes the conversation the tab was in last. The new conversation MUST get the session's start prompt again, as after a `/clear` in Claude Code. `obk session clear` on a Pi session MUST still type nothing, and MUST say plainly why and that a `/new` typed in the tab is followed. Amends: [PRD-12]

Assumed: this is slice 6 of #547 (#662). The kit learns the new id through a Pi extension of its own, given on every Pi launch line with `--extension`. It reports through the kit's existing `obk session record`, as the Claude Code and Codex hooks do, and it handles no credentials, types into no tab and reaches no network. The kit writes nothing into `~/.pi/agent`, and `--no-approve` stays. A tab that Orca brings back by itself runs `pi --session <file>` with none of the kit's flags, so it does not follow a `/new` until the kit restarts it. The facts are from Pi 1.3.0 and Orca 1.4.225.
Out: `obk session clear` typing `/new` into a Pi tab (a follow-up issue), `obk session compact` on Pi, and a fix for Orca's own restore of a Pi tab.
Signed off: 2026-10-19 owner, origin/2026-10-19-signoff.md

## Outcome

- R1 When a new conversation starts in a Pi session's tab, by a person's `/new` there, the book MUST hold the new conversation's id, and that session's history MUST keep the old one. A restart then resumes the conversation the tab was in last. The new conversation MUST get the session's start prompt again, as after a `/clear` in Claude Code. `obk session clear` on a Pi session MUST still type nothing, and MUST say plainly why and that a `/new` typed in the tab is followed.: in [PRD-12]
- Added: none
- Modified: [PRD-12]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: none
- ADRs superseded: none

Notes:
