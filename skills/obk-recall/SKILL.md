---
name: obk-recall
description: >-
  Rebuilding where a piece of work actually stands before carrying on with it:
  fixing the scope first, reading back over your own history and whatever the
  project records around the same code, checking what you find against the
  live state, and handing back a short brief of where things are and what to
  do next. Run it when you are asked to: "catch me up", "what was I doing with
  X", "where did I leave off", "get up to speed on this before we start". Not
  something to do unbidden: being asked to carry on with a task is a request
  for the task.
---

# Working out where you left off

You are rebuilding context, not writing history. The output is short and it
ends in a next action.

This is run when someone asks for it. Having been away from the work is not
itself a trigger: pick up what you were asked to pick up, and say so if you
find you have lost the thread. Rebuilding context nobody asked for spends
their time and their money on your comfort.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## First, decide whether this is the right thing

- **One specific earlier session to continue** is not this. Go and read that
  one, and pick up where it stopped.
- **A summary for someone else to read** is not this either. This is for
  acting on.
- **If they have already told you the state** — the branch, the files, what
  changed — use it. Do not go mining for what you have just been handed.

## Fix the scope before you search

Say it back before you start: how far back, what topic, and whose work. "Recent"
is a real range — pick one and name it. Never quietly turn "everything" into
"the last few", and never widen a narrow question because the search was easy.

Stay inside the work you were asked about. Another project's history is not
yours to read without being asked, and a bot that wanders into unrelated
conversations is a problem whatever it finds there.

## Read your own history

Where a session's record lives depends on the harness, and the project or the
harness will tell you — find that out rather than guessing at a path.

Then:

- Go by when things were last touched, not by the order names happen to sort
  in. An identifier is not a date.
- Search for the topic first, and only read the sessions that match, and only
  the parts of them that matter. Whole transcripts are long and mostly
  irrelevant.
- Skip the session you are in, and the obvious noise — helper runs, test
  sessions, anything that was not the work.
- When a transcript is long, reduce it somewhere else and bring back the
  reduced timeline. Pulling the whole thing into the conversation you are
  trying to rebuild is self-defeating. If what you sent off never comes back,
  treat it as a source you could not reach: say so, say what the brief rests on
  instead, and do not hold the brief waiting on it.

From each one, take: what the work was, what was decided, what was left open,
where it got stuck or was corrected, and what it produced — branches, changes,
issues. Note which session each came from, so a claim can be traced.

## Then read what everyone else recorded

Your own history is only half of it, and it is the half most likely to be
flattering. Where the topic names a feature, a file or an area, also look at
what the project records around it: what shipped, what was reverted and why,
what people keep reporting, what is still failing. A thing with a long tail of
trouble keeps most of its story outside your conversations.

Use whatever the project actually has. Its history and its review discussion
are always there. A tracker, documents, a chat log, somewhere errors land —
some projects have them and some do not. Where one is missing, that is a fact
about what you could check, not a step to pretend you did.

Skip this only when the question is purely about your own activity — "what did
I do this week" — where your history and the current state are the whole
answer.

## Check it against what is true now

Whatever the reading turned up — a branch, a change, an issue — go and look at
its current state rather than trusting the account. A conversation from
Thursday does not know what happened on Friday. Where the answer hinges on
what was actually done rather than what was said, read the record itself
rather than a summary of it.

That is a check on the state, not a licence to do the work again. What the
earlier sessions worked out and decided is what you are inheriting, and it is
the best thing you have: take it, and resist the pull to re-derive it because
you were not there. Re-running a prior investigation to see whether you agree
treats a trail as untrustworthy when it is not, and spends exactly the time the
brief exists to save. Where the trail does turn out to be wrong, that is a
finding to report, not a quiet correction.

Then set what shipped beside what was planned. The difference between the two
is most of the brief: what is already done comes off the list, and what is left
names the point to pick up from.

## The brief

Lead with where things stand. Detail below that, or cut.

- **Where it stands.** At most five lines: what this work is and where it has
  got to.
- **The threads.** One line each, and each one carries its state plainly —
  landed, open, in progress on a branch, done but not committed, reverted,
  planned and not started. A thread with no state named is a thread nobody can
  act on.
- **What keeps going wrong.** At most five, and only the recurring ones.
  Include anything that was fixed and then came back, so the next attempt
  starts after the last failure rather than before it.
- **The next move.** One concrete action.

Anything adjacent stays out unless it is in the way. When it grows past a
screen, cut the detail rather than dropping a thread. Say where each thing
came from, and take out anything private before it goes anywhere else.

Sources and licences: [NOTICE.md](NOTICE.md).
