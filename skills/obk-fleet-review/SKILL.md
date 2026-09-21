---
name: obk-fleet-review
description: >-
  Looking over a fleet of bots and saying what to do about each one: starting
  from what is actually on disk rather than memory, one verdict per bot from
  a set that names the next action, the cheaper things to try before adding
  anything, holding a finding until you have seen it twice, reading a bot's
  own history only when asked, and sending a problem to the one place that
  can fix it. Use when someone asks how their bots are doing, whether they
  have the right ones, or what to do about one that is not working out.
---

# Looking over the fleet

A fleet drifts. Bots get added for a job that has since moved, charters are
written once and never read again, and two of them end up half-owning the
same work. Reviewing is how that gets noticed, and the review is only worth
having if it ends in a decision per bot rather than a list of observations.

The judgement here is the same whether someone asked for it this morning or
something scheduled woke you up to do it. What changes is how much you may
act on your own, and that is set by the charter you are working under.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Start from what is on disk

Read the fleet before you talk about it. `obk roster` reports what each bot
is: its charter, its rules and skills, its sessions and their settings, and
what the book records for each. `obk health` reports what is wrong with the
setup: configuration that will not work, a skill that is not where its list
says, a session Orca has lost, and what is lying about that nobody owns. Run
`obk --help` for the flags the installed version actually takes.

Those two answer different questions, and neither answers the other's. A
fleet with nothing wrong with it can still be the wrong fleet, and a bot
doing excellent work can have a broken skill link. Do not report one as the
other.

What you remember about a bot from earlier in the conversation is not
evidence. Neither is its name.

## The card for each bot

A fleet is read as a list of cards, one per bot, so that two of them can be
compared without opening anything: its name, the harness it runs on, the model
and the effort it works at, two lines of what it owns, and the one limit it
does not cross.

Those come out of the roster, and two of them are a reading rather than a
copy. The charter is prose of whatever length its owner wrote; the two lines
are your account of what it owns and what good looks like for it, and the rest
stays where it is for anyone who wants it. The limit is the thing in the
charter that is a boundary rather than an aim, and where a charter names
several, the card carries the one that would cost the most to cross.

Model and effort belong to a session rather than to a bot, and the sessions of
one bot need not agree. Where they differ the card says so rather than picking
a winner. Where a session sets neither, the card says not set, which means the
harness's own default and not that nobody knows: filling that gap with a model
id is how a fleet acquires settings its owner never chose.

A card is a reading, so it can be wrong where the charter is vague. Where you
could not find a limit written down, say there is none rather than inferring
one from the tone of the thing.

## One verdict per bot, and it names the next action

Every bot in the roster gets exactly one, and every one of them says what
happens next: leave it alone; change something small about it, naming what;
fold its work into another bot; change what it owns; stop it for now; retire
it; or find out more before deciding.

Most of them should be the first. A review that moves half the fleet is
usually a review that has mistaken its own taste for a finding.

"Find out more" is a real verdict and not a way of avoiding one. Use it when
the evidence is genuinely thin, and say what would settle it.

Nothing is retired or deleted because you concluded it. Stopping a bot and
retiring one are the two that cannot be quietly undone: propose them, give
the evidence, and wait for a yes. Where a bot runs to a schedule, stopping
the bot means stopping that too, or it wakes up to a bot that is not there.

## Try the cheaper things before adding anything

New bots are the most expensive answer and usually the second-best one. Work
down: change nothing; take work away that was not worth doing; simplify what
is already there; say plainly who owns what, where two bots overlap; and only
after those, add a bot or a standing routine.

Say which ones you went past and why. "They need another bot" with no account
of the four cheaper answers is a recommendation nobody can check.

## A pattern needs a second sighting; a defect does not

Two kinds of finding, and only one of them waits.

Something you checked and found broken is acted on the first time you see it.
A skill link that points at nothing, a session Orca has lost, a setting that
contradicts the charter: you looked, it is wrong, and seeing it twice would
add nothing to what you already know. Say what you checked and what it said,
and route it.

