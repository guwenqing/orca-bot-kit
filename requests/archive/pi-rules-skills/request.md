# pi-rules-skills
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-19 the owner's words, snapshot origin/2026-10-19-owner-words.md

## Organized requirement

R1: A Pi session MUST start from its bot's rules, the bot's `AGENTS.md`, as a Claude Code or Codex session of the same bot does. Pi has no permission rules and no hooks, so the kit MUST write neither for Pi, and `obk rules build` and `obk up` MUST say so for each bot with a Pi session. Amends: [PRD-11], [PRD-13]

R2: A Pi session MUST be able to use the skills its bot's lists name, as a Claude Code or Codex session of the same bot does, with Pi's project trust left as it is. A skill added to a bot or taken from it MUST reach a running Pi session through `obk skills build`, which types `/reload` into the session's tab when Pi is idle, and says what to do when it could not. `obk skills build` and `obk up` MUST say how a Pi session gets its skills. Amends: [PRD-11], [PRD-14]

Assumed: this is slice 4 of #547 (#659). Pi reads the `AGENTS.md` of the folder a session starts in, and of the folders above it, whatever the project trust. The kit names the bot's own `.agents/skills` folder on each Pi launch line with `--skill`, because `--no-approve` keeps Pi from the folder's own skills; the kit writes nothing into `~/.pi/agent` or any other folder that every Pi session reads. Pi refuses `/reload` while it works, so the kit types it only into an idle Pi tab. A running Pi session reads a changed `AGENTS.md` at its next start or `/reload`; `obk rules build` types nothing, as for the other harnesses. The facts are from Pi 1.3.0 (docs/tech-notes.md, section 6).
Out: health of a Pi session, `/new` in a Pi tab, and `session change --harness pi`: later slices of #547.
Signed off: 2026-10-19 owner, origin/2026-10-19-signoff.md

## Outcome

- R1 A Pi session MUST start from its bot's rules, the bot's `AGENTS.md`, as a Claude Code or Codex session of the same bot does. Pi has no permission rules and no hooks, so the kit MUST write neither for Pi, and `obk rules build` and `obk up` MUST say so for each bot with a Pi session.: in [PRD-11], [PRD-13]
- R2 A Pi session MUST be able to use the skills its bot's lists name, as a Claude Code or Codex session of the same bot does, with Pi's project trust left as it is. A skill added to a bot or taken from it MUST reach a running Pi session through `obk skills build`, which types `/reload` into the session's tab when Pi is idle, and says what to do when it could not. `obk skills build` and `obk up` MUST say how a Pi session gets its skills.: in [PRD-11], [PRD-14]
- Added: none
- Modified: [PRD-11], [PRD-13], [PRD-14]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: none
- ADRs superseded: none

Notes:
