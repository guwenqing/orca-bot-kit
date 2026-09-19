# Working rules for this repo

## What decides

`docs/prd.md` is the design, `docs/adr/` holds the decisions with lasting
consequences, `docs/tech-notes.md` holds what we know about Orca and the two
harnesses. Issues reference them; they do not copy them.

An item tagged `[proposed]` in the PRD is not confirmed by the owner. Ask before
relying on one. A fact in the tech notes marked **unverified** must be proven by
a live check before code relies on it.

## How the work is cut

Issues are vertical slices, worked in order, each with a check you can run. Do
not pull work from a later slice into an earlier one.

## How code is written

- Test first, one slice at a time, through the public interface.
- The test author is a separate agent from the implementer. The implementer
  cannot change a test to make it pass; a test that looks wrong goes back to the
  author.
- The author's tests are checked by mutation testing: `npm run mutate`.
- The reviewer is a separate agent and only comments. The implementer makes the
  change and verifies it again.
- Do not say it works from a plausible diff. Run the check and read the output.

## Pull requests

One PR per issue. The reviewer approves before merge; merges are squash merges.
