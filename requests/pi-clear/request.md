# pi-clear
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-19 the owner's words, snapshot origin/2026-10-19-owner-words.md

## Organized requirement

R1: `obk session clear` on a Pi session MUST start a new conversation in its tab by typing Pi's own `/new`, with the same care as on Claude Code and Codex: it waits for the session to be idle with nothing to answer, types nothing over a draft, types one character at a time, presses Return only when the screen shows `/new` and nothing else, and takes back what it typed otherwise. It MUST confirm the clear by the new conversation in the book, and the new conversation gets the session's start prompt again. A Pi screen that says Pi is at work MUST count as busy wherever the kit types into a Pi tab. `obk session compact` on a Pi session MUST still type nothing, and say so plainly. Amends: [PRD-12]

Assumed: this is a follow-up of slice 6 of #547 (#663, after #662). The kit learns the new id through its own Pi extension, as in #662. Pi needs no turn after `/new`, so the kit types nothing after the Return. The screen facts are from Pi 1.3.0's own code and are checked in a live run in a throwaway Orca tab at night; the facts are from Pi 1.3.0 and Orca 1.4.225. With Pi's command menu open, Return runs the menu's selected command; the kit checks that this is `new`. A menu still drawn for an earlier part of `/new`, with `new` on top, looks the same on the screen, and the kit cannot tell it apart. The at-work check also means `obk skills build` waits on a busy Pi screen before it types `/reload`. No command, option or setting is added.
Out: `obk session compact` on Pi, and a fix for Orca's own restore of a Pi tab.
Signed off: 2026-10-19 owner, origin/2026-10-19-signoff.md
