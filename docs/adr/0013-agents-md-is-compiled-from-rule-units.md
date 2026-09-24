# ADR 0013: `AGENTS.md` is compiled from rule units

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19. Consulted: the coordinator, who proposed the mechanism, and a reviewer subagent, who found the `CLAUDE.md` gap.
Supersedes: [ADR 0003](0003-agents-md-is-compiled-from-rule-units.md).

## Context

Each bot starts as if its folder were the root of a project, with its own
instructions shared by all of its sessions. The owner asked for a bot's
`AGENTS.md` to be "built from the rules that user configure, so that some
common rules the kit provide can be given to all bots and the user can
customise in a good way" (the owner's design session, 2026-09-19, not in the
repo).

Two harnesses have to read the same instructions, and they find them
differently. Codex reads `AGENTS.md` from the project root down to the working
folder, stops at a git root, and caps the total at 32 KiB. Claude Code reads
`AGENTS.md` directly only when there is no `CLAUDE.md` or `CLAUDE.local.md` in
the folder or above it, and not on Bedrock or with telemetry off (both from the
harnesses' documentation, 2026-09-19, Claude Code 2.1.277 onwards; tech notes).
A `CLAUDE.md` that is a link to `AGENTS.md` works in every case.

Always-on text costs tokens on every turn, where a skill is loaded only when it
is needed. The owner kept his own working rules in a user-level rules file, and
said he intends to cut it down and eventually remove it. The kit is not only
for him.

## Decision

A bot's `AGENTS.md` is built from rule units: the kit's common rules, the
user's own rules, and per-bot overrides, plus the bot's charter. Defaults set
what every bot gets. The build writes a marked region; text outside it is
kept; a hand edit inside it stops the build and shows the conflict.
`CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`. The kit does not
rely on any user-level rules file.

## Alternatives considered

- **`AGENTS.md` alone, with no `CLAUDE.md`.** The owner's first call, since
  Claude Code now reads `AGENTS.md`. Not chosen because a reviewer found that
  Claude Code skips it without a word when a `CLAUDE.md` exists anywhere above
  the bot folder, or when telemetry is off, and a bot that runs without its
  rules is the worst kind of failure. A health check that warns about both
  cases was offered with it and did not change that.
- **A one-line `CLAUDE.md` that imports `AGENTS.md`.** The reviewer's
  suggestion and the coordinator's recommendation: it always works, at the cost
  of one more generated file per bot. The owner chose the symlink instead: "dont
  make it so hard, then softlink it to agents.md as before".
- **Rely on the user's own user-level rules, and have the kit's rules not
  repeat them.** The coordinator proposed it. The owner turned it down: he
  plans to "streamline a LOT" of his global rules and to delete them in the end,
  and "The kit is not only used by me."
- **A principles skill in place of always-on rules.** Proposed alongside. The
  owner chose to divide the two as suggested: a short always-on set in
  `AGENTS.md`, the depth in skills, and no separate principles skill (PRD 6.6).
- A generated whole file that overwrites hand edits, and a `CLAUDE.md` that is
  a copy of `AGENTS.md`: not recorded as considered.

## Consequences

- Good: both harnesses read the same file, so two sessions of one bot cannot
  start from different rules.
- Good: the user edits outside the marked region freely, and a hand edit inside
  it is shown, never silently overwritten.
- Bad: rule text from the kit ends up as generated text in the user's repo.
  This is the one exception to "no kit content is copied".
- Bad: every always-on line is paid for on every turn, so only a short set of
  always-on rules belongs here; depth lives in skills.
- Revisit if: both harnesses read `AGENTS.md` reliably without a link, or a
  harness reads a different file. Confidence: high, since the link works on
  both harnesses and the failure it avoids is silent. (Proposed in #262; not
  recorded when it was decided.)
- Checked by: `rules build` writes nothing and reports the conflict when a
  hand edit is inside the region, and reports a `CLAUDE.md` in the bot folder
  that is not the link to its `AGENTS.md` (`test/rules-build.test.js`).

## History

- 2026-09-19, [ADR 0003](0003-agents-md-is-compiled-from-rule-units.md):
  decided as above, by the owner in his design session. It named
  `defaults.yaml` as the source of the defaults.
- 2026-09-20, [ADR 0003](0003-agents-md-is-compiled-from-rule-units.md):
  wording only, "`defaults.yaml` sets" became "Defaults set", when the owner
  asked for decisions to state their intent and boundary without naming
  mechanisms (#85, following #84).
- 2026-09-24, this record: the decision is unchanged. It is written again in
  the format the kit now uses, with its alternatives, and replaces ADR 0003
  (#262).
