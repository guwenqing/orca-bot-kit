---
name: obk-arch
description: >-
  Shaping a piece of work before building it: a short note of what is wanted
  and what done means, deciding the shape from the usage and the data with
  more than one candidate, making the thing runnable and testable so anyone
  can find out whether it works, and cutting the work into pieces that each
  end in a check. Use when starting something new, planning a feature, adding
  a public interface or a new data shape, making a choice that is hard to
  undo, or when a change is big enough that jumping into the code would settle
  the shape by accident.
---

# Shaping work before you build it

Four things: say what is wanted, decide the shape, make sure the thing can be
started and driven so anyone can tell whether it works, and cut the work into
pieces that each end in a check. The third is what makes the rest real.

None of this needs a particular document, tracker or format. Where a project
has one, use it; where it does not, a few lines in the right place do the job.

Reach for this when there is a shape to get wrong: something new, a public
interface, a new data shape, a choice that will be expensive to undo. Not for
work where the pattern is already set, a bug fix with a clear target, or a
change the constraints leave only one way to make. When it is one or two files
and the approach is obvious, say so and go and do it. A plan longer than the
work it plans is a cost with no return.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Say what is wanted

A very light note: short enough to be read, long enough that someone else could
act on it. It says:

- **The problem.** What is wrong or missing now, not the solution wearing a
  problem's clothes.
- **Who it is for.** The person who has that problem, which is often not the
  person asking.
- **What they can do once it is finished**, as behaviour someone could observe
  from outside.
- **How we will know it works**, written as checkable statements. These are the
  ones that matter most: they become the acceptance tests when the work starts
  and the "what was asked" a reviewer reads it against, so write them as
  something you could be wrong about, and never loosen one to declare victory.
- **What we are not doing.** The things nobody said aloud are the things that
  get built by accident.

No format and no home: an issue, a file, a message, a page in whatever the
project already uses. And if a proper note already exists, use that one rather
than writing a second.

## Decide the shape

### Sharpen the words while you are at it

When a term keeps doing heavy lifting ("account", "active", "ready"), say what
it means here and what it does not; where that stays vague, a concrete scenario
forces the boundary open. Check a claim about how things work against the code
rather than accepting it.

### Ground it first

Before sketching anything, build a real model of what the new code touches: the
modules it will sit between, how data reaches them now, what already owns the
rules you are about to write. Naming a file is not grounding. Trace it.
Skipping this is what produces a design that is elegant and does not fit.

Where the design redefines who owns what, find out why the current shape is
the way it is first, so the reason becomes a constraint you are choosing to
overrule rather than one you never saw. Greenfield with nothing around it is
the one case to skip.

### What a sketch is

Types, signatures and module boundaries with nothing implemented: bodies that
say "not implemented", a comment where the tricky logic will go, and a line on
each saying what it is for and what it must keep true. The test of a good one
is that a reader can follow the data from input to output by reading the
signatures alone.

That is what you compare, argue about and throw away, cheaply, which is the
point of doing it before the code.

### Usage first, then the data, then the types

Write the calls before the types: two or three real call sites, and how
someone would use it if they were reading about it for the first time. The
usage is the specification. When the sketch and the usage disagree, change the
sketch.

Then the data. Get the shape of it right before the logic, and trace every way
it will be read and written through the shape you are proposing. If the answer
to one of those is "we can add an index or a cache for that later", the shape
is wrong now, not later.

Types and data converge. Three similar lines still beat an abstraction
invented before there was anything to abstract.

Five things worth deciding while the shape is still cheap to change:

- **Let a structure carry the domain.** A state machine rather than scattered
  flags, a lookup table rather than branches spread across files, a typed
  object rather than loose parameters: the right structure makes invalid
  states impossible to write and deletes branches.

- **Put the rules in the types where you can.** A type that cannot be misused
  beats a check at runtime, which beats a comment asking people to be careful.
- **Check at the edges and trust inside.** Validate where data enters, then let
  the inside assume it is good. Scattering the same check through the middle
  means no one place is responsible for it.
- **One home per rule.** Derive the rest rather than keeping two copies in
  step; two copies of one fact is a bug with a delay on it.
- **Ask what happens if it runs twice, or stops halfway.** If the answer
  depends on what the last attempt left behind, something is missing that puts
  it back in order, and that is a design question, not an operational one.

### Design it twice

Produce at least two structurally different candidates before you choose, even
when the first looks sufficient. Whole shapes, not variations inside one shape.
Two ways to arrange the same idea teach you nothing.

A cheap way to get real difference is to give each candidate a constraint of
its own and see what it forces:

- the smallest possible interface, one to three ways in, as much behind each as
  will fit;
- the one that bends to the widest range of uses;
- the one that makes the most common case trivial and lets the rest be awkward;
- the one that puts whatever varies behind a port with adapters either side.

Keep them genuinely apart while you make them; a safe middle drafted early
defeats the point. Then compare on how much each hides, prefer the shape that
puts more behaviour behind a smaller surface (that is what a caller is buying),
and take the best parts of the others into it where they combine.

### Judging an interface

The interface is everything a caller has to know to use a piece correctly: not
only the signature, but the order things must happen in, what errors come out,
what it needs and what it costs. A good one gives a caller a lot of behaviour
for a little of that. Three questions do most of the work: can it have fewer
ways in, can the arguments be simpler, and can more be hidden behind it?

### Three tests that settle most of it

- **The deletion test.** Imagine the module gone. If the complexity goes with
  it, it was a pass-through. If the complexity reappears in every caller, it
  was earning its place.
- **The interface is the test surface.** Callers and tests cross at the same
  place. If you find yourself wanting to test past the interface, the shape is
  probably wrong.
- **One adapter is a hypothetical port; two is a real one.** This one is about
  pluggability, not about whether a module should exist. Before putting an
  interchangeable boundary in (a port with adapters either side), ask what the
  second adapter is; production plus a test double is the usual honest pair. If
  there is only ever one, you have added a layer to swap something that never
  gets swapped. Pure computation needs no adapter at all: merge it and test it
  through its interface.

  Whether a module earns its place is a different question, answered by the
  deletion test and by how much it hides. A module with one caller can be
  entirely right, hiding an invariant, a rule or a state machine that would
  otherwise sit in the middle of something else. One caller is not one adapter,
  and counting callers is not this test.

### Signs the shape is wrong

- A caller has to call several things in the right order to do one thing.
- The options expose the stages inside rather than what the caller wants.
- Learning the interface does not save you from learning the implementation.
- Several modules depend on the same decision made inside one of them.
- Modules named after the order things happen rather than what they know. The
  same rule then gets repeated in each step.
- A function that passes the same arguments on to something with the same
  shape, adding a layer and hiding nothing.

And the other way: do not force it. Boring, local and clear is right where the
thing is unlikely to grow, and an abstraction that removes no branch, no
repeated rule and no impossible state is just indirection. The tell that this
step got skipped is the next feature adding one more branch to an if-else
chain, or a second flag that has to be kept in step with the first.

### Write down what you chose

One short paragraph, where the next person will find it: the problem, how it
is used, the shape, the trade-offs accepted (in the form *we accept X in
exchange for Y*), at least one other shape you considered with a line on why
it lost, and anything still open.

Where the constraints left only one shape, say that instead: "the only viable
shape, because...". Name anything a later reader might mistake for an
oversight.

A lasting record of its own, kept beyond the change, earns its place when all
three are true: it is hard to reverse, it is surprising without the context,
and it came out of a genuine trade-off. Miss one and the paragraph is enough.

### When to build a throwaway instead of arguing

A prototype answers one question and is then deleted. No question, no
prototype: "let's try something" is not a question.

Skip the polish deliberately: no tests, no error handling beyond what makes it
run, no abstractions. Say out loud that it is throwaway, so nobody tries to
harden it or ship it.

Three things make one actually useful. It has to be trivial to start: one
command, or a file someone double-clicks; anything that needs explaining will
not get run by the person whose opinion you wanted. It should keep nothing
between runs, because persistence is usually the thing being questioned rather
than something to lean on. And it should show its state after every action, so
what changed is visible rather than inferred.

The observation is the result, not the code. Keep the decision it produced,
throw the prototype away or park it somewhere clearly marked, and write the
real thing from the beginning, test first.

## Make it runnable and testable

This is the part that makes an agent able to check its own work at any size
above a single function, and it belongs in the design rather than after it.
When a whole application is designed, or a feature is planned, the end-to-end
test work is planned at the same time and with the same care, and written, like
any other test, by someone other than the implementer.

Answer these about the thing you are shaping, from the code where you can
rather than by asking:

- **Surface**. What does a person actually touch? A screen, a command, an
  endpoint, a library. If there are several, pick the main one and name the
  rest.
- **Start**. How does it come up, and how do you know it is ready? A log line,
  a port answering, a prompt appearing. Guessing with a pause is not knowing.
- **Drive**. How can something interact with it with nobody watching?
  Whatever the project already has first; a general harness only after that.
- **Observe**. What evidence can be captured? Output, an exit status, a file,
  a stored row, a message sent, a picture of the screen.
- **Isolate**. Can two of these run side by side, with their own ports and
  data? If not, say so plainly, because refusing to drive a shared instance is
  better than corrupting the one someone is using.

If the thing does not build or start as it stands, either fix that first or say
precisely what stopped it: which command, which failure, what was missing.
A recipe written against a broken checkout and presented as working teaches the
next reader the wrong steps, confidently. A recipe written against one and
marked as not yet run is still worth having: it says what the proof will be
once someone can get the thing up, which is most of the value. What it must not
do is claim to have been proven. And repairing whatever is broken is its own
piece of work, not something to absorb quietly into this one.

Prefer handles that survive: the name of a thing, a label, a route, a prompt
the program prints. Positions, orders and coordinates all drift, and a recipe
pinned to them fails for reasons that have nothing to do with the code.

Worth writing beside the recipe: a short list of what the thing actually does
for someone, one entry per feature (how to reach it, how to drive it, and what
state proves it worked). It is the part people find most useful later, because a
proof that exercises whichever entry point was convenient is incomplete when
the list names others. Start with the few that matter and let it grow.

