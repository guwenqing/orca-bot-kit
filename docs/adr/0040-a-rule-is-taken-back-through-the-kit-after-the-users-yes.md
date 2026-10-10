# ADR 0040: A rule is taken back through the kit, after the user's yes, and only one the kit wrote

Date: 2026-10-10.
Status: accepted.
Decided by: the owner, on 2026-09-26, for a bot keeping only the rules its charter grants ("charter decides what are needed"), for a rule being taken back only after the user's yes and by the kit's code, and for an entry the user added by hand staying theirs (#360); developer-2, on 2026-09-27, for refusing a rule `allow` does not hold, and for not taking back and allowing in one command; the owner, on 2026-10-10, for the command being `obk permission disallow` (#527), and the architect, on 2026-10-10, for refusing a default rule. The architect or the owner may overrule the parts that are not the owner's.
Supersedes: [ADR 0029](0029-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md).

## Context

[ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md)
keeps every rule a bot is allowed in `bot.yaml`'s `allow`, the kit's default
set included, and the kit's code writes it into the bot's
`.claude/settings.json`.
[ADR 0038](0038-a-charters-grants-become-exact-permission-rules.md) lets a
charter's grants in the same way, and
[ADR 0039](0039-a-codex-bots-rules-are-written-in-codexs-own-form.md) makes
Codex's `.codex/rules/obk.rules` from the same list. `allow` only grew: a rule
a new charter no longer grants stayed in both files until someone edited them
by hand, which the kit's rules tell every bot not to do.

## Decision

`obk permission disallow --rule <rule>`, once per rule, takes back rules the user
has said yes to taking back. Bot Father offers it after a charter change for
each rule the new charter no longer grants, shows the rule word for word, and
runs it only after the user's yes; on a no it runs nothing.

It takes each rule out of `allow`, keeping the rest of `bot.yaml` as it was.
For a bot that runs on Claude Code it takes every entry of that exact text out
of `permissions.allow` in the settings file and changes nothing else there,
adding nothing either. For a bot that runs on Codex it rewrites `obk.rules`
from what `allow` still holds.

Only a rule `allow` holds, spelled exactly as it is there, is taken back. Any
other is refused, and nothing is changed: the kit did not write it, and an
entry the user added by hand stays theirs. A settings file the kit could not
safely write is refused as `permission allow` refuses it, and so is one it may not
write at all. Everything is checked before anything is written, the edit to
`bot.yaml` included, and `bot.yaml` is written after the harnesses' files, so
a write that fails leaves the rule in `allow` and the same command takes it
back again.

A rule of the kit's default set is refused, and nothing is changed: the kit
writes it again at the next rules write
([ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md)), so
taking it back would look done and not be. Allowing and taking back are two
commands, `permission allow` and `permission disallow`
([ADR 0037](0037-permission-changes-and-risky-operations-have-commands-of-their-own.md)),
so one run never does both.

## Alternatives considered

- **Taking out of the files whatever `allow` no longer holds, at every build.**
  Not chosen: the kit cannot tell an entry it wrote from the user's once
  `allow` no longer names it, and a hand edit to `bot.yaml` would then remove
  a rule from the settings with no yes.
- **Doing nothing for a rule `allow` does not hold, and succeeding.** Not
  chosen: a misspelled rule would look taken back while the bot is still
  allowed it.
- **Allowing and taking back in one command.** Not chosen: nothing needs both
  at once, and one at a time keeps what each run changed plain.
- **Taking back a default rule and remembering it, so the kit does not write
  it again.** Not chosen: it adds a second list to `bot.yaml` that nobody has
  asked for; the owner wants the kit's own commands allowed for every bot
  (#527).
- **Taking back a default rule as before, to wait for the user's yes.** Not
  possible any more: nothing waits for a yes, and the next rules write adds it.

## Consequences

- Good: a bot keeps only the rules its charter grants, once the user says so,
  and no model edits a settings file.
- A running Codex session keeps a rule taken back until its next start, as it
  gets a new one then.
- A rule the user added to a settings file by hand is still theirs to take
  out; the refusal names the file.
- Bad: a bot cannot be kept from one of the kit's default rules through the
  kit. Revisit if a user needs that.

## History

- 2026-09-27, [ADR 0029](0029-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md):
  recorded for #360, with `bot change --disallow` as the command, and a
  default taken back waiting for the user's yes again.
- 2026-10-10: the command is `obk permission disallow`, and a default rule is
  refused (#527).
