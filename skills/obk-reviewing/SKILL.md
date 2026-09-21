---
name: obk-reviewing
description: >-
  Reviewing a change, and receiving a review of your own: what a reviewer is
  given and what it is not, the angles worth taking on a diff, the test to put
  a finding through before writing it, the findings that are usually wrong,
  what a report says, and how to answer one without performing agreement. Use
  whenever you are reading someone else's change — a diff, a branch, a pull
  request, a patch — or have been asked to look at, check over or give an
  opinion on work you did not write, and equally whenever findings come back
  on your own work and you have to decide what to do about each one.
---

# Reviewing

Two jobs, and they are different: reading someone else's change, and answering
a reading of your own. A review is worth having only when the reader did not
write the code, and it is worth acting on only when each finding survives being
checked.

The reviewer comments and does not edit. Whoever wrote the code makes the
change, and the check is run again afterwards. That order is the whole
mechanism: it keeps the author responsible for the code and the reviewer
responsible for the argument.

Scale the reading to the change. A review is not skipped because the work is
small, but a small change gets a small review: the questions that could matter
here, not the whole list every time. Formality repeated on every change costs
trust as surely as missing a defect does.

Question the approach before the edge cases. If the change solves the problem
in the wrong place, or solves the wrong problem, the boundary conditions inside
it are beside the point; settle the shape first and look at the details after.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Giving a review

### What you are given, and what you are not

The requirement, the change, and the criteria it has to meet. Not the author's
session, not its reasoning, and not its conclusion: handed a conclusion, a
reader tends to come back agreeing with it. If you are the one asking for the
review, pass the artefact and the contract, and keep your verdict to yourself.

State the intent in one paragraph before you read the diff, taken from the
requirement rather than from the author's summary. You are judging whether the
change achieves that intent, not whether the intent was right. Solving the
wrong problem is still a finding — that is the change failing the requirement,
not you re-arguing it.

Pin what you are reading: the range, and that it resolves and is not empty.
Work that out before you start rather than half way through.

Read the change before you read what anyone else said about it. Other people's
comments, and any automated review, come after your own pass, so your eyes are
your own.

### The author's report is a claim

Treat it as a claim about the code, not as evidence. It may be incomplete,
optimistic, or simply wrong. Check what it says against the change itself. A
rationale in the report — "left out deliberately", "kept simple on purpose" —
is the author grading its own work and never lowers the severity of anything
you find.

The other way round holds too: evidence you cannot see is not evidence that
does not exist. When you cannot check something, say that you could not, and
say what would settle it.

### Two questions, kept apart

Does the change do what was asked, and is it well made? A change can pass one
and fail the other — correct in every detail and solving the wrong problem, or
exactly what was wanted and a mess in the codebase. Answer them separately and
report them separately. Merged into one ranked list, the loud one hides the
other.

For the first, go through the requirement and sort what you find into three:

- **Missing** — asked for and not there, or claimed and not implemented.
- **Not asked for** — behaviour, options or generality nobody wanted.
- **Misunderstood** — the right thing built the wrong way, or the wrong
  problem solved.

Quote the line of the requirement for each. Where settling one means reading
code the change does not touch — the function it delegates to, the contract it
relies on — read it: that is evidence about this change, not a review of
something else. Say you could not settle it only when you actually could not.
And the requirement is not a list of everything that matters: what a reasonable
person would expect is part of it, and silence about an input is not permission
for that input to break things.

### Where to look

The second question. What you report is the change: what it adds or alters, and
a defect in an untouched line of a function it touched. Not a survey of
everything around it.

What you read to get there is a different matter. Follow a question you can
name — where does this value come from, what did the old contract promise, who
calls this — until it is settled or you are genuinely stuck, and say in the
report what you followed and what you found. Do not report a half-answer you
could have finished: "this breaks unless the caller handles it" is not a
finding when the caller is there to be read. What you must not do is wander:
reading with no question in hand turns a review of this change into a review of
the codebase, and that is the thing to stay out of.

These are questions, not a list to complete. A one-line fix does not need
paragraphs about the architecture.

- **Every line.** What input, state, timing or platform makes this line wrong?
  Empty input, a boundary, a value that is absent, two of these at once, the
  second time it runs.
