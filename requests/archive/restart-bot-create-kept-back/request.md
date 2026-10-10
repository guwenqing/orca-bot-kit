# restart-bot-create-kept-back
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-10 the owner's words, snapshot origin/2026-10-10-owner-words.md

## Organized requirement

R1: `obk restart` and `obk bot create` MUST NOT be in the kit's default set of permission rules. They keep the user's yes, as `init`, `retire` and `pause` do: `restart` closes a long-lived session, and the owner decided on 2026-10-10 that only Bot Father runs `restart` and `bot create`. No other command joins or leaves the set. Amends: [PRD-11]
R2: A bot whose `allow` still holds one of the two rules MUST keep it, in bot.yaml and in its harness files. The kit cannot tell the entry it wrote as a default (0.26.0) from a user's yes to the same rule, so it takes back neither. `rules build` and `up` MUST name each bot that holds one, with the exact `obk permission disallow` command that takes it back. Amends: [PRD-11]
R3: `obk permission disallow` MUST take back either rule, after the user's yes, as it takes back any rule the user allowed. It still refuses a rule that is still in the default set. Amends: [PRD-11]

Assumed: the notice in R2 states a fact that stays true after a later yes ("<bot> holds <rule>, which is no longer one of the kit's defaults. To take it back: …"), and does not say the rule is wrong. `init`, `restart` and `unpause` print it too, because they write the rules through the same code as `up`. In the owner's fleet, Bot Father takes the two rules back from every bot but itself after the release, with that command (the architect, 2026-10-10, ruling D on #548, which replaces the issue's boundary item 2).
Out: the kit taking the two rules back by itself; a record of which rules the kit wrote; a special case for Bot Father in the code; a general way for a fleet to exclude any default.
Signed off: 2026-10-10 owner, origin/2026-10-10-signoff.md

## Decisions

- D1, 2026-10-10. Source: the architect, 2026-10-10, in the kit-dev architect's session, on developer-548's question. Ruling D replaces the issue's boundary item 2. The kit takes neither rule back by itself: in bot.yaml allow, the entry 0.26.0 wrote as a default and a user's yes to the same rule are the same text, and in the owner's fleet Bot Father held both rules by the owner's yes before 0.26.0 (bots repo, b25a851^). PRD-11 (#360) keeps a rule the user said yes to theirs, so when the kit cannot tell, it names the rule and the disallow command and removes nothing. No record of the defaults the kit wrote, and no special case for Bot Father. Bot Father takes the two rules back from the other bots after the release. The result for the fleet is the same as the issue's, so it needs no new yes from the owner.

## Outcome

- R1 `obk restart` and `obk bot create` MUST NOT be in the kit's default set of permission rules. They keep the user's yes, as `init`, `retire` and `pause` do: `restart` closes a long-lived session, and the owner decided on 2026-10-10 that only Bot Father runs `restart` and `bot create`. No other command joins or leaves the set.: in [PRD-11]
- R2 A bot whose `allow` still holds one of the two rules MUST keep it, in bot.yaml and in its harness files. The kit cannot tell the entry it wrote as a default (0.26.0) from a user's yes to the same rule, so it takes back neither. `rules build` and `up` MUST name each bot that holds one, with the exact `obk permission disallow` command that takes it back.: in [PRD-11]
- R3 `obk permission disallow` MUST take back either rule, after the user's yes, as it takes back any rule the user allowed. It still refuses a rule that is still in the default set.: in [PRD-11]
- Added: none
- Modified: [PRD-11]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: D1
- Agent rulings: none
- ADRs added: 0041
- ADRs superseded: 0037

Notes:
