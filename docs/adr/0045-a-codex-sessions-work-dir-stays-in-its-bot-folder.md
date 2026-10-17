# ADR 0045: A Codex session's work dir stays in its bot folder

Date: 2026-10-16.
Status: accepted.
Decided by: the architect, on 2026-10-16, for refusing an outside work dir for a Codex session in `session add` and `session change`, for judging it by real paths, for keeping Claude Code and Pi as they are, for not exempting `dangerously-skip`, for leaving `up` as it is, and for no road of the user's yes in this issue (#585); developer-585, for the details. The architect or the owner may overrule.

## Context

A session's work dir is an instruction and a plain folder (PRD 6.4). The kit
names it in the start prompt. On Codex the kit also names it on the launch
line: in Codex's auto mode the sandbox lets a session write only in the
folder it starts in, so a work dir outside the bot folder gets
`--add-dir <work dir>` ([ADR 0015](0015-three-approval-levels-auto-by-default.md)).
`--add-dir` makes that folder writable for the session. Claude Code and Pi
get no such flag for a work dir.

`session add` and `session change` are in every bot's default permission set
([ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md)), so
a bot runs them with nobody asked. Until this record they took a work dir
anywhere, and only said so when it was outside the bot folder (#222). A bot
could therefore give a Codex session of its own bot `--work-dir /`, or move a
session with an outside work dir to Codex, and that session could then write
anywhere (#585). The PRD promises: "No command in the default set grants a
rule or widens an approval: `bot change`, `session add` and `session change`
grant none" (PRD 6.4).

`temp make` gives every temporary session `work/<name>`, and the name is one
plain name, so it cannot give an outside work dir.

No session in the owner's fleet had a work dir outside its bot folder on
2026-10-16 (the architect).

## Decision

`session add` and `session change` refuse a change that gives a Codex session
a work dir outside its bot folder:

- `session add --work-dir <path>` for a session that runs on Codex, by its
  own `--harness codex` or by the bot's harness.
- `session change --work-dir <path>` for a session that runs on Codex after
  the change.
- `session change --harness codex` for a session whose work dir is outside
  the bot folder.

Outside is judged by real paths, as the finding of #222 judges it: an
absolute path elsewhere, a path through `..`, or a path that a link takes
out of the bot folder. A path whose spelling is outside the bot folder is
outside too, even when a link takes it back in: the launch line names the
spelled path, and the link can be changed later (developer-585). A refusal says that Codex would be allowed to write
that folder, and changes nothing. A change that leaves a Codex session's
harness and work dir as they were is not refused. `session change` judges the
whole session that it writes, so a change that another command made in the
meantime is not combined with it unchecked (reviewer-585). Every kit write
over `bot.yaml` is made in one step, as the book is written: to a file of the
command's own beside it, then moved over it. Two writes at once then leave one
whole text that a command checked, never one text with the end of the other
after it (reviewer-585).

The approval level does not matter. A Codex session at `dangerously-skip`
has no sandbox, but a later `obk permission approval` to `auto` would then
make the folder writable with no yes to it.

Claude Code and Pi sessions keep what #222 gave them: an outside work dir is
written as given, and the answer says it is outside the bot folder.

`up` does not change. A `bot.yaml` that the user writes by hand launches as
written, as for `extra_args`
([ADR 0044](0044-extra-arguments-that-widen-a-session-are-refused.md)).

The kit gives no road for the user's yes to an outside work dir on Codex. If
a user needs one later, that is a new requirement.

## Alternatives considered

- **A command of the user's yes, `obk permission work-dir`, that records the
  folders a bot's Codex sessions may write.** Not chosen: nobody uses an
  outside work dir today, and the PRD promises no work dir anywhere. It
  would add a command and a key that nobody asked for (the architect).
- **Telling a person from a bot by the tab the command runs in.** Not
  chosen: a bot can run the command with that environment taken off.
- **Taking `--add-dir` off the launch line.** Not chosen: a work dir outside
  the bot folder that the user wrote by hand would then not be writable.
- **Refusing an outside work dir for every harness.** Not chosen: on Claude
  Code and Pi it widens nothing, and the kit takes no requirement stricter
  than the intent.
- **Judging outside by real paths only.** Not chosen: a path spelled
  outside that a link takes back inside would pass, and the launch line
  would still name it with `--add-dir`. A bot could then point the link at
  another folder.

## Consequences

- Good: no command in the default set can make a folder outside the bot
  folder writable for a Codex session through its work dir.
- Bad: a user who wants a Codex session to work outside its bot folder must
  write the work dir into `bot.yaml` by hand. The kit does not tell a bot to
  do that.
- Bad: a path spelled outside the bot folder that a link takes back into it
  is refused, though it widens nothing today. Its user can spell it inside.
- Bad: nothing locks the read, the check and the write of `bot.yaml`, so two
  commands at the same time can still lose one of the two changes. Each
  `bot.yaml` that results is one that a command checked, so this is a
  correctness gap, not a wider write: #595.
- Revisit if: a user asks for a Codex work dir outside the bot folder, or a
  harness gets another flag that the kit sets from a work dir. Confidence:
  high.

## History

- 2026-09-24: a work dir outside the bot folder is said, not refused (#222).
- 2026-10-16: refused for a Codex session in `session add` and
  `session change` (#585).