Worth having beside that: one read-only check that answers "is this instance
worth driving at all" (is it up, is it the build I think, is that port ours).
Run it first whenever something looks strange, before debugging the thing
underneath.

What a proof has to do, which is where most of them fail:

- drive the path a person would actually take, not an internal setter or a
  door that exists only for tests;
- capture the action and the state it produced, not only the final screen;
- check the effects as well as what is visible: what was written, sent,
  recorded;
- stand in for something only where a real boundary already separates it.

Where the safe path is a dry run, find out what it genuinely skips by watching
what happens (files, network, state) rather than trusting its name.

Clean up what a run started, and never by name: stop what you started. Cleanup
takes the instance away and leaves the evidence where it said it would be.

Whatever you write down so that the next agent can do this, run it once, end to
end, before you hand it over. Instructions nobody has executed are a draft.

Where the work is about changing a number rather than adding a behaviour, take
the measurement before you start, so the check reads as the old value against
the new one rather than as a number with nothing to compare it to.

And be strict about what counts. A check comes back verified, not verified, or
inconclusive. And inconclusive is not a pass. Read the artefact rather than a
report about it. When something passes more easily than you expected, suspect
the way you are observing before you believe the result: that is the shape of a
check that is not actually looking.

### Designing so this is possible

Accept what you depend on rather than building it inside. Return results
instead of reaching out and changing things. Keep the surface small: fewer ways
in means less to set up.

How you test across a boundary follows what is behind it. Pure computation:
no boundary needed, test through the interface. Something with a good local
stand-in: use the stand-in and keep the boundary inside. Your own service
across a network: a port at the boundary, a real adapter for production and an
in-memory one for tests. Something you do not own at all: a port, and a
stand-in for it.

Once behaviour is covered through the interface above, tests against the pieces
inside it prove the same thing twice; retiring them, like any change to
tests, is for whoever wrote them.

## Cut the work into pieces

Each piece ends in a state you can check, and a piece that depends on it does
not start until it is green. A break found at the step that caused it is cheap; the
same break found five steps later is buried under everything built on top of
it.

- **Each piece is a narrow but complete path** through every layer it touches,
  not one layer done across the whole feature. A finished piece can be shown
  or checked on its own.
- **Sized to what one fresh context can hold**, because a piece that does not
  fit gets done half-remembered.
- **Ordered by what you will learn.** The riskiest unknown first, so that
  being wrong about it is cheap.
- **Prefactor where it helps.** Make the change easy, then make the easy
  change. A small reshaping is part of the change; a large one is a piece of
  its own, before the feature.
- **The first piece gets the thing running and testable as a whole**, even if
  it does almost nothing yet. That is where the end-to-end test work lands, and
  everything after it is checked through what it puts in place.
- **Each piece names the evidence** that says it is done: a test run, a file, a
  line of output, a command. It is done when the evidence exists, not when it
  feels done.
- **Say which pieces depend on which, and which can run side by side.** Two
  people, or two sessions, can take independent pieces at once; a dependency
  nobody wrote down turns into two people editing the same thing.

The exception is a change that has to happen everywhere at once. Sequence it as
expand, migrate, contract: add the new form beside the old so nothing breaks,
move the callers over in batches sized by what each batch touches, then delete
the old form once nothing calls it. If a piece deliberately leaves something
broken in between, say which piece and for how long.

## Before you build on it

Find out what the shape breaks elsewhere. Listing the callers is not the job;
the breakage a search does not show is (a changed order, a new precondition, an
assumption two things shared). Most plans that look risky are safe because of
one fact: find it, since if it holds most of the risky cases clear at once.

Look where a symbol search stops, because that is where the surprises are: the
library you call, at the version actually pinned; when things run, not only
what calls what; and what two things agree on without naming each other (the
shape of what an interface returns, a stored column, a wire format, something
in another language reading the same bytes, a setting that turns a path on).
Give each risk you keep a real likelihood and a real cost.

Then say how far you proved it: you said so, you pointed at the line, you
walked the bad case through, you ran something that would have failed if you
were wrong, or you saw it in the running thing. Short of running it, say so
rather than writing it up as settled, and list what you checked and cleared as
well as what you kept.

## When the shape turns out to be wrong

Deviations from the sketch are signal, not friction to absorb quietly. A
function that needs a parameter the sketch did not anticipate is asking a
question: was the sketch wrong, was the requirement missed, or is the
implementation reaching for something that is not its business?

The signal is a pattern rather than a single instance:

- the same shape of workaround appearing in unrelated places;
- several unrelated edge cases that each need their own special branch;
- types needing escape hatches to compile at all;
- reaching for a lock where the sketch said nothing was shared;
- callers having to know the rules inside to use it correctly.

A few edge cases do not condemn a design; some problems really are knotty, and
complexity in the problem is not complexity in the design. But when the pattern
is there, say so and redesign, rather than paying it off one branch at a time.

Sources and licences: [NOTICE.md](NOTICE.md).