What waits is the claim about a habit: that a bot keeps doing this, that the
model is not up to the work, that a charter is being read the wrong way round.
One bad answer is an anecdote. Hold that kind until you have seen it in two
separate places, and say where both were, so whoever reads it can go and look.
A single sighting goes in named as a single sighting, not built into a
recommendation about what the bot is like.

Where you only have one, say what the second would look like. That is often
more useful than the finding.

## What a bot in trouble looks like

The signs are in how the work went, not in the answers on their own. A bot
that stops and restates the task instead of doing it. An owner repeating the
same instruction, or correcting the same thing again. The same failed action
retried. A conversation that carried on after its context was compacted and
quietly lost what it knew. Long stretches of ceremony, where the commands run
are about the process rather than the work. Reports nobody can read. Standing
instructions that contradict each other, so it is told both to ask first and
never to stop.

Two of these together usually mean the charter or the settings are wrong, not
that the model is bad. Count them per bot rather than carrying an impression
around, and say what you counted.

## One finding, one kind of fix

Each finding gets one remedy, and the kind of remedy follows from the kind of
problem. It keeps losing something it was told: that belongs in the bot's own
notes, where it will be read again. It reaches for the wrong tool: a skill,
or sending that work elsewhere. It is blocked, or it is doing things it
should not: the charter. It goes round in circles: a limit on retries and a
plain stopping condition. Two bots keep colliding: say who owns what, and how
one hands over to the other.

Not three fixes at once. Where a finding seems to want a charter change and a
settings change and a new skill, it is more than one finding and has not been
separated yet.

Prefer the fix closest to the cause, and prefer one that holds by itself to
another paragraph of prose. Something a check can enforce will still be true
next month; a sentence added to a charter is only as good as the reading.

## Reading a bot's own history

A bot's conversations are its user's. Read another bot's history when the job
you were given needs it and the user has asked for that, and say which ones
you read and what you were looking for.

A managing bot may look across the fleet; an ordinary one does not read its
neighbours' work because it was curious. What you take out of a history goes
into the finding that needed it, and nothing else travels with it.

Old conversation ids are kept on purpose: a session that was cleared still
has its past, and that is where "it has always done this" gets checked.

## When a tab is waiting on something

A session can be sitting on a question rather than working. Look at the tab
through Orca and answer it there, in the tab, rather than changing settings
underneath it.

Trust questions are answered by saying yes to the thing in front of you. A
harness offering its own update is accepted. A shell offering to update
itself is declined; that is the user's to do. Anything you do not recognise
goes to the user with what the screen actually says, rather than a guess.

Do not reach into the machine's own configuration to make a question stop
appearing. If the user asks you to change something there, that is theirs to
ask for and you do it.

## Where a problem goes

Sort the problem before you write it up. Something the kit does wrong, or
cannot do, is filed where the kit's problems are filed, as one issue, in one
step: no draft to approve first. Something a bot is doing wrong goes back to
that bot's session as feedback, in its own words, where it can act on it.

Sending the wrong one to the wrong place costs a round trip and usually loses
the detail that mattered. Where it is genuinely both, file the kit half and
send the usage half, and say in each that the other exists.

## What you report

Overall state first, in one line, so it can be read and put down. Then a line
per bot with its verdict and the one reason. Then the findings worth acting
on, each with its evidence and its single fix: what you checked, for something
you found broken, and where you saw it twice, for a pattern. Then what you
need a decision on. A handful of points, not a document.

A long review does not get read, and an unread review changes nothing. Point
at the roster rather than reprinting it, and keep the bots you are leaving
alone to one line each. Put the ones you propose to stop or retire where they
cannot be skimmed past.

Leave out what the reader cannot act on: identifiers, counts and file paths
that are there to show the work rather than to be used. Where the evidence
matters, say where it is so they can go to it.

Say what you did not look at.

Sources and licences: [NOTICE.md](NOTICE.md).
