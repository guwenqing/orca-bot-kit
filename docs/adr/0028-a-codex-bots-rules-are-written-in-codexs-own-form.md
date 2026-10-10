# ADR 0028: A Codex bot's permission rules are written in Codex's own form, from the same yes

Date: 2026-09-26.
Status: superseded by [ADR 0039](0039-a-codex-bots-rules-are-written-in-codexs-own-form.md).
Decided by: the owner, on 2026-09-26, for a Codex bot getting the same default rules and charter grants as a Claude bot ("regardless if it is claude or codex … even if codex, we prepare it", #354); the architect, on 2026-09-26, for `allow` staying the one record in Claude Code's text with the Codex form made from it, for a file the kit owns whole, for saying so where a rule has no Codex form, and for the system test's own sandbox settings. The owner may overrule the architect's parts.

## Context

[ADR 0026](0026-the-kit-writes-a-bots-permission-rules-after-the-users-yes.md)
gave every Claude bot a default set of rules and
[ADR 0027](0027-a-charters-grants-become-exact-permission-rules.md) the rules
its charter grants. Both keep the user's yes in `bot.yaml`'s `allow`, as
Claude Code's rule text, and both left Codex to #354.

A Codex bot at the kit's `auto` level (`--approve-for-me`) runs in Codex's
`workspace-write` sandbox and sends what the sandbox stops to Codex's own
reviewer. The sandbox lets it read every file but write only its bot folder,
`/tmp` and `$TMPDIR` (the rollout's `permission_profile`). A long message's
body kept beside the bots folder, a commit into the bots repo's `.git` above
the bot folder, and the mail through Orca all reach outside that.

Codex has rules of its own: `prefix_rule(pattern=[…], decision=…)` lines in
`.rules` files, read from `~/.codex/rules/` and from a trusted project's
`.codex/rules/` (Codex's rules and advanced-config docs). Seen live on
2026-09-26, Codex 0.157.1 (tech notes, section 3): a bot folder's
`.codex/rules/*.rules` is read by the TUI the kit starts there, below the bots
repo's git root; `forbidden` blocks a command, and `allow` runs one outside
the sandbox with no review.

## Decision

A bot that runs on Codex, by its own harness or any session's, gets its rules
in `.codex/rules/obk.rules` in its bot folder. The kit owns that file whole:
`rules build`, `up` and `bot change --allow` rewrite it from `allow`, and it
holds nothing else. The kit writes no other file in `.codex/rules/`, so a
`default.rules` of the user's or of Codex's own is never touched; health names
each rule in such a file, and says it stays.

`allow` stays the one record of the yes, in Claude Code's text. The Codex form
is made from it:

- `Bash(<words>:*)`, or `Bash(<words> *)`, the words plain as ADR 0027 reads
  them, becomes `prefix_rule(pattern=[<words>], decision="allow")`, one word
  per string.
- `Read(...)` needs nothing: Codex's sandbox reads every file already. So a
  bot that runs only on Codex is not offered the default Read rule.
- Anything else has no Codex form, and the kit says so rather than write a
  looser rule: `Edit` and `Write`, a Bash rule for one exact command (a prefix
  rule would let any arguments after it), and a wildcard anywhere but the end.
  `--allow` refuses such a rule for a bot that runs only on Codex; for a bot
  that runs on both, it is written for Claude Code only.

Codex reads rules when a session starts, so a rule allowed while a Codex
session runs reaches that session at its next start; `--allow` says so.

Codex ignores an untrusted project's `.codex/` layers (its docs). A kit
session always runs in a trusted one: Codex's trust screen offers only to
trust the repository root or to quit, and the kit's hook in the same layer
works only once it is trusted. This is from the docs and that screen, not a
live test: `codex exec` records its own folder as trusted in the user's
config, so an untrusted project cannot be tried with it.

## Alternatives considered

- **Merging into `default.rules` line by line, as the Claude settings file
  is.** Not chosen: Codex's conventional file may be written by the user or by
  Codex, and a file of the kit's own needs no merging and is never mistaken
  for theirs (the architect).
- **A harness-neutral form in `allow`.** Not chosen: ADR 0026 kept Claude
  Code's text, which is what the user is shown, and every rule the kit and Bot
  Father spell has a Codex form or needs none.
- **Writing a prefix rule for an exact command.** Not chosen: it lets the bot
  run the command with anything after it, which the user did not say yes to.
- **Widening the sandbox for `Edit` and `Write` grants** (`writable_roots`).
  Not chosen: loosening the sandbox is out ([ADR 0015](0015-three-approval-levels-auto-by-default.md)).
- **Writing to `~/.codex/rules/`.** Not chosen: that is the user's own config,
  and it would reach every Codex session they run.

## Consequences

- Good: a Codex bot reads and sends its mail, commits, and runs what its
  charter grants without the sandbox stopping it or the reviewer being asked,
  once the user has said yes to each exact rule.
- An allowed command runs outside the sandbox, as the user's own Codex rules
  do. That is what the rule is for, and why each is narrow.
- A hand edit to `obk.rules` is lost at the next build. Rules of the user's own
  go in another file in the same folder, where health names them and leaves
  them.
- A charter grant that is not a command, such as editing a folder outside the
  bot's, still goes to Codex's reviewer.
- The system test's Codex sessions shut `/tmp` and `$TMPDIR` out of the
  sandbox with extra arguments, because its throwaway bots folder lives there
  and a real one does not. The product's launch line is unchanged.

## History

- 2026-09-26: recorded for #354 (slice C of #344: Codex).
