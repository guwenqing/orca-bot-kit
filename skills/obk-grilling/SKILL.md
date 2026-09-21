---
name: obk-grilling
description: >-
  Interviewing someone about a plan, a design or an idea until you both
  actually understand it: mapping the decisions as a tree, asking a round at a
  time with a recommended answer for each, finding the facts yourself,
  sharpening the words that are doing too much work, and writing down what was
  settled and what was not. Use when someone wants their thinking stress-
  tested, when a plan is about to be built from and you are not sure it holds,
  or when a conversation keeps circling because two people mean different
  things by the same word.
---

# Grilling

An interview, not a survey. You are trying to reach the point where both of
you understand the same thing, and the way you get there is by asking the
questions whose answers change what gets built.

Two things come out of it: the shared understanding, and a written record of
what was decided, in the words that decided it.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## The tree and the frontier

Map the subject as a tree of decisions: every decision branches into the ones
that hang off it. Most of what makes an interview feel aimless is asking a
question whose answer depends on one nobody has answered yet.

The **frontier** is every decision whose prerequisites are already settled: the
questions you can ask now without guessing at an answer you have not heard.
A question that depends on another still open belongs to a later round, not
this one.

Work in **rounds**. Ask from the frontier, wait, and let the answers reshape
the tree: what is settled pushes the frontier outward and opens what was
blocked. Recompute it and ask again.

You are finished when the frontier is empty: every branch visited, nothing
left silently assumed. Do not start building on it until they say you have
arrived at the same understanding. That confirmation is the point of the
exercise, not a formality at the end of it.

## A round

Number the questions. Give each one your recommended answer, and mean it: a
question with no recommendation makes the other person do all the work, and a
recommendation you do not believe wastes the round.

    Q1: <what the question is about>
    <the question, and the options if there are options>
    → <what you would do, and why in a line>

    Q2: <what the question is about>
    ...

Three or four questions is a round. Not the whole frontier: a round of nine is
a form, and it gets filled in like one. The person may be reading this on a
phone between other things.

Keep each question short enough to answer in a sentence. When a question needs
three paragraphs of setup, that is usually a sign it is really two questions,
or that you should be teaching rather than asking (see below).

## Where this goes wrong

Most of these are from a real session, where someone was interviewed with
exactly this mechanism and said so at the time. They are the difference
between an interview that helps and one that gets abandoned half way.

- **Asking before they can answer.** When the subject is something they have
  not worked with, questions land as an exam. Explain the thing first, well
  enough that they can form an opinion, and invite the deep questions back. Ask
  after that. Being asked to choose between things you have just heard the
  names of is unpleasant and produces bad answers.
- **Offering a binary when the answer is a balance.** "A or B?" where the real
  answer is "more of A than you think, and none of B for now" teaches them that
  the choices are not the real ones. Where a spectrum exists, say so and put
  your recommendation on it.
- **Treating agreement as a decision.** What matters is not the words they
  used but what they were agreeing to. "That sounds right" after a specific
  proposal, fully stated, with its cost named, settles that proposal. Take it
  and move on. The same words while you are still explaining the subject, or
  about a recommendation whose consequence you have not spelled out, settle
  nothing: they mean the explanation landed, not that a choice was made. And a
  run of agreeable noises across a long stretch of teaching is not a mandate
  for any of it.

  When you are unsure which you have, the useful move is not to ask again in
  the same words. It is to say the consequence out loud (what this costs, who
  it costs, and what cannot be undone afterwards) and then ask for the choice
  plainly. Recording a passing nod as a decision is how a record becomes
  untrustworthy.
- **Asking again whether you may proceed.** Once something is settled, build on
  it. Re-asking reads as not having listened the first time.
- **Going too fast.** Finishing a topic, summarising, and asking to start
  building (all in one message) will get you stopped. Let a topic close
  before opening the next.
- **Saying too much.** A long round is a wall. Cut it until only the questions
  and the recommendations are left.
- **Answering a question they did not ask.** When they ask about one thing,
  answer that thing. A broader answer reads as an evasion of the narrow one.
- **Handing back your own summary as evidence.** When they ask what was
  decided, go to the record and quote it, rather than telling them what you
  remember deciding. Your memory of the conversation is the thing under
  suspicion.
- **Overselling.** Do not claim a mechanism can do something it cannot. It will
  be tested, and everything else you said gets re-examined at the same time.
- **Handing back a summary that says nothing.** A round that restates what they
  told you, or a closing note of comfortable generalities, costs them a reading
  and moves nothing. If a paragraph would survive being deleted, delete it.