- **The second run, and the half-finished one.** What happens if this runs
  twice, or if the last attempt died partway through? If the answer depends on
  what was left behind, something is missing that puts it back in order.
- **Two at once.** Where more than one actor can touch the same file, branch or
  shared value, is the access made safe by the structure — a lock, a sequence,
  one owner — or by a convention that will not hold?
- **Checked against the real thing.** Does the code establish what it claims,
  or does it read a stand-in for it: a timestamp instead of the value, a cached
  flag instead of the state, a helper's summary instead of what the helper
  produced?
- **What the change took away.** For each line deleted or replaced, name the
  behaviour it was holding up, then find where that behaviour is held up now.
  This is the one most reviews miss.
- **The callers.** A changed function reaches its call sites: a new
  precondition, a different return shape, an error that did not use to come
  out, a new dependency on ordering or timing.
- **The cause, not the symptom.** A guard that hides a broken invariant, a
  retry that covers a broken contract, a cast that silences a modelling
  mistake. A special case layered onto shared machinery usually means the fix
  went in at the wrong depth. If the fix is a comment telling the next person
  not to do something, ask what would make the wrong thing impossible instead.
- **The shape.** Does the change read as though the design always allowed for
  it, or as though it was pushed in from outside? Does the data match how it is
  actually used? Is a second path being kept alive for callers that do not
  exist?
- **What could be less.** An abstraction with one caller, an option for a case
  nobody has, a parameter nothing passes, a compatibility path whose migration
  is over. Do not mark simple code down for not being abstract: a few lines
  repeated beat an abstraction invented too early.
- **The tests.** Is there a test for what changed, and would it fail if the
  code were wrong? Where a separate author wrote them, is every case the hand-
  over names present in the revision being handed on, with the contents the
  author handed back? Absent from the diff is a reason to look at the
  revision, not a finding by itself — the tests may have landed in an earlier
  change this one builds on. What is a finding is a named test that is not
  there at all, or is there with its assertions softened. Confirm which before
  writing it up: a test still sitting in somebody's working tree reads as
  success until another clone says otherwise. For a bug, is there a test that
  reproduces it? Was there a failing run before the code, or only a green one
  after? Do the tests observe behaviour or repeat the implementation? And look
  for green that was bought: a threshold moved, a test skipped or deleted,
  assertions taken out of a test that stayed, a check switched off by a
  comment, a value hard-coded to match one test's input. Tightening the bar is
  quiet; loosening it should not be.
- **The repo's own rules.** Flag a breach only when you can quote the rule and
  the line that breaks it. Not a style you prefer, and not the spirit of a
  document. Skip anything the project's own tooling already enforces.
- **Security**, only where you can follow it: an input, the path it takes, and
  the place it lands. "This could be an injection" without that path is not a
  finding. Worth following: a new way in with no check on who may use it; a
  secret that reaches a log, an error or a message; a check made at one moment
  and relied on at a later one, when the answer can change in between; and
  whether a value is checked once where it enters and trusted after, or checked
  again and again in the middle and never at the edge.
- **What it breaks for the people working on it.** A change to where a secret
  is read from, the name of a setting, a port, or a step that now has to be run
  before anything works, will stop other people's machines. So will a feature
  reaching someone it was meant to be hidden from, which is usually a quiet
  change to a condition rather than a loud one.

### A baseline when the repo documents nothing

What the project writes down about how code should be written is the standard,
and it wins. On top of it, this set carries where nothing is written down. Each
one reads as what it is, then what to do about it, and each is a label you
apply with judgement — "possible feature envy", never a violation. A documented
repo standard that endorses something here suppresses it, and anything the
project's tooling already enforces is not a finding.

- **Mysterious name.** A function, variable or type whose name does not say
  what it does or holds. → Rename it; if no honest name comes, the design is
  the murky part.
- **Duplicated code.** The same shape of logic in more than one place in the
  change. → Pull the shape out and call it from both.
- **Feature envy.** A function that reaches into another object's data more
  than its own. → Move it onto the data it envies.
- **Data clumps.** The same few fields or parameters keep travelling together,
  a type waiting to be born. → Bundle them and pass the one thing.
