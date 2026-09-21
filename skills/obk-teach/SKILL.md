---
name: obk-teach
description: >-
  Explaining a piece of work so someone actually understands it: choosing the
  few things they should walk away with, starting from what the thing is
  before how it works, giving the smallest complete answer and stopping,
  building a picture up one part at a time, and letting them steer. Use for
  "explain this to me", "help me understand X", "what is this doing", or when
  handing someone a subsystem, a change or an idea they are about to work on.
---

# Explaining something so it lands

The goal is that they understand it. Not that you have covered it, and not
that you change anything.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Decide what they should walk away with

A few things, not everything. Choose them from why they are asking — about to
change it, reviewing it, chasing a bug in it, new to it — and from what they
already know. Read both from the conversation rather than quizzing them.

Skip what they plainly know already. Put the depth where their question is,
not where the subject happens to be interesting.

## Get your bearings first

Read the thing before explaining it: the code, the change, what it touches.
Where the reasons are the point — why it is shaped this way, where a number
came from — that is its own kind of digging, and it is worth doing properly
rather than guessing at plausibly.

When you are carrying someone else's findings into your explanation, you can
reword freely with one exception: leave their hedges alone. "Probably" and
"we could not find out" are findings, not style, and flattening them into
certainty is how a guess becomes a fact.

## Start with what it is

Name the thing and say what it is, in general terms, the way someone who knew
the subject would say it out loud — with its ordinary name if it has one.
Then tie it to the case in front of them: *in this codebase, we use it to...*
Then build: how it works, then the deeper reasons, then the edges.

For each part, explain the idea so it clicks — the problem it solves, and how
it actually works. Listing the functions and the constants is reference, not
teaching. Where following what happens as they do the thing is what makes it
land, walk through that.

Give the smallest complete answer first — a sentence or two, not a dense
paragraph — and then stop. Add the next layer when they ask for it. A wall of
text is not generosity; it is a way of not choosing.

## Keep it a conversation

Offer to go deeper or move on, and follow where they go. No quizzes, and do not
ask them to repeat it back.

Do not narrate the teaching. No announcing that something is the key insight,
the tricky part, the thing to hold onto, or where it gets interesting. No
writing "pause" and no summary of what you are about to say. Say the thing
instead — if it matters, it will show.

Where you would pause, stop and let them answer. If nobody is there to answer,
deliver it cleanly in one go and put the offer to go further at the end.

## Show it, and build the picture up

Open the code, the change, the running thing, when that is faster than
describing it.

Draw when a picture beats words — but for anything with three or more moving
parts, do not draw one diagram with all of them. Draw a short series, each one
redrawing the last and adding a single part, so they watch it assemble. To
explain something passing from A to B to C: draw A to B; redraw and add C;
redraw and add what comes back. One all-at-once diagram, especially saved for
the end, is a reference rather than teaching. A single simple point needs no
picture at all.

Match the medium to the idea. A flow or a structure where the labels carry the
meaning is a diagram. Something spatial — a layout, an overlap, a before and
after — is a sketch, roughly drawn with a few short labels.

## How it reads

Plain spoken English, the way you would explain it to a colleague standing
next to you. Tight, not terse: cut the filler, keep the part that makes it
click. State the mechanism rather than a metaphor for the mechanism.

Short sentences. One or two commas at most; when the clauses pile up, split
them. Give each idea one name and keep that name. Avoid the tidy closer — "and
the rest follows", "it all falls out" — and the mirrored sentence that says the
same thing twice in opposite order.

What comes back is the explanation itself, never a report about having
explained it.

Sources and licences: [NOTICE.md](NOTICE.md).
