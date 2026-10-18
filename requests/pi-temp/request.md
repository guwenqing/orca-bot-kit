# pi-temp
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-18 the owner's words, snapshot origin/2026-10-18-owner-words.md

## Organized requirement

R1: A temporary session MUST be able to run on Pi, as on Claude Code or Codex. `obk temp make` takes Pi from `--harness pi`, from a role's option, or from the maker's own harness. The new session gets its own tab, work dir and mailbox, and its model, effort, name and start prompt. Every Pi session runs as `dangerously-skip`, so when the maker's own approval is narrower, `temp make` MUST refuse and say why, unless the user allowed `dangerously-skip` for the bot's temporary sessions with `obk permission approval --temps`. `obk temp retire` retires a Pi temporary session as it retires any other. A first-run screen that Pi shows in a new tab MUST be known to the kit: `obk temp answer` answers it, or says what it is. Amends: [PRD-11]

Assumed: this is slice 3 of #547 (#648). A Pi temporary session takes the maker's model and effort only when the maker is on Pi too, as for the other harnesses. The other refusals of a Pi session hold for a temporary one too: a start prompt that begins with `@`, a context setting, and the extra arguments `--approve` and `-a`. The facts are from Pi 1.3.0 and Orca 1.4.225.
Out: rules and skills for Pi, health of a Pi session, the book following a `/new` in a Pi tab, and `session change --harness pi`: later slices of #547.
