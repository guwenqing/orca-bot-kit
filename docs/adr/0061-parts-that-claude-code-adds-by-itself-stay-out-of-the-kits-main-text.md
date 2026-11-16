# ADR 0061: Parts that Claude Code adds by itself stay out of the kit's main text

Date: 2026-11-16.
Status: accepted.
Decided by: the architect, on 2026-11-16, for path 0, the reading of R5 below, a recipe that names each such part, and health's two findings (#784). The architect or the owner may overrule.
Builds on: [ADR 0055](0055-the-kit-trims-what-a-claude-code-session-is-sent.md), section 4.

## Context

The kit builds a Claude Code session's main text from Claude Code's own text, as a transcript recorded it, less the units that its recipe cuts (ADR 0055, section 4). The session gets that text by `--system-prompt-file`.

After a replaced main text, Claude Code adds some parts by itself, each for a tool that the session has. The tech notes said this of the Artifact tool's paragraph, and PR #783 accepted it for a bot that keeps Artifact. The live check of #769 showed more (2026-11-16, Claude Code 2.1.325, Haiku): after the kit's main file, Claude Code added the WebSearch tool's paragraph and the section on the Chrome extension. The kit's file held both too. So the session got each part two times, and its main text was 3,671 characters longer than Claude Code's own.

Which parts come back depends on the model, the Claude Code version and the tools of the session. A fenced probe cannot show all of them: the stand-in API is not the first-party API, and the fence has no Chrome extension. So the WebSearch and Chrome parts do not come up there. The fenced probe showed only the Artifact paragraph, for each of the three models that the recipe names.

R5 of `requests/archive/claude-session-trim` says that the recipe names each unit that the kit cuts by a hash and a `text:` name, that the kit cuts each named unit it finds, and that it leaves every unit that the recipe does not name. It also says that a record of a conversation that did not start on Claude Code's own text is not a source.

## The candidates

1. **The recipe names each part that comes back.** The build always takes it out of the file. A live probe gives the sums, for each model and each new version. Cost: the recipe needs the probe again for each new version. A part that the probe did not see stays two times until health names it.
2. **The kit learns the parts from a record of a session on its own text.** The sections after the main file that the file also holds come back, so the next build takes them out. Cost: it cuts a part that no recipe names, against R5's letter, and it uses a record that R5 says is not a source. The first session of each shape still gets the parts two times. Refused.
3. **The kit asks Claude Code at build time, with a tiny replaced text.** Cost: an API call on the user's account at each build. Refused.
4. **A fixed list in the code.** The same as 1, but outside the recipe and without a `text:` name. Against R5's letter. Refused.

## Decision

Candidate 1, with health in both directions.

1. **The reading of R5.** A part that Claude Code adds by itself is a unit that the recipe names, by its sum and a `text:` name, in a class of its own: parts that come back. The build takes each one out of the file that it finds, so the letter of R5 holds on the file. The session still gets the part one time, from Claude Code, so R5's purpose holds for the session: Claude Code's own text, less the cuts. No word of R5 or KIT-55 changes: `Tier: 0`.
2. **Not by a user's choice.** A `claude_cut` or `claude_keep` list does not change a part that comes back. A keep list does not put it back into the file, because the session already has it from Claude Code. A list that names one gets a health finding that says so. No new setting.
3. **Safety.** The recipe never names a unit that guards safety (R5). Each part is read on the machine before the recipe names it, and the reviewer checks it too. A part that guards safety is not named, and the architect is told.
4. **Not a missing unit.** An own text without such a part is normal: the session does not have that tool. So health does not name a part that comes back as a recipe unit that it did not find.
5. **Health reads the first record of each session on the kit's text.** That is the first `prompt_snapshot` of the session's conversation whose first section is the kit's main file. It is evidence for health only, never a source. Health gives two findings, with sums, sizes and the kit's own names, and no text of Claude Code:
   - a part after the main file that the file also holds: the session has it two times;
   - a part that comes back, that the build took out, and that the record does not show after the main file: the session runs without it.
6. **The probe.** `test/system/claude-added-parts-live.test.js` starts one bot for each model that the recipe names, first on Claude Code's own text and then on the kit's, and prints the sums of the parts that Claude Code added. It runs again for each new Claude Code version, on the architect's go word at night.

## Consequences

- A session on the kit's text gets each part one time, for each part that the probe saw.
- A part that the probe did not see stays two times until a new kit names it. Health names the session meanwhile.
- The cost of #783 for a bot that keeps Artifact goes: the paragraph comes one time.
- Each new Claude Code version needs the probe, as the cut units need their sums.

## History

- 2026-11-16: accepted (#784).
