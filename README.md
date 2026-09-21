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

## Status

Early. The CLI creates your bots folder, brings Bot Father up in Orca, and
creates bots and their sessions on either harness.

## Install

Node.js >= 24.21.0, git, and Orca with at least one of Claude Code or Codex
installed and configured. That line because the kit keeps writers out of each
other's way in a bot's book with a SQLite write transaction: `node:sqlite` is in
Node itself from 24 on, and from 24.21.0 it loads without an experimental warning
on stderr.

```sh
npm install
npm link
obk --version
```

## Create your bots folder

```sh
obk init --bots /absolute/path/to/my-bots --harness claude
```

`--harness claude|codex` says which harness Bot Father itself runs on; there is
no default. This makes the folder a git repository and seeds it:

```
my-bots/
  defaults.yaml            # rules and skills every bot gets
  skills.yaml              # online skill sources
  rules/                   # your own rule units
  skills/                  # your own common skills
  bots/bot-father/bot.yaml # Bot Father: charter, rules, skills, sessions
```

The folder is yours. It holds your configuration and none of the kit's code —
kit skills are linked from the installed package, never copied
([ADR 0004](docs/adr/0004-skills-are-linked-never-copied.md)). Run `init` again
whenever you like: it adds what is missing and leaves everything else, including
your edits, exactly as it is. It does not commit for you.

## Add a bot and its sessions

```sh
obk bot create  --bots /path/to/my-bots --name api-bot --harness codex \
                --charter 'Api Bot owns the API clone.'
obk session add --bots /path/to/my-bots --bot api-bot --name daily \
                --effort high --work-dir work/api \
                --prompt 'Keep the API clone green. Ask before you touch main.'
obk up          --bots /path/to/my-bots
```

`bot create` writes the bot's folder — `bot.yaml`, an `AGENTS.md` holding its
charter, `CLAUDE.md` as a symlink to it, and a `.gitignore` for `work/`.
`session add` writes one session into `bot.yaml`: its harness (the bot's unless
it says otherwise), model, effort, context window, approval level, start prompt,
work dir and any extra arguments for the harness. A start prompt is either text
(`--prompt`) or, when it is long, a file in the bot home the session points at
(`--prompt-file prompts/reviewer.md`), and it reaches the harness exactly as
written. Anything you leave out is the
harness's own default; the kit names no model of its own. The approval level is
`auto` — the harness's real auto mode — unless you ask for `ask` or, in those
words, `dangerously-skip`
([ADR 0005](docs/adr/0005-three-approval-levels-auto-by-default.md)).

Neither command touches Orca. `obk up` is what makes it all real there: an Orca
project per bot, a tab per session, each started at the bot home with its own
launch command and its start prompt. It only ever adds — it never closes a tab —
so run it after a restart, or whenever something is missing. `--bot` and
`--session` bring up one thing rather than the fleet.

## The rules a bot works by

Each bot has one `AGENTS.md`, shared by all its sessions: its charter, then the
rule units it uses
([ADR 0003](docs/adr/0003-agents-md-is-compiled-from-rule-units.md)). A rule
unit is one short block of always-on working rules. The kit's own units live in
[`rules/`](rules/) in this package; yours go in `rules/` inside your bots
folder. What is always on stays short, because every session reads it on every
turn; the depth belongs in skills.

Seven units suit every bot, whatever it does:

| | |
|---|---|
| `the-ask` | reading the whole request, which questions are yours to answer |
| `simple` | the smallest thing that answers it, and reusing what is there |
| `scope` | changing what the work needs and leaving the rest |
| `evidence` | what you saw, what you worked out, and not inventing either |
| `finishing` | the check you can run, run on the real thing, reported as it came |
| `limits` | the charter, what needs a yes, no quiet substitutes |
| `talk` | answer first, short, real names |

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
([ADR 0009](docs/adr/0009-skills-by-technique-with-a-prefix.md)). They are
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

A skill is where the depth lives. The always-on rules say that a change in
behaviour starts with a failing test someone else wrote and is read by someone
who did not write it; `obk-tdd` is how to write a test worth keeping and find
out whether the tests would catch a real mistake, and `obk-reviewing` is how to
read a change so the findings are worth acting on, and how to answer a reading
of your own.

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
([ADR 0002](docs/adr/0002-the-book-is-the-authority-for-session-ids.md)).

The book stays true to the harness through a hook `obk up` puts in the bot's own
folder — `.claude/settings.json` or `.codex/hooks.json`, never your user-level
settings ([ADR 0010](docs/adr/0010-kit-hooks-live-in-the-bot-folder.md)). Your own
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

## Working on the kit

```sh
npm test             # the whole suite, in a couple of seconds
npm run test:system  # the system tests, on this machine
npm run mutate       # the mutation check, on what your branch changed
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
merged. When Orca is not answering the command says so and skips, rather than
report a kit that is not broken. A system test touches only what it creates and
cleans up after itself; it never closes a tab it did not open.

`npm run mutate` runs [StrykerJS](https://stryker-mutator.io) over the
JavaScript this branch changed against `main` — committed, still in the working
tree, or not tracked yet — and reports the mutants the tests do not kill. A
surviving mutant is a change to the code that no test objects to: kill it with a
better test, or say in the pull request why it does not matter. Name targets
yourself to check a whole area instead:

```sh
npm run mutate -- 'src/**/*.js'
```

Every mutant means running the tests again, so the check does not run them the
way `npm test` does. It runs [`scripts/mutation-suite.js`](scripts/mutation-suite.js)
instead: the same test files, one at a time, stopping at the first file that
fails, trying the file that killed the last mutant first and then the quickest.
On a ten-core machine `src/up.js` — 128 lines, 76 mutants — takes about twelve
minutes that way. Running the whole suite for every mutant, as it used to, took
forty, and counted a mutant as killed whenever a run of it ran out of time. A
change across several files takes proportionally longer, so check one or two at
a time.

The check still takes minutes where the suite takes seconds, which is why it is
a command of its own. StrykerJS is a development dependency of this repo, pinned
to an exact version and needing Node 22 or newer; the kit itself neither ships
it nor needs it.
