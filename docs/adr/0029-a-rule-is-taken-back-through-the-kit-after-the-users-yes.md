# ADR 0029: A rule is taken back through the kit, after the user's yes, and only one the kit wrote

Date: 2026-09-27.
Status: superseded by [ADR 0040](0040-a-rule-is-taken-back-through-the-kit-after-the-users-yes.md).
Decided by: the owner, on 2026-09-26, for a bot keeping only the rules its charter grants ("charter decides what are needed"), for a rule being taken back only after the user's yes and by the kit's code, and for an entry the user added by hand staying theirs (#360); developer-2, on 2026-09-27, for the `--disallow` flag, for refusing a rule `allow` does not hold, and for not taking `--allow` and `--disallow` in one command. The architect or the owner may overrule developer-2's parts.

## Context

[ADR 0026](0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md)
keeps the user's yes to each permission rule in `bot.yaml`'s `allow`, and the
kit's code writes it into the bot's `.claude/settings.json`.
[ADR 0027](0027-a-charters-grants-become-exact-permission-rules.md) lets a
charter's grants in the same way, and
[ADR 0028](0028-a-codex-bots-rules-are-written-in-codexs-own-form.md) makes
Codex's `.codex/rules/obk.rules` from the same list. `allow` only grew: a rule
a new charter no longer grants stayed in both files until someone edited them
by hand, which the kit's rules tell every bot not to do.

## Decision

`obk bot change --disallow <rule>`, once per rule, takes back rules the user
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
safely write is refused as `--allow` refuses it, and so is one it may not
write at all. Everything is checked before anything is written, the edit to
`bot.yaml` included, and `bot.yaml` is written after the harnesses' files, so
a write that fails leaves the rule in `allow` and the same command takes it
back again.

A kit default taken back waits for the user's yes again, as a default not yet
allowed does. `--allow` and `--disallow` in one command are refused.

## Alternatives considered

- **Taking out of the files whatever `allow` no longer holds, at every build.**
  Not chosen: the kit cannot tell an entry it wrote from the user's once
  `allow` no longer names it, and a hand edit to `bot.yaml` would then remove
  a rule from the settings with no yes.
- **Doing nothing for a rule `allow` does not hold, and succeeding.** Not
  chosen: a misspelled rule would look taken back while the bot is still
  allowed it.
- **`--allow` and `--disallow` together.** Not chosen: nothing needs both at
  once, and one at a time keeps what each run changed plain.

## Consequences

- Good: a bot keeps only the rules its charter grants, once the user says so,
  and no model edits a settings file.
- A running Codex session keeps a rule taken back until its next start, as it
  gets a new one then.
- A rule the user added to a settings file by hand is still theirs to take
  out; the refusal names the file.

## History

- 2026-09-27: recorded for #360.
