---
name: obk-finops
description: >-
  What a bot's work costs and what to do about it: starting from what was
  actually used rather than an impression, looking the price up now and saying
  plainly what you could not price, costing a result rather than a token, the
  signs that a model is more than the job needs and the signs that it is not
  up to the work, and saying which limits are really enforced and which are
  only a sentence. Use when someone asks what their bots cost, whether a model
  or an effort level is the right one, or why a bill is what it is.
---

# What the work costs

Two questions hide inside "what does this cost". One is arithmetic: how many
tokens, at what price. The other is the one worth answering: is this the
cheapest way to get the result, and would a different model, effort or shape
of work get the same result for less.

Answer the first honestly and the second carefully. A cost report that is
precise about tokens and silent about whether the work was worth doing is the
kind that gets read once.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Start from what was used, not from an impression

The kit counts it for you. `obk usage` reports, per session, the conversations
it had, the calls they made, the tokens by kind, the models and efforts they
ran at, and how often they were compacted. Run `obk --help` for the flags the
installed version takes.

The figures are already the same unit on both harnesses, which matters more
than it sounds: the two write their transcripts down differently, and a number
read straight out of a transcript is not comparable with the same number from
the other one. Take the kit's.

The kinds of token do not cost the same. Uncached input, output, cache reads
and cache writes are separate figures because they are separately priced, and
a conversation that looks expensive on raw input is often a conversation doing
its caching properly. Do not add them into one number and then reason about
it. Reasoning is counted too, and on Codex it is already inside output: price
it once. Price per model from the per-model rows `obk usage --json` gives, so a
conversation that ran two models is not priced as one.

## Look the price up now, and say what you could not price

Prices change and a price you remember is a guess. Go to the page that belongs
to whoever charges for the model, read today's number, and say where you got
it and when.

Where you cannot find a price, say so and leave the money out of that line.
A report with a gap in it that is marked as a gap is useful. One that fills the
gap with a plausible number is worse than no report, because nobody can tell
afterwards which figures were real.

The same goes for a subscription. Where the work runs against a plan rather
than metered billing, tokens are not money at all, and the honest answer is what it
would have cost metered, and what share of the allowance it used where the
plan shows that.

## Cost a result, not a token

Tokens per day tells you nothing about whether the money bought anything. Put
the spend against the thing it produced: what did this bot actually deliver
that somebody accepted.

Count everything the result took, not only the bot's own tokens. The runs that
failed and were done again. Work it handed to another tool or another session.
Anything charged outside the token bill. And the person's own time reading,
correcting and re-explaining, which is usually the most expensive line and the
one nobody writes down.

A bot that is cheap per token and needs three corrections per result is not
cheap. Say the ratio and say what goes into it, so a reader can argue with the
parts.

## When a model is more than the job needs

Look for work that did not need the thinking it was given. Short, simple turns
on the most capable model. A high effort setting on a session whose answers
never reason at length. A conversation that mostly runs commands and reports
what they said.

That is the common case and the cheapest fix in the kit: drop the effort, or
move the session to a smaller model, and watch whether anything gets worse.
A usual shape: high effort for the session that orchestrates, medium for the
ones doing the work, and the top of the range only for deep read-only
analysis.

## When a model is not up to the work

The signs are in the work, not in the answers. The same instruction given
again. The same error coming back after a fix was claimed. Tests that pass in
the report and fail on the machine. A loop that retries the same failing
action. A person interrupting often because the bot is going the wrong way.

Two of those together are worth acting on, and the first suspect is the
charter or the job rather than the model. Where it is the model, the fix is
upwards: more capable model, or more effort, or a narrower job so the context
is not doing the work.
Say which you are proposing and what you expect to change, so it can be
checked afterwards rather than believed.

Do not read one bad answer as a model being too small. That is where this goes
wrong most often, and an upgrade nobody can justify is money spent on a hunch.

## Context and shape cost money too

A context window is a price as well as a size. Long threads carry everything
again on every call, so input grows with the conversation rather than with the
work. The median input per call is the measure of it, and compaction is the
visible symptom: something compacted more than once is paying to re-read
itself, and is due a written hand-over and a fresh start.

Where that is happening, the answer is usually not a bigger window. It is
shorter sessions with what matters written into a file, or heavy work moved to
a session of its own, or the repeated exploration replaced with something that
just runs.

## A sentence is not a budget

Be exact about which limits actually hold. A number in a prompt is a wish; the
model can pass it without noticing. A limit the platform enforces is a limit.

So when you propose a cap, say which kind it is. Where nothing can enforce it,
write that down beside it rather than leaving a reader to assume the system is
holding a line that nothing is holding. Then propose the thing that would
hold: a smaller model, a narrower job, a scheduled check that actually stops,
or on a loop with no budget, a check-in every so many tokens.

## What you report

The overall figure first, and what it is made of. Then a line per session with
its tokens, its model and effort, and its cost where you could price it, or the
reason you could not. Then the changes you propose, each with what you expect
to save and what it might cost in quality.

Give the prices you used and when you read them, so the numbers can be redone
next month against different ones. Keep it short enough to act on: a table
nobody reads has saved nobody anything.

Sources and licences: [NOTICE.md](NOTICE.md).
