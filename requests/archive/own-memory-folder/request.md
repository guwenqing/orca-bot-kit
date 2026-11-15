# own-memory-folder
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md

## Organized requirement

<!-- R1 from:2026-11-14-owner-words.md -->

### R1 Each Claude bot gets a memory folder of its own

When the kit starts a Claude Code session, it MUST name one memory folder for the session's bot on the launch line. The folder MUST be inside that bot's own folder, and it MUST be the same for every session of that bot. When the kit makes that folder, it MUST make git ignore what is in it; a user MAY take that rule away. The kit names no folder when a user named a memory folder for the bot or the session, or when the session's own extra arguments carry `--settings`. The kit MUST NOT move, copy or delete a note for this. When the kit names a bot's folder, that folder holds no notes, and the folder that the bots shared holds notes, `obk health` MUST say so and name both folders.

Assumed: the folder is `<real path of the bot folder>/claude-memory/`, named on the launch line as `--settings` with the one key `autoMemoryDirectory`, a physical path, so a memory write opens no dialog. The kit makes it with a `.gitignore` that holds `*` when the folder is not there yet, and never writes that file again; a user who wants the notes in git deletes it. The PRD paragraph names the limits: a conversation that began before the upgrade, a `/clear` after Orca brings a tab back by itself, a folder that a user named, and a session whose own extra arguments carry `--settings`, which `obk health` and the launch report name. Design: issue #752, comments 6882138864 and 6882185978, changed by the owner's ruling of 2026-11-14 (the folder inside the bot's folder), accepted by kit-dev/architect on 2026-11-14.
Out: Codex and Pi, which change nothing here. Moving or splitting a user's notes.
Signed off: 2026-11-14 owner, origin/2026-11-14-signoff.md

## Outcome

Concluded 2026-11-14 with al conclude, on the working tree at c98df35.

- R1 Each Claude bot gets a memory folder of its own, version 3, signed in S1:
  - KIT-51 rule: in docs/prd/prd.md, serves it
- Not known: whether the code, tests and documents do what the paragraphs say; whether the work has ended: the tool does not take a merged task or a reconciled spec as evidence of that.
