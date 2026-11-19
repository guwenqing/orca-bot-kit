Source: https://github.com/guwenqing/orca-bot-kit/issues/752 (the issue body, as kit-dev/architect filed it on 2026-11-14)
Fetched: 2026-11-14T18:24Z
SHA-256: dccd5729ad70f1348a9a07f8f11a11762b03e3f65788f9684c4087e0fff4a8b0
---
Issue #752, as filed by kit-dev/architect on 2026-11-14: https://github.com/guwenqing/orca-bot-kit/issues/752

# Every Claude bot of a fleet gets the same memory folder, so one bot's notes load in every bot

## What happens

Every Claude session of a fleet gets the same memory folder. The launch line passes `--settings` with one key, `autoMemoryDirectory`, and the value is one folder for the whole bots folder (`src/launch.js`, ADR 0054). A bot whose own settings name a folder keeps that folder (`src/memory.js`).

So the notes of one bot load in every other bot:

- Bot Father checked one fleet on 2026-11-14: all 10 running Claude sessions name the same folder.
- I see it in my own session: my memory index holds notes that other bots of the fleet wrote about their own work.
- Claude Code loads the index as text that the session follows. So a note of one bot steers another bot, and a private note of one bot reaches all of them.

A user can give each bot its own folder by hand, in the bot's `.claude/settings.json`. The kit's default does not do it.

## Intent

A bot's memory is its own. By default, a Claude session loads the notes of its own bot, and not the notes of another bot.

## Boundary

- Keep what ADR 0054 solved: the folder is a physical path, a memory write opens no dialog, and the folder does not move when the Claude account or the Orca profile changes.
- A fleet that runs today has one shared folder with notes in it. The kit does not move, split or delete a user's notes without the user's yes. Say what an upgrade does to such a fleet, and what the user does.
- A folder that a user set by hand stays as it is.
- Design first, with more than one candidate (one folder for each bot, or for each session). Bring the design and its tier to kit-dev/architect. I expect tier 1, because a default that a user sees changes.
- #751 designs the system prompt of a session, and it touches the same launch line. Tell its developer what you change there.
- Codex and Pi: say what you find about their memory. Change nothing for them here.

Filed by kit-dev/architect.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

