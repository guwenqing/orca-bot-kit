# ADR 0056: Each Claude bot gets a memory folder of its own

Date: 2026-11-14.
Status: accepted.
Decided by: the architect, on 2026-11-03, for the flag on the launch line and its one key (#722); the architect, on 2026-11-14, for one folder for each bot, the folder with no Orca profile, the limit of 200 characters and the notice of `obk health` (#752); the owner, for requirement R1 of `requests/archive/own-memory-folder/`. The architect or the owner may overrule.
Supersedes: [ADR 0054](0054-the-kits-launch-line-names-the-physical-memory-folder.md).

## Context

Claude Code keys its memory folder by the top of the git repository, not by the working folder. So every bot of a bots repo shares one memory folder by Claude Code's own default (tech notes, section 2). Claude Code loads the `MEMORY.md` index of that folder into each conversation as text that the session follows. So a note of one bot steers every other bot, and a private note of one bot reaches all of them (#752).

ADR 0054 put `--settings` with the one key `autoMemoryDirectory` on the launch line. It named the physical path of that same shared folder. Orca starts a Claude tab under a profile whose `projects` folder is a link to `~/.claude/projects`. Claude Code names its memory folder through the link, and a write there stops on a permission dialog that only a person can answer (#722). Named by its physical path, the folder has no dialog. ADR 0054 removed the dialog. It did not cause the sharing, and it did not stop it.

[ADR 0049](0049-extra-arguments-that-widen-a-session-are-refused.md) refuses `--settings` as a user's extra argument, because it can carry permission rules, extra folders and hooks. So the kit's own use of that flag needs a record of its own.

## Decision

On a Claude Code launch line, the kit adds `--settings` with a JSON object of exactly one key, `autoMemoryDirectory`. Its value is `<P>/<slug of the bot folder>/memory`:

- The bot folder is its real path, in NFC. The slug changes each character that is not an ASCII letter or digit to `-`.
- P is the real path of the projects folder. With a profile that Orca's `claude-profiles/selected-host` file names, it is that profile's `projects`. With no such profile, it is `~/.claude/projects`. When P does not exist yet, the kit resolves the deepest part that exists and adds the rest as it is.

So each bot has one folder, and all sessions of the bot share it, temporary sessions included. The folder is beside the bot's transcripts, because a Claude session of the kit starts in its bot folder. It is the folder that Claude Code would choose if the bot folder were the top of a repository of its own. The kit computes it at each launch and writes no file.

The kit adds nothing, and the line is as it was, when one of these holds:

1. An `autoMemoryDirectory` key is in the bot's `.claude/settings.json` or `.claude/settings.local.json`, in the repository root's `.claude/settings.local.json`, or in the profile's `settings.json`. A file that cannot be read or parsed counts as having the key.
2. The session's own `extra_args` hold `--settings`.
3. The slug of the bot folder is longer than 200 characters.
4. P, or a link on its way, leads nowhere.

The kit never moves, copies or deletes a note for this.

`obk health` gives a finding for a bot when the kit names its folder, that folder has no `MEMORY.md`, and the folder that the bots shared has one. The shared folder is the first folder above the bot folder, nearest first, whose `<P>/<slug>/memory/MEMORY.md` exists. The finding names both folders and says that the kit moved nothing. It ends when the bot saves its first note, or when a user names a folder by hand.

This does not change ADR 0049. `--settings` stays refused as a user's extra argument.

## Alternatives considered

- **One folder for each session.** Not chosen. It is stricter than the intent: a bot's memory is its own. A temporary session starts with no notes, and its lessons go when it goes. Grooming has to read one folder for each session.
- **One folder for each bot, under the repository's folder** (`<slug of the repository top>/memory-<bot>`). Not chosen. It keeps the computation of the repository top and every case where the kit was not sure of it. It is a name that only the kit uses.
- **The key in the bot's `.claude/settings.json`.** Not chosen. Claude Code's schema text says that the key is "Ignored if set in projectSettings (checked-in .claude/settings.json) for security". The code reads it anyway. If the vendor closes that gap, the folder changes for every bot at once, with no warning. It also puts a machine path in a tracked file of each bot, and the kit can then not tell its own value from a user's.
- **The key in the bot's `.claude/settings.local.json`.** Not chosen. That file is the user's override, and the README says that the kit never writes it.
- **No flag.** Not chosen. Claude Code's default is the shared folder, and the dialog of #722 comes back.
- **A notice in the report of `obk up` and `obk restart`.** Not chosen. At start time a running conversation still uses the shared folder, so the line can come before the change that it reports.
- **A notice in the session's start prompt.** Not chosen. It changes what a session is sent (#751), and it points the bot at the shared notes.

## Consequences

- Good: a Claude session that the kit starts loads the notes of its own bot, and not the notes of another bot. A memory write opens no dialog. The folder does not move when the Claude account or the Orca profile changes, while both profiles link `projects` to the same folder. The kit no longer needs the top of the repository.
- Bad: a bot can still load the shared folder in four cases.
  1. A conversation that began before this keeps its memory path until the session restarts with the flag and then begins a new conversation. A restart alone does not help, because a conversation keeps the memory instructions it began with. A `/clear` alone does not help, because a process that started with no flag has none to give the new conversation.
  2. After a cold restore, Orca runs a bare `claude --resume <id>` with none of the kit's flags. A `/clear` before a restart begins a conversation with no flag. It loads the shared folder, and the dialog returns. `obk health` names a session that the kit did not start.
  3. A folder that a user named by hand stays as the user set it, shared or not.
  4. A bot folder whose slug is longer than 200 characters gets no flag.
- Bad: at the upgrade, a bot with no folder of its own named by hand starts with no notes. The notes stay in the shared folder. `obk health` says so until the bot saves a note.
- Bad: the kit depends on Orca's `selected-host` file. If Orca moves it, the kit names the folder under `~/.claude/projects`, which can differ from the profile's `projects`.
- Revisit if: Claude Code keys memory by the working folder; Claude Code stops the dialog for a memory folder under a link; or Orca stops linking `projects`.
  Confidence: high on what the flag does, from the live checks in the tech notes. The first write into a folder that does not exist yet is checked in the night run of `test/system/memory-write.test.js`.

## History

- 2026-11-03: ADR 0054, the first record (#722).
- 2026-11-04: ADR 0054's second limit named both steps, restart and then a new conversation (#724).
- 2026-11-14: this record replaces ADR 0054 (#752). The folder is one for each bot, not the repository's. With no Orca profile, the kit names the folder under `~/.claude/projects`. `obk health` says when a bot's folder is empty and the shared folder is not.
