# test-out-of-core
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-18 the owner's words, snapshot origin/2026-10-18-owner-words.md

## Organized requirement

R1: The kit's core, which is what the package ships (`src/`, `rules/`, `skills/`, `README.md` and `SETUP.md`), MUST hold only what a user of the kit uses. Anything that exists only for the kit's own tests MUST live outside the core, under `test/` or `scripts/`. Amends: [PRD-8]
R2: The kit MUST NOT have the `obk run` command, and `obk health` MUST NOT have the finding about rules that let `obk run` run any command. Nothing else that a user does with the kit changes. Amends: [PRD-8]
R3: The PRD MUST name, in one list, every `obk` command and every environment setting that the core reads. A check in CI MUST fail when the core has a command or a setting that the list does not name, or when the list names one that the core does not have. So a new command or setting needs an edit of the PRD and the owner's sign-off. Amends: [PRD-8]

Assumed: the settings that go are `OBK_PS`, `OBK_LSOF`, `OBK_STTY`, `OBK_OSASCRIPT` and `OBK_KILL` (they choose the program the kit runs for `ps`, `lsof`, `stty`, `osascript` and `kill`), and `OBK_POLICY_ROOT` (where health looks for the machine's policy files). `OBK_ORCA` and `OBK_ORCA_DATA` stay: SETUP.md names them for users. The tests reach their fakes from test code, and no test checks less than before. A new ADR replaces the decision of #532 and names the owner's words. AGENTS.md gets the rule in the owner's words: "Core is core and test is test." A bot may still hold an allow rule for `obk run`; the kit then names it as a rule for a command it no longer has, as it does for `session mail`. The check cannot see a new flag on a command that is already listed, or a test-only branch inside a command; the PR names these limits.
Out: the time limit for kit-dev's own live tests, which is a separate issue in `scripts/test-system.js`, outside the core. The line in kit-dev's charter, which is Bot Father's to write.
Signed off: 2026-10-18 owner, origin/2026-10-18-signoff.md
