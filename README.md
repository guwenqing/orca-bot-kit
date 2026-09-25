# Orca Bot Kit

A kit for running a small fleet of long-lived role bots on your own computer —
a manager, developers, reviewers, a personal helper. Each bot keeps its
identity, its rules, its skills and its sessions across restarts.

[Orca](https://github.com/stablyai/orca) is the host: a bot is an Orca project
and a session is a tab, on Claude Code or Codex. The kit is an npm package with
an `obk` command and a set of skills. You are meant to manage the fleet by
talking to Bot Father, the first bot, whose skills call the CLI for you — not by
editing files.

The design is in [`docs/prd.md`](docs/prd.md); the decisions with lasting
consequences are in [`docs/adr/`](docs/adr/); what we know about Orca and the
two harnesses is in [`docs/tech-notes.md`](docs/tech-notes.md).

## Start here

Paste this into any AI session that can run commands — a Claude Code or Codex
session in a terminal, or anything else with a shell:

> Set up Orca Bot Kit on this machine: get
> https://github.com/guwenqing/orca-bot-kit, then follow SETUP.md in it to the
> end.

It checks what your machine already has, tells you plainly about anything
missing rather than installing it, asks you the only two things it cannot work
out for itself — where your bots folder goes, and which harness Bot Father runs
on — and leaves you talking to Bot Father, which is where everything after this
happens.

[`SETUP.md`](SETUP.md) is that page. It is written for the assistant rather than
for you, so you do not have to read it; nothing in it is hidden from you either.

The rest of this README is the reference: what each command does, and why the
kit is built the way it is. Reach for it when you want to know how something
works, not to get started.

## Reporting a problem

When the kit itself goes wrong (an `obk` command fails in a way its own message
does not explain, or does something other than what it says), open an issue on
this repository's Issues page (the address `package.json` gives as `bugs`) with
the form there. It asks for the command and its whole output, what you expected,
`obk health --json`, and the versions of `obk`, Node, Orca and the harness. Take
out anything private first: issues are public.

Bot Father is told the same thing. Tell it what went wrong and it gathers these
details and, when you say so, files the issue or gives you the text to paste.

## Status

Early. The CLI creates your bots folder, brings Bot Father up in Orca, creates
bots and their sessions on either harness, and builds each bot's `AGENTS.md`
from its charter and the rules it carries.

## Install

Node.js >= 24.21.0, git, and Orca with at least one of Claude Code or Codex
installed and configured. That line because the kit keeps writers out of each
other's way in a bot's book with a SQLite write transaction, through Node's own
`node:sqlite`. That module is older than the 24 line; 24.21.0 is the first
release measured here that loads it without an experimental warning on stderr,
which would otherwise land in the output of every command.

```sh
npm install -g @assuredloop/orca-bot-kit
obk --version
```

The command is `obk`. If `obk --version` does not answer after that, npm has no
working release yet (an early placeholder has no `obk` in it): run
`npm uninstall -g @assuredloop/orca-bot-kit`, then install from a clone of this
repository with `npm install` and `npm link`. To work on the kit itself, run
your clone's `src/cli.js` by its full path instead of linking it: the `obk` on
PATH stays the published one, and the kit calls itself back by the path of the
CLI that started it, so what your clone brings up calls back into your clone.

Releases go out from CI: publishing a GitHub Release tagged `v<version>` runs
`.github/workflows/publish.yml`, which runs the suite and publishes that version
to npm with a provenance statement. Nothing else publishes.

## Create your bots folder

```sh
obk init --bots /absolute/path/to/my-bots --harness claude
```

`--harness claude|codex` says which harness Bot Father itself runs on; there is
no default. This makes the folder a git repository and seeds it:

```
my-bots/
  .gitignore               # what obk links here, which no clone carries
  defaults.yaml            # rules and skills every bot gets
  skills.yaml              # online skill sources
  rules/                   # your own rule units
  skills/                  # your own common skills
  bots/bot-father/bot.yaml # Bot Father: charter, rules, skills, sessions
```

The folder is yours. It holds your configuration and none of the kit's code —
kit skills are linked from the installed package, never copied
([ADR 0014](docs/adr/0014-skills-are-linked-never-copied.md)). Run `init` again
whenever you like: it adds what is missing and leaves everything else, including
your edits, exactly as it is. It does not commit for you.

The `.gitignore` keeps out the skill links, and the kit's own record of which
ones it made (`.obk-skills.yaml` in each bot folder). The links point at
where the kit and your skill sources are installed on this machine, so they say
nothing true on another one, and `obk up` makes them again wherever you check
the repo out. So a clone carries your bots and not this machine's paths, and two
computers do not take turns rewriting each other's links. Anything of your own
in a bot's skills directories is still yours: `git add --force` takes it in.

## Add a bot and its sessions

```sh
obk bot create  --bots /path/to/my-bots --name api-bot --harness codex \
                --charter 'Api Bot owns the API clone.'
obk session add --bots /path/to/my-bots --bot api-bot --name daily \
                --effort high --work-dir work/api \
                --prompt 'Keep the API clone green. Ask before you touch main.'
obk up          --bots /path/to/my-bots
```

`bot create` writes the bot's folder — `bot.yaml`, the `AGENTS.md` built from
that file and the rule units, `CLAUDE.md` as a symlink to it, and a `.gitignore`
for `work/`.
`session add` writes one session into `bot.yaml`: its harness (the bot's unless
it says otherwise), model, effort, context window, approval level, start prompt,
work dir and any extra arguments for the harness. A start prompt is either text
(`--prompt`) or, when it is long, a file in the bot home the session points at
(`--prompt-file prompts/reviewer.md`), and it reaches the harness as written,
apart from two things the kit does on purpose: blank space at either end is
trimmed, and when the session has a work dir the kit appends its one-sentence
note about it. Anything you leave out is the
harness's own default; the kit names no model of its own. The approval level is
`auto` — the harness's real auto mode — unless you ask for `ask` or, in those
words, `dangerously-skip`
([ADR 0015](docs/adr/0015-three-approval-levels-auto-by-default.md)).

Neither command touches Orca. `obk up` is what makes it all real there: an Orca
project per bot, a tab per session, each started at the bot home with its own
launch command and its start prompt. It only ever adds — it never closes a tab —
so run it after a restart, or whenever something is missing. `--bot` and
`--session` bring up one thing rather than the fleet.

## The rules a bot works by

Each bot has one `AGENTS.md`, shared by all its sessions: its charter, then the
rule units it uses
([ADR 0013](docs/adr/0013-agents-md-is-compiled-from-rule-units.md)). A rule
unit is one short block of always-on working rules. The kit's own units live in
[`rules/`](rules/) in this package; yours go in `rules/` inside your bots
folder. What is always on stays short, because every session reads it on every
turn; the depth belongs in skills.

```sh
obk rules build --bots /path/to/my-bots [--bot api-bot]
```

That writes the file, and `obk up` does the same for every bot it brings up,
before any session starts — a session reads its rules as it comes up, so a
rebuild landing after the tab is open would reach nobody. The build owns a
marked block and nothing else in the file:

```
<!-- obk:rules 6f1cfe05a4d3b2e9 — built by obk from bot.yaml and the rule units; ... -->
# Api Bot

## Charter
...
<!-- obk:rules end -->
```

Write what you like above or below that block and it comes back exactly as you
left it. Edit inside it and the build stops, tells you, and leaves your words
alone — the checksum on the begin marker is how it knows its own text from
yours. A bot carries every kit unit marked `applies: all` without asking for
them; anything else is named in a `rules:` list, in `defaults.yaml` for every
bot or in one bot's `bot.yaml`, as `kit:<name>` for one of the kit's or a bare
name for one of yours. Codex reads at most 32 KiB of an instructions file and
says nothing when it stops, so the build tells you when a bot's file goes over.

Nine units suit every bot, whatever it does:

| | |
|---|---|
| `the-ask` | reading the whole request, which questions are yours to answer |
| `simple` | the smallest thing that answers it, and reusing what is there |
| `scope` | changing what the work needs and leaving the rest |
| `evidence` | what you saw, what you worked out, and not inventing either |
| `finishing` | the check you can run, run on the real thing, reported as it came |
| `limits` | the charter, what needs a yes, no quiet substitutes |
| `talk` | answer first, short, real names |
| `mail` | asking the kit for the road to another session; mail is queued |
| `profiles` | the few lines the fleet keeps on each bot, for choosing who to hand work to |

Two more are for bots that write code: `tests-first`, a failing test first and
someone else writing it, and `review`, someone who did not write the work
reading it.

They are the essence, not the depth: how to debug, how to review well, how to
write a test worth keeping and how to hand work over belong to the skills a bot
picks. They are also defaults, not fences — a bot uses the ones its owner
picks, your own units sit beside them, and a bot does what its user asks of it.
Why the set is this size is in
[`docs/proposals/41-common-rules.md`](docs/proposals/41-common-rules.md).

A unit is a markdown file whose frontmatter carries `name` (the file's own
name), `title` (the heading it gets in `AGENTS.md`) and `applies` (`all` or
`code`); the body is the rule text and nothing else.
[`test/kit-rules.test.js`](test/kit-rules.test.js) holds that shape, and the
size the always-on set may reach.

## The skills a bot uses

The kit ships its own skills in [`skills/`](skills/), one directory per skill,
named `obk-<technique>`
([ADR 0019](docs/adr/0019-skills-by-technique-with-a-prefix.md)). They are
organised by technique rather than by role: a role is a charter plus a choice
of skills. Each one gives techniques and defaults, never a process or
a way of working you have to adopt, and carries what it needs itself rather
than relying on another skill being loaded.

| | |
|---|---|
| `obk-tdd` | a failing test first, a separate test author, the mutation check |
| `obk-reviewing` | giving a review that is worth acting on, and answering one |
| `obk-debugging` | a check that goes red first, the real cause, proof where it broke |
| `obk-arch` | what is wanted, the shape, runnable and testable, work in slices |
| `obk-grilling` | interviewing a plan until it holds, and writing down what was settled |
| `obk-handoff` | stopping somewhere safe, and the note a cold reader can act on |
| `obk-recall` | where a piece of work actually stands, before carrying on with it |
| `obk-why` | why the code is like this, and how sure you are |
| `obk-teach` | explaining something so it lands, at the other person's pace |
| `obk-personal-facilitation` | keeping someone's own list true, and stopping before the step that cannot be taken back |
| `obk-researching` | finding it out from sources, and saying how well you know it |
| `obk-writing` | writing for a reader, in one kind of piece, with the claims checked |
| `obk-decision-memo` | the conclusion first, the alternatives, and the argument against it |
| `obk-bot-building` | what a bot owns, the charter interview, and the skills the job needs |
| `obk-fleet-review` | one verdict per bot, the cheaper answers first, and where a problem goes |
| `obk-grooming` | the daily pass: only what changed, one output checked, one short report |
| `obk-finops` | what a result cost, live prices, and which limits are really enforced |

A skill is where the depth lives. The always-on rules say that a change in
behaviour starts with a failing test someone else wrote and is read by someone
who did not write it; `obk-tdd` is how to write a test worth keeping and find
out whether the tests would catch a real mistake, and `obk-reviewing` is how to
read a change so the findings are worth acting on, and how to answer a reading
of your own.

A bot gets the ones its lists name:

```sh
obk skills build --bots /path/to/my-bots [--bot api-bot]
```

`skills:` in `defaults.yaml` gives them to every bot and `skills:` in a bot's
`bot.yaml` to that one. An entry is `kit:<name>` for one of the kit's, a bare
name for a directory in `skills/` inside your bots folder, or anything with a
`/` in it for a skill directory anywhere on disk. `obk up` links them before it
opens a tab, and `bot create` gives a new bot what the lists already name.

A bot whose sessions are running gets a changed list without a restart.
When `skills build` links or takes away a skill, it tells each running
session of that bot. A Claude Code session gets `/reload-skills` typed into
its tab: Claude Code's own reload, which a busy session runs when its turn
ends. Codex has no reload command and takes the change at the start of its
next turn, so nothing is typed there. The kit prints the new skills'
`SKILL.md` paths, and says that a restart would make a skill appear if it is
still missing after that turn. A session the kit could not tell is named,
with the reason.

What lands in the bot is a symlink, never a copy
([ADR 0014](docs/adr/0014-skills-are-linked-never-copied.md)) — into
`.claude/skills` and `.agents/skills` in the bot home, which is where each
harness reads a project's skills from. So a kit skill is read where npm
installed it, a running session reads an edited skill the next time it loads
it, and updating the kit updates every bot at once.

The kit takes away only what it can prove it put there. It writes down every
link it makes, in `.obk-skills.yaml` in the bot folder, and when no list names
one any more it takes that link away, whichever shelf it came from, as long as
the link is still the one it wrote. Anything else in those directories is left
alone and shown as yours: a skill you wrote there, a link of your own, or one of
the kit's that you have since pointed somewhere else. If you want one of those
gone, delete it yourself; the skill a link points at is never touched.

## Skills from somebody else's repo

`skills.yaml` in your bots folder lists where else skills come from:

```yaml
sources:
  - name: someones-skills
    repo: https://github.com/someone/skills
    path: skills        # subfolder inside the repo, optional
    ref: v1.2.0         # branch, tag or sha
```

```sh
obk skills fetch  --bots /path/to/my-bots [--source someones-skills]
obk skills update --bots /path/to/my-bots [--source someones-skills]
```

`fetch` clones each source into `<your-bots-folder>.skill-sources/`, a sibling
of your repo and never inside it, at the version you pinned, and writes the sha
it got back beside your `ref`. A source that is already there it leaves exactly
as it is — no network, no moving — even when the `ref` is a branch that has gone
on ahead. `update` is the asking, and it is the only thing that moves one. So
the version your bots run changes when you say so and at no other time; `obk up`
never fetches.

A bot names one of those skills `<source>:<skill>` in its `skills:` list, beside
the other three forms. Moving a source moves what every session reading it sees,
with no rebuild, because the link points at the clone.

The kit says one line when a source carries scripts or hooks. It does not read
them and does not stand in your way — a third-party skill is your risk to take
([ADR 0014](docs/adr/0014-skills-are-linked-never-copied.md)).

A skill is a directory holding `SKILL.md` — frontmatter carrying `name` (the
directory's own name) and `description`, then the body — plus any reference
files it links to and a `NOTICE.md` naming the sources it was built from and
their licences. The notice travels with the skill, which is what the licences
ask for, and stays out of `SKILL.md`, which a bot reads into its context every
time the skill is used. Those two keys are the only frontmatter both Claude Code and
Codex read, so a kit skill carries nothing else, and its links stay inside its
own directory, because a bot gets the directory alone.
[`test/kit-skills.test.js`](test/kit-skills.test.js) holds that shape.

## Sessions that come back

Each bot keeps a book, `sessions.yaml` in its folder: which Orca tab each session
lives in, which harness session it is running as, and every id it ran as before,
with why that one ended and when
([ADR 0012](docs/adr/0012-the-book-is-the-authority-for-session-ids.md)).

The book stays true to the harness through a hook `obk up` puts in the bot's own
folder — `.claude/settings.json` or `.codex/hooks.json`, never your user-level
settings ([ADR 0020](docs/adr/0020-kit-hooks-live-in-the-bot-folder.md)). Your own
settings in those files are kept. Codex asks you to trust a hooks file the first
time it sees one; answer its question in the tab.

So: kill a tab, or reboot, and `obk up` brings the session back with the
conversation it was having, rather than starting a new one. Clear a session —
`/clear` on Claude Code, `/new` on Codex — and the kit writes down the new id,
keeps the old one, and gives the session its start prompt again, because that
prompt is what tells one session's duty from another's.

One tab holds one session: the harness the kit started in it. Anything that
session runs inside the tab — a `codex exec`, a helper, a subagent's own process
— is not the session, and never becomes the conversation the kit brings back.

And when the kit cannot say which conversation a session is, it does not pick
one. The usual reason is a Codex hooks file trusted after the session had already
begun talking: nothing was recorded for that first conversation, and trusting the
file does not go back for it.

A bot's sessions all live in one folder, and so does every harness they start
inside themselves, so a conversation sitting in that folder says nothing about
whose it is — and neither harness writes down anything that ties a conversation
that has ended to the session that had it. So the kit writes what it found into
the book as `unclaimed`, tells you the ids, and starts the session on a fresh
conversation with its duty rather than guessing. To bring one back yourself,
write it into `sessions.yaml` under that session as `session: <id>` and run
`obk up` again.

## Restarting a session

A restart is rare and never automatic: `obk up` only ever adds, because closing
a tab takes your screen away and Orca's resume record with it. When you do want
one, ask for it.

```sh
obk restart --bots /path/to/my-bots --bot api-bot [--session daily]
```

It closes the session's tab — one tab, by its own handle — and opens a new one
with the conversation the book holds, so the session comes back as itself. With
no `--session` it does that for every session of the bot.

What it will not do, in order of how much it would cost you. It closes only a
tab your book names, so Bot Father's ops tab and anything you opened yourself
are left alone. It will not close a tab whose conversation the book cannot name:
that close would be the end of that conversation, so it refuses, tells you which
session and which file to settle it in, and touches nothing. It will not close
anything at all until everything that would stop the session starting again has
been settled — the same refusals `obk up` gives, made before the tab goes rather
than after. If Orca refuses to close a tab it stops there, rather than start a
second harness beside the first. And it waits for Orca's own listing to agree
that the tab has gone before opening the new one, because Orca answers a close
before it stops reporting the tab.

## Changing, pausing and retiring

Bot Father does these for you when you ask; these are the commands it runs.

```sh
obk bot change --bots /path/to/my-bots --bot api-bot --charter "…"
obk session change --bots /path/to/my-bots --bot api-bot --session daily --model opus
obk skills remove --bots /path/to/my-bots --bot api-bot --skill kit:obk-tdd
obk pause --bots /path/to/my-bots --bot api-bot [--session daily]
obk unpause --bots /path/to/my-bots --bot api-bot [--session daily]
obk retire --bots /path/to/my-bots --bot api-bot [--session daily]
```

A change to a charter or a setting is written at once, and a running session
takes it when it next starts. A session keeps its harness: to move one, retire
it and add another. A pause closes the tabs the way a restart does, with the
same refusals, and `obk up` leaves what is paused closed until `obk unpause`
brings it back with its conversations. Retiring a session takes it off the bot
and keeps its conversations in the book under `retired`. Retiring a bot closes
its tabs, removes its Orca project and moves its folder to `retired/`; it will
not touch a bot whose Orca project holds a tab your book does not name. The
folder moves only once Orca no longer lists the project; if Orca still lists it,
or its list cannot be read, retire says so and leaves the bot where it is, and
retiring it again finishes the job. Bot
Father itself, and its management session `daily`, are never paused or
retired; its other sessions are like any bot's.

## When something is wrong

```sh
obk health --bots /path/to/my-bots [--bot api-bot]
```

It reads your setup and says what it found, in plain sentences with `--json`
beside them for Bot Father to read. It writes nothing at all — not a file, not a
link, not a tab — so everything it finds is yours to decide about.

What it looks for:

- **configuration that will not work**: a `bot.yaml` nothing can read, a session
  the kit would refuse to start, a bot with no `AGENTS.md`, a block somebody
  edited by hand, a file bigger than the 32 KiB Codex reads, a `CLAUDE.md` that
  is not this bot's rules, and a hooks file without the kit's own hook in it,
  which is how a book goes stale without anything saying so;
- **a skill that is not where its list says**: a listed skill missing from one
  of the two harnesses, a skill of your own standing where a listed one would
  go, and a link with nothing at the end of it;
- **a session the book knows that Orca does not**: its tab was closed, or the
  machine was restarted, and `obk up` brings it back;
- **a session whose tab is open and whose harness is gone**: only the tab's
  shell is in front, because the harness quit or crashed. `obk up` leaves an
  open tab alone, so the finding names the `obk restart … --session` that
  brings it back. A tab the kit cannot read is never called down;
- **leftovers no book owns**: an Orca project inside your bots folder with no
  bot in it, a tab in a bot's project that the book does not name, a start
  prompt written for a session that has gone, a clone of a skills source you no
  longer list, and the conversations the kit found and would not assign;
- **a session running on something other than its bot asks for**: a model,
  effort, context or approval level that the harness's own record of the
  conversation says differs from `bot.yaml`, and a session that started before
  its bot's `AGENTS.md` last changed, with what brings it up to date. Beside the
  findings, each running session gets a line saying, for each setting, whether
  it matches, differs, was not asked for, or cannot be told from the record;
  cannot be told is never taken for a match;
- **Orca's own default launch arguments**. Orca adds these to the agents it
  launches, relaunches and resumes, so when they carry a permission bypass every
  session runs in that mode whatever the kit asked for. The kit never sets that
  setting and says so every time it is on — including when Orca has no entry for
  a harness at all, because Orca's own default for a missing entry is the bypass.

It exits 1 when it found something, so a script can tell. Nothing it prints is a
verdict: which of these matter, and in what order, is for you or for Bot Father.

## Sessions and bots that talk

Ask the kit how to reach a session, and it answers with the road and the
address ([ADR 0018](docs/adr/0018-messaging-transport.md)):

```sh
obk message to    --bots /path/to/my-bots --to api-bot/daily
obk message send  --bots /path/to/my-bots --to api-bot/daily \
                  --subject 'the schema changed' --text 'orders.total is cents now'
obk message check --bots /path/to/my-bots --bot api-bot --session daily
```

Two roads, and a bot never picks. Claude Code to Claude Code in the same
approval class (`auto` and `ask` are one class, `dangerously-skip` the other)
is the harness's own messaging: `message to` answers with the
session's name — `<bot>.<session>`, which `obk up` puts on its launch line —
and the sending session writes to that name itself, because no command can send
that message for it. Everything else goes through Orca's mailbox, which the kit
does carry.

A session's mailbox is made the first time `obk up` brings it up, and written in
the book beside its tab. It is an Orca Run rather than the session's tab,
because a tab's address dies with the tab and a Run does not — so a message sent
while a session is down is still there when it comes back.

Nothing in a mailbox wakes anybody, so `message send` also types one line into
the receiver's tab telling it to look. Both harnesses take a typed line as the
next thing to do rather than cutting into what they are doing, which is the
whole of "queued, not interrupting". A session that is not up is not typed
into at all; its message waits.

A message longer than 4 KiB is written to a file beside your bots folder and
named in the message, so a long one arrives whole without landing a document in
somebody's context.

One thing to know about Codex bots: the kit launches them with
`-c sandbox_workspace_write.network_access=true`. Without it, the Orca CLI run
from inside a Codex session answers that Orca is not there — `reachable: false`,
and every mailbox call refused — so a Codex bot can neither read its mail nor
send any. Why is not established; what is, is that those calls fail without the
switch and work with it. It widens that session's sandbox to the network generally — there
is no localhost-only setting — and that is the price of a Codex bot being in the
fleet at all. Turn it off for a session with your own
`--extra-arg=-c --extra-arg=sandbox_workspace_write.network_access=false`, and
the kit will report that session as out of reach of fleet mail rather than
failing quietly.

## Working on the kit

```sh
npm test                      # the whole suite, in a few minutes
npm run test:system           # what the system tests would drive, and nothing else
npm run test:system -- --yes  # drive them, on this machine, for real
npm run mutate                # the mutation audit, on what your branch changed
```

The tests come in two layers, and every test file belongs to one of them.

`npm test` is `test/*.test.js`: unit tests and end-to-end runs of the CLI in a
throwaway folder, with a fake `orca` on PATH. It needs nothing but Node, so
[GitHub Actions](.github/workflows/ci.yml) runs it on every pull request and on
every push to `main`: on Node 25.8.0, the current line, and again on 24.21.0,
the floor `engines.node` promises users, with only the kit's own dependencies
installed.

`npm run test:system` is `test/system/*.test.js`: the real `obk` against the
real Orca and the real harnesses on your own machine. No CI runner can do that,
so these are run by hand before a change that touches Orca or a harness is
merged. A system test touches only what it creates and removes it afterwards,
except the mailbox Runs Orca gives no way to delete, which the run names; it
never closes a tab it did not open.

They run on the machine the command is typed on, so the command will not start
them by itself. On its own it says what it is about to drive — whose machine,
which Orca, which files, and what they will do to it — and then stops without
driving any of it, answering non-zero so that a run which did not run them
cannot be read as one that passed. `-- --yes` is how you say you meant it. When
Orca is not answering, the command says which Orca it asked and skips, rather
than report a kit that is not broken.

`npm run mutate` runs [StrykerJS](https://stryker-mutator.io) over the
JavaScript this branch changed against `main` — committed, still in the working
tree, or not tracked yet — and reports the mutants the tests do not kill. It is
an audit, not a step of every pull request
([PRD 7.3](docs/prd.md#73-decided-rules-inside-the-skills)): the everyday
check is the implementer's own hand check, and the tool runs over the whole
suite at a milestone or when the owner asks, or once, narrowed to the changed
logic, for a change at the core of the kit. A surviving mutant is a change to
the code that no test objects to. It is worth a test only where it shows a gap
in behaviour the requirement cares about, and that test is written by the
separate test author. Name targets yourself to check a whole area instead:

```sh
npm run mutate -- 'src/**/*.js'
```

Every mutant means running the tests again, so the check does not run them the
way `npm test` does. It runs [`scripts/mutation-suite.js`](scripts/mutation-suite.js)
instead: the same test files, one at a time, stopping at the first file that
fails, trying the file that killed the last mutant first and then the quickest.
On a ten-core machine, `src/up.js` as it was when this was measured (128 lines,
76 mutants) took about twelve minutes that way. Running the whole suite for every mutant, as it used to, took
forty, and counted a mutant as killed whenever a run of it ran out of time. A
change across several files takes proportionally longer, so check one or two at
a time.

The check still takes minutes where the suite takes seconds, which is why it is
a command of its own. StrykerJS is a development dependency of this repo, pinned
to an exact version and needing Node 22 or newer; the kit itself neither ships
it nor needs it.
