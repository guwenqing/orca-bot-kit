# ADR 0061: A part that Claude Code adds by itself, and that the recipe names, stays out of the kit's main text

Date: 2026-11-16.
Status: accepted.
Decided by: the architect, on 2026-11-16, for path 0, the reading of R5 below, a recipe that names such a part only when it does not guard safety, and health's two states on the session's line (#784), after the reviewer's safety read. The architect or the owner may overrule.
Builds on: [ADR 0055](0055-the-kit-trims-what-a-claude-code-session-is-sent.md), section 4.

## Context

The kit builds a Claude Code session's main text from Claude Code's own text, as a transcript recorded it, less the units that its recipe cuts (ADR 0055, section 4). The session gets that text by `--system-prompt-file`.

After a replaced main text, Claude Code adds some parts by itself, each for a tool that the session has. The tech notes said this of the Artifact tool's paragraph, and PR #783 accepted it for a bot that keeps Artifact. The live check of #769 showed more (2026-11-16, Claude Code 2.1.325, Haiku): after the kit's main file, Claude Code added the WebSearch tool's paragraph and the section on the Chrome extension. The kit's file held both too. So the session got each part two times, and its main text was 3,671 characters longer than Claude Code's own.

Which parts come back depends on the model, the Claude Code version and the tools of the session. A fenced probe cannot show all of them: the stand-in API is not the first-party API, and the fence has no Chrome extension. So the WebSearch and Chrome parts do not come up there. The fenced probe showed only the Artifact paragraph, for each of the three models that the recipe names.

R5 of `requests/archive/claude-session-trim` says that the recipe names each unit that the kit cuts by a hash and a `text:` name, that the kit cuts each named unit it finds, and that it leaves every unit that the recipe does not name. It also says that a recipe never names a unit that guards safety, that health names a recipe unit that a record of one of its models does not hold, and that a record of a conversation that did not start on Claude Code's own text is not a source.

## Decision

The recipe names each part that comes back and does not guard safety, and the build always takes it out of the file. A live probe gives the sums, for each model and each new version. This is inside R5 as signed, with no exception.

1. **The reading of R5.** A part that Claude Code adds by itself can be a unit that the recipe names, by its sum and a `text:` name, in a class of its own: `back`, the parts that come back. The build takes each one out of the file that it finds, whatever the cut and keep lists say, so the letter of R5 holds on the file. The session still gets the part one time, from Claude Code, so R5's purpose holds for the session. No word of R5 or KIT-55 changes: `Tier: 0`.
2. **Safety first.** The recipe never names a unit that guards safety (R5). Each part is read on the machine before the recipe names it, and the reviewer reads it too. The Chrome extension's section limits the use of the user's existing browser tabs, so it guards safety, and the recipe does not name it. The kit's file keeps it, and a session with Chrome gets it two times: in run 1 of #769, 18,665 characters against Claude Code's own 14,994. That is the cost of R5 as signed. A change of R5 for such a part is the owner's choice, in a separate request.
3. **What the recipe names now.** `text:web-search`, for the three models, seen live. Not `text:chrome` (point 2). Not the Artifact paragraph: the fence showed it, but a fleet that cuts the Artifact tool has it in no record, and point 4 would then name it for ever. A bot that keeps Artifact gets the paragraph two times, as since #783.
4. **A `back` unit is a recipe unit.** R5's health clause holds for it: `obk health` names it when a saved copy of one of its models does not hold it. A cut or keep list does not change it, and a list that names one gets a finding that says so.
5. **Health reads the first record of each session on the kit's text.** That is the first `prompt_snapshot` of the session's conversation whose first section is the session's own main file, the one the book names. It is evidence for health only, never a source. Health shows two known states on the session's line, with sums, sizes and the kit's own names, and no text of Claude Code. Neither is a finding, and neither fails health:
   - a part after the main file that the file also holds: the session has it two times, as in `main text kit, 1 part two times (4107 characters, sum e2f9e7f17ce6231d)`. This shows for a session on the current file and for one on an older file. A part that guards safety stays two times by point 2, so this is not a fault to fix;
   - a `back` part that the build took out and that the record does not show after the main file: the session runs without it, as in `main text kit, without text:web-search`. A session without the part's tool lacks the part rightly, and the record cannot tell that case from another. This needs the build's list, so health says it only for a session on the current file.
6. **The probe.** `test/system/claude-added-parts-live.test.js` starts one bot for each model that the recipe names, first on Claude Code's own text and then on the kit's, and prints the sums of the parts that Claude Code added. It runs again for each new Claude Code version, on the architect's go word at night.

## Alternatives considered

- **The kit learns the parts from a record of a session on its own text.** The sections after the main file that the file also holds come back, so the next build takes them out. Not chosen: it cuts a part that no recipe names, against R5's letter, and it uses a record that R5 says is not a source. The first session of each shape still gets the parts two times.
- **The kit asks Claude Code at build time, with a tiny replaced text.** Not chosen: an API call on the user's account at each build.
- **A fixed list in the code.** Not chosen: it is outside the recipe and has no `text:` name, against R5's letter.
- **Name the Chrome section too.** Not chosen: it guards safety, and R5 has no exception for a part that comes back. A change of R5 for it is the owner's choice.
- **A `back` entry that names no model,** so that R5's health clause does not bind it. Not chosen: it holds the clause's letter and misses its purpose.
- **A part two times as a failing finding.** Not chosen: a part that guards safety stays two times by design, so the finding would fail health for most sessions with nothing for the user to do.

## Consequences

- A session on the kit's text gets the WebSearch paragraph one time.
- A session with Chrome gets the Chrome section two times, and its main text can be larger than Claude Code's own. Health shows it on the session's line.
- A bot that keeps Artifact gets the Artifact paragraph two times, as since #783.
- Each new Claude Code version needs the probe, as the cut units need their sums.

## History

- 2026-11-16: accepted (#784). The same day, after the reviewer's safety read: the Chrome section guards safety and is not named; the Artifact paragraph is not named; a `back` unit falls under R5's health clause; a part two times goes on the session's line, not into a finding.
