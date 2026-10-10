# session-first-run
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-09 the owner's words, snapshot origin/2026-10-09-owner-words.md

## Organized requirement

R1: The user, an assistant of theirs, or a Bot Father session MUST be able to answer a long-lived session's first-run screen through the kit, with one command for each screen: `obk session trust-hooks` for Codex's `Hooks need review`, and `obk session answer` for Claude Code's `Teach auto mode` screen. Amends: [PRD-11]
R2: A session of any other bot that runs these commands MUST be refused, with Bot Father named and nothing typed. A temporary session's screen stays its maker's to answer, with the temp commands. Amends: [PRD-11]
R3: These commands MUST make the same checks as the temp commands: read the screen, answer only the exact shapes the kit knows, with arrows and a return and never a digit, refuse any other screen and say what it saw, and check afterwards that the screen went. Amends: [PRD-11]
R4: Before the kit trusts a session's hooks, for a long-lived session or a temporary one, it MUST check that the hooks the review covers are the kit's own. A hook in the bot's `.codex/hooks.json` that the kit did not write MUST be refused. The count on the screen MUST be the number of the kit's own hooks that Codex does not trust yet; any other count MUST be refused. Where the kit cannot tell, it MUST refuse. Amends: [PRD-11]

Assumed: the kit's shipped defaults add no permission rule for the new commands; the owner is asked for the exact rules after the merge. SETUP.md section 5 and the obk-bot-building skill point at the new commands for long-lived sessions; the table of keys stays for the screens the kit does not answer.
Out: any other first-run screen; any change to what the temp commands answer.
Signed off: 2026-10-10 owner, origin/2026-10-10-signoff.md

## Outcome

- R1 The user, an assistant of theirs, or a Bot Father session MUST be able to answer a long-lived session's first-run screen through the kit, with one command for each screen: `obk session trust-hooks` for Codex's `Hooks need review`, and `obk session answer` for Claude Code's `Teach auto mode` screen.: in [PRD-11]
- R2 A session of any other bot that runs these commands MUST be refused, with Bot Father named and nothing typed. A temporary session's screen stays its maker's to answer, with the temp commands.: in [PRD-11]
- R3 These commands MUST make the same checks as the temp commands: read the screen, answer only the exact shapes the kit knows, with arrows and a return and never a digit, refuse any other screen and say what it saw, and check afterwards that the screen went.: in [PRD-11]
- R4 Before the kit trusts a session's hooks, for a long-lived session or a temporary one, it MUST check that the hooks the review covers are the kit's own. A hook in the bot's `.codex/hooks.json` that the kit did not write MUST be refused. The count on the screen MUST be the number of the kit's own hooks that Codex does not trust yet; any other count MUST be refused. Where the kit cannot tell, it MUST refuse.: in [PRD-11]
- Added: none
- Modified: [PRD-11]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: none
- ADRs superseded: none

Notes:
