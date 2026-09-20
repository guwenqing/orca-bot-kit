---
name: obk-tdd
description: >-
  Test-driven work: a failing test before the code, one vertical slice at a
  time, through the public interface; a separate author for the tests, whose
  tests the implementer does not edit; the shapes of tests that catch nothing;
  and the hand mutation check that asks whether the tests would catch a real
  mistake. Use when changing behaviour, fixing a bug, writing or reviewing
  tests, or deciding whether a suite is worth trusting.
---

# Test-driven work

The order is the point: the check exists, and has been seen to fail, before the
code that satisfies it. What that buys is a test written against the
requirement rather than against the implementation you already had in mind.

Three things hold the tests honest, in this order of value: the author is
someone other than the implementer, a reviewer reads the tests, and the
implementer breaks its own logic on purpose to see whether a test notices.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Start from the requirement, not the code

Write the acceptance criteria before any test: one line each, each one
checkable on its own, each phrased as behaviour someone could observe. A
criterion you cannot check is a criterion nobody can hold you to.

A requirement's silence is not permission. What a reasonable reader would
expect is part of it: the invalid input, the denied permission, the empty
collection. List the input classes the requirement implies but no test
exercises, and give each one a test or a written reason it is out of scope.

Expected values come from the requirement, a worked example or a known-good
literal — never from the code under test or its helpers. An expectation the
code computes passes whatever the code does.

Say which requirement a test covers, in its name or in a line beside it. A test
that names a requirement but does not assert its behaviour does not cover it.

## One vertical slice at a time

One test, then the smallest implementation that passes it, then the next. Not
all the tests first and then all the code: tests written in bulk describe
behaviour you imagined, and they all go green in one step that nobody watched.

A separate author writing the acceptance tests up front is not that, although
it looks like it: those are a few tests at the top seam, taken from the
requirement rather than from a plan. You still work through them one at a time,
watching each one fail and then pass, and adding narrower tests of your own as
the code takes shape.

Test at a seam: the public boundary where you can observe behaviour without
reaching inside. Prefer a seam that already exists, and the highest one that
still shows the behaviour; the fewer seams a codebase has, the better. State
the seam you are testing at. Ask about it only when the interface itself is
what is in question.

Do not anticipate the next test. Code that no failing test asked for is
untested code, whatever it does.

Stand in for what you do not own: an external service, a database sometimes
(prefer a real test one), the clock, randomness, the filesystem sometimes. Do
not stand in for your own modules or internal collaborators. A test whose setup
is mostly stubs is testing the stubs.

## The test author is someone else

An agent that writes the code and the tests shares one set of blind spots. It
writes tests it already knows will pass, and when one goes red the cheapest
road is to soften it. What separation buys is a context that holds the
requirement and not the implementation — the isolated context is the point, not
a role or a persona.

Who counts: a fresh subagent, another session, another bot, or a person. In
Claude Code it must be a subagent with its own context, not a fork that
inherits the conversation. Codex spawns a subagent only when asked in so many
words, so ask in so many words.

What the author gets: the requirement, the acceptance criteria, and the public
interface — names, signatures, types, the shape of inputs and outputs. Not your
plan, not your diff, not the implementation. What the author returns: the test
files, the command, the failing output, and one line per test naming the
requirement it covers.

A brief that works, adjusted to the job:

> Write tests for this requirement. You are not writing the implementation and
> you will not see it.
> Requirement: <what the behaviour is, and the acceptance criteria>.
> Public interface: <signatures and data shapes, no bodies>.
> Test at <seam>, in <the repo's test style and framework>; follow the
> repo's existing tests for shape.
> Test observable behaviour through that interface. Take expected values from
> the requirement or a worked example, never by calling the code under test.
> Cover the unhappy inputs the requirement implies as well as the happy one.
> Run them. They are all expected to fail, and to fail because the behaviour is
> missing rather than because of a typo or an import error.
> Return: the files you wrote, the command, its failing output, and one line
> per test naming the requirement it covers.

Then, as the implementer: you may add tests of your own. You do not edit,
weaken, skip or delete the author's tests to get to green. A test you believe
is wrong goes back to its author with what you think is wrong with it — that is
a real and expected outcome, not a defeat. The tests verify the requirement;
they do not define the solution, so do not write code that works only for the
inputs a test happens to use.

Where the harness or the repo allows it, make tampering visible rather than
forbidden: commit the author's tests before the implementation, so a later
`git diff` over the test paths shows any change; or keep those paths outside
the implementer's write scope.

