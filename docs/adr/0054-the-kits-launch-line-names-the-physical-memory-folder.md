# ADR 0054: The kit's launch line names the physical memory folder

Date: 2026-11-03.
Status: accepted.
Decided by: the architect, on 2026-11-03, for the flag on the launch line over a key in a bot's files, and for tier 0 (#722); developer-722, for the conditions. The architect or the owner may overrule.

## Context

Orca starts a Claude tab with `CLAUDE_CONFIG_DIR` set to a profile of its own. In that profile, `projects` is a symlink to `~/.claude/projects`. Claude Code names its memory folder through the link. A write to that folder then stops on a permission dialog that only a person can answer, and an allow rule does not clear it (#722; tech notes, section 2). On the owner's fleet this stopped sessions for 16.5 hours, 64 minutes and 75 minutes.

Claude Code's `autoMemoryDirectory` setting moves the memory folder. When it names the physical folder, the same write has no dialog, and the memory is the same memory.

[ADR 0049](0049-extra-arguments-that-widen-a-session-are-refused.md) refuses `--settings` as a user's extra argument, because it can carry permission rules, extra folders and hooks. So the kit's own use of that flag needs a record of its own.

## Decision

On a Claude Code launch line, the kit adds `--settings` with a JSON object of exactly one key, `autoMemoryDirectory`. Its value is the real path of the profile's `projects` link, then the slug of the project root, then `memory`. The kit computes it at each launch and writes no file.

The kit adds it only when all of these hold. Otherwise the line is as it was:

1. Orca's `claude-profiles/selected-host` file names a profile home.
2. The `projects` entry of that home is a symbolic link that resolves.
3. No `autoMemoryDirectory` key is in the bot's `.claude/settings.json` or `.claude/settings.local.json`, or in the profile's `settings.json`. A file that cannot be read or parsed counts as having the key.
4. The slug has 200 characters or fewer. Past that, Claude Code adds a hash of its own, which the kit does not copy.
5. The session's own `extra_args` do not hold `--settings`.

This does not change ADR 0049. `--settings` stays refused as a user's extra argument. The kit's line carries this one key and no other, and a test holds that.

## Alternatives considered

- **The key in the bot's `.claude/settings.json`.** Not chosen. It holds in more cases: live, it held after a bare resume and a `/clear`. But Claude Code's schema text says the key is "Ignored if set in projectSettings (checked-in .claude/settings.json) for security". The code reads it anyway. If the vendor closes that gap, the dialog returns for every bot at once, with no warning. It also puts a machine path in a tracked file of each bot, needs a guess at which values are hand-set, needs new words in two skills, and is a change of promise (the architect, 2026-11-03).
- **The key in the bot's `.claude/settings.local.json`.** Not chosen now. It also holds after a bare resume and a `/clear`. But that file is the user's override, and the README says that the kit never writes it. This is the road if the first limit below proves to matter in use. It then goes to the owner as a change of promise.
- **A permission rule.** Not chosen: the issue's table shows that the rules do not clear the dialog, and the binary shows why.
- **A rule that tells a session to write to the real path.** Not chosen: it is the workaround on the owner's fleet. A session also follows the path in its memory instructions, so it does not hold.
- **Answering the dialog.** Not chosen: the issue's boundary excludes it. Nothing types into a tab or watches for the dialog.
- **`CLAUDE_CODE_REMOTE_MEMORY_DIR`.** Not chosen: it is an undocumented variable, seen only in the binary.

## Consequences

- Good: a new conversation of a session that the kit starts saves its memory with no dialog and no classifier call. The memory is in the same physical folder, so a session still loads it and grooming still finds it. The flag does not turn on memory for a session that has it off.
- Bad: three limits.
  1. After a cold restore, Orca runs a bare `claude --resume <id>` with none of the kit's flags. A conversation born with the flag keeps the physical path and passes by the auto-mode classifier. But a `/clear` before any restart begins a conversation under the profile path, and the dialog returns. `obk health` names a session the kit did not start, and its restart.
  2. A conversation born before this keeps the profile path until its next `/clear` or a new conversation. A restart does not help, because a conversation keeps the memory instructions it began with.
  3. The kit depends on Orca's `selected-host` file. If Orca moves it, the kit adds nothing, and the dialog returns with no memory lost.
- Revisit if: the first limit stops sessions in use; Claude Code stops the dialog for a memory folder under a link; or Orca stops linking `projects`.
  Confidence: high on what the flag does, from the live checks in the tech notes.

## History

- 2026-11-03: the first record (#722).
