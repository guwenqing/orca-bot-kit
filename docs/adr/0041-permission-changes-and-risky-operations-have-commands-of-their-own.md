# ADR 0041: Permission changes and risky operations have commands of their own

Date: 2026-10-10.
Status: accepted.
Decided by: the owner, on 2026-10-10, for permission changes and risky operations in commands of their own, kept out of the default set (#527: "Change permission and risky operation; you need to make dedicate sub command"), and for a bot never granting itself rules or approval (the fleet's rules, 2026-10-10); Bot Father, on 2026-10-10, for moving the approval out of `session add` and `session change` and for `init` staying out of the set; the architect, on 2026-10-10, for `temp make` taking no approval wider than its maker's without the user's yes for the bot's temporary sessions, for refusing extra arguments that set approval, and for `bot change --role-cap`; developer-527, for the name `obk permission` and for the list of risky commands; the owner, on 2026-10-10, for `restart` and `bot create` being Bot Father's only (the owner's fleet rules, bots commit 6bc6835, rules/kit-commands.md), so kept out of the default set (#548); the architect, on 2026-10-10, for naming a bot that still holds one of those two rules rather than taking it back (#548, ruling D). The architect or the owner may overrule the parts that are not the owner's.
Supersedes: [ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md).

## Context

[ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md) allows
every bot the kit's own commands with nobody asked. Until 2026-10-10 three of
those commands also granted rights: `bot change --allow` and `--disallow`
wrote a bot's permission rules (#344, #360), and `session add`, `session
change` and `temp make` set a session's approval level, `dangerously-skip`
included. `--extra-arg` on those commands, and on `groom --run-on codex`, can
carry a harness's own approval flags, such as Claude Code's
`--dangerously-skip-permissions` or Codex's `-a never`. A rule that allows a
command allows all of its flags: Claude Code's Bash rules and Codex's prefix
rules match a command's first words, whatever comes after them.

On 2026-10-10 kb and stockops made their job sessions with
`temp make --approval dangerously-skip` from a maker at `auto`.

The owner, 2026-10-10: "Change permission and risky operation; you need to
make dedicate sub command". Risky is an operation that deletes or overwrites
data that cannot be got back, retires or closes a long-lived session, changes
permissions, or reaches an account or other people (#527).

Kit 0.26.0 (#527) put `restart` and `bot create` in the default set, so it
wrote both rules into every bot's `bot.yaml` `allow` and harness files with
nobody asked. After that sign-off, the owner decided that only Bot Father runs
them: "obk retire, obk pause and obk restart, because they close a long-lived
session; obk bot create, because Bot Father creates the bots" (the owner's
fleet rules, 2026-10-10, bots commit 6bc6835, rules/kit-commands.md).

In `allow`, the entry 0.26.0 wrote as a default and a user's yes to the same
rule are the same line of text, and 0.26.0 kept no other record of what it
wrote. In the owner's fleet, Bot Father held both rules by the owner's yes
before 0.26.0. A rule the user said yes to stays theirs until they say yes to
taking it back ([ADR 0040](0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md)).

## Decision

Permission changes are one group of commands, `obk permission`:

- `obk permission allow --bot <bot> --rule <rule> …` records the user's yes to
  each exact rule and writes it, as
  [ADR 0038](0038-a-charters-grants-become-exact-permission-rules.md) says.
- `obk permission disallow --bot <bot> --rule <rule> …` takes one back, as
  [ADR 0040](0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md)
  says.
- `obk permission approval --bot <bot> --session <name> --approval <level>`
  sets a session's approval level.
- `obk permission approval --bot <bot> --temps --approval <level>` records, as
  `temp_approval` in `bot.yaml`, the widest level the bot's temporary sessions
  may be made at.

No other command grants a right:

- `bot change` sets a charter and, with `--role-cap <role>=<n>`, a role's cap
  in `temp_roles`. Its `--allow` and `--disallow` refuse, name the `permission`
  command, and change nothing.
- `session add` and `session change` refuse `--approval`, name
  `obk permission approval`, and change nothing. A new session is at `auto`.
- `temp make` refuses an approval wider than the widest of its maker's own and
  the bot's `temp_approval` (`ask` is narrower than `auto`, and `auto` than
  `dangerously-skip`). A temporary session made with no `--approval` still
  takes its maker's.
- `session add`, `session change`, `temp make` and `groom --run-on codex`
  refuse an extra argument that sets approval or permissions on the session's
  harness: on Claude Code `--permission-mode`, `--dangerously-skip-permissions`,
  `--allow-dangerously-skip-permissions`, `--allowedTools` and
  `--allowed-tools`; on Codex `-a`, `--ask-for-approval`, `--approve-for-me`,
  `--dangerously-bypass-approvals-and-sandbox`, `-s` and `--sandbox`, each alone, with `=` and a value, or, for
  `-a` and `-s`, with the value glued on.

The commands kept out of the default set, which keep the user's yes:

| Command | Why |
|---|---|
| `permission allow`, `permission disallow`, `permission approval` | They change permissions. |
| `retire` | It closes a long-lived session and takes it off its bot, or closes a whole bot, removes its Orca project and moves its folder. |
| `pause` | It closes a long-lived session's tabs, and `up` leaves them closed. |
| `restart` | It closes a long-lived session's tabs and opens them again. |
| `bot create` | It makes a bot, which the owner leaves to Bot Father (2026-10-10). |
| `init` | It is the user's own first step, which makes the bots folder. |

Every other command the kit has today is ordinary, and on the list of
default commands. A command added later is on neither list until someone puts
it on one, and a command that runs whatever its arguments say is kept back
([ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md)). `up` and `unpause` only add.
`health`, `roster` and `usage` only read.
`session clear` and `session compact` keep the conversation in the book and in
the harness's record. `temp retire` retires only a temporary session its
caller made. `session trust-hooks`, `session answer`, `temp trust-hooks` and
`temp answer` answer a first-run screen, and are narrow by construction: they
accept only their own callers, screens, keys and the kit's own hooks (#506;
the architect, 2026-10-10). The mail commands reach the fleet's own sessions, not people.
`skills fetch` and `skills update` clone or move the sources the user listed,
and reach no account. The hook commands are run by the kit's hooks.

A bot whose `allow` still holds the `restart` or `bot create` rule, spelled as
the default set spelled it, keeps it, in `bot.yaml` and in its harness files:
the kit cannot tell its own entry from a user's yes, so it takes neither back.
`rules build` and `up` name each such bot and rule, with the exact
`obk permission disallow` command that takes it back. The notice states a fact
that stays true after a later yes, and does not say the rule is wrong.
`permission disallow` takes either rule back as it takes back any rule the user
allowed, since neither is a default rule any more.

## Alternatives considered

- **`obk bot allow` and `obk bot disallow`.** Not chosen: the approval is a
  session's setting, not a bot's, and one group named `permission` tells a
  reader, a rule and the default set at a glance which commands grant rights.
- **Keeping `--approval` on `session add` and `session change`, and refusing
  only a level wider than the bot's recorded one.** Not chosen: a second
  check of the same kind in three places is more to keep right than one
  command, and a session's approval then has one writer.
- **Taking `--approval` off `temp make`.** Not chosen: a maker at
  `dangerously-skip`, such as Bot Father's daily session, makes its temporary
  sessions at its own level, and `ask` is always narrower.
- **Moving every `--extra-arg` into the permission commands.** Not chosen:
  most extra arguments do not touch permissions, and the kit cannot tell an
  unknown one either way. The ones it knows are refused.
- **Keeping `restart` and `bot create` in the default set** (ADR 0037). Not
  chosen any more: `restart` closes a long-lived session, as `retire` and
  `pause` do, and the owner decided on 2026-10-10 that only Bot Father runs
  `restart` and `bot create`. ADR 0037 kept `restart` because it opens every
  session again on the conversation it was having.
- **Taking the two rules back at the next `rules build` or `up`** (#548 as
  filed). Not chosen: the kit cannot tell the entry it wrote from a user's yes
  to the same rule, so it would take back a yes, such as Bot Father's.
- **A special case that leaves Bot Father its two rules.** Not chosen: it is a
  guess too, since another bot may hold them by the user's yes.
- **A record of the default rules the kit writes.** Not chosen: it does not
  tell the entries 0.26.0 wrote from a yes, and naming them settles the same
  question with no new state.

## Consequences

- Good: no command in the default set can grant a bot a rule or widen a
  session's approval through any flag the kit knows.
- Bad: an extra argument the kit does not know can still change permissions,
  such as Claude Code's `--settings` or Codex's `-c` and `--profile`. It is a
  known gap.
- Codex's `--dangerously-bypass-hook-trust` is not refused: it skips the
  review of the hooks in the bot folder, the kit's own, and does not widen
  what a session may run. The kit's system tests pass it to their throwaway
  Codex sessions.
- Bad: kb's and stockops's job sessions, made at `dangerously-skip` from an
  `auto` maker, are refused from this release until Bot Father runs
  `obk permission approval --temps` for each, once the owner's plain words for
  that level are on record.
- Bad: a bot that holds the `restart` or `bot create` rule from 0.26.0 keeps
  it until the user says yes to taking it back. In the owner's fleet, Bot
  Father takes it back from every other bot after the release (the architect,
  2026-10-10).
- Bad: a bot that holds either rule by the user's yes, such as Bot Father, is
  named at every `rules build` and `up`.
- Good: a fleet made from this release on gives `restart` and `bot create`
  only to a bot the user said yes to.
- Old spellings refuse with a pointer, so a bot or a skill that still uses one
  learns the new command and nothing is dropped in silence.
- Revisit if: a harness adds an approval flag, or the kit's approval levels
  change. Confidence: high.

## History

- 2026-09-26, [ADR 0026](0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md)
  and [ADR 0029](0029-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md):
  permission rules allowed and taken back through `bot change --allow` and
  `--disallow` (#344, #360).
- 2026-10-10, [ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md):
  permission changes moved into `obk permission`, and the risky commands named
  (#527).
- 2026-10-10: `restart` and `bot create` kept back for the user's yes, on the
  owner's decision that only Bot Father runs them; a bot that still holds
  either rule is named, not changed (#548).
