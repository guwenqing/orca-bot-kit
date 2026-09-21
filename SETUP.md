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
codex --version
```

The Orca line must come back with `ok: true` and `result.runtime.reachable:
true`. Anything else means Orca is not running, whatever else it says: ask them
to start it, then run the line again.

On the Orca CLI path: `/usr/local/bin/orca` is a root-only symlink on some
machines and fails for an ordinary user, so use the full path above. If Orca
lives somewhere else here, find it and set `OBK_ORCA` to it.

If Node is older than 24.21.0, say so and stop. The kit's book of sessions is a
SQLite write transaction, and `node:sqlite` arrives in Node itself on that line.

If neither harness is installed, say so and stop. If only one is, that is fine,
and it is the one Bot Father will run on.

## 2. Make `obk` runnable

**First ask whether it already is:**

```sh
obk --version
```

If that answers, the kit is installed. Say where it is coming from — `which obk`
— and go on to step 3. **Do not install it again.** Someone else, or another
project, may be running through that same installation, and replacing it would
take their `obk` away without telling them.

If it does not answer, install it. Today the kit is not published, so the route
is a clone and a global install from it:

```sh
git clone https://github.com/guwenqing/orca-bot-kit
cd orca-bot-kit
npm install
npm link
obk --version
```

The repository is private for now, so the clone uses their own git credentials.
If it cannot authenticate, say so and ask them to sign in. Do not go looking for
credentials of your own.

**This step is the one thing on this page that changes.** When the kit is
published, all of it becomes `npm install -g orca-bot-kit` and the clone goes
away. The rest of this page is about Orca and the harnesses and stays as it is.

If `npm link` fails because it cannot write where npm keeps global packages,
give them the command to run themselves and wait. Do not reach for `sudo` on
their behalf.

## 3. Ask the two things only they can answer

Ask both in one message, then wait.

**Where the bots folder goes.** An absolute path. It becomes a git repository of
theirs holding every bot's configuration: charters, rules, session settings, the
book of sessions. It holds none of the kit's code. They may push it somewhere
later; the kit never commits for them.

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

Read everything it prints. Two parts of it matter to them:

- **what it created** — say it in a sentence, not as a file listing;
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

A tab that has just been opened may be sitting on a question before the harness
is even running, and until it is answered nothing else happens in that tab. This
step is yours: the kit will not type into a tab that is waiting, on purpose.

Find the tabs, and look at each one. Bot Father's own folder is `bots/bot-father`
*inside* the bots folder from step 3, so where `<their path>` appears below it is
that folder itself, exactly as you gave it to `obk init`:

```sh
orca terminal list --worktree path:<their path>/bots/bot-father --json
orca terminal read --terminal <handle> --screen --json
```

What you will see, and the usual answer. Each goes as one `terminal send
--text`, with the return inside the text and **no** `--enter`, because a menu
takes a return as the keypress it is waiting for:

| On screen | Send | Which is |
|---|---|---|
| Claude Code's folder trust list | `\x1b[B\r` | down, then return: its selection starts on **No, exit** |
| Codex's directory trust, `1. Yes, continue` | `1\r` | yes |
| Codex's `Hooks need review` | `2\r` | trust all and continue |
| Codex's update offer, `1. Update now` | `1\r` | accept it |
| `[oh-my-zsh] Would you like to update?` | `n` | they update their own shell |
| Claude Code's `Teach auto mode about your environment?` | `2\r` | **Not now**: it would write settings of theirs |

The numbers there are what these menus showed when this was written. Read them
off the screen in front of you rather than trusting the table: a harness that has
added an option since has moved them all down one.

Two things to know rather than guess at.

Codex's hooks question is not cosmetic. The kit's hook is how the book learns
which conversation a session is running as, and while that screen is up the
conversation has not started at all. Answer it, or the session comes up with an
empty book and nothing says why.

Codex's trust question applies to the **repository root**, which for a bot means
the whole bots folder rather than the one bot. That is what they are agreeing to.

**Anything you do not recognise: type nothing.** Tell them what is on the
screen and which tab it is in, and wait. A keypress into a menu you have not read
is how a harness quits back to the shell.

When you have answered, read the screen again and confirm the harness is up.

## 6. Check it

```sh
obk health --bots <their path>
```

It reads the setup and says what it found, and writes nothing at all. It exits 1
when it found something, so do not read a non-zero exit as a broken setup.

Relay what it says in plain words. Nothing it prints is a verdict: which findings
matter is for them, or for Bot Father, to judge. If something looks wrong to you,
say what you would do and let them decide.

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
