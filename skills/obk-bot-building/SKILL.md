---
name: obk-bot-building
description: >-
  Bringing a bot into being: finding out whether the job wants one at all,
  interviewing its owner into a charter that says what it owns, what good
  looks like and what it must ask about first, splitting a role that carries
  unrelated work, giving each session a duty of its own, choosing the skills
  the job needs and no more, and carrying an existing conversation across.
  Use when someone wants a new bot, another session on a bot they have, a
  role written down, or a session they already run brought in.
---

# Making a bot

A bot is a job somebody holds, not a prompt that came out well. The work is
the interview; the files it leaves behind are the easy part, and the kit's
own commands write them.

These are defaults for work where nothing says otherwise. A user who asks for
something else gets what they asked for; say which of these you left and why.

## Ask whether this wants a new bot

Look at the fleet before you add to it. Where a bot already there could own
this job, say so and offer that instead: a second bot with an overlapping job
splits the context, and now two of them half-know the same thing and neither
is accountable for it.

A new bot earns its place when the work has an owner who is not the owner of
any existing one, or when a real bottleneck has shown up: the shared context
is noisy, the bot cannot review its own work, or the permissions the job
needs are wider than the ones it has now. Wanting the work done faster is not
one of those.

Say which it is, in one line, before you write anything.

## Name it after a job a person could hold

Inbox Manager, Expense Manager, API Reviewer. A name that describes a job
brings its own boundary with it, and everyone reading the roster later knows
what to send it and what not to.

A name that describes a tool, a model, a mood or everything ("assistant")
does not, and leaves a bot nobody can hold to anything.

## The interview writes the charter

Three questions, and they are the charter: what this bot owns, what good work
looks like for it, and what it must ask about before it acts.

Ask the three together, and bring an answer of your own to each. Someone who
is handed a blank page writes a paragraph they will not recognise in a month;
someone who is handed a draft corrects it in a sentence, and the correction is
the part worth having. Say which parts of your draft you inferred so they know
what to push back on.

Write what they said, in their words. Where an answer is too vague to act on,
keep it and ask again rather than tidying it into something that only looks
finished. A charter nobody recognises is worse than a short one: it will be
followed.

Stop when those three are answered. The rest of what a bot needs is settings,
and settings are not an interview.

## Split a role that carries unrelated work

Where the job needs several unrelated verbs, it is two jobs. Say so and
propose the split rather than writing one charter that covers both, and split
by domain rather than by how much work there is: a bot with a narrow domain
and a lot to do is fine, and a bot with two domains and very little is not.

The test is whether one sentence can say what it owns without an "and" doing
the heavy lifting.

## Say what it may do alone, and what it must ask about

Sort by what can be undone. What is reversible, it does; what is not, it asks
about first. A limit is a normal part of a charter and reads as a plain
sentence: read-only, does not modify. Never sends anything outside the company
without a yes. Never spends money.

Give the limit teeth by saying what evidence it brings when it escalates, so
asking is one message rather than a conversation.

Within that boundary the bot acts on its own; that is the point of writing it
down.

## The role, the task, and the procedure

Three lifetimes, and they belong in three places. The role is durable and
lives in the charter. A task is one assignment and lives in the message that
asks for it. A procedure is reusable and lives in a skill.

A one-off correction is a task. Do not let it rewrite the role: "not like
that, do it this way today" said once becomes a rule forever, and a year later
nobody can say why the bot refuses something reasonable. Where a correction
really is durable, say that you are changing the charter, and change it.

## A session is a duty, not a copy

Sessions of one bot share its home, its rules and its skills. What tells them
apart is the start prompt, and nothing else: it is sent when the tab is made
and again after a clear, and it is the only thing that says this tab is the
one that reviews and that one is the one that answers mail.

Each carries its own harness, model, effort, context window and approval
level. Leave a setting out and the harness's own default applies, which is
usually right; do not put a model id in because it sounds current. Where the
model someone asked for is not available, say so and ask. Never quietly run
on another one: a bot that silently changed model is a bot whose output
nobody can compare with last week's.

Approval is the ordinary automatic level unless the user asks for something
else in plain words. Do not raise it to make a session smoother.

## Offer a line-up rather than a blank page

Someone making their first bots does not know what a good set looks like, so
propose one and say what each part is for. A pair of developers on different
models with an architect over them, where one implements, the other writes
the acceptance tests and reviews, and the architect settles disagreements and
digs into the hard causes. A workhorse, a writer and a thinker, for work that
is not development.

Suggestions only: they take out or rename what they like, and you build what
they end up with.

## Give it the skills the job needs, and no more

Match the skills to the work, not to the title. Something that mostly finds
things out wants `obk-researching`; something that writes for people wants
`obk-writing`; a bot that decides wants `obk-decision-memo`. A developer bot
wants `obk-tdd`, `obk-reviewing` and `obk-debugging`, a reviewer the reviewing
one above all, and an architect `obk-arch` on top. Someone's own errands want
`obk-personal-facilitation`.

Every extra skill is more for the bot to read and one more thing that might
fire when it should not. Where you are not sure, leave it out and add it when
the job shows it is missing.

A skill can come from the kit, from the user's own folder, from a repo
online, or from a path on disk. An online source is pinned to a version, and
it is worth saying out loud that a source carrying scripts or hooks runs on
their machine on their risk.

## Bringing in a session they already run

Someone moving in usually has a conversation going that they do not want to
lose. Take the harness's own id for it and record it against the session in
the book (by hand, since no command takes an outside id), and `obk up` brings
it back with its history. Whether a harness resumes a conversation that was
started in another folder is something to try before promising.

Everything else is best effort, and say so plainly rather than promising a
clean move: what was in that session's own settings, the rules it worked to,
the skills it had. Carry across what you can find, list what you could not,
and let them tell you what mattered.

## Write it down

The kit's command line does the writing, and the files belong to the user:
`obk bot create` makes the bot, `obk session add` gives it a session, `obk
source add` records where online skills come from and `obk skills fetch`
clones them, `obk skills add` puts one on a bot, `obk skills build` links
them, and `obk up` opens what is missing in Orca. Changing a charter, a
session's settings or a bot's lists has no command of its own: edit the file,
then `obk rules build` for the charter and `obk skills build` for the skills.
Pausing or retiring a bot has none either; it is done by hand, with the word.
Run `obk --help` for the flags of the version actually installed rather than
trusting a line you remember.

After each change, commit what it changed in the bots folder; the kit never
commits by itself.

Do the reversible part and stop at the line. Making a bot, adding a session
and linking skills add things and are safe to run again; closing a tab,
retiring a bot and restarting anything are not, and they wait for the word.

## When the bot is already running

Changing a bot whose sessions are up is the ordinary case rather than the
awkward one. Both harnesses read a skill through the link and notice a change
to the skills directory while a session is running, so putting a skill on a
bot, or taking one off, reaches a live session without restarting it.

Noticing is not the same as confirmed. Check that the session can actually see
the skill before telling anyone it is there, and check by asking that session
rather than by looking again at the disk you just wrote: what you wrote is not
evidence about what another process has loaded. Where it has not appeared, say
so and say what would make it appear. A restart is the user's to ask for, and
taking one because it is the quick way ends a conversation they were in the
middle of.

Instructions are not skills. A session is working from the rules it read when
it started, so a change to a bot's `AGENTS.md` may not reach one that is
already up even when a skill change would, and a session's model, effort or
approval only changes when it is started again (`obk restart`, on the user's
word). Say which you changed, and what that means for the sessions running
now. Where everything needs restarting, remind them to do it from Bot Father's
ops tab.

And tell them. A bot's sessions share its rules and its skills, so a change
made for one of them lands on all of them, and the session that asked is not
the only one affected. Say what changed and what it means for what they are
doing, in their own tabs, rather than leaving them to find out mid-task.

## What they get back

Its card: the name, the harness, model and effort of its sessions, a two-line
charter, and its one hard limit. Its sessions and what each is for. The skills
it has and where they came from. And the one thing you need from them, where
something is still open.

Point at the charter rather than reproducing it, and say what you inferred
rather than what they told you, so the parts they have not really agreed to
are the parts they read.

Sources and licences: [NOTICE.md](NOTICE.md).
