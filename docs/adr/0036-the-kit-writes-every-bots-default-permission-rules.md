# ADR 0036: The kit writes every bot's default permission rules, with nobody asked

Date: 2026-10-10.
Status: accepted.
Decided by: the owner, on 2026-09-26, for a default set every bot gets and the kit's code as the only writer (#344); the owner, on 2026-10-10, for the kit's own commands being in that set and written with nobody asked (#527: "for kit command I need you to be part of kit code!!! To set default for every session without the need to ask"); the architect, on 2026-09-26, for leaving an entry the kit did not write where it is and naming it in health, and for the rules build writing the kit's path and the bots folder's path into a bot's rules; the architect, on 2026-10-10, for adding Orca's `orca orchestration check --run` to the set, and for writing the set from an explicit list (#527, #532). The owner may overrule the architect's parts. Which commands are left out is [ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md).
Supersedes: [ADR 0026](0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md).

## Context

A bot in auto mode is stopped by the harness's own check for what the kit's
rules tell every bot to do. On kit-dev (Claude Code 2.1.283, 2026-09-26),
every `obk message check` and every read of a long message's body asked the
owner Yes/No. Claude Code settles a matching allow rule before its auto-mode
check, and keeps narrow rules in auto mode while it drops broad ones such as
`Bash(*)` (its permissions and auto-mode docs).

From 2026-09-26 (#344) the kit offered every bot six rules: its mail, reading
a long message, `git add` and `git commit`. It wrote them only after the
user's yes, given per bot. The kit's rules also tell every bot to make,
answer and retire its own temporary sessions (PRD 6.4, #251), and none of
those commands was in the set. On 2026-10-10 six of the eight bots made
temporary sessions with no rule for it, and auto mode can refuse a kit road
at any time (#521). Auto mode refused `orca orchestration check --run`, which
Orca's mail notice tells every session to run, in arch-panel the same day.

The owner, 2026-10-10 (#527): "Choice: b", one yes for every bot; then "for
kit command I need you to be part of kit code!!! To set default for every
session without the need to ask", and "This is not the first time I ask for
thi?". The owner had said so before: Bot Father's charter takes the kit's
default rules without asking (September), and the own-tool standing yes
(2026-10-05).

The kit already writes `.claude/settings.json` in every bot folder for its hook
([ADR 0022](0022-kit-hooks-live-in-the-bot-folder.md)), and knows its own CLI
path and the bots folder, so it can spell exact rules.

## Decision

Every bot gets a default set of rules, spelled with the kit's real CLI and the
bots folder, with nobody asked:

- `Bash(<kit> <command> --bots <folder>:*)` for each command on the kit's
  list of default commands, which holds none that
  [ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md)
  keeps for the user's yes;
- `Read(/<folder>.messages/**)`, for a long message's body;
- `Bash(git add:*)` and `Bash(git commit:*)`;
- `Bash(orca orchestration check --run:*)`, which Orca's mail notice tells a
  session to run, and nothing else of `orca`'s.

The set is written from an explicit list of commands, never as every command
less some exceptions. Every command the kit has is on exactly one of two
lists, the default commands or the commands kept back, and a test holds every
command to that, so a new command joins the set only when someone puts it on
the list. A command that runs whatever its arguments say, such as the
`obk run` #532 proposes, never goes on it: allowed, it would allow any
command (the architect, 2026-10-10).

`bot create`, `init`, `rules build` and `up` (and so `restart`) add each
default rule a bot's `bot.yaml` `allow` does not hold yet, after the entries
already there, and write `allow` into the harness files. They say, for each
bot, each rule they added. Nothing waits for a yes. `allow` stays the one
record of what a bot is allowed, and the kit's code the only writer.

So that a bot runs the kit's commands in exactly the form the rules allow, the
rules build writes the kit's own path, as a shell word, where a rule unit says
`"${OBK_CLI:-obk}"`, and the bots folder's path where it says `<bots>`. A bot's
`AGENTS.md` therefore names the CLI that built it and the folder it was built
in, and the next `up` or `rules build` from another CLI or another folder
rebuilds it, and adds that CLI's rules. Skills are linked files, the same on
every machine, and keep their own wording (the architect, 2026-09-26).

The kit owns only the entries `allow` holds. Any other entry stays where it
is; `obk health` names it, and names an allowed rule the file lacks. The kit's
rules tell every bot, Bot Father included, not to write permission rules into
a settings file itself.

There is no SendMessage rule in the set. Claude Code's docs and its 2.1.222
changelog say the auto-mode classifier reviews every SendMessage before it is
delivered, and say nothing of an allow rule settling it first. A SendMessage
rule takes the bare tool name only, so it cannot be narrowed to the fleet's
sessions, and a rule for every recipient is broad (#527). #521 tells a sender
that is refused what to do.

A Codex bot gets the same set in Codex's form, as
[ADR 0039](0039-a-codex-bots-rules-are-written-in-codexs-own-form.md) says.
Rules beyond the set stay the user's yes to each exact rule
([ADR 0038](0038-a-charters-grants-become-exact-permission-rules.md)).

## Alternatives considered

- **The user's yes to each bot's default set, listed as waiting** (ADR 0026).
  Not chosen any more: the owner asked twice that the kit's commands need no
  question, and a bot was stopped meanwhile for what the kit tells it to do.
- **One yes from the owner to an exact list, written at bot creation** (the
  owner's first answer, "Choice: b"). Replaced the same day by the owner's
  later words: no question at all, the kit's code decides.
- **Only the commands the kit's rules tell every bot to run** (the issue's
  first boundary). Not chosen: the owner asked for every kit command but those
  that grant rights or are risky.
- **Every command less a list of exceptions.** Not chosen: a new command, such
  as one that runs other commands (#532), would be allowed by default without
  anyone deciding it, and that would allow any command.
- **The owner's broader `Bash(<cli>:*)`.** Not chosen: it would hold the
  permission commands and the risky ones, and the kit refuses a rule with one
  word before its wildcard as broad.
- **Bot Father editing the settings file.** Not chosen: the owner wants the
  kit's code to write the exact text, not a model.
- **A bare `SendMessage` rule.** Not chosen: it cannot be narrowed, and the
  docs do not say it settles the classifier's review of a send.

## Consequences

- Good: a bot runs the kit's commands, reads and sends its mail and commits
  without the auto-mode check stopping it, on every bot, from its first `up`.
- Good: a bot's `bot.yaml` shows every rule it has, the kit's own included.
- Bad: each bot's `allow` holds about forty rules, most of them the kit's.
- Bad: a default rule cannot be taken back: the next rules write adds it again
  ([ADR 0040](0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md)).
- A rule allows only the command spelled as the kit prints it: the kit's path,
  then the command, then `--bots` and the folder. A command spelled another
  way, such as a relative bots folder, goes to the harness's check as before.
- An allow rule only stops the harness from stopping a bot. It does not widen
  what a bot's charter lets it do.
- `git add` and `git commit` are allowed wherever the bot runs them, not only
  in the bots repo: Claude Code's docs give no way to scope a Bash rule to a
  folder.
- Revisit if: Claude Code gives SendMessage a narrow rule that settles its
  review. Confidence: high for the set, low for SendMessage, which rests on
  the docs and not on a live run.

## History

- 2026-09-26, [ADR 0026](0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md):
  six default rules, written only after the user's yes, per bot (#344).
- 2026-10-10: every kit command but those kept back, and Orca's check, written
  with nobody asked (#527).
