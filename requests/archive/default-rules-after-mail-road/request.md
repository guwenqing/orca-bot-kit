# default-rules-after-mail-road
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-17 the owner's words, snapshot origin/2026-10-17-owner-words.md

## Organized requirement

R1: The kit's default set of permission rules MUST NOT hold `Bash(orca orchestration check --run:*)`, or its Codex form. Orca's mail notice names that command, but the kit's rules tell every bot to read its mail with `obk message check` and never with the bare check, which leaves the mail unread (#555). No kit command or rule needs a bot to run it. No other rule joins or leaves the set. Amends: [PRD-11]
R2: A bot whose `allow` still holds a rule that kit 0.26 gave every bot and that is no longer in the set MUST keep it, in bot.yaml and in its harness files, as for `restart` and `bot create` (#548). `rules build` and `up` MUST name each such bot and rule, with the exact `obk permission disallow` command that takes it back. Besides the rules of `restart` and `bot create`, these are the rules of `obk session mail` and `obk session nudge`, which #555 removed from the kit, and the rule of R1. Amends: [PRD-11]
R3: `obk permission disallow` MUST take back each rule of R2, after the user's yes, as it takes back any rule the user allowed. Amends: [PRD-11]

Assumed: the notice in R2 is the one #548 prints ("<bot> holds <rule>, which is no longer one of the kit's defaults. To take it back: …"). The kit spells each rule with its own path and the bots folder, as the default set spelled it. A bot that still holds the rule of R1 is allowed the bare check until the user takes it back; the kit's rules still tell it not to run it.
Out: the kit taking any of these rules back by itself; a rule that forbids the bare check; any change to rules/mail.md or to how `obk message check` reads mail.
Signed off: 2026-10-17 owner, origin/2026-10-17-signoff.md

## Outcome

- R1 The kit's default set of permission rules MUST NOT hold `Bash(orca orchestration check --run:*)`, or its Codex form. Orca's mail notice names that command, but the kit's rules tell every bot to read its mail with `obk message check` and never with the bare check, which leaves the mail unread (#555). No kit command or rule needs a bot to run it. No other rule joins or leaves the set.: in [PRD-11]
- R2 A bot whose `allow` still holds a rule that kit 0.26 gave every bot and that is no longer in the set MUST keep it, in bot.yaml and in its harness files, as for `restart` and `bot create` (#548). `rules build` and `up` MUST name each such bot and rule, with the exact `obk permission disallow` command that takes it back. Besides the rules of `restart` and `bot create`, these are the rules of `obk session mail` and `obk session nudge`, which #555 removed from the kit, and the rule of R1.: in [PRD-11]
- R3 `obk permission disallow` MUST take back each rule of R2, after the user's yes, as it takes back any rule the user allowed.: in [PRD-11]
- Added: none
- Modified: [PRD-11]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: 0048
- ADRs superseded: 0047

Notes:
