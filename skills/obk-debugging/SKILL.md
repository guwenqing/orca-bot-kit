---
name: obk-debugging
description: >-
  Finding the cause of a bug and proving you found it: building a check that
  goes red on this bug before theorising, reading the error and asking what
  changed, reproducing and cutting it down, saying the cause in one testable
  sentence that explains every symptom, probing one variable at a time, fixing
  the cause rather than the symptom, and proving it where the bug appeared.
  Use whenever something is broken, failing, throwing, hanging, flaky, slow,
  or behaving differently from how it behaved before — including when you
  think you already know why, since that is when the wrong fix gets shipped.
---

# Finding the cause

Nearly all of this is one thing: get a check that goes red on this bug, and
keep it. Bisecting, guessing, instrumenting and reading code all spend that
check. Without one you are looking at code and hoping.

The order matters more than the cleverness. A cause named before there is
anything to test it against is a guess wearing a lab coat.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Build the check first

Spend more effort here than feels reasonable. With a tight red check the rest
is mechanical; without one, no amount of staring saves you.

Ways to get one, roughly in this order:

1. A failing test, at whatever seam reaches the bug.
2. A request against a running instance, scripted.
3. A command-line run against a fixed input, its output compared with a known
   good one.
4. A script that drives the interface and asserts on what it sees.
5. A captured real request, payload or event log, replayed through the code
   path on its own.
6. A throwaway harness: the smallest slice of the system that reaches the bug
   in one call.
7. A loop over many generated inputs, when the complaint is "sometimes wrong".
8. A harness that boots at a given state and checks, so a bisect can drive it.
9. The same input through two versions or two configurations, outputs
   compared.
10. A scripted set of steps for a person to follow, driving them rather than
    asking them to explore. A last resort, and still a structure.

Then tighten it, because a loop is a thing you build, not a thing you find.
Can it be faster — less setup, narrower scope? Sharper — asserting the exact
symptom rather than "it did not crash"? More repeatable — time pinned, random
seeded, the filesystem and the network held still? A thirty-second flaky loop
is barely better than nothing. A two-second reliable one changes the day.

When it only happens sometimes, the goal is not a clean reproduction but a
higher rate. Run the trigger a hundred times, run copies at once, add load,
narrow the window, insert a pause where the timing is tight. A one-in-two bug
is workable; a one-in-a-hundred is not, so raise the rate until it is.

You have what you need when you can name one command, that you have already
run at least once, which:

- goes red on *this* bug — it drives the real path and asserts the symptom
  that was actually reported, not merely that something failed;
- gives the same answer every time, or fails at a rate you pinned;
- takes seconds;
- runs without a person in the middle.

If you notice yourself reading code to build a theory before that command
exists, stop. Going straight to a theory is the failure this order prevents.

When you genuinely cannot build one, say so plainly, list what you tried, and
ask for what would make it possible: access to where it happens, a captured
artefact, or permission to instrument the place it actually runs. Do not
proceed to theorise without a check. Whatever you show — commands, output,
captured traffic — take the secrets out of it first.

## Read what it says, and ask what changed

Before any theory: read the error, all of it, and read the documentation of the
thing that failed. A surprising amount of debugging is skipping this.

Then ask what changed, because most things that "started happening" have an
answer there: the version, a dependency, the environment, the data, the
configuration, the last commit or deploy that worked. When you have a last good
state and a first bad one, the difference between them is the shortest path to
the cause you will get.

When something fails after a restart, suspect stored state before code: a
cache, a lock file, a serialised value, a config written by an earlier run. If
clearing it restores the behaviour, the fix is usually making that state safe
to find, not deleting it by hand.

## Reproduce it, then cut it down

Run the check and watch it go red. Confirm it is the failure that was
reported and not a different one nearby — the wrong bug gets the wrong fix.
Capture the exact symptom: the message, the wrong value, the timing.

Then make it smaller. Remove one input, one caller, one setting, one step at a
time, running the check after each. Stop when every remaining piece is
load-bearing: take any one away and it goes green.

This is not tidiness. A small reproduction leaves fewer things to suspect, and
it is the regression test you are going to need later anyway.

## Say the cause in one sentence

Do not change code until you can write this down:

> I believe the cause is X, at this file and line, because Y.

Specific enough to be wrong. "A state problem" cannot be tested. "The cached
value in `user.ts` is never cleared when the account id changes, so the second
lookup returns the first account's name" can be.

It has to explain every symptom, including the one the reporter mentioned in
passing and dismissed. A sentence that covers most of them is a guess about a
symptom, not a cause.

Write three to five candidates and rank them before testing any. One candidate
on its own anchors you to whatever occurred to you first, and everything after
that is a search for confirmation.

Each one has to be falsifiable — say what it predicts: *if X is the cause,
changing Y makes it go away, and changing Z makes it worse.* A candidate that
predicts nothing is a feeling; sharpen it or drop it.

If someone is there to read the ranked list, show it. Domain knowledge re-ranks
it in seconds — "we changed that last week" — and it costs nothing to ask. Do
not wait on it.

## Probe one thing at a time

Every probe answers one prediction, and only one variable moves at a time.

A debugger or an interactive session beats logs where you have one: a single
breakpoint tells you more than ten print statements. Failing that, put logs at
the boundary that separates two candidates. Never log everything and search
through it afterwards.

Every log is a yes-or-no question: *if this prints before that, candidate A
lives, otherwise A is dead.* A log that cannot rule anything in or out is
noise. Tag the temporary ones with a single marker of your own so that removing
them later is one search.

If adding a log changes the behaviour, that is not an annoyance, it is your
answer arriving early: something about timing, ordering or two things running
at once.

