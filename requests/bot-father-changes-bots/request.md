# bot-father-changes-bots
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-17 the owner's words, snapshot origin/2026-10-17-owner-words.md

## Organized requirement

R1: The kit's default set of permission rules MUST NOT hold the rules of `obk bot change`, `obk session add` and `obk session change`, or their Codex forms. They keep the user's yes, as `restart` and `bot create` do (#548). No other rule joins or leaves the set. Amends: [PRD-11]
R2: A bot whose `allow` still holds one of these rules MUST keep it, in bot.yaml and in its harness files, as for `restart` and `bot create` (#548, #564). `rules build` and `up` MUST name each such bot and rule, with the exact `obk permission disallow` command that takes it back. Amends: [PRD-11]
R3: `obk permission disallow` MUST take back each rule of R1, after the user's yes, as it takes back any rule the user allowed. Amends: [PRD-11]

Assumed: the notice in R2 is the one #548 and #564 print ("<bot> holds <rule>, which is no longer one of the kit's defaults. To take it back: …"). The kit spells each rule with its own path and the bots folder, as the default set spelled it. Bot Father keeps the three as held rules, and `rules build` and `up` name them for Bot Father too, as they do for `restart` and `bot create`. No kit rule or skill tells a bot other than Bot Father to run the three.
Out: the kit taking any rule back by itself (Bot Father takes the rules back from the other bots, after the release); `obk temp make` and the other temp commands, which stay in the set.
Signed off: 2026-10-17 owner, origin/2026-10-17-signoff.md
