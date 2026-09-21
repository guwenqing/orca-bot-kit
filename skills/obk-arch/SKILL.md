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

Short enough to be read. Long enough that someone else could act on it.

- **What it has to do**, as behaviour someone could observe from outside.
- **What done means**, as something checkable that you could be wrong about —
  written before the work starts, and never loosened later to declare victory.
- **What is out of scope.** The things nobody said aloud are the things that
  get built by accident.
- **What must not break.**
- **What you do not know yet**, separated into what changes the shape and what
  can be settled later. Only the first kind is worth stopping for.
- **What happens when it goes wrong**, what limits it has to hold, and how
  anyone will see what it is doing once it is running. This part gets left out
  most often, and it is usually the part that decides the shape.

## Decide the shape

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
- **Depth** — how much behaviour a caller gets per unit of interface they have
  to learn. Deep is a lot behind a little. Shallow is an interface nearly as
  complicated as what it hides, which buys nobody anything.

### Three questions that settle most of it

- **The deletion test.** Imagine the module gone. If the complexity goes with
  it, it was a pass-through. If the complexity reappears in every caller, it
  was earning its place.
- **The interface is the test surface.** Callers and tests cross at the same
  place. If you find yourself wanting to test past the interface, the shape is
  probably wrong.
- **One adapter is a hypothetical seam; two is a real one.** Do not put a seam
  where nothing actually varies. A seam with one thing behind it is
  indirection with a nice name.

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

Name anything a later reader might mistake for an oversight. Worth writing at
all when the decision is hard to reverse, surprising, or a real trade-off;
otherwise the code says it.

### When to build a throwaway instead of arguing

A prototype answers one question and is then deleted. No question, no
prototype — "let's try something" is not a question.

Skip the polish deliberately: no tests, no error handling beyond what makes it
run, no abstractions. Say out loud that it is throwaway, so nobody tries to
harden it or ship it. The observation is the result, not the code. Writing the
real thing starts again, test first.

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

### Designing so this is possible

Accept what you depend on rather than building it inside. Return results
instead of reaching out and changing things. Keep the surface small: fewer ways
in means less to set up.

How you test across a seam follows what is behind it. Pure computation: no
seam needed, test through the interface. Something with a good local stand-in:
use the stand-in and keep the seam inside. Your own service across a network:
a port at the seam, a real adapter for production and an in-memory one for
tests. Something you do not own at all: a port, and a stand-in for it.

And once tests exist at the deeper interface, the old tests against the shallow
pieces are waste. Replace, do not layer: delete them.

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
- **Each piece names the evidence** that says it is done: a test run, a file, a
  line of output, a command. It is done when the evidence exists, not when it
  feels done.

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