Across several parts, log what goes into each one and what comes out, run it
once, and find the boundary where good becomes bad. Then work inside that part
rather than everywhere at once.

Trace backwards from the symptom: what produced this value, what called that,
what did it pass, back to where the wrong thing was born. That is where the fix
goes. Log before the dangerous operation rather than after it fails, and
capture the call chain where you can — in a test, print to the error stream,
since a logger may be swallowed.

Then confirm or discard. Run the probe that would fail if you were wrong, and
read it. If it contradicts you, drop the idea rather than patching around it,
and start from what the probe just showed. Do not stack a fix on an idea that
has already been disproved.

Things you will catch yourself saying, and what each one means:

- "I'll just try this" — you have no hypothesis. Write one.
- "I'm confident" — then run the probe that would embarrass you.
- "Probably the same as that other one" — re-read this path from the start.
- "It works on my machine" — list the differences before dismissing it.
- "One more restart" — read the last error, word for word, instead.

## Bisecting

Worth it when the bug appeared between two known states and you have a
non-interactive pass/fail command decided in advance.

Look at the difference first. If the last good version is only a little way
back, reading the diff over the suspect area usually shows the regression at a
fraction of the cost of a search.

Check the working tree is clean before you start, and if it is not, do the
search on a separate copy rather than moving what someone is working on.

## When it is slow rather than wrong

Measure first, fix second, and cite numbers: a baseline, the change, the same
measurement again. Logs are usually the wrong instrument here; a profile, a
timing harness or a query plan is the right one. Do not claim a limit you have
not measured.

Where the measurement points, these are the usual shapes a fix takes. They are
ways to generate a hypothesis, not a list to work through, and one earns an
attempt only when the measurement shows what it needs:

- **Remove it.** The fastest work is the work nobody needs: a result nothing
  consumes, a path that is always off, a sync that repeats what is already
  true. A profile shows what is slow, never what is unnecessary, so this one
  comes from reading rather than measuring.
- **Split it.** The cost follows the size of the input: cut it into pieces that
  each touch less, or run independent pieces at once.
- **Remember it.** The same work repeats on the same input. Keep the answer —
  and say what makes it wrong again before you call it a win.
- **Go through something cheaper.** An index instead of a scan, a queue instead
  of doing it now. Worth it only when the hop removes more than it adds.
- **Do them together.** Many small operations each paying a fixed cost — pay it
  once for the batch.
- **Do it elsewhere.** The work has to happen but not while someone is waiting:
  before they arrive, after the moment passes, when nothing else is going on.
- **Do it later, or never.** Cost paid for results nobody asks for. Wait until
  something needs it.

## When it only happens sometimes

Get the rate up before diagnosing; a bug you cannot summon is a bug you cannot
study.

Then wait for the condition, not for a duration. A fixed pause is a guess about
someone else's machine, and it is why a test passes here and fails under load.
Watch for the thing you actually care about, read it fresh each time rather
than checking a value you captured before the loop, and always set a limit with
a message saying what never happened.

Where a wait really is about time — something ticks at a known interval — wait
for the triggering condition first, then wait the interval you know about, and
write down why that number.

## Fix the cause

A guard that silences a crash is a note to the user, not a fix. If a workaround
needs a paragraph to justify it, the code is wrong and the paragraph is
evidence.

Ship the smallest change the evidence justifies. Anything added because it
"might help" is another untested hypothesis, and when the evidence refutes the
idea that motivated a change, take the change back out.

Then look for siblings. Take what characterises this bug — the call, the
pattern, the missing check — and search for it. For every match, say in writing:
the same bug, or safe and why, or unsure and worth asking about. Do not skip
one silently. Anything unrelated that the sweep turns up gets listed rather than
fixed here.

## Prove it where it appeared

Write the regression test before the fix, at a seam where it exercises the bug
the way it actually happened. A seam too far inside gives a test that passes
and protects nothing. If there is no correct seam, that is itself the finding:
say so, because the shape of the code is what is stopping the bug from being
pinned down.

Watch it fail. Fix. Watch it pass. Then run the original, unminimised scenario
again, on the same surface the bug appeared on. A different surface, or an
inconclusive result, is not a pass. A unit test shows that a branch behaves; it
does not show that the bug is gone. Where the symptom was something you could
see, look at it — compiling is not seeing.

## When it is not working

Two attempts from the same idea have failed: stop, write down the assumption
both of them shared, and test that instead. That assumption is where the bug
is hiding.

Three ideas have failed: stop and report. The same symptom after a fix is a
full stop, not a reason to try again — it means the idea was never finished.

When each fix moves the problem somewhere else, or turns up more shared state,
or would need a large restructuring to do properly, the shape of the thing is
wrong and no further hypothesis at this level will help. Say that, rather than
producing a fourth.

When you stop, say: what you expected, what you saw instead, what you ruled out
and what ruled it out, and what you need — access, an artefact, a decision.

If someone asks you "is that actually happening?" or "will that tell us
anything?" or says "stop guessing", they are telling you that you are theorising
without evidence. They are usually right.

## Before you call it done

- The original reproduction no longer reproduces, and you ran it again to see.
- The regression test passes, or the absence of a seam is written down.
- Every temporary log is gone — search for the marker you used.
- Throwaway harnesses are deleted, or clearly marked as what they are.
- The idea that turned out to be right is written down where the next person
  to touch this will find it. They will be you.

## Away from code

A configuration, a document, a data pipeline or a prompt gives way to the same
order: get something that shows the fault reliably, read what it actually says,
ask what changed, name the cause in a sentence that covers every symptom, and
prove the fix on the thing that failed rather than on a copy of it.

Sources and licences: [NOTICE.md](NOTICE.md).
