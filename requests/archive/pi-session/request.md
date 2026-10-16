# pi-session
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-16 the owner's words, snapshot origin/2026-10-16-owner-words.md

## Organized requirement

R1: A bot or a session MAY run on Pi (`@earendil-works/pi-coding-agent`), a third harness beside Claude Code and Codex: `obk bot create --harness pi` and `obk session add --harness pi` make one, and `obk up` MUST open a Pi session in an Orca tab with its model, effort, name and start prompt. Amends: [PRD-4], [PRD-6], [PRD-11]
R2: The book MUST keep a Pi session's id, and bringing the session up again after its tab closed MUST resume that conversation. Amends: [PRD-12]
R3: Every Pi session MUST count as `dangerously-skip`, since Pi asks before no tool call and has no rule for each command. The kit MUST refuse `auto` and `ask` for a Pi session, and say why. Amends: [PRD-11]
R4: The kit MUST NOT handle Pi's credentials: the user signs in to Pi on their own. When Pi is not ready to start a session, the kit MUST say so and stop. Amends: [PRD-8]

Assumed: this is slice 1 of #547 (#578). The kit names a Pi session's id itself, on its launch line (`pi --session-id`), so a `/new` in a Pi tab does not reach the book in this slice, and a restart resumes the conversation the book holds (the architect, #578; a later slice of #547 adds it). The kit passes `--no-approve`, so Pi loads none of the bot folder's own files (`.pi/`, `.agents/skills`) and shows no trust screen, and the kit refuses Pi's `--approve` and `-a` as an extra argument (the architect, #578), which rests on R5 of the signed request kit-commands-allowed ("refuse an extra argument that sets approval or permissions"), so it is no new promise. Pi has no context setting, so a Pi session's context is refused. Pi is not ready when `pi` does not run, `pi --list-models` lists no model, or it lists none matching the session's model. The kit was tested with Pi 1.1.0.
Out: mail to a Pi session, temporary sessions on Pi, rules and skills for Pi, health of a Pi session, and `/new` in a Pi tab: later slices of #547. `obk init --harness pi`, and `obk session clear` and `compact` on a Pi session, are refused until then. Pi's RPC mode for the kit's own use, Pi's MCP servers, and a gate extension that asks before a command.
Signed off: 2026-10-16 owner, origin/2026-10-16-signoff.md

## Outcome

- R1 A bot or a session MAY run on Pi (`@earendil-works/pi-coding-agent`), a third harness beside Claude Code and Codex: `obk bot create --harness pi` and `obk session add --harness pi` make one, and `obk up` MUST open a Pi session in an Orca tab with its model, effort, name and start prompt.: in [PRD-4], [PRD-6], [PRD-11]
- R2 The book MUST keep a Pi session's id, and bringing the session up again after its tab closed MUST resume that conversation.: in [PRD-12]
- R3 Every Pi session MUST count as `dangerously-skip`, since Pi asks before no tool call and has no rule for each command. The kit MUST refuse `auto` and `ask` for a Pi session, and say why.: in [PRD-11]
- R4 The kit MUST NOT handle Pi's credentials: the user signs in to Pi on their own. When Pi is not ready to start a session, the kit MUST say so and stop.: in [PRD-8]
- Added: none
- Modified: [PRD-4], [PRD-6], [PRD-8], [PRD-11], [PRD-12]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: none
- ADRs superseded: none

Notes:
