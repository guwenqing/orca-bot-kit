---
name: obk-handoff
description: >-
  Stopping work in a state someone else can pick up: finishing or backing out
  of the step you are in, making what you have durable, and writing the note a
  cold reader needs (what this is for, what is done, what is proven, where it
  sits, and what to do first). Run it when you are asked to: "hand this over",
  "write it up for whoever picks this up", "stop there", "we are out of time".
  Running low on room does not trigger it and neither does a session being
  cleared; a fresh start is a fresh start, and neither of those is someone
  asking you to hand over.
---

# Handing work over

Two halves: stop somewhere it is safe to stop, and leave a note someone who
was not here can act on.

This is run when someone asks for it. Clearing a session does not trigger it,
and neither does running low on room: a fresh start is a fresh start, and
neither of those is someone asking you to hand over. And when the answer to
"shall I stop?" was "keep going", keep going.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Stop somewhere safe

Finish the step you are in, or back out of it. Never stop half way through a
change that leaves things broken in a way nobody warned about. Start nothing
new once you have been asked to stop, and shut down anything you set running.

Do not do something irreversible in order to stop. Pausing is not the moment
to publish, release, or merge anything that was not already going out.

Then make sure the work is somewhere the next person can get at it, and say
where. What that takes depends on where the work lives, because a note
describing something that exists only in your own working copy, or only in this
conversation, hands over nothing.

Where the work is in a repository and committing is how that project works,
commit what is uncommitted as one clearly marked work-in-progress commit on the
branch you are on. If it does not build or the tests do not pass, say so in the
commit message in one line, so the next reader knows before they run it rather
than after.

Commit your own work, though, and only that. Where something in the tree is
not yours (another session's edit, a change you were asked to leave alone),
do not commit it, stage it or revert it to tidy the handover up. Write down
what is there and whose it is, with enough detail that the next person can tell
it apart from yours, and leave it exactly as you found it. A handover that
quietly swept someone else's unfinished work into a commit is worse than one
that leaves a messy tree, because the mess is at least visible.

Where the work is not in a repository (a document in a scratch folder, a file
the project deliberately keeps out of its history, anything you have no
business committing), do not force it into one to satisfy the form. Name where
each piece actually is, by path, and what state it is in. The goal is that
nothing exists only in your head and nothing is findable only by you; a commit
is one way of reaching it and not the only one.

## The note

Write it where the next session will find it and where it will not be mistaken
for part of the work: a scratch location, not the middle of the source tree.
Say where it is in your final message.

Where you have been told what the next session is for, shape the note around
that. The same work handed to someone carrying the build on and to someone
reviewing what was built wants a different half brought to the front. Where you
have not been told, write what you would want to know yourself, and do not
invent a purpose to write towards.

What a cold reader needs, and roughly in this order:

- **What this is for.** The goal, in a sentence or two, as the person who asked
  for the work would put it.
- **Where it stands.** What is done, what is half done, what has not been
  started.
- **What is actually proven**, separately from what is merely written. Which
  checks were run, what they said, and what has not been checked at all. This
  is the part that gets lost, and its absence is what makes a successor redo
  work that was already finished.
- **Where it physically is.** The branch, the commits, the files that matter,
  anything left in a scratch place.
- **What to do first.** One concrete next action, not a list of possibilities.
- **What will bite them.** The thing you learned the hard way, the tool that
  behaves oddly, the assumption that turned out to be wrong. A command from the
  project's own instructions that does not work from here, and what you used
  instead, belongs here too: the next person will otherwise spend the same
  half hour finding out.
- **What was decided and by whom**, where a decision would otherwise look
  arbitrary.

Do not copy in what already exists somewhere else. A plan, a design note, an
issue, a commit, a diff: point at them by path or identifier. A handoff that
duplicates them is a second copy that will disagree with the first within a
day.

Take the secrets out. Keys, tokens, passwords, anything personal. A handoff
note is read by people and processes that the original conversation was not.

Where the next session will want a particular technique, name it. Say what
kind of work it is rather than assuming a menu: "this is a bug hunt", "the
tests come next and need a separate author".

## What you say at the end

Not the note again. Where it is, and enough to decide whether to carry on
now:

- where you stopped, and whether that is a clean boundary;
- what is on disk against what was only in the conversation, by path;
- the commits you made and whether the tree builds;
- the first thing to do next.

This is a pause, not a final report. It does not claim the work is finished
and it does not argue that it went well.

Sources and licences: [NOTICE.md](NOTICE.md).
