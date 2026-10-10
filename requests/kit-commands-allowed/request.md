# kit-commands-allowed
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-10 the owner's words, snapshot origin/2026-10-10-owner-words.md

## Organized requirement

R1: Every bot MUST get a default set of permission rules from the kit's code, with nobody asked: each of the kit's own commands, narrowed to its CLI path and this bots folder, plus reading long messages, `git add`, `git commit` and Orca's `orca orchestration check --run`. A bot on Codex gets them in Codex's form. Amends: [PRD-11]
R2: The default set MUST NOT hold `init`, `retire`, `pause` or the permission commands (R4), nor any broad rule. They keep the user's yes. Amends: [PRD-11]
R3: `bot create`, `init`, `rules build` and `up` MUST write each default rule a bot does not have yet into its `bot.yaml` `allow` and its harness files, through the kit's existing writer, and MUST say which rules they wrote, for which bot. Amends: [PRD-11]
R4: Permission and approval changes MUST have commands of their own: `obk permission allow`, `obk permission disallow` and `obk permission approval`. They keep the user's yes. `bot change`, `session add` and `session change` then hold no permission or approval change, and are ordinary kit commands in the default set. Amends: [PRD-11]
R5: No command in the default set MAY widen an approval: `session add` and `session change` refuse `--approval`; they, `temp make` and `groom` refuse an extra argument that sets approval or permissions; `temp make` refuses an approval wider than its maker's own, unless the user allowed that level for the bot's temporary sessions through `obk permission approval --temps`. Amends: [PRD-11]
R6: An old spelling that moved (`bot change --allow`, `--disallow`, `session add --approval`, `session change --approval`) MUST refuse, name the new command, and change nothing. Amends: [PRD-11]
R7: `obk permission disallow` MUST refuse a rule of the default set, because the kit writes it again at its next rules write. Amends: [PRD-11]
R8: `bot change --role-cap <role>=<n>` sets or takes off a role's cap in `temp_roles`, as an ordinary `bot change` setting. Amends: [PRD-11]

Assumed: the permission commands are one group, `obk permission …`, so that one word names every command that grants or takes back a right (the developer's choice, which the issue left open). An allow rule stops only the harness's check; a bot's charter still says what it may do. The extra arguments refused are the ones the kit knows set approval or permissions on each harness; an extra argument the kit does not know, such as Claude's `--settings` or Codex's `-c` and `--profile`, can still change them, and is named as a known gap. A SendMessage rule goes in the default set only if Claude Code 2.1.296 settles SendMessage by an allow rule; the PR says what was found. kb and stockops make temporary sessions at dangerously-skip from an auto maker today; after the release each needs one `obk permission approval --temps` run by Bot Father, after Bot Father finds the owner's plain words for that level on record (the architect, 2026-10-10).
Out: rules outside the default set still need the user's yes to the exact rule, as before (#353); `obk session trust-hooks` and `session answer` (#506) stay a grant for Bot Father; the owner's own tools (`tools/alert`).
Signed off: 2026-10-10 owner, origin/2026-10-10-signoff.md

## Decisions

- D1, 2026-10-10. Source: developer-527, from Claude Code's docs (permission-modes, tools-reference, cross-session-messaging) and its 2.1.222 changelog, read 2026-10-10. No SendMessage rule is in the default set. The docs say the auto-mode classifier reviews every SendMessage before delivery and name no allow rule that settles it first, and SendMessage takes only the bare tool name, so a rule cannot be narrowed to the fleet's sessions and would be broad.
