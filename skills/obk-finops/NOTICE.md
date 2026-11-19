<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

`obk-finops` reproduces no third-party text. It is written from this kit's own
design, from what was measured for it, and from the owner's own conclusions
about his own spending, restated in our own words.

## The owner's own conclusions, restated

He reviewed his real sessions and wrote down what he found. That is his own
writing rather than a third party's, so there is no licence question, but the
research pack holds it only at one remove, as another agent's digest, so
nothing here quotes it:

- that the figure worth knowing is what a result cost rather than what a token
  cost, and that the sum includes the runs that failed, the work handed to
  another tool, anything charged outside the token bill, and the person's own
  time correcting and re-explaining, which is usually the largest part and the
  part nobody writes down;
- that effort should follow the work: high for the orchestrating session,
  medium for the workers, and the top of the range kept for deep read-only
  analysis, as the owner's usage review puts it;
- that a long thread pays to re-read itself, that a high median input per call
  is the measurable form of it, and that compaction is where it becomes
  visible;
- that a sentence in a prompt is not a budget control, and that where a limit
  cannot be enforced by the platform, that has to be written down beside it
  rather than left for a reader to assume;
- the two directions to read the evidence in: short simple turns on a top
  model, or a high effort setting that is never used, mean the model is more
  than the job needs; repeated corrections, the same error returning after a
  fix was claimed, and tests failing again mean it is not up to the work.

## This kit's own design

PRD 6.8 decides that prices come from a live lookup and that a price which
cannot be found is said to be unknown, and ADR 0016 is why none of the
arithmetic here is done by the kit's own code: what a token costs is judgement
about a changing world, not plumbing.

The four kinds of token and the warning about comparing them across harnesses
come from what was measured for this slice and written into the tech notes: the
two harnesses do not mean the same thing by input tokens, one counting the
cache reads inside it and the other outside, so a figure read straight from a
transcript is not comparable with the same figure from the other. The kit's own
usage report already puts both into the same unit, which is why this skill says
to take that rather than the files.

## The figures are a floor (#822)

The paragraph on the figures being a floor comes from issue #822. Its facts
were read in these, all on 2026-11-19, and no text of theirs is taken:

- **Claude Code's issue 104358**, "Persist per-request usage for every
  billed request", https://github.com/anthropics/claude-code/issues/104358:
  the kinds of request that are billed
  and leave no row in a transcript, among them `agent_summary`, `auto_mode`,
  `compact`, `away_summary`, `generate_session_title`, `extract_memories` and
  `prompt_suggestion`. It cites #86879, on the size of the progress summaries
  in one session, and #100830, on subagent transcripts that lacked their
  final output from 2.1.280.
  Read: 2026-11-19 (opened 2026-10-22, open when read; #86879 and #100830 read
  the same day)
- **Claude Code's `CHANGELOG.md`**: 2.1.307
  fixed subagent transcripts that recorded placeholder usage; 2.1.323 added
  `CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES`; 2.1.327 and 2.1.328 had the
  progress summaries written from short notes, using far fewer tokens.
  Revision: anthropics/claude-code@26fdd0013f7800348867d6c9c25143fcfd089ec6
  (main, read 2026-11-19)

The end of the subagent gap was also seen on disk on 2026-11-19, in 143
subagent transcripts of one bot: 93 to 100 per cent of the messages of
Claude Code 2.1.301, 2.1.304 and 2.1.306 had no final entry, and none of
those of 2.1.307 to 2.1.328. Earlier versions were not on that disk; the
start at 2.1.280 is #100830's.

## What was deliberately not taken

The source material carries an autonomy ladder that raises and lowers what a
bot may do on its own according to how clean its recent runs were. It is not
here. The pack itself records that the ladder's rungs are missing from the
source, so there is nothing to take but the idea, and an untested scheme for
automatically widening a bot's permissions is not something to invent inside a
skill about cost.

Sources and licences in full: [LICENSES.md](LICENSES.md).

## What the re-validation changed (#156)

- Pricing per model from `obk usage --json`'s per-model rows (the review
  finding on #141), and reasoning tokens priced once, since on Codex they sit
  inside output (docs/tech-notes.md).
- The effort defaults as the owner's usage review gives them.
- The median input per call as the measure of a thread re-reading itself, a
  hand-over after more than one compaction for a worker session while a
  persona session is judged on its cost and lost state (grok-bot-lessons'
  session policy), and a check-in every so many
  tokens on a loop with no budget (the usage review, via grok-bot-lessons).
- On the signs of a model not up to the work, the charter or the job is the
  first suspect, as in `obk-fleet-review`.
- The allowance share is given only where the plan shows it; the kit does not
  report it.
