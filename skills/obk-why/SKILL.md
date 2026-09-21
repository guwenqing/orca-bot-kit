---
name: obk-why
description: >-
  Finding out why code is the way it is, and saying how sure you are: anchoring
  the question in the actual lines, following the history and the discussion
  around them, looking wherever else this project records its reasons, and
  separating what someone actually wrote from what you worked out and what
  nobody recorded. Run it when you are asked to: "why is this like this", "why
  did we pick that", "where did this number come from", "find out why before
  you touch it". Not something to launch on your own before an ordinary change;
  where the shape puzzles you and nobody asked, say so and offer it.
---

# Why it is like this

Code does not carry its own motivation. You can read what it does; you cannot
read why it exists. That lives in commits, reviews, issues, documents and
conversations — all partial, some missing, some wrong. Pretending otherwise
produces a confident answer that sends someone the wrong way.

So the work is two things: find what was actually recorded, and be honest
about the difference between that and what you have pieced together.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## The question, and the lines it is about

Work out what is being asked about and what kind of answer would settle it —
the reason for a design, a trade-off, an edge case that forced something, an
outside constraint, or something that looks dead. Where the target is vague,
say which reading you took in a line and carry on, so it can be corrected
without a round trip.

Then anchor it in the code before going anywhere else: the files and the line
ranges, the names that matter, the last handful of changes that touched them,
and the review or discussion those changes belong to. Everything after this
hangs off that anchor, and an investigation that never had one tends to answer
a question nobody asked.

Where the project keeps its history, that is the one source you can count on. Who last touched these
lines and in what change; the whole life of the file, including through
renames; what the change said about itself; and whatever discussion is attached
to it, which is usually where the reason actually is.

## Then look where else this project keeps its reasons

Different reasons live in different places, and which of these exist varies by
project. Use the ones it has:

- **The history and its discussion** — always. Best for the reason given at
  the time by the person doing it, under review.
- **Whatever tracks the work** — issues, tickets, a board. Best when the reason
  came from outside engineering: a customer, a deadline, a rule.
- **Longer documents** — a design note, a page somewhere. Best where the
  thinking was written out before it became code.
- **The conversation** — wherever the team talks. Best for the deliberation
  that never made it into anything durable, and most valuable exactly when the
  written trail is thin.
- **Whatever records what actually happened in use** — errors, metrics, logs.
  Best for defensive code: a guard, a retry, a limit, a special case usually
  exists because something happened.

Look in them in parallel where you can, one pass per source with its own
question. Where a source does not exist or you cannot reach it, that is a
finding: write down that you could not look there. Skipping something because
it is probably irrelevant is not the same as it being provably irrelevant, and
the first one belongs in the write-up as a gap.

Watch for the newest change looking authoritative. The shape you are asking
about is usually the accumulation of several decisions, and the most recent one
often only moved something that an earlier one put there. Trace back until the
reason appears or the trail ends.

And watch for a history that has been flattened. Where a project collapses a
branch into a single change when it lands, that change shows the end state and
none of the steps: a value that was set, argued over and moved twice appears to
have arrived at its final form in one go. The steps are still there, on the
branch or in the discussion attached to it, and that is usually where the
reason is — the argument that moved it is more informative than the number it
landed on. Cite the change that actually did the thing, not the one that
delivered it.

## How sure you are

Every claim sits in one of these, and it is said differently in each. Keeping
them apart is most of the value of the whole exercise.

- **Someone wrote it down.** An explicit statement answering the question — a
  change description saying what it fixes, a comment saying why the number is
  what it is, a document choosing between two options. Say it plainly, present
  tense, and cite where it came from.
- **Several things point the same way.** Nothing states it, but the evidence
  converges. Say so, and name the pieces: "the evidence points to X — the
  change is labelled performance, the tests added all exercise very large
  inputs, and the surrounding work touches the same path."
- **You worked it out.** A reasonable reading with nothing explicit behind it.
  Hedge it, and show the chain: given this and this, that seems likely, because
  of this. The reader needs to know it is your interpretation.
- **You are guessing.** Plausible, thin evidence, other explanations fit as
  well. Say it is a guess and put the alternatives next to it.
- **Nobody recorded it.** You looked and it is not there. This is a real
  result and worth saying precisely: not "we could not find out" but what you
  searched and how. The specific version tells the next person where not to
  look again.

Do not launder one of these into another. An inference stated in the voice of
a citation is the failure this whole skill exists to prevent.

## What you hand back

- **The question**, as you understood it.
- **The code**, so the reader knows what is being explained.
- **What was actually recorded**, cited.
- **What follows from it**, marked as reasoning.
- **Other explanations that fit**, where more than one does.
- **What nobody wrote down**, with what you searched.
- **Where you looked** — one line per source, including the ones that held
  nothing and the ones you could not reach, with the reason.
- **How sure you are overall**, in a line.

When this is the prelude to changing the thing, finish by turning the reasons
into constraints on that change: what must be preserved and why, what is free
to change, what to avoid doing, and what is risky because the original reason
may still apply. That is what makes the history useful rather than merely
interesting.

Sources and licences: [NOTICE.md](NOTICE.md).