- **Primitive obsession.** A string or a number standing in for a domain idea
  that deserves its own type. → Give the idea its own small type.
- **Repeated switches.** The same branch on the same kind of thing recurring
  across the change. → One map both sites share, or let the type decide.
- **Shotgun surgery.** One logical change forcing scattered edits across many
  files. → Gather what changes together into one place.
- **Divergent change.** One file edited for several unrelated reasons. → Split
  it, so each part changes for one reason.
- **Speculative generality.** Abstraction, parameters or hooks for needs the
  requirement does not have. → Delete it; inline it back until a real need
  turns up.
- **Message chains.** Long `a.b().c().d()` navigation the caller should not
  have to know about. → Hide the walk behind one method on the first object.
- **Middle man.** A class or function that mostly passes calls onward. → Cut
  it out and call the real target.
- **Refused bequest.** Something that inherits and then ignores or overrides
  most of what it got. → Drop the inheritance and compose instead.

### Before you write a finding

Four questions. If any answer is no or unsure, the finding drops or its
severity does.

1. Can you name the file and the line? "Somewhere in the parsing" is not
   something anyone can act on.
2. Can you state the failure concretely — this input, in this state, gives that
   wrong outcome? If you cannot name the trigger, you are matching a pattern,
   not reviewing.
3. Have you read what is around it — the callers, the types, the tests? Much of
   what looks wrong is already handled one frame up.
4. Is the severity one you could defend? A missing comment is never urgent.
   Inflated severity costs you the next review as well as this one.

Trace it before you flag it. "This could be nil" becomes a finding when you can
show the call that makes it nil. Where a type or a validated boundary already
rules it out, it is not one.

Put each candidate in one of three states and say which:

- **Confirmed** — you can name the input and the wrong result, and quote the
  line.
- **Plausible** — the mechanism is real but you cannot reach the trigger from
  here. Say what would settle it.
- **Refuted** — drop it, and only call it that when the code proves it: the
  line says otherwise, a type or constant makes it impossible, or a guard in
  the change already handles it.

Finding and judging are two steps, and collapsing them is how real defects get
lost. While you are looking, keep anything you can name a failure for. Judge
afterwards. What reaches the report is what survived.

### What a report says

Every line is a verdict, a finding, or a check you ran. Start with the answer.
No preamble, no narration of your process, no closing summary.

A finding gives its location, what is wrong, and the evidence for it — why you
believe it, not just that you do. A concrete alternative if you have one, and
nothing if you do not. Fold repeats together: "five handlers swallow the error"
is one finding, not five.

- No findings is a real result. A clean review is a valid review, and
  manufacturing findings to justify having looked is the failure that makes
  reviewers worth ignoring.
- Do not restate what the code does, suggest rewriting working code because you
  would have written it differently, raise a case you cannot reach, or pad with
  small points to look thorough. Do not praise it either; that is not what the
  reader needs.
- Say what severity means where you are writing, and keep to it. A useful
  line: it matters when the work cannot be trusted until it is fixed — wrong
  or fragile behaviour, a requirement missed, the same block of logic copied
  verbatim, an error swallowed, a test that asserts nothing. "The coverage
  could be broader" and polish are the other kind.
- Severity never exceeds what you showed. If you demonstrated a way to read a
  value that should not be read, that is what it is worth; it does not become
  urgent because of what someone might do next with it.
- One structural problem and ten small ones: the structural problem is the
  review.
- If the list of things to act on runs past about five, you have not finished
  filtering.
- List what you considered and set aside, one line each with the reason, so
  nothing is dropped silently. An empty list is fine and means you set nothing
  aside.
- Say what you did not check. If you looked less thoroughly than you were asked
  to — one pass where more was wanted, a part of the change you could not read
  — say that plainly, so nobody takes the review for more than it is.
- A review reads the change. Whether it runs is a separate question and a
  separate check.

### Findings that are usually wrong

Before writing one of these, do the thing in brackets.

- "Add error handling here" [check whether the caller or the framework already
  does].
- "This input is not validated" on something internal [follow one caller and
  see what reaches it].
- "Magic number" for a number everyone knows [ask whether naming it helps a
  reader who already knows it].