When you can neither start an author nor reach one, say so. Then write the
tests as a step of their own, before you read the implementation area in depth,
and state in your report that authorship was not independent.

## Red is evidence, not a formality

Run the test and read the output before you write any code:

- It fails, rather than errors.
- The failure message is the one you expected.
- It fails because the behaviour is missing — not a typo, a bad import, a
  missing fixture.

If it passes, you are testing behaviour that already exists; that is a finding
about the test, not a step you may skip past. If it errors, fix the error and
run again until it fails cleanly.

Reaching a clean red is one step at a time, and none of them is implementation:
the test cannot find the symbol, so add an empty stub; the call does not match
the signature, so fix the signature and leave the body empty; now it fails on
the assertion, and only now does logic get written.

Keep the receipt: the command, the failing output, and one line on why that
failure is the expected one. After green, the command and the passing output.
Commit order proves nothing about what ran first — without a captured failing
run, say the chronology is unproven rather than implying it.

Things that look like green and are not: a test that passed on its first run; a
suite reported as passing that nobody ran; a default test command guessed
instead of the one this repo actually uses. And your test passing is not the
suite passing — any failure the run showed, including one you did not cause,
goes in your report by name.

## Green, then refactor outside the loop

Write the smallest code that passes the failing test, and stop there.

Refactoring is not a phase of the red/green loop. Go green, then change the
structure as a separate step, under the same tests and the same contract, and
keep the two in separate commits, green on both sides. Pulling
out something whose behaviour already exists elsewhere is refactoring; a
function whose behaviour appears nowhere else is new, and it starts with a
failing test like anything else.

When a change is large enough that the old tests cannot hold, that is still not
a licence to edit them. The author writes them again from the new requirement,
usually deleting the old ones first. A large refactor is planned as a piece of
work in its own right, not carried inside another change.

Tests against an inner module become waste once the same behaviour is covered
at the interface above it. Deleting them is the author's call, and deliberate.

## Bugs

A bug fix starts with a test that reproduces it, written before the fix, at a
seam where the test exercises the bug as it actually happens at the call site.
A seam below that gives a green test and no protection. If no correct seam
exists, that is itself the finding: report it, because the shape of the code is
what is stopping the bug from being pinned down.

Minimise the reproduction until every part of it is load-bearing, turn it into
a failing test, watch it fail, fix the cause, watch it pass, then run the
original unminimised scenario again.

A regression test written after the fix has proved nothing yet. Prove it:
revert the fix, run it and watch it fail, restore the fix, run it again.

When a failing test really is impractical, say so out loud, say why, and name
the closest executable check you used instead. Quiet omission is the part that
does damage: a reviewer treats a missing red receipt as a finding.

## Tests that catch nothing

Before writing the body, answer one question: what change to the production
code should make this test fail, and is that change a bug or a decision? A test
earns its place by catching a wrong branch, a missing side effect, a wrong
argument, a boundary or a broken contract. A test that only fails on a
deliberate decision fires on every redesign and sleeps through every bug.

The cheap check on a test you already have: would it still pass if every
function it calls returned nothing? If yes, it observes no behaviour.

Five shapes that still pass that way, and what to do with each:

- **No real assertion.** Nothing asserted, or only "is defined", "is truthy",
  "did not throw". Call the subject with one concrete input and assert the
  literal output or the observable effect.
- **Only a stub or an absence.** Only "was called", "was not called", "is
  undefined", "is empty". Assert the payload the stub received, or the state
  after the call.
- **Self-referential.** The expected value is produced by the code under test.
  Replace it with a literal you worked out by hand.
- **Constant pinned.** The assertion restates a constant, a config default or
  the exact wording of a message. Test the mechanism that reads the constant
  with one input instead.
- **Fixture asserts fixture.** The assertion reads data the test itself built,
  and the subject never runs. Run the subject inside the test body.

When no honest assertion exists, delete the test. Prefer no new test to a bad
one: one that mostly tests stubs, that encodes today's implementation, that
depends on timing or global state, or that you would delete the moment the fix
is proven.

Other tells: the test breaks when you refactor although the behaviour did not
change; the stub setup is more than half of it; the expected values are hidden
behind loops or builders; the only way it can fail is a crash; it exists to
raise a coverage number.

What is missing is usually on the unhappy side: the denied case of a permission
check, untested guard clauses and early returns, error branches, boundaries
(zero, empty, negative, one element, the maximum), and the second half of any
"if". And tests that pass together but not alone are already broken: shared
mutable state, order dependence, the clock, the timezone, the real network, a
sleep, an assertion on the order of something unordered.

## The mutation check before you call it done

