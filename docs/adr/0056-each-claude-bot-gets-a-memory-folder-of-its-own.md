# ADR 0056: Each Claude bot gets a memory folder of its own, in its bot folder

Date: 2026-11-14.
Status: accepted.
Decided by: the architect, on 2026-11-03, for the flag on the launch line and its one key (#722); the owner, on 2026-11-14, for the folder inside the bot's own folder (#752); the architect, on 2026-11-14, for the folder's name, the ignore file and the notice of `obk health` (#752); the owner, for requirement R1 of `requests/archive/own-memory-folder/`. The architect or the owner may overrule.
Supersedes: [ADR 0054](0054-the-kits-launch-line-names-the-physical-memory-folder.md).

## Context

Claude Code keys its memory folder by the top of the git repository, not by the working folder. So every bot of a bots repo shares one memory folder by Claude Code's own default (tech notes, section 2). Claude Code loads the `MEMORY.md` index of that folder into each conversation as text that the session follows. So a note of one bot steers every other bot, and a private note of one bot reaches all of them (#752).

ADR 0054 put `--settings` with the one key `autoMemoryDirectory` on the launch line. It named the physical path of that same shared folder, under `~/.claude/projects`. Orca starts a Claude tab under a profile whose `projects` folder is a link to `~/.claude/projects`. Claude Code names its memory folder through the link, and a write there stops on a permission dialog that only a person can answer (#722). Named by its physical path, the folder has no dialog. ADR 0054 removed the dialog. It did not cause the sharing, and it did not stop it.

The owner ruled on 2026-11-14 that a bot's memory folder is in the bot's own folder, not at the user level, and that all sessions of a bot share it.

[ADR 0049](0049-extra-arguments-that-widen-a-session-are-refused.md) refuses `--settings` as a user's extra argument, because it can carry permission rules, extra folders and hooks. So the kit's own use of that flag needs a record of its own.

## Decision

On a Claude Code launch line, the kit adds `--settings` with a JSON object of exactly one key, `autoMemoryDirectory`. Its value is `<real path of the bot folder>/claude-memory`. All sessions of the bot share it, temporary sessions included. It does not depend on the repository, the Orca profile or the session's work dir.

When the kit names the folder and nothing is at that path, the kit makes the folder and writes a `.gitignore` in it that holds `*`, before the session starts. So git ignores the notes. The kit never writes that file again once the folder is there. A user who wants the notes in git deletes it.

The kit adds nothing, and makes nothing, when one of these holds:

1. An `autoMemoryDirectory` key is in the bot's `.claude/settings.json` or `.claude/settings.local.json`, in the repository root's `.claude/settings.local.json`, or at the user level: the selected Orca profile's `settings.json`, or `~/.claude/settings.json` with no profile. A file that cannot be read or parsed counts as having the key. The repository root is the top of the repository that holds the bot, the main repository's for a linked worktree. When the kit is not sure of the root, it does not read that file.
2. The session's own `extra_args` hold `--settings`, which replaces the kit's: Claude Code keeps only the last one on the line. `obk up`, `obk restart` and `obk health` name such a session and what it runs without.
3. Something that is not a plain folder is at `<bot folder>/claude-memory`: a file, or a link.
4. The kit cannot make the folder with its `.gitignore`. It then takes back only what it made: its own `.gitignore`, and the folder while it is empty. It tries again at the next start.

The kit never moves, copies or deletes a note for this.

`obk health` gives a finding for a bot when the kit names its folder for a Claude session of the bot, that folder has no `MEMORY.md`, and the folder that the bots shared has one. The shared folder is Claude Code's default from before: under the real path of the profile's `projects`, or of `~/.claude/projects` with no profile, the `memory` folder of the first folder above the bot folder, nearest first, whose `MEMORY.md` exists. The finding names both folders and says that the kit moved nothing. It ends when the bot saves its first note, or when a user names a folder by hand.

This does not change ADR 0049. `--settings` stays refused as a user's extra argument.

## Alternatives considered

- **One folder for each bot at the user level**, `<projects>/<slug of the bot folder>/memory`, beside the bot's transcripts. Accepted by the architect first, then rejected by the owner: the memory goes in the bot's own folder.
- **One folder for each session.** Not chosen. It is stricter than the intent: a bot's memory is its own. A temporary session starts with no notes, and its lessons go when it goes.
- **`memory/` as the name.** Not chosen. A bot can have a `memory/` folder of its own: one bot on the owner's fleet keeps a `memory.md` there. On a disk that ignores case, as macOS's default does, `MEMORY.md` is the same file, so Claude Code would load and overwrite it.
- **`.claude/memory/` as the name.** Not chosen. Writes there passed in the fence only because of Claude Code's exemption for memory files, and `.claude/` is an area that Claude Code protects.
- **The notes in git, with no ignore file.** Not chosen. In a repository with a remote, a commit and then a push publish the notes, and they stay in its history. That cannot be undone, and it reaches other people. A lost note is a lesson that the bot can learn again.
- **The ignore rule in the bot's own `.gitignore`.** Not chosen. The kit writes that file only when it creates the bot, so the bots of a fleet that runs today would not get it.
- **The key in the bot's `.claude/settings.json`.** Not chosen. Claude Code's schema text says that the key is "Ignored if set in projectSettings (checked-in .claude/settings.json) for security", though 2.1.325 honours it. It also puts a machine path in a tracked file of each bot, and the kit can then not tell its own value from a user's.
- **No flag.** Not chosen. Claude Code's default is the shared folder.
- **A notice in the report of `obk up` and `obk restart`.** Not chosen. At start time a running conversation still uses the shared folder, so the line can come before the change that it reports.
- **A notice in the session's start prompt.** Not chosen. It changes what a session is sent (#751), and it points the bot at the shared notes.
- **A finding when a user's own `claude-memory` folder is in git and holds notes.** Not built. A user who deleted the ignore file to keep history is in the same state, and the finding would not end for that user.

## Consequences

- Good: a Claude session that the kit starts loads the notes of its own bot, and not the notes of another bot. A memory write opens no dialog (seen in a fence, Claude Code 2.1.325, `-p` in auto mode). The notes stay out of git unless the user asks. The kit no longer needs the Orca profile or the repository for the folder.
- Bad: a bot can still load the shared folder in five cases.
  1. A conversation that began before this keeps its memory path until the session restarts with the flag and then begins a new conversation. A restart alone does not help, because a conversation keeps the memory instructions it began with. A `/clear` alone does not help, because a process that started with no flag has none to give the new conversation.
  2. After a cold restore, Orca runs a bare `claude --resume <id>` with none of the kit's flags. A `/clear` before a restart begins a conversation with no flag. It loads the shared folder, and the dialog of #722 returns. `obk health` names a session that the kit did not start.
  3. A folder that a user named by hand stays as the user set it, shared or not.
  4. A session whose own extra arguments carry `--settings` gets no folder from the kit, because Claude Code keeps only the last `--settings` on the line. `obk up`, `obk restart` and `obk health` name it.
  5. A file or a link at `claude-memory`, or a start at which the kit cannot make the folder with its `.gitignore`, gives that start no folder.
- Bad: at the upgrade, a bot with no folder named by hand starts with no notes. The notes stay in the shared folder. `obk health` says so until the bot saves a note.
- Bad: the notes are not in git by default, so git keeps no history or backup of them.
- Bad: the kit now writes a folder and one file in each Claude bot's folder.
- Revisit if: Claude Code keys memory by the working folder; or Claude Code stops honouring `autoMemoryDirectory` from `--settings`.
  Confidence: high on what the flag does, from the fence and the live checks in the tech notes. A real tab under Orca, with the real auto mode, is checked in the night run of `test/system/memory-write.test.js`.

## History

- 2026-11-03: ADR 0054, the first record (#722).
- 2026-11-04: ADR 0054's second limit named both steps, restart and then a new conversation (#724).
- 2026-11-14: this record replaces ADR 0054 (#752). The folder is one for each bot, in the bot's folder, with an ignore file. `obk health` says when a bot's folder is empty and the shared folder is not.
