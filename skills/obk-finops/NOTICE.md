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
- that effort should follow the work: low for routine and dispatch, high for
  orchestration, and the top of the range kept for deep read-only analysis;
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
cannot be found is said to be unknown, and ADR 0006 is why none of the
arithmetic here is done by the kit's own code: what a token costs is judgement
about a changing world, not plumbing.

The four kinds of token and the warning about comparing them across harnesses
come from what was measured for this slice and written into the tech notes: the
two harnesses do not mean the same thing by input tokens, one counting the
cache reads inside it and the other outside, so a figure read straight from a
transcript is not comparable with the same figure from the other. The kit's own
usage report already puts both into the same unit, which is why this skill says
to take that rather than the files.

## What was deliberately not taken

The source material carries an autonomy ladder that raises and lowers what a
bot may do on its own according to how clean its recent runs were. It is not
here. The pack itself records that the ladder's rungs are missing from the
source, so there is nothing to take but the idea, and an untested scheme for
automatically widening a bot's permissions is not something to invent inside a
skill about cost.

Sources and licences in full: [LICENSES.md](LICENSES.md).
