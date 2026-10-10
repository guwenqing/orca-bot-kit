# ADR 0038: A charter's grants become exact permission rules, and broad rules stay the user's

Date: 2026-10-10.
Status: accepted.
Decided by: the owner, on 2026-09-26, for a bot's charter deciding which rules it needs and the user's yes before any is written (#344, #353); the architect, on 2026-09-26, for Bot Father listing the rules and slice A's `bot change --allow` (now `permission allow`) recording them with no second list, for it refusing broad rules and leaving them to the user by hand, for health's neutral wording about those, and for a charter change naming the rules allowed now. The owner may overrule the architect's parts. The exact line between narrow and broad is developer-1's, for #353. The owner, on 2026-10-10, for the rules being recorded by `obk permission allow` rather than `bot change` (#527).
Supersedes: [ADR 0027](0027-a-charters-grants-become-exact-permission-rules.md).

## Context

kit-dev's charter says it "merges and closes issues without asking". Auto mode
still refused `gh pr merge` three times on PR #334, until the owner added
`Bash(gh pr merge:*)` and `Bash(gh issue close:*)` to the bot's settings by
hand (#344). [ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md)
gives every bot a default set of rules, kept in `bot.yaml`'s `allow` and
written by the kit's code. A charter's grants go beyond that set (#353).

The owner, 2026-09-26: "charter decides what are needed, for safety you should
ask user to allow it". The issue keeps the rules narrow and exact: broad rules
(`Bash(*)`, an interpreter with any argument) and rules for what no charter
grants are out, unless the user adds them for that bot themselves.

A charter is the user's own words, and no code can read a rule out of them.
Claude Code settles a matching allow rule before its auto-mode check, and
suspends broad ones such as `Bash(*)` in auto mode (its permissions and
auto-mode docs).

## Decision

Bot Father reads the charter, when it is written and whenever it changes, and
lists the exact rules it grants, spelled as the bot will run each command: the
kit by the path the bot's rules give it, every folder absolute. It shows them
to the user word for word, with a line on what each lets the bot do, and only
after their yes runs `obk permission allow` with the rules they said yes to.
On a no it runs nothing. The skill that guides Bot Father says so; the kit
keeps no second list of proposed rules.

`permission allow` refuses a broad rule, says why, and writes nothing. Broad is a rule that lets the bot run
any command or any file on the disk:

- a Bash rule with no command, or with fewer than two words before its first
  wildcard (`Bash(*)`, `Bash(gh:*)`, `Bash(git * main)`);
- a shell or an interpreter with a wildcard, unless the word after it is a
  fixed script by its absolute path, with no wildcard in it and itself no
  shell, interpreter or wrapper (`Bash(python3 -c:*)`, `Bash(npx prettier:*)`
  are broad; `Bash(python3 /abs/tool.py:*)` is not);
- a command wrapper such as `env` or `sudo` with a wildcard, unless the word
  after it is a fixed program by its absolute path, and then the rest of the
  rule, from that program on, is judged by these same lines
  (`Bash(env /bin/sh -c:*)` and `Bash(env /usr/bin/git:*)` are broad;
  `Bash(env /abs/tool.sh run:*)` is not);
- `Read`, `Edit` or `Write` with no path, or on the whole disk or the whole
  home (`Edit(//**)`, `Write(~/**)`).

A Bash rule is read as shell words, quotes keeping a space inside one word,
and judged from its program, the first word after any shell assignments in
front of it: `Bash(X="a b" gh:*)` is broad. A shell or interpreter with a
version on its name, such as `python3.12`, is that shell or interpreter.

`permission allow` also refuses a Bash rule that is not plain words, naming the
character: outside quotes a word holds only letters, digits, `-_./:=@%+,^`, a
`~` at its start, `*` as the wildcard, and `\'` for an apostrophe (the form
the kit quotes one with in a path); inside double quotes no `$`, backtick or
backslash; and every quote closes. An escape, an expansion, a glob or a
second command could otherwise hide which program runs (`Bash(/bin/s\h -c:*)`
runs `/bin/sh`), and chasing each such trick one by one would never end.

A user who wants such a rule for a bot adds it to that bot's settings file
themselves. Health still names it, as it names every entry the kit did not
write, and says only that the user added it and not the kit, and that it stays.

`bot change --charter` names the rules the bot is allowed now beyond the
kit's defaults, says they stay allowed until the user takes them out, and that
no new one is written until the user answers, through `obk permission allow`.
A charter change writes no rule.

Codex's form of these rules is
[ADR 0039](0039-a-codex-bots-rules-are-written-in-codexs-own-form.md)'s.
Why the rules are written by a `permission` command of their own, and not by
`bot change`, is
[ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md).

## Alternatives considered

- **A `grants` list in `bot.yaml`, set by a `--grant` flag, shown as waiting
  like the defaults.** Not chosen: Bot Father would still spell the rules, so a
  second list and a new flag add code without making them more exact. The
  owner's "the kit script does the change" is met by the kit's command doing the
  writing (the architect).
- **The kit reading rules out of the charter.** Not chosen: a charter is the
  user's prose, and a guessed rule is not an exact one.
- **Accepting broad rules on `permission allow`.** Not chosen: the boundary leaves them
  to the user by hand, and a model passing one on by mistake is refused.
- **Reading every shell escape and expansion to find the program.** Not
  chosen: each review round found another one (a wrapper, a quoted
  assignment, a backslash); refusing what is not plain words ends the class,
  and a narrow rule a charter grants is plain words.
- **Calling a hand-added broad rule broad or unsafe in health.** Not chosen:
  it is the user's rule, and they chose it (the architect).
- **Taking back a rule a new charter no longer grants.** Not in this slice;
  [ADR 0040](0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md)
  decides it.

## Consequences

- Good: a bot runs what its charter grants without the auto-mode check
  stopping it, once the user has said yes to each exact rule.
- Good: a model's mistake that would grant any command is refused by code.
- The line refuses some narrow-enough rules, such as `Bash(make:*)` or
  `Bash(npx prettier:*)`; the user adds those by hand, and health names them
  neutrally.
- A rule the old charter granted stays allowed after a charter change until
  the user takes it out; the change's report names it.
- Whether a rule is exact still rests on Bot Father spelling the command as
  the bot runs it; a rule spelled differently does not match and goes to the
  check, as in ADR 0036.

## History

- 2026-09-26, [ADR 0027](0027-a-charters-grants-become-exact-permission-rules.md):
  recorded for #353 (slice B of #344: Claude Code), with `bot change --allow`
  as the command.
- 2026-10-10: the command is `obk permission allow` (#527).
