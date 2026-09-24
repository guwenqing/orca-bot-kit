# ADR 0017: The test author and the reviewer are always separate from the implementer

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19. Consulted: the coordinator, who proposed the author's brief and the wording. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0007](0007-test-author-and-reviewer-are-always-separate.md).

## Context

An agent that writes both the code and the tests shares its blind spots,
tends to write tests it knows will pass, and tends to weaken a test to get
green. An agent reviewing its own work finds little. The owner had required a
different test author in the project before this one, and a second agent costs
at least one more run for every change.

In Claude Code a subagent starts with a fresh, isolated context, while a fork
inherits the parent conversation. Codex starts a subagent only when asked for
one directly (both from the harnesses' documentation, 2026-09-19).

## Decision

For code-writing bots the test author is always a different agent from the
implementer, and so is the reviewer. A subagent with a fresh context counts;
another session or bot also counts, by the user's flavour. The author gets the
requirement and the public interfaces, not the implementer's code plan. The
implementer cannot change a test to make it pass; a test that looks wrong is
reported to the author (proposed; PRD 7.3 has recorded it as decided since
2026-09-23, on the coordinator's reading of the owner's decisions kept in
`AGENTS.md`, #108 and #193, and no word of the owner's confirming it is
recorded). The author's tests are checked by the mutation check of PRD 7.3.
The reviewer never modifies code; it only comments, the implementer makes the
change, and the change is verified again. When a substantial change means the
old tests cannot hold, the author redoes them, usually deleting the old tests
first.

## Alternatives considered

- **A separate test author off by default, offered only for high-stakes
  work.** The coordinator's recommendation, on the grounds that red-first
  evidence and a controlled fault already catch most self-deception and a
  second author doubles the cost. The owner chose the other way: "always
  seperate, but a subagent count" (the owner's design session, 2026-09-19, not
  in the repo).
- **The implementer writes its own tests when no other author can be
  reached.** In a draft of the `tests-first` rule unit (#100). Removed: the
  bot says so and asks (#100, #107).
- **The implementer adds narrower or lower-level tests itself.** In a draft of
  `obk-tdd` (#110). Removed in review, as an exception the owner's rule does
  not allow; such a test goes to the author.
- **A fork of the implementer as the helper.** Not allowed: a fork inherits
  the conversation, which is the shared view the separate author exists to
  avoid.
- **A reviewer that edits the code.** Ruled out by the owner: "reviewer NEVER
  modify the code, it only comments the code".
- **An author who sees the implementer's code plan.** Not chosen, so that the
  tests come from what was asked and not from how the code will be built.
- **A reviewer on a different harness as a requirement.** Not chosen: a
  bonus, never required.

## Consequences

- Good: the tests and the review come from someone who does not share the
  implementer's view of the code.
- Bad: every behaviour change costs at least one extra agent run.
- In Claude Code the helper must be a fresh subagent, not a fork that inherits
  the conversation; Codex spawns a subagent only when asked explicitly, so the
  skill asks.
- A reviewer on a different harness is a bonus the kit makes easy, not a
  requirement.
- Revisit if: a harness offers no way to start a fresh helper, or the extra
  runs cost more than the defects they catch. Confidence: high; this repo's
  PRs have named a separate test author from slice 01 (#57) on. (Proposed in
  #262; not recorded when it was decided.)
- Checked by: the reviewer, who looks for tests changed by the implementer;
  PRs in this repo name the separate test author.

## History

- 2026-09-19, [ADR 0007](0007-test-author-and-reviewer-are-always-separate.md):
  decided by the owner in his design session. It said the author's tests "are
  validated by mutation testing".
- 2026-09-20: the owner made the everyday mutation check a hand check and the
  tool an audit (PRD 7.3, #93 to #95); from then on "mutation testing" in this
  decision means the mutation check of PRD 7.3. ADR 0007 was not changed.
- 2026-09-23: PRD 7.3 changed "A test that looks wrong is reported to the
  author" from proposed to decided (#193, at the coordinator's request);
  ADR 0007 kept "(proposed)".
- 2026-09-24: the owner restated that which kind of different author or
  reviewer counts is the user's to say (#233), which this decision already
  allowed.
- 2026-09-24, this record: nothing decided changes. It names the mutation
  check as PRD 7.3 now has it, records where the proposed sentence stands, is
  written again in the format the kit now uses, and replaces ADR 0007 (#262).
