# Setting up Orca Bot Kit

You are an AI assistant with a shell, and someone has asked you to set this kit
up on their computer. This page is what to do. Read it to the end before you run
anything.

Everything here is a default for when they have said nothing else. When they ask
for something different, do that instead; nothing on this page stands in their
way.

Two rules hold throughout.

**Install nothing but the kit.** Node, git, Orca and the harnesses are theirs to
install, and each needs choices you cannot make for them. When one is missing,
say which, say what it is for, and stop.

**Ask only what only they can answer.** There are two such things, in step 3.
Everything else you can find out by looking.

## What you are making

Orca is the host. A bot is an Orca project and a session is a tab, running
Claude Code or Codex. You are making the first bot, **Bot Father**, and a folder
that holds the whole fleet's configuration as a git repository of theirs.

When you are done they will have an Orca project called Bot Father with two
tabs, and from then on they manage everything by talking to it rather than by
running commands. Leading them into that conversation is the last step, and it
is the point of all the others.

## 1. Check what is already here

Run these and read the answers.

```sh
node --version                                          # 24.21.0 or newer
git --version
/Applications/Orca.app/Contents/Resources/bin/orca status --json
claude --version                                        # at least one of these
codex --version                                         # 0.156.1 or newer
```

The Orca line must come back with `ok: true` and `result.runtime.reachable:
true`. Anything else means Orca is not running, whatever else it says: ask them
to start it, then run the line again.

On the Orca CLI path: `/usr/local/bin/orca` is a root-only symlink on some
machines and fails for an ordinary user, so use the full path above. If Orca
lives somewhere else here, find it and set `OBK_ORCA` to it.

If Node is older than 24.21.0, say so and stop. The kit's book of sessions is a
SQLite write transaction through Node's own `node:sqlite`, and 24.21.0 is the
first release measured here that loads it without an experimental warning.

If neither harness is installed, say so and stop. If only one is, that is fine,
and it is the one Bot Father will run on.

If Codex is older than 0.156.1, say so and ask them to update it before a bot
runs on Codex. The kit starts Codex with `--no-daemon`, and older Codex refuses
that flag.

## 2. Make `obk` runnable

**First ask whether it already is:**

```sh
obk --version
```

If that answers, the kit is installed. Say where it is coming from — `which obk`
— and go on to step 3. **Do not install it again.** Someone else, or another
project, may be running through that same installation, and replacing it would
take their `obk` away without telling them.

If it does not answer, install it from npm:

```sh
npm install -g @assuredloop/orca-bot-kit
obk --version
```

If `obk --version` still does not answer, npm has no working release yet: it
refused the name, or it installed an early placeholder that has no `obk` in it.
Take the placeholder off again if there is one, and install from a clone
instead:

```sh
npm uninstall -g @assuredloop/orca-bot-kit
git clone https://github.com/guwenqing/orca-bot-kit
cd orca-bot-kit
npm install
npm link
obk --version
```

**This step is the one thing on this page that changes.** The rest of this page
is about Orca and the harnesses and stays as it is.

If either install fails because it cannot write where npm keeps global packages,
give them the command to run themselves and wait. Do not reach for `sudo` on
their behalf.

## 3. Ask the two things only they can answer

Ask both in one message, then wait.

**Where the bots folder goes.** An absolute path. It becomes a git repository of
theirs holding every bot's configuration: charters, rules, session settings, the
book of sessions. It holds none of the kit's code. The bots commit their own
changes to it; the kit's commands never commit, and pushing it somewhere is
theirs to decide.

**Which harness Bot Father runs on**, `claude` or `codex`. There is no default
and the kit will not guess. It is Bot Father's own harness only; each bot they
make later chooses its own. If only one harness is installed, say so and confirm
it rather than asking as though the choice were open.

## 4. Make the fleet

```sh
obk init --bots <their path> --harness claude|codex
```

This makes the folder a git repository, seeds it, writes Bot Father, and opens
its two tabs in Orca: the management tab where they will talk to it, and an ops
tab, which is a plain shell for work across the whole fleet.

Read everything it prints. Three parts of it matter to them:

- **what it created** — say it in a sentence, not as a file listing;
- **the permission rules it wrote**: the kit's default set, so auto mode does
  not stop Bot Father for the kit's own commands, reading a long message
  beside the bots folder, and its commits. The kit writes this set for every
  bot, with nobody asked. Say in a sentence what it allows, and that
  `obk permission`, `obk retire`, `obk pause` and `obk init` are not in it and
  keep their yes;
- **anything it says about Orca's own default launch arguments.** Orca adds
  these to every agent it launches, relaunches and resumes. When they carry a
  permission bypass, every session runs in that mode whatever approval level the
  kit asked for. The kit never sets that setting and will not change it. Tell
  them plainly what it is doing and that it is theirs to change in Orca's
  settings. Say it even if it sounds like a small thing: it decides what every
  bot on this machine is allowed to do.

`init` is safe to run again. It adds what is missing and leaves everything else,
their own edits included.

## 5. Answer what the tabs ask

**How the tab got into this state**, because it decides what you do about it. A
tab the kit has just made has no harness in it yet. The kit waits up to 15 s for
the tab's shell to come to a ready prompt, types the launch line, and only then
asks whether a harness came up. A shell that asks a question of its own as it
starts gets nothing typed. So different things can be on the screen, and they
need different answers.

`obk init` tells you which, for every tab it opened:

- *not launched: the shell is asking: …* — the shell asked a question as it
  started, and the kit typed nothing. Answer the shell (the oh-my-zsh question
  in the table below is the usual one), then run the `obk restart` command the
  output gives for that session. It closes that tab and launches the session in
  a new one. The command exits 1 while a session is not launched.
- *the harness was typed in and is running. The kit cannot see whether a screen
  in it is waiting for an answer* — look at it: Orca does not flag every first-run
  screen, so it may still be asking something of its own. That is the table below.
- *the harness was typed in and came up, waiting on: …* — running and blocked on
  a question. The table below.
- *the harness was typed in, and no session came up in the tab* — **the line did
  not take.** There is a shell there, not a harness. Answering whatever the shell
  is asking does not start the harness, and neither command you might reach for
  will: `obk up` sends nothing, because the tab is already in the book, and
  `obk restart` refuses, because the book cannot name a conversation for a
  session that never started. The recovery is below.

Use the Orca CLI at the path you found in step 1, not a bare `orca`: on a machine
where `/usr/local/bin/orca` is the root-only symlink, a bare `orca` answers
`Unable to determine Orca.app path from symlink` and nothing below will work.
`OBK_ORCA` tells *the kit* which Orca to use; it does not change what your shell
finds.

```sh
ORCA=/Applications/Orca.app/Contents/Resources/bin/orca
```

Find the tabs, and look at each one. Bot Father's own folder is `bots/bot-father`
*inside* the bots folder from step 3, so where `<their path>` appears below it is
that folder itself, exactly as you gave it to `obk init`:

```sh
"$ORCA" terminal list --worktree path:<their path>/bots/bot-father --json
"$ORCA" terminal read --terminal <handle> --screen --json
```

What you will see, and the usual answer. Each goes as one
`"$ORCA" terminal send --terminal <handle> --text …`, with the return inside the
text and **no** `--enter`, because a menu takes a return as the keypress it is
waiting for:

| On screen | Send | Which is | Proven on |
|---|---|---|---|
| Claude Code's folder trust list | `\x1b[B\r` | down, then return: its selection starts on **No, exit** | Claude Code 2.1.283 |
| Codex's directory trust, `1. Trust and continue` (older: `1. Yes, continue`) | `\r` | return: its selection starts on **Trust and continue** | Codex 0.160.0 |
| Codex's `Hooks need review` | `\x1b[B\r` | down, then return, to **Trust all and continue**; if the selection already starts there, return alone | Codex 0.160.0 |
| Codex's `/new`: `Where should the new conversation run?` | `\r` | return: its selection starts on **Current checkout** (bot home); on 0.162.0 it is called **1. Use current Git worktree** (Keep using the current working directory). Never **Create new Git worktree** | Codex 0.160.0; Codex 0.162.0 (#516) |
| Codex's update offer, `1. Update now` | `\r` | return: its selection starts on **Update now**, which accepts it | Codex 0.156.1; seen on 0.157.1 (offering 0.158.0) with the selection on **Update now**, not pressed; 0.158.0 offered 0.160.0, taken on 2026-10-02 by Bot Father's restarts |
| `[oh-my-zsh] Would you like to update?` | `n` | they update their own shell | oh-my-zsh bf77e35 |
| Claude Code's `Teach auto mode about your environment?` | `\x1b` | Esc, which cancels it (**Not now**). On 2.1.283 it is a form, not a list: `How you use Claude here`, `Also scan shell history`, `Also scan your other repos`, `Continue`, and `Enter to continue · Esc to cancel`. **Never send a return**: Enter is **Continue**, which starts a scan of the project, recent Claude sessions and, by default, the machine's shell history | Not yet proven: Esc cancels in Claude Code 2.1.283's code, not yet seen live (#370); the form was seen live twice on 2.1.283, in #261's live test and #239's live run 1 (#416); 2.1.278 showed a numbered list, answered with 2. Not now |
| Claude Code 2.1.289's `Teach auto mode about your environment?`, a numbered list: `1. Yes`, `2. Not now`, `3. Don't show again`, and `Enter to confirm · Esc to cancel`, above the input box | `\x1b[B\r` | down, then return, to **2. Not now**: its selection starts on **1. Yes**. Read the screen after the down arrow, and send the return only with the selection on **2. Not now**. Never **1. Yes**, which starts the teach scan, and never **3. Don't show again** | Not yet proven: the list was seen live on 2.1.289 with its selection on 1. Yes, in #489's live run 1, and was not answered there |

Each key counts on where the selection starts, as it did on the version named.
Read the screen in front of you before you send: if the selection is somewhere
else, or the options have moved, go to the answer with the arrows and then
return. Never send a digit and then return: on Codex's update offer that took
the highlighted **Update now**, whatever the digit was.

Three things to know rather than guess at.

Codex's hooks question is not cosmetic. The kit's hook is how the book learns
which conversation a session is running as, and while that screen is up the
conversation has not started at all. Answer it, or the session comes up with an
empty book and nothing says why.

Codex's trust question applies to the **repository root**, which for a bot means
the whole bots folder rather than the one bot. That is what they are agreeing to.

Codex's `/new` question (seen on 0.156.1, 0.157.1, 0.158.0 and 0.160.0) is always answered with the current checkout, which is the bot
home. The kit never makes a git worktree, so
`2. New worktree` is never the answer.

A bot's own temporary sessions are answered by their maker, through the kit, so
that a narrow permission rule of the kit's default set allows it rather than a
rule to type into any tab. On Codex's hooks review, the maker runs
`obk temp trust-hooks --bots <their path> --name <session>`. On Claude Code's
`Teach auto mode` screen, it runs `obk temp answer --bots <their path> --name <session>`.
That command reads the screen and answers only when it holds one of the two
shapes in the table exactly as the kit knows it: Esc for the 2.1.283 form, and
**2. Not now** for the 2.1.289 list. On the list it sends the arrows, reads the
screen again, and sends the return only with the selection on **2. Not now**.
It refuses any other screen, types nothing then, and prints what it saw.
Afterwards it checks that the screen has gone. The kit's default set allows
both commands for every bot, so there is nothing to ask the user. The rules
are these, with the kit's full CLI path for `<kit>`, as the command's own
output prints it:

```text
Bash(<kit> temp answer --bots <their path>:*)
Bash(<kit> temp trust-hooks --bots <their path>:*)
```

A long-lived session's two screens go through the kit as well, not through the
keys. On Codex's hooks review, run
`obk session trust-hooks --bots <their path> --bot <bot> --session <session>`.
On Claude Code's `Teach auto mode` screen, run
`obk session answer --bots <their path> --bot <bot> --session <session>`.
A long-lived session is Bot Father's, so run them from outside the fleet's tabs,
as you do here, or from a Bot Father session. A session of any other bot is
refused. They make the same checks as the temp commands. Before either
trust-hooks command trusts hooks, the kit checks that the hooks on the review
are its own: the bot's `.codex/hooks.json` holds only the kit's hooks, and the
count on the screen is the number of the kit's hooks that Codex does not trust
yet. When it refuses, it says what it saw: type nothing, and tell them what it
said. Use the keys in the table for the screens the kit does not answer.
The kit reads Codex's trust from the caller's `CODEX_HOME`, else `~/.codex`;
a bot run under another `CODEX_HOME` is outside what the kit can see.
The kit also records the extra arguments it launched each session with, and
refuses when they mention hooks, or when there is no record. A Codex that
someone started again by hand in that tab, with other flags, is outside what
the kit records.

**Anything you do not recognise: type nothing.** Tell them what is on the
screen and which tab it is in, and wait. A keypress into a menu you have not read
is how a harness quits back to the shell.

**If the line did not take**, and you have a shell rather than a harness: answer
whatever the shell was asking (the oh-my-zsh question above is the usual one),
then close that one tab and bring the fleet up again. The new tab's shell has
nothing pending, so the line lands:

```sh
"$ORCA" terminal close --terminal <handle> --tab --json
obk up --bots <their path>
```

That is safe here and only here: the tab holds no conversation to lose, which is
the same reason `obk restart` will not do it for you. `obk up` opens a new tab,
types the line again and leaves the ops tab alone. Never close a tab you did not
open, and never close one with a session running in it.

When you have answered, read the screen again and confirm a harness is actually
running in the tab. Do not go to step 7 on a tab that is still a shell.

## 6. Check it

```sh
obk health --bots <their path>
```

It reads the setup and says what it found, and writes nothing at all. It exits 1
when it found something, so do not read a non-zero exit as a broken setup. The
one exception is an error with no findings, saying Orca is not answering: that
is a real problem, and the fix is to start Orca and run it again.

Relay what it says in plain words. Nothing it prints is a verdict: which findings
matter is for them, or for Bot Father, to judge. If something looks wrong to you,
say what you would do and let them decide.

Then go on to step 7, whatever it found. A finding does not stop the setup: Bot
Father is running, and it is the one to look at findings with them. One thing is
not a finding: on Codex, the book has no conversation id for the session until
the first message is typed into it.

## 7. Hand them over to Bot Father

This is the step that finishes the job, and the easiest one to do badly by
carrying on managing the fleet yourself.

Tell them:

- **which tab is Bot Father's.** In Orca, the project is called Bot Father and
  has two tabs: the management tab is the one with the harness running in it,
  and the other is the ops shell. Identify it for them by what is on the screen
  rather than by its title, because a harness rewrites its own tab title;
- **that they talk to it in ordinary words.** It knows how to interview them into
  a bot's charter, suggest the skills a role needs, and make the bots and their
  sessions. They do not need to learn the commands;
- **what to say first.** Give them an actual opening line, something like *"I
  want a bot that reviews my pull requests"*, or *"what should my first three
  bots be?"* — whichever fits what they have told you they want;
- **what the ops tab is:** a plain shell for work across the fleet. The kit does
  not track it.

Then stop. If they ask you for more bots after this, point them at Bot Father
rather than running `obk` for them. Every bot it makes, it knows about; the ones
you make behind its back are ones they will have to explain to it later.
