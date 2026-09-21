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

Four things, and the fourth is what makes the rest real: say what is wanted,
decide the shape, make sure the thing can be started and driven so anyone can
tell whether it works, and cut the work into pieces that each end in a check.

None of this needs a particular document, tracker or format. Where a project
has one, use it; where it does not, a few lines in the right place do the job.

Reach for this when there is a shape to get wrong: something new, a public
interface, a new data shape, a choice that will be expensive to undo. Not for
work where the pattern is already set, a bug fix with a clear target, or a
change the constraints leave only one way to make. When it is one or two files
and the approach is obvious, say so and go and do it — a plan longer than the
work it plans is a cost with no return.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Say what is wanted

Short enough to be read. Long enough that someone else could act on it. One
note, saying:

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
- **What must not break.**

No format and no home: an issue, a file, a message, a page in whatever the
project already uses. And if a proper note already exists, use that one rather
than writing a second.
- **What you do not know yet**, separated into what changes the shape and what
  can be settled later. Only the first kind is worth stopping for.
- **What happens when it goes wrong**, what limits it has to hold, and how
  anyone will see what it is doing once it is running. This part gets left out
  most often, and it is usually the part that decides the shape.

## Decide the shape

### Sharpen the words while you are at it

Half the arguments about a design are two people using one word for two things.
When a term keeps doing heavy lifting — "account", "session", "active",
"ready" — stop and say what it means here, and what it does not. Where the
answer is vague, invent a concrete scenario that forces the boundary into the
open: this customer, with this half-finished order, on the day their card
expires — is that active or not?

Check what you are told against the code rather than accepting it. "It always
has an owner" is a claim, and the place it stops being true is usually where
the design needs to change. Write the words down as they settle, wherever the
project keeps such things.

### Ground it first

Before sketching anything, build a real model of what the new code touches: the
modules it will sit between, how data reaches them now, what already owns the
rules you are about to write. Naming a file is not grounding — trace it.
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

That is what you compare, argue about and throw away — cheaply, which is the
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

Four things worth deciding while the shape is still cheap to change:

- **Put the rules in the types where you can.** A type that cannot be misused
  beats a check at runtime, which beats a comment asking people to be careful.
- **Check at the edges and trust inside.** Validate where data enters, then let
  the inside assume it is good. Scattering the same check through the middle
  means no one place is responsible for it.
- **One home per rule.** Derive the rest rather than keeping two copies in
  step; two copies of one fact is a bug with a delay on it.
- **Ask what happens if it runs twice, or stops halfway.** If the answer
  depends on what the last attempt left behind, something is missing that puts
  it back in order — and that is a design question, not an operational one.

### Design it twice

Produce at least two structurally different candidates before you choose, even
when the first looks sufficient. Whole shapes, not variations inside one shape
— two ways to arrange the same idea teach you nothing.

A cheap way to get real difference is to give each candidate a constraint of
its own and see what it forces:

- the smallest possible interface, one to three ways in, as much behind each as
  will fit;
- the one that bends to the widest range of uses;
- the one that makes the most common case trivial and lets the rest be awkward;
- the one that puts whatever varies behind a port with adapters either side.

Then compare on how much each hides. Prefer the shape that puts more behaviour
behind a smaller surface: that is what a caller is buying.

### The words, used precisely

Worth using these exactly, because the whole value is that two people mean the
same thing:

- **Module** — anything with an interface and an implementation. A function, a
  class, a package, a slice through several layers. Scale does not matter.
- **Interface** — everything a caller has to know to use it correctly. Not just
  the signature: the invariants, the order things must happen in, what errors
  come out, what configuration it needs, what it costs.
- **Implementation** — what is inside.
- **Seam** — the place where behaviour can be changed without editing in that
  place; where an interface lives. Where to put it is its own decision,
  separate from what goes behind it.
- **Adapter** — something that satisfies an interface at a seam. A role, not a
  size: a small adapter can have a large implementation behind it.
- **Internal and external seams** — a module can have seams inside it, private
  to how it works and used by its own tests, as well as the one at its
  interface. Having one inside is not a reason to expose it.
- **Depth** — how much behaviour a caller gets per unit of interface they have
  to learn. Deep is a lot behind a little. Shallow is an interface nearly as
  complicated as what it hides, which buys nobody anything.

When you have an interface in front of you, three questions do most of the
work: can it have fewer ways in, can the arguments be simpler, and can more be
hidden behind it?

### Three questions that settle most of it

- **The deletion test.** Imagine the module gone. If the complexity goes with
  it, it was a pass-through. If the complexity reappears in every caller, it
  was earning its place.
- **The interface is the test surface.** Callers and tests cross at the same
  place. If you find yourself wanting to test past the interface, the shape is
  probably wrong.
- **One adapter is a hypothetical port; two is a real one.** This one is about
  pluggability, not about whether a module should exist. Before putting an
  interchangeable boundary in — a port with adapters either side — ask what the
  second adapter is; production plus a test double is the usual honest pair. If
  there is only ever one, you have added a layer to swap something that never
  gets swapped. Pure computation needs no adapter at all: merge it and test it
  through its interface.

  Whether a module earns its place is a different question, answered by the
  deletion test and by how much it hides. A module with one caller can be
  entirely right — hiding an invariant, a rule or a state machine that would
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
is used, the shape, the trade-offs accepted — in the form *we accept X in
exchange for Y* — at least one other shape you considered with a line on why
it lost, and anything still open.

Name anything a later reader might mistake for an oversight.

Worth writing down at all when all three are true: it is hard to reverse, so
changing your mind later costs something real; it is surprising without the
context, so a reader will wonder why on earth it was done this way; and it came
out of a genuine trade-off, with alternatives that could have been chosen.
Easy to reverse and you will simply reverse it. Not surprising and nobody will
ask. No real alternative and there is nothing to record beyond doing the
obvious thing. Otherwise the code says it.

### When to build a throwaway instead of arguing

A prototype answers one question and is then deleted. No question, no
prototype — "let's try something" is not a question.

Skip the polish deliberately: no tests, no error handling beyond what makes it
run, no abstractions. Say out loud that it is throwaway, so nobody tries to
harden it or ship it.

Three things make one actually useful. It has to be trivial to start — one
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
test work is planned at the same time and with the same care.

Answer these about the thing you are shaping, from the code where you can
rather than by asking:

- **Surface** — what does a person actually touch? A screen, a command, an
  endpoint, a library. If there are several, pick the main one and name the
  rest.
- **Start** — how does it come up, and how do you know it is ready? A log line,
  a port answering, a prompt appearing. Guessing with a pause is not knowing.
- **Drive** — how can something interact with it with nobody watching?
  Whatever the project already has first; a general harness only after that.
- **Observe** — what evidence can be captured? Output, an exit status, a file,
  a stored row, a message sent, a picture of the screen.
- **Isolate** — can two of these run side by side, with their own ports and
  data? If not, say so plainly, because refusing to drive a shared instance is
  better than corrupting the one someone is using.

If the thing does not build or start as it stands, fix that before writing any
of this down. A recipe written against a broken checkout teaches the next
reader the wrong steps, confidently.

Prefer handles that survive: the name of a thing, a label, a route, a prompt
the program prints. Positions, orders and coordinates all drift, and a recipe
pinned to them fails for reasons that have nothing to do with the code.

Worth writing beside the recipe: a short list of what the thing actually does
for someone, one entry per feature — how to reach it, how to drive it, and what
state proves it worked. It is the part people find most useful later, because a
proof that exercises whichever entry point was convenient is incomplete when
the list names others. Start with the few that matter and let it grow.

Worth having beside that: one read-only check that answers "is this instance
worth driving at all" — is it up, is it the build I think, is that port ours.
Run it first whenever something looks strange, before debugging the thing
underneath.

What a proof has to do, which is where most of them fail:

- drive the path a person would actually take, not an internal setter or a
  door that exists only for tests;
- capture the action and the state it produced, not only the final screen;
- check the effects as well as what is visible — what was written, sent,
  recorded;
- stand in for something only where a real boundary already separates it.

Where the safe path is a dry run, find out what it genuinely skips by watching
what happens — files, network, state — rather than trusting its name.

Clean up what a run started, and never by name: stop what you started. Cleanup
takes the instance away and leaves the evidence where it said it would be.

Whatever you write down so that the next agent can do this, run it once, end to
end, before you hand it over. Instructions nobody has executed are a draft.

Where the work is about changing a number rather than adding a behaviour, take
the measurement before you start, so the check reads as the old value against
the new one rather than as a number with nothing to compare it to.

And be strict about what counts. A check comes back verified, not verified, or
inconclusive — and inconclusive is not a pass. Read the artefact rather than a
report about it. When something passes more easily than you expected, suspect
the way you are observing before you believe the result: that is the shape of a
check that is not actually looking.

### Designing so this is possible

Accept what you depend on rather than building it inside. Return results
instead of reaching out and changing things. Keep the surface small: fewer ways
in means less to set up.

How you test across a seam follows what is behind it. Pure computation: no
seam needed, test through the interface. Something with a good local stand-in:
use the stand-in and keep the seam inside. Your own service across a network:
a port at the seam, a real adapter for production and an in-memory one for
tests. Something you do not own at all: a port, and a stand-in for it.

Replace, do not layer. Once the behaviour is covered through the deeper
interface, a second set of tests against the pieces inside proves the same
thing twice and pins the inside in place. But a new location is not the same as
new coverage: a test at the interface that exercises the ordinary path does not
stand in for the one that covered a retry charging twice. What retires is what
is genuinely superseded — the same behaviour, now checked through the new
interface — or what was tied to internals that no longer exist. Everything else
is carried across.

And it is not the implementer's call. The tests belong to whoever wrote them;
an ordinary restructuring keeps them green, and where a change is big enough
that they cannot hold, the separate author writes them again from the
requirement.

## Cut the work into pieces

Each piece ends in a state you can check, and the next one does not start
until this one is green. A break found at the step that caused it is cheap; the
same break found five steps later is buried under everything built on top of
it.

- **Each piece is a narrow but complete path** through every layer it touches,
  not one layer done across the whole feature. A finished piece can be shown
  or checked on its own.
- **Sized to what one fresh context can hold**, because a piece that does not
  fit gets done half-remembered.
- **Ordered by what you will learn.** The riskiest unknown first, so that
  being wrong about it is cheap.
- **Prefactor first.** Make the change easy, then make the easy change — and
  that reshaping is its own piece, before the feature.
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

Find out what the shape breaks elsewhere. Listing the callers is not the job —
that is a search anyone can run. The job is the breakage a search does not
show: a changed order, a new precondition, an assumption two things shared.

For each fact the safety of the plan rests on, get as far down this as is cheap
and say where you stopped:

1. You said so. Worth nothing on its own.
2. You pointed at the line that says so.
3. You walked the bad case through and showed it cannot get there.
4. You ran something that calls the real code and would have failed if you
   were wrong.
5. You saw it in the running thing.

Anything you could not get to the fourth, say so rather than writing it up as
settled. The fourth is usually one small script.

Look where a search stops, because that is where the surprises are: inside the
library you call, and at the version actually pinned rather than the one whose
documentation you read; in when things run, not just what calls what; and in
everything a symbol search cannot see — the shape of what an interface returns,
a column, a format two things agree on, something in another language reading
the same bytes, a setting that turns a path on, code three hops downstream.

Then be honest about each risk you keep: how likely it really is, and what it
would actually cost. List separately what you checked and cleared, because that
is what tells the next reader the search happened at all. A search that finds
nothing is a result worth writing down.

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

## Away from code

The same four moves carry to anything with a shape: say what is wanted and what
done means, work out the arrangement from how it will be used rather than from
how it will be built, make sure there is a way to tell whether it works, and
break it into pieces that each end somewhere you can check.

Sources and licences: [NOTICE.md](NOTICE.md).