The question is the whole point: if a real mistake were made in this code,
would a test fail? There is no score to reach.

**Everyday: your own hand check.** Once per piece of work, at the end, only
where it earns its place. Five to eight deliberate breaks in the risky logic
the work changed, chosen before you look at the tests, each one run, each one
expected to make a test fail, each one put back. Reported in three lines.

One break at a time, never two at once: note the original, apply the break, run
the tests, record killed or survived, restore the code immediately, then the
next one.

What to break, in this order: boundaries (`<` for `<=`, one off), boolean logic
(`&&` for `||`, a dropped `not`), returned values (an empty or default return,
a removed early return), a removed statement or side effect, a wrong constant
or argument. Aim for at least one per branch or boundary the work changed.
Avoid a change that cannot show: adding zero, multiplying by one, or a value
identical to the original.

Skip it, and say that you skipped it, for work with no real logic in it: docs,
config, wiring, renames, small fixes, prototypes, and code with no runnable
tests.

**A survivor** — a break no test objected to — gets the equivalence question
first: is there any input for which the changed code returns a different value,
stores different state, or emits a different message? If there is none it is
equivalent, and no test can catch it; write the one-line argument for why.
"No test covers this" is not the same as "no input can reach this". Every
survivor ends as exactly one of three things: killed by a new test, equivalent
with that argument, or a judgment call you name and leave. A list of survivors
with nothing said about them is not a report, and neither is treating each one
as a defect.

Kill a survivor only where it shows a gap in behaviour the requirement cares
about. Wording of messages, logging and changes with no visible difference are
not worth a test; say so in a line and move on. To kill one: keep the break in
place, write the smallest behaviour test that fails against it for the right
reason, restore the code, check the new test still passes.

The implementer runs the check. A test that needs strengthening goes to the
separate author, like any other test.

**A mutation tool is an audit, not everyday work.** It is never a requirement,
and it is not worth a user's time on a suite it does not fit. Where a project
has one, run it over the whole suite occasionally — at a milestone, or when the
user asks — in the background at a quiet time, in its own tab or session. Read
the result once; turn the few real gaps into test work; ignore the rest. Not
once per change, and never twice for the same change. For a piece of work at
the core of a product, one run narrowed to the logic that changed, in the
background, around twenty minutes; if it will not fit in that, do the hand
check instead. Then stop. A run heading towards hours is stopped.

If you do run one: a clean working tree first, because a diff-scoped run covers
committed work only; prove the setup with one small scoped run before spending
a long one; capture the output once and read it from the copy rather than
re-running to re-read it; set no failing threshold before a measured baseline
exists. Paste what the tool printed — a mutation result reported from memory
has been wrong. A compile error is not a kill, and a timeout is inconclusive
rather than evidence. Commands and their current flags are in
[mutation-tools.md](mutation-tools.md).

Keep it in proportion. This check is the third safety net, after the separate
author and the reviewer's reading of the tests, and it stays the cheapest of
the three.

## Green that was bought

Tightening the bar should be silent; loosening it should be loud. In your own
diff and in anyone else's, these are the cheap roads to green, and each one is
worth a sentence when it happens: a threshold moved, a test marked skipped, a
test file deleted, assertions removed from a test that stayed, a check disabled
by a comment, a value hard-coded to match one test's input.

## What you report

- Red: the command, the failing output, why that failure was expected.
- Green: the command, the passing output, and any other failure the run showed.
- Who wrote the tests, and whether they were changed after they were written.
- The mutation check in three lines: what you broke, what survived, what you
  did about it — or the line that says you skipped it and why.
- What you did not check, and the command that would check it.

## Away from code

The same three moves work on documentation, configuration, prompts and data,
where no tool will help: state the check before you make the change, see the
check fail first, and at the end break the artefact on purpose to find out
whether the check notices.

## Where this comes from

Written for this kit from: mattpocock/skills (MIT) — seams, vertical slices,
tautological tests, refactoring outside the loop; obra/superpowers (MIT) — red
verification, the test-quality questions, the revert-the-fix proof; Cursor
pstack (MIT) — the five shapes that observe no behaviour; addyosmani/agent-docs
(MIT) — a subagent for the reproduction test, the cheap roads to green;
citypaul/.dotfiles (MIT) — the mutation loop, survivor triage and equivalence;
nizos/tdd-guard (MIT) — the clean-red ladder. Ideas paraphrased, no text
copied, from Trail of Bits' mutation-testing skill (CC BY-SA 4.0), Anthropic's
Claude Code documentation, alexop.dev and the Google mutation-testing papers.