- "This function is too long" for a table, a switch or a list of cases [length
  is not the same as complexity].
- "Possible null" where a guard or a type is in scope [read the scope].
- "This is N+1" over a fixed, small set [count it].
- "Missing await" where not waiting is the point [check whether the result is
  wanted].
- "Hard-coded value" in a test [a test is supposed to hard-code what it
  expects].
- Security that cannot be traced from an input to a sink [trace it or drop it].

The question that settles most of them: would someone who knows this codebase
actually change the code because of this comment?

### One reviewer

Do the review yourself. Splitting a diff between several reviewers, or adding
one to check another, buys less than it costs: each one sees less of the change
and their verdicts do not add up. If the change really is too large to hold in
one reading, that is itself worth saying.

Reviewing is read-only. Do not change the working tree, the index, or which
branch or commit is checked out — look with the commands that only read. If you
need another revision to compare, take a separate copy of it somewhere else.

## Receiving a review

Read all of it before you react. Then take the items one at a time.

**Restate each in your own words.** Go through the whole review first and ask
about every item you are unsure of, in one go, before you start changing
anything. Never guess at an unclear item and never act on a half-understood
one: that produces the wrong change, and then a second wrong change when the
answer arrives.

Items are related more often than they look, so assume the answer to one bears
on the others until you have checked. Where you have checked and an item plainly
stands alone — a crash with a reproduction, while the unclear item is a vague
note about tidying something up — that one can go ahead. Anything the answer
could change waits for it.

**Check it against the code before you act on it.** Is it right for this
codebase? Does it break something that works? Is there a reason the code is the
way it is? A fresh reader has less context, not more — that is the point of it,
and it is also its weakness. Do not defer to a finding because it is fresh, and
do not dismiss one because it is uncomfortable.

**Sort each item.** Something you got wrong, and it stands. Something right and
worth doing. A trade-off that is worth keeping but worth writing down. Or
noise — and when it is noise, the useful question is whether the brief should
have said something that would have prevented it.

Some findings carry a sign that the reader was working without something you
have: a change asked for in code you did not touch, a pattern flagged that the
rest of the codebase already uses, an approach recommended that a constraint
you know about rules out. Treat that as a reason to look, not as an answer. It
is often an honest mistake from someone with less context, and it is just as
often the finding that matters most — a caller you did not touch is exactly
where a changed return shape breaks, and the same unsafe pattern elsewhere says
nothing about whether this use of it is safe.

So check it out, and dismiss it only on what the code, the contract or a
decision you can point to actually shows. "The reviewer did not know about X"
dismisses the finding once you have said what X is and why it settles this
case; on its own it is not a reason. Say that much, and move on without making
a point of it.

Ask rather than decide when the finding is novel, when you cannot tell, or when
it touches security, privacy, who is allowed to do what, money, a data
migration, or whether something can safely run twice. Passing over a noisy
remark about style costs little; passing over one of those costs a great deal.
When in doubt, ask.

Where someone suggests building something out "properly", look first for who
calls it. If nothing does, say so and ask whether it should exist at all.

Where you cannot check a point, say so: "I cannot settle this without X" is an
answer, with what you would do next.

**Push back with evidence.** Name what you checked and what it showed. Ask when
a point is unclear. Where a finding conflicts with a decision the user already
made, raise it rather than quietly following one or the other.

Security and correctness findings get more scrutiny before you dismiss them,
not less.

**Then fix, in this order:** what is broken or unsafe, then the small certain
things, then the structural ones. One at a time, running the check after each,
so you know which change did what.

**Answer plainly.** No performative agreement, no thanks, no apology: state the
fix or state the pushback. If you pushed back and turned out to be wrong, say
what you checked, what it showed, and carry on — the correction is one line,
not a paragraph about how it happened.

When the changes are in, the check is run again and the result reported. The
review is answered when every point has a fix, a reason it does not hold, or a
question back — not when the list has been read.

## Reviewing something that is not code

The same shape holds for a document, a configuration, a prompt or a plan: what
was asked for, what the thing does, and the difference between them. The
questions change, the discipline does not — cite the place, name the concrete
consequence, and say plainly when there is nothing to report.

Sources and licences: [NOTICE.md](NOTICE.md).