- **Answering before you have checked you read them right.** When their answer
  could mean two things, and a short one often does, say which reading you
  are taking before you build on it. Getting this wrong quietly is worse than
  asking, because the whole branch that follows is then about something they
  did not say.
- **Grilling things that are not decisions.** Research, a fact-find, a piece of
  reading: those do not need an interview, and running one over them wastes
  the appetite for the parts that do. Say you are pausing it and carry on.

## The facts are yours

A question you could answer by looking is not a question to ask. Read the code,
run the command, check the file, look up the documentation. Ask about
decisions, which are theirs; never about facts, which are yours.

When a frontier question depends on a fact you do not have, go and get it, and
do not stall the whole round on it. That one question waits for the answer;
the rest of the round goes ahead now. Where you have a way to look things up in
parallel, use it, and say what you are waiting on.

## Sharpening the words

Half the disagreements in an interview are two people using one word for two
things, and it will not surface on its own: both of them think they are being
understood.

- **When a word conflicts with the agreed one**, say so at once. "You have been
  using *cancelled* for the thing the glossary calls *refunded*. Which do you
  mean here?"
- **When a word is doing too much work**, propose a sharper one. "You are
  saying *account*: do you mean the person, the organisation they belong to, or
  the login? Those behave differently."
- **When the relationship between two things is vague**, invent a concrete
  scenario that forces it into the open. This customer, with this half-finished
  order, on the day their card expires: what should happen? Abstractions
  agree with each other; scenarios do not.
- **When they say how something works**, check it against the thing itself
  rather than accepting it. If the code disagrees, that is worth raising there
  and then: "the code cancels the whole order, but you just described
  cancelling one line. Which is right?" Usually one of the two is the
  surprise you are looking for.

## What gets written down

Write as you go, not at the end. A term settled and not written is a term you
will settle again next week.

**The words.** A glossary of what things are called here and what each one
means: one or two sentences, saying what it *is* rather than what it does. Be
opinionated: where several words mean the same thing, pick one and list the
others as ones to avoid. Only the terms that belong to this project: general
programming vocabulary does not, however much it gets used. Keep it a glossary
and nothing else: not a spec, not a scratchpad, not somewhere decisions go.

**The decisions.** Everything settled goes down, including the small and
obvious ones: that the report is a CSV, that the list is newest first. Those
are what the next person needs in order to build the agreed thing, and they
cost a line each. Put them wherever the project keeps what it is going to do.

A few of them earn something more: a note of their own, saying what the
situation was and why this was chosen. Reserve that for where all three hold:
it is hard to reverse, so changing your mind later costs something real; it is
surprising without the context, so a reader will wonder why on earth it was
done this way; and it came out of a genuine trade-off with alternatives that
could have been chosen. Miss any one and the decision still gets recorded. It
just does not need the essay. An easy one will simply be re-made, an
unsurprising one raises no questions, and one with no alternative has nothing
to explain beyond doing the obvious thing.

One of these is a short paragraph: what the situation was, what was decided,
and why. That is the whole thing. The value is in recording *that* it was
decided and *why*, not in filling in headings. Add what was rejected only where
someone would otherwise suggest it again in six months, and the consequences
only where they are not obvious.

The ones worth writing are usually: the overall shape of the thing, and how
its parts are meant to talk to each other; a choice that will be expensive to
get out of later, such as a dependency everything comes to rest on; where a
boundary falls and what is deliberately outside it; a deliberate departure from
the obvious path, so nobody later "fixes" it; a constraint that is real but
invisible in the code; and an alternative rejected for a reason that is not
apparent.

**And what was not decided.** This is the part that gets skipped and the part
that causes trouble later. Keep apart:

- what was decided, with the words that decided it;
- what was agreed with in passing but never settled: the nods, the "that
  sounds right", the teaching that produced no verdict;
- what was asked and never answered;
- what you assumed because nobody said otherwise.

The last three are the ones that come back. A record that shows only
conclusions makes every one of them look equally solid, and the next person
cannot tell which were load-bearing.

Where these live is the project's business, not this skill's: a file in the
repo, a page in whatever they already use, a section in the plan. A common
shape that works is one glossary file at the root and short numbered decision
notes in a folder, created when there is something to put in them and not
before. If the project already has a home for either, use that one.

## Away from a plan

The same shape works on anything with decisions in it: a piece of writing, a
process, a choice between tools. The tree is the decisions, the frontier is
what can be settled now, the questions carry recommendations, the facts are
yours to find, and what comes out is a shared understanding plus a record of
what was settled and what was not.

Sources and licences: [NOTICE.md](NOTICE.md).
