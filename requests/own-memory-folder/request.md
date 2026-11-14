# own-memory-folder
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md

## Organized requirement

<!-- R1 from:2026-11-14-owner-words.md -->

### R1 Each Claude bot gets a memory folder of its own

When the kit starts a Claude Code session, it MUST name one memory folder for the session's bot on the launch line. The folder MUST be the same for every session of that bot and different for each bot. The kit names no folder when a user named a memory folder for the bot or the session, or when the slug of the bot folder is longer than 200 characters. The kit MUST NOT move, copy or delete a note for this. When the kit names a bot's folder, that folder holds no notes, and the folder that the bots shared holds notes, `obk health` MUST say so and name both folders.

Assumed: the folder is `<real path of the projects folder>/<slug of the bot folder>/memory`, beside the bot's transcripts. The projects folder is the one that the Orca profile links to, or `~/.claude/projects` when no profile is selected. The value is a physical path, as in ADR 0054, so a memory write opens no dialog. The PRD paragraph names the limits: a conversation that began before the upgrade, a `/clear` after Orca brings a tab back by itself, a folder that a user named, and a slug past 200 characters. Design: issue #752, comment 6882138864, accepted by kit-dev/architect on 2026-11-14.
Out: Codex and Pi, which change nothing here. Moving or splitting a user's notes.
