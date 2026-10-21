# pi-compact
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-20 the owner's words, snapshot origin/2026-10-20-owner-words.md

## Organized requirement

<!-- R1 from:2026-10-20-owner-words.md -->

### R1 obk session compact types /compact into a Pi tab
`obk session compact` on a Pi session MUST compact its conversation by typing Pi's own `/compact` into its tab, with the same care as on Claude Code and Codex, and as `obk session clear` takes for `/new` in a Pi tab: it waits for the session to be idle with nothing to answer, types nothing over a draft, types one character at a time, and checks that the screen shows `/compact` and the menu's selected row names `compact`. Then it types one space, and presses Return only when the screen shows `/compact` and no menu. Otherwise it takes back what it typed. A menu row still drawn from an earlier key MUST NOT run a command other than `/compact`. The kit MUST confirm the compact by Pi's own record of the conversation, a compaction written after the command was typed, within 5 minutes, or say that it is not confirmed yet. It MUST read nothing that holds a credential, write nothing into `~/.pi/agent`, and delete nothing in Pi's session store. Amends: KIT-28

Assumed: this is a follow-up of #663, part of #547 (#671). Pi 1.3.0 lists `/compact` in its slash menu, and a compaction writes a line `{"type":"compaction","timestamp":…}` into the conversation's session file, `~/.pi/agent/sessions/--<folder>--/<time>_<id>.jsonl` (read in code). These facts are from Pi 1.3.0, and a live run in a throwaway Orca tab at night checks them. No command, option or setting is added.
Out: a fix for Orca's own restore of a Pi tab, and Pi's automatic compaction.
Signed off: 2026-10-20 owner, origin/2026-10-20-signoff-2.md

## Outcome

Concluded 2026-10-21 with al conclude, on the working tree at fa78276.

- R1 obk session compact types /compact into a Pi tab, version 2, signed in S2:
  - KIT-28 rule: in docs/prd/prd.md, serves it
- Not known: whether the code, tests and documents do what the paragraphs say; whether the work has ended: the tool does not take a merged task or a reconciled spec as evidence of that.
