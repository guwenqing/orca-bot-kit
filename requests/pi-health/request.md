# pi-health
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-19 the owner's words, snapshot origin/2026-10-19-owner-words.md

## Organized requirement

R1: `obk health` MUST know a Pi session as it knows a Claude Code or Codex session. It names a Pi session whose tab is gone, whose tab has only the shell in front, or that has unread mail Orca has not told it of. It reads the session's model and thinking level from Pi's own record of the conversation, and names a difference from what `bot.yaml` asks for. It says when the book holds a conversation that Pi has no record of, and it names the Pi conversations that the book does not hold, with no words about a hook. It says when Pi cannot run a session: Pi does not run, Pi can use no model, or Pi cannot use the model that the session names, as `pi --list-models` answers. It MUST NOT ask for or read Pi's credentials, and it MUST NOT give a hook or permission-rule finding for a Pi session, since Pi has neither. Health still changes nothing. Amends: [PRD-11]

Assumed: this is slice 5 of #547 (#660). A live probe on 2026-10-19 (Pi 1.3.0, Orca 1.4.225) found what health said before this change; it is in the tech notes, section 6. `ps -E` shows a Pi process only as `pi`, with no environment, so health cannot tell a Pi that the kit started from one that Orca restored, and it reports nothing about that. Pi writes nothing about approval, so a Pi session's approval stays unknown in health's list. The kit's screen check does not yet see Pi's own selector screens; #661 teaches it, and the mail finding then uses it for Pi.
Out: a finding for a session that waits on a screen, which no harness has (the architect's ruling of 2026-10-19 on #660); the book following a `/new` in a Pi tab; `session change --harness pi`.
