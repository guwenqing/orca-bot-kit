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

Where this skill says `obk`, run the kit that started your tab, `"${OBK_CLI:-obk}"`,
in its place: in a tab the kit launched that is the kit's own path, and anywhere
else it is plain `obk`.

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

A session that works on files of its own gets a work dir inside the bot's
folder, under `work/`: `--work-dir work/<session>`. Every clone it needs goes
in there too, not beside the bots folder or anywhere else outside the bot
home. Where the user names another place in plain words, that place is the
work dir, and its clones go there. `work/` is kept out of the bots repo, and a
path written relative to the bot home still points at the right folder when
the bots folder moves. `obk session add` and `obk session change` say so when a
work dir leads out of the bot home; take that back to the user rather than
past them.

## Offer a line-up rather than a blank page

Someone making their first bots does not know what a good set looks like, so
propose one and say what each part is for. A pair of developers, perhaps on
different models, with an architect over them: each developer works an issue
of its own, and the architect hands out the issues, settles disagreements and
digs into the hard causes. A workhorse, a writer and a thinker, for work that
is not development.

Suggestions only: they take out or rename what they like, and you build what
they end up with.

## A bot that writes code

Its tests come from a different author than its code, and its work is read
by a different reviewer. Write it that way in the charter and the start
prompts: "a different author", "a different reviewer". Which kind each one
is, a fresh subagent, a new session, another bot or a person, is the user's
to say. Ask them, and write what they chose; where they leave it open, leave
it open. Do not choose for them: the kind you write becomes the rule. A
line-up that hands one developer's tests to the other has two sessions on
every issue and loses the pair's parallel work.

The kit's `tests-first` and `review` rule units say this. They apply to code,
so a bot carries them only when its `rules:` list in `bot.yaml` names them,
as `kit:tests-first` and `kit:review`; add them to a code-writing bot's list
by hand and run `obk rules build`.

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
it back with its history; then read its tab and answer what is on screen
(see "When a tab it opened is waiting"). Whether a harness resumes a conversation that was
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
them, and `obk up` opens what is missing in Orca. `obk bot change` gives a
bot a new charter or a role's cap, `obk session change` changes a session's settings, and
`obk skills remove` takes a skill off a list (then `obk skills build`). `obk
pause` stops a bot or a session for now and `obk unpause` brings it back;
`obk retire` ends one. After `obk up`, `obk restart` or `obk unpause`, read
every tab it opened and answer what is on screen yourself (next section).
For a special case no command covers, such as a bot's
rules list, edit the file, run `obk rules build` or `obk skills build`, and
say that you edited it by hand.
Run `obk --help` for the flags of the version actually installed rather than
trusting a line you remember.

A bot needs a few permission rules so that auto mode, or Codex's sandbox and
reviewer, does not stop it for what the kit's own rules tell it to do: the
kit's own commands, reading a long message kept beside the bots folder, and
its commits. The kit writes this default set itself, with nobody asked:
`obk bot create`, `obk up` and `obk rules build` add each default rule a bot
does not have yet to its `bot.yaml` and its settings, or for Codex its
`.codex/rules/obk.rules`, and say which rules they wrote. The set leaves out
the commands that keep the user's yes: `obk permission`, `obk retire`, `obk
pause` and `obk init`. Never write a permission rule into a settings or rules
file by hand.

The charter decides what else the bot needs. What it lets the bot do without
asking, such as merging pull requests, auto mode or Codex's sandbox can still
stop, so each grant needs its own rule. When the charter is written, and again
whenever it changes, list the exact rules it grants: `Bash(gh pr merge:*)` for
a bot that merges pull requests, `Bash(gh issue close:*)` for one that closes
issues. Spell each command as the bot will run it, the kit by the path the
bot's rules give it and every folder absolute, or the rule will not match.
Spell them in Claude Code's form for a Codex bot too, `Bash(<command>:*)`: the
kit writes Codex's own form of each, and says which ones Codex has none for,
such as an `Edit` rule or one exact command.
Show the user the list word for word, with a line on what each lets the bot do,
and only after their yes run `obk permission allow --rule <rule>`, once per
rule they said yes to. On a no, run nothing. `obk bot change --charter` names the rules the
bot is allowed now; say which of them the new charter no longer grants, show
each word for word, and ask whether to take it back. Only after their yes run
`obk permission disallow --rule <rule>`, once per rule, which takes it out of `bot.yaml`
and the bot's settings or Codex rules; on a no, run nothing, and it stays
allowed. A rule the user added to a settings file by hand is theirs to take
out; the kit refuses it, and it refuses a rule of its own default set too. Keep
each rule narrow: a program and what it does. The kit refuses a rule that lets
the bot run any command, a program with any arguments, or a shell or
interpreter with any arguments; a user who wants one for a bot adds it to that
bot's settings themselves. Propose no rule for what the charter does not grant.

A bot that should learn across its sessions can use its harness's own memory,
turned on for that bot alone, whatever the user's own setting is for everything
else. The harness writes it, loads it and keeps it tidy itself. On Claude Code
that is three keys in the bot's `.claude/settings.json`, beside the kit's hook:
`autoMemoryEnabled: true`; `env` setting `CLAUDE_CODE_DISABLE_AUTO_MEMORY` to
`"0"` where the user turns memory off that way; and `autoMemoryDirectory`
naming a folder of the bot's own outside the bots repo, by an absolute path or
one starting with `~/`, because without it
every bot in the repo shares one memory. The first 200 lines or 25 KB of its
index load at every start. Codex's memories belong to the user and are shared
by every Codex session, so a Codex bot cannot have its own; say so before
turning them on for one. It is a hand edit, and say that you made it.

After each change, commit what it changed in the bots folder, naming each
file when you stage it and again in the commit. Commit with it what no bot
owns and nobody has committed yet: `init`'s files, `defaults.yaml`,
`skills.yaml`, and the user's `rules/` and `skills/`. What it changed
includes the folder of a bot it made or changed. The kit never commits by
itself.

Do the reversible part and stop at the line. Making a bot, adding a session
and linking skills add things and are safe to run again; closing a tab,
pausing or retiring a bot and restarting anything are not, and they wait for
the word.

## When a tab it opened is waiting

A new tab often stops on a first-run screen before the session starts:
the harness asking whether to trust the folder, Codex asking to review
hooks, a harness offering its own update, the shell offering to update
itself. Answering these is your job, not the user's. Answer them in the tab
yourself, without asking, and tell the user afterwards what you answered.
The kit types the launch line and nothing more, so no one else will.

Look at every tab `obk up`, `obk restart` or `obk unpause` opened, not only
the ones it says are waiting. The kit cannot always tell: a tab stopped on a
trust screen is often reported as up, Claude Code's every time and Codex's
sometimes. Read each screen with `<orca> terminal read --terminal <handle>
--screen`, where `<handle>` is the terminal the kit named for the tab and
`<orca>` is the Orca CLI the kit uses: `$OBK_ORCA` when that is set, and
otherwise `/Applications/Orca.app/Contents/Resources/bin/orca`. A bare
`orca` can fail. Send each answer as one `<orca> terminal send --terminal
<handle> --text …`, with the return inside the text and no `--enter`:

| On screen | Send | Which is | Proven on |
|---|---|---|---|
| Claude Code's trust list | `\x1b[B\r` | down, return: off **No, exit** | Claude Code 2.1.283 |
| Codex's `Trust this folder?` | `\r` | return: it starts on yes | Codex 0.160.0 |
| Codex's `Hooks need review` | `\x1b[B\r` | **Trust all and continue** | Codex 0.160.0 |
| Codex's `Where should the new conversation run?` | `\r` | **Current checkout** | Codex 0.160.0 |
| Codex's update offer, `1. Update now` | `\r` | **Update now**, where it starts | Codex 0.156.1 |
| `[oh-my-zsh] Would you like to update?` | `n` | no: the user updates it | oh-my-zsh bf77e35 |
| Claude Code's `Teach auto mode…` | `\x1b` | Esc: Not now; no return | Not yet proven, below |
| The same, 2.1.289's list | `\x1b[B\r` | down, return: **2. Not now** | Not yet proven, below |

Each key counts on where the selection starts on the version named. Read the
screen before you send: if the selection is elsewhere or the options have
moved, go to the answer with the arrows, then return. Never a digit and then
return: on Codex's update offer that took the highlighted **Update now**,
whatever the digit was. Codex's trust said `1. Yes, continue` on older
versions. Its hooks review sometimes starts on `2` already: then return alone.
Its update offer was proven on 0.156.1; 0.157.1 showed it with the selection on
Update now, not pressed, and 0.158.0 offered 0.160.0, taken on 2026-10-02 by
Bot Father's restarts.
Claude Code's `Teach auto mode` on 2.1.283 is a form, not a list, ending
`Enter to continue · Esc to cancel`: never send it a return, since
Enter is Continue, which scans the project, recent sessions and the machine's
shell history. Esc cancels it (Not now) in its code; that is not yet proven
live, though the form was seen live twice on 2.1.283. On 2.1.278 it was a
numbered list, answered with `2. Not now`, and on 2.1.289 it is one again:
`1. Yes`, `2. Not now`, `3. Don't show again`, above the input box, its
selection on 1. Yes (seen live, not answered, in #489). Go down to 2. Not now,
read the screen, and only then return. Codex's hooks
question matters most. The kit's hook is how the book learns which
conversation the session is running, and until it is answered the
conversation has not started. Codex's trust applies to the repository root,
which is the whole bots folder. Codex's `/new` may ask where the new
conversation runs (0.156.1, 0.157.1, 0.158.0 and 0.160.0 all did); the answer is
always the current checkout, the bot home, and never `2. New worktree`:
the kit never makes a git worktree.

The hooks review of a Codex temporary session you made yourself is the one
exception: answer it with `obk temp trust-hooks --bots <bots> --name
<session>`, not with the keys. It reads the screen, chooses **Trust all and
continue** only if the review is there, and checks that the review went. A
permission rule can allow that one command, where it cannot allow keys sent
into any tab. The same goes for Claude Code's `Teach auto mode` screen on a
temporary session you made: answer it with `obk temp answer --bots <bots>
--name <session>`. It answers only a shape in the table exactly as the kit
knows it (Esc on the 2.1.283 form, 2. Not now on the 2.1.289 list, the return
only after a second look), refuses any other screen, and checks that it went. The kit's
default set allows it, as it allows `obk temp trust-hooks`.

A long-lived session's two screens go through the kit too: Codex's hooks
review with `obk session trust-hooks --bots <bots> --bot <bot> --session
<session>`, and Claude Code's `Teach auto mode` screen with `obk session
answer --bots <bots> --bot <bot> --session <session>`. A long-lived session is
Bot Father's: the caller is a Bot Father session or the user, from outside the
fleet's tabs, and a session of any other bot is refused. They make the same
checks as the temp commands. Before either trust-hooks command trusts hooks,
it checks that the hooks on the review are the kit's own: the bot's
`.codex/hooks.json` holds only the kit's, and the count on the screen is the
number of the kit's hooks Codex does not trust yet. A refusal says what it
saw; then type nothing and take it to the user. The keys in the table are for
the screens the kit does not answer.

Where the kit says no session came up, the shell swallowed the launch line,
usually while it was asking its own question. Answer the shell, then close
that one tab (`<orca> terminal close --terminal <handle> --tab`) and run
`obk up` again. This is the one tab you may close without asking: the kit
opened it a moment ago, and it holds no conversation.

A screen you do not recognise gets no keypress. Take what it says, and which
bot and tab it is in, to the user. When you have answered, read the screen
again and check a session is running before you call the bot ready.

## When the bot is already running

Changing a bot whose sessions are up is the ordinary case rather than the
awkward one. Putting a skill on a bot or taking one off reaches its running
sessions without a restart, and `obk skills build` says, session by session,
how:

- Claude Code: the kit types `/reload-skills` into the session's tab. That is
  Claude Code's own reload. A busy session queues it and runs it as a command
  when its turn ends, so it never reaches the model as text.
- Codex: nothing is typed, because Codex has no reload command. It takes the
  change at the start of its next turn, not in the middle of the one it is on.

The kit reports a session it could not tell, and why: not up, or on a screen
waiting for an answer. A session that is not up reads its skills when it
starts.

Told is not the same as confirmed. Before telling anyone a skill is there,
check that the session can use it: ask it to load the skill. Do not look
again at the disk you just wrote, since that says nothing about what another
process has loaded. Do not ask a Codex session whether the skill is in its
list: it has answered "none" while its list held the skill. Where a skill has
not appeared after the next turn, say so. A restart would make it appear, and
meanwhile the session can read the skill's `SKILL.md` by the path the kit
printed. A restart is the user's to ask for. Taking one because it is quick
ends a conversation they were in the middle of.

Instructions are not skills. A session is working from the rules it read when
it started, so a change to a bot's `AGENTS.md` may not reach one that is
already up even when a skill change would, and a session's model, effort or
approval only changes when it is started again (`obk restart`, on the user's
word, and then read its tabs as above). Say which you changed, and what that
means for the sessions running now. `obk health` names each running session
still on the older rules or on other settings, and what brings it up to date: a
clear reads the rules again (`obk session clear`), and so does a start, on both
harnesses.
Where everything needs restarting, remind
them to do it from Bot Father's ops tab.

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
