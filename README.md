# Orca Bot Kit

A kit for running a small fleet of long-lived role bots on your own computer —
a manager, developers, reviewers, a personal helper. Each bot keeps its
identity, its rules, its skills and its sessions across restarts.

[Orca](https://github.com/stablyai/orca) is the host: a bot is an Orca project
and a session is a tab, on Claude Code, Codex or Pi. The kit is an npm package with
an `obk` command and a set of skills. You are meant to manage the fleet by
talking to Bot Father, the first bot, whose skills call the CLI for you — not by
editing files.

The design is in [`docs/prd/prd.md`](docs/prd/prd.md); the decisions with lasting
consequences are in [`docs/adr/`](docs/adr/); what we know about Orca and the
harnesses is in [`docs/tech-notes.md`](docs/tech-notes.md).

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
bots and their sessions on any of the three harnesses, and builds each bot's
`AGENTS.md` from its charter and the rules it carries.

## Install

Node.js >= 24.21.0, git, and Orca with at least one of Claude Code, Codex or
Pi installed and configured. That line because the kit keeps writers out of each
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

`--harness claude|codex|pi` says which harness Bot Father itself runs on; there
is no default. This makes the folder a git repository and seeds it:

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
that file and the rule units, `CLAUDE.md` beside it (a symlink to it, or for a
Claude Code bot a file built from it; see below), and a `.gitignore` for `work/`.
`session add` writes one session into `bot.yaml`: its harness (the bot's unless
it says otherwise), model, effort, context window, start prompt,
work dir and any extra arguments for the harness, the approval level, and, on
Claude Code, whether Remote Control is on (see below). A start prompt is either text
(`--prompt`) or, when it is long, a file in the bot home the session points at
(`--prompt-file prompts/reviewer.md`), and it reaches the harness as written,
apart from two things the kit does on purpose: blank space at either end is
trimmed, and when the session has a work dir the kit appends its one-sentence
note about it. Anything you leave out is the
harness's own default; the kit names no model of its own. The approval level is
`auto` — the harness's real auto mode — unless you ask for `ask` or, in those
words, `dangerously-skip`
([ADR 0015](docs/adr/0015-three-approval-levels-auto-by-default.md)). Only
`obk permission approval` changes it, after your yes: `session add` and
`session change` take no approval, and refuse an extra argument that sets one
([ADR 0051](docs/adr/0051-permission-changes-and-risky-operations-have-commands-of-their-own.md))
or that widens what the session may write or run, such as `--add-dir`, Claude
Code's `--settings` or Codex's `--profile`. On Codex, `-c` passes only for a
short list of keys known to be safe, such as `model_reasoning_effort`
([ADR 0059](docs/adr/0059-extra-arguments-that-widen-a-session-are-refused.md)).
A Codex session's work dir stays in its bot folder: Codex may write in its work
dir, so `session add` and `session change` refuse one outside the bot folder for
a Codex session
([ADR 0045](docs/adr/0045-a-codex-sessions-work-dir-stays-in-its-bot-folder.md)).

A bot or a session can also run on [Pi](https://pi.dev) (`--harness pi`, tested
with Pi 1.3.0). Pi asks before no tool call, so a Pi session is always
`dangerously-skip`, and the kit refuses `auto` and `ask` for it. Sign in to Pi
yourself first: `obk up` asks Pi which models it can use, and starts nothing
when Pi has none, or not the one the session names. The kit gives a Pi session
its id, so `obk up` resumes it after its tab is closed. Pi has no context
setting: name a model that carries it. A Pi session reads its bot's
`AGENTS.md` and loads its bot's skills from `.agents/skills`; when
`obk skills build` changes them, it types `/reload` into an idle Pi tab. Pi has
no permission rules and no hooks, so the bot's allow list does not limit a Pi
session. `obk health` reads a Pi session's model and thinking level from Pi's
own record, and says when Pi cannot run it. `obk session clear` types Pi's
`/new` into a Pi tab, and `obk session compact` types Pi's `/compact`.
`obk init --harness pi` puts Bot Father itself on Pi.

Every bot gets the kit's default permission rules, written by the kit with
nobody asked: its own commands for this bots folder, reading a long message,
`git add` and `git commit`
([ADR 0050](docs/adr/0050-the-kit-writes-every-bots-default-permission-rules.md)).
`obk permission`, `obk retire`, `obk pause`, `obk restart`, `obk bot create`,
`obk bot change`, `obk session add`, `obk session change` and `obk init` are
not in the set, and keep your yes
([ADR 0051](docs/adr/0051-permission-changes-and-risky-operations-have-commands-of-their-own.md)).
A rule beyond the set is written by `obk permission allow`, after your yes to
the exact rule. A bot that still holds a rule that the kit gave every bot
before and that is no longer in the set keeps it: the rule of `obk restart`,
`obk bot create`, `obk bot change`, `obk session add`, `obk session change`,
`obk session mail` or `obk session nudge`, or of Orca's
`orca orchestration check --run`. So does a bot that holds a rule you allowed
for the kit's `run` command, which the kit no longer has. `obk rules build` and
`obk up` name each such rule, with the `obk permission disallow` command that
takes it back.

Neither command touches Orca. `obk up` is what makes it all real there: an Orca
project per bot, a tab per session, each started at the bot home with its own
launch command and its start prompt. It only ever adds — it never closes a tab —
so run it after a restart, or whenever something is missing. `--bot` and
`--session` bring up one thing rather than the fleet.

## Reaching a Claude session from your phone

Every Claude Code session that the kit starts, temporary sessions included,
starts with Claude Code's own
[Remote Control](https://code.claude.com/docs/en/remote-control) on. You can
then open it from claude.ai/code or the Claude app, under its address
(`<bot>.<session>.<token>`). Codex and Pi sessions do not change
([ADR 0058](docs/adr/0058-remote-control-is-on-for-every-claude-code-session.md)).

Read this before you keep it on. Anyone who holds your claude.ai account can,
for each connected session: read the conversation; type prompts, which run on
your machine at the session's approval level (in `auto`, that includes commands
and file edits); answer its permission prompts; attach files; change its model
and effort; clear, compact or end it; stop its subagents; rename it (fleet mail
to it by name then fails until its next launch by the kit); change its MCP
servers; and fork it into a new session on your machine that the kit does not
manage. While a session is connected, Anthropic stores its transcript, tool
activity included. Turning a session off later does not delete what is stored.
Claude Code's Trusted Devices, which you turn on yourself, limits this to
devices you enrol.

Turn it off for one session with `--remote-control off`, and back on with
`--remote-control on`:

```sh
obk session change --bots /path/to/my-bots --bot api-bot --session daily --remote-control off
obk restart        --bots /path/to/my-bots --bot api-bot --session daily
```

`session add` and `temp make` take the same flag. A temporary session takes its
maker's setting unless you give one. The setting is `remote_control: on|off` on
the session in `bot.yaml`. With no setting, a session is on. Claude Code's own
`--remote-control` and `--rc` are refused as extra arguments: the setting is the
only switch. `obk up`, `obk restart`, `obk unpause` and `obk temp make` say for
each Claude session they start whether it is on or off, and why.

Off puts `"disableRemoteControl": true` in the kit's `--settings` on the
session's launch line. It holds at every start and resume by the kit, and over
your own `remoteControlAtStartup: true`. The session's tab and `claude doctor`
then say that Remote Control is disabled by your organization's policy. That is
Claude Code's wording for this key; here it means that you set the session off.

Off does not hold in two cases:

- After Orca brings a tab back by itself, it runs a bare `claude --resume`
  without the kit's line. A conversation that was once connected then
  reconnects, until the kit next starts the session.
- A session whose own extra arguments in `bot.yaml` carry `--settings` replaces
  the kit's `--settings`, so the kit's off goes with it. `obk up` and
  `obk health` say so.

For an off that holds in every case, for a whole bot or fleet, put Claude Code's
own `"disableRemoteControl": true` in the bot's, or the bots repo's,
`.claude/settings.local.json`. The kit never writes that file.

`obk health` shows, for each running Claude session, what was asked and what
Claude Code's own registry says: `enabled`, `not enabled`, or `unknown`.
`enabled` means that Claude Code holds a Remote Control handle for the session;
the kit cannot see whether it is connected at this moment. Health gives a
finding when a session that is on is not enabled (its tab says why), and when a
session that is off is enabled (most often after Orca brought its tab back).

Each connected session is an entry in your list at claude.ai/code. Entries of
sessions that ended can stay there, offline, until you archive them there.

The kit turns Remote Control on or off on the launch line, and reports what
Claude Code's registry says. It does not test Remote Control itself, which is
Claude Code's feature. So the kit's tests do not cover whether a session
connects, what your list at claude.ai/code shows, or a prompt, a clear or a
fork sent from another device. Its live test checks only that a Claude session
starts from the kit's line, with Remote Control on and with it off.

When you upgrade to this version, a running session stays as it is. At its
next start by the kit (`up` of a closed tab, `restart`, `unpause`, `temp make`),
a Claude session starts with Remote Control on, unless you set it off first. A
session whose `extra_args` in `bot.yaml` carry `--remote-control` or `--rc`
gets a finding from `obk health`: remove the argument, and use
`--remote-control on|off` instead.

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

Eleven units suit every bot, whatever it does:

| | |
|---|---|
| `the-ask` | reading the whole request, which questions are yours to answer |
| `simple` | the smallest thing that answers it, and reusing what is there |
| `scope` | changing what the work needs and leaving the rest |
| `evidence` | what you saw, what you worked out, and not inventing either |
| `finishing` | the check you can run, run on the real thing, reported as it came |
| `commit` | committing your own work to the bots repo often, file by file; pushing is the user's call |
| `limits` | the charter, what needs a yes, no quiet substitutes |
| `talk` | answer first, short, real names |
| `mail` | asking the kit for the road to another session; mail is queued |
| `temporary` | making a temporary session of your own for a helper, and retiring it when its work is done |
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

A unit may also carry `placement`: `all`, `main` or `both`. A unit with none is
`all`, and any other value stops the build of its bot, which then writes
nothing. `all` is in the instruction file only. `main` is for a rule that only
shapes how the main session talks or arranges its work: a Claude Code session
gets it in its system text, and its helpers and the permission check do not.
`both` is for the owner's hard limits: in the instruction file and in the
system text, from one source. The kit's `talk` and `profiles` are `main`, and
`limits` is `both`. `AGENTS.md` always holds every unit, and a Codex or Pi
session reads every unit there.

For a bot with a Claude Code session, `CLAUDE.md` is then a file that the kit
builds in the same step as `AGENTS.md`: `AGENTS.md` word for word, with the
`main` units left out of the kit's block. A bot with no Claude Code session
keeps `CLAUDE.md` as a link to `AGENTS.md`. The `main` and `both` units go into
a file beside your bots folder, in `<bots>.prompts/<bot>/`, and the kit's
launch line for each Claude Code session appends it with
`--append-system-prompt-file`.

What this costs you:

- A hand edit of `AGENTS.md` reaches `CLAUDE.md`, and so a Claude Code session,
  at the next build: `obk up`, `obk rules build`, `obk restart` or
  `obk temp make`. Before, the link made it reach at once. `obk health` names a
  `CLAUDE.md` that is older than its `AGENTS.md`.
- A line added to `CLAUDE.md` by hand, or by a session, stops the kit from
  writing it. `obk rules build`, `obk up` and `obk health` name it until the
  line moves into `AGENTS.md`, below the kit's block, and is taken out of
  `CLAUDE.md`.
- A changed `main` or `both` unit reaches a running session's system text only
  after a restart and the session's next compaction. Until then a `both` unit
  can say one thing in `CLAUDE.md` and an older thing in the system text. So
  keep `both` for rules that rarely change. `obk rules build` and `obk health`
  name each session whose system text is older than its bot's units.
- The kit's hook gives a Claude Code session its `main` units as context at
  each start, resume, `/clear` and compaction, whatever its launch line says,
  so no session loses one. So a `main` unit is in a main session twice: once
  in the system text and once as context. Keep `main` units short. The kit's
  own `main` units are `talk` and `profiles`, whose two files are 602 bytes
  together.
- When Orca brings a tab back by itself, the session has no appended text, and
  the hook's context is where its `main` units come from. `obk health` names
  the session until `obk restart`.

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
settings ([ADR 0022](docs/adr/0022-kit-hooks-live-in-the-bot-folder.md)). Your own
settings in those files are kept. Codex asks you to trust a hooks file the first
time it sees one; answer its question in the tab.

A Claude bot gets one more hook there. Claude Code's own messaging reaches every
Claude session on the machine, so after a session sends a native message to an
address that is none of your bots folder's sessions, the hook tells it so, and
names the address `obk message to` would have given. The message goes either
way ([ADR 0032](docs/adr/0032-a-native-message-outside-the-fleet-is-warned-about.md)).

A Claude bot's `.claude/settings.json` also gets
`"skillOverrides": { "auto-mode-setup": "off" }`, so no session of the bot stops
on Claude Code's `Teach auto mode about your environment?` form. Your other
skill overrides are kept. The cost: `/auto-mode-setup` is off in that bot's
sessions, and your own sessions outside the bots folder keep it. To use it in a
bot's sessions, set `"auto-mode-setup": "on"` under `skillOverrides` in the bot's
`.claude/settings.local.json`, which wins over the kit's entry. The kit never
writes that file.

The same file also cuts some of Claude Code's tools and built-in skills, so
each request of a fleet session is smaller. By default the kit cuts the tools
`Artifact`, `ArtifactComments`, `ArtifactData` and `DesignSync`, and the skills
`artifact-design`, `artifact-diagramming`, `artifact-capabilities`,
`update-config`, `fewer-permission-prompts`, `init`, `keybindings-help` and
`plugin-authoring`. A cut tool is a `permissions.deny` entry with its name, and
a cut skill is `"off"` under `skillOverrides`. Your other entries are kept. A
session in that bot does not have them, and your own sessions outside the bots
folder keep them. To cut more, name them in a `claude_cut` list: in
`defaults.yaml` for every bot, or in a bot's `bot.yaml` for that bot. A name
that starts with a capital letter or with `mcp__` is a tool; any other name is
a skill. To keep one, name it in the bot's `claude_keep` list in `bot.yaml`. A
keep wins over every cut list, and `obk up` then takes the kit's cut out of the
file. Taking a name out of a `claude_cut` list does not give it back; keep it
instead. `Workflow` and `workflow-authoring` go together: a cut or a keep of
one applies to both. A cut or a keep reaches a session when it starts again.

The kit found no way to ask Claude Code which names it knows, so `obk health`
goes by the records of your fleet's Claude Code sessions. It names a cut that is not
one of the kit's defaults and is in no record of the fleet, and a kept name
that the bot's newest record does not hold. A bot with no record yet gets no
finding for a kept name. A real cut name that no record holds yet is named too,
and a tool that a new Claude Code renamed is not seen while older records hold
the old name. A `text:` name in a list is accepted, and
`obk health` says that the kit does not cut units of the main text yet.

Each Claude bot has a memory folder of its own, `claude-memory/` in the bot's
folder. Claude Code alone would give every bot of one bots repository the same
folder, so the notes of one bot would load in every bot. The kit's line for a
Claude session carries `--settings` with the key `autoMemoryDirectory`, which
names that folder by its physical path, so a session saves its memory with no
permission dialog. For a session with Remote Control set off, the same
`--settings` also carries `disableRemoteControl`. All sessions of a bot share
the folder, temporary sessions too. The kit never moves, copies or deletes a
note.

The notes stay out of git. When the kit makes `claude-memory/`, it writes a
`.gitignore` in it that holds `*`, because a note can hold your words or
private facts, and a push would publish them. To keep a bot's notes in git,
delete that `.gitignore`; the kit does not write it again while the folder is
there. A `claude-memory/` folder that you made yourself gets no `.gitignore`
from the kit.

A bot, its repository or your user-level settings that name their own
`autoMemoryDirectory` keep it, and the kit then makes no folder.

The kit does not start a Claude session without its bot's folder, because its
notes would then go to the folder that the bots shared. When a file or a link
is at `claude-memory` in the bot folder, or the kit cannot make the folder with
its `.gitignore`, `obk up`, `obk restart`, `obk unpause`, `obk temp make` and
`obk init` leave that session closed. The report has a `refused` line that
says why and what to do, and the command exits with 1. The bot's other
sessions and your other bots start as usual. A session that `obk restart`
refuses keeps its tab. After a failed creation, the kit leaves nothing behind
and tries again at the next start. `obk health` names a file or a link at that
path before you start.

A conversation that
began before this keeps its old folder until the session restarts under this
version and then begins a new conversation with `/clear`. A restart alone or a
`/clear` alone does not change the folder. After Orca brings a tab back by
itself, a `/clear` before a restart goes back to the shared folder and brings
the permission dialog back; `obk health` names such a session
([ADR 0060](docs/adr/0060-each-claude-bot-gets-a-memory-folder-of-its-own-named-in-the-kits-one-settings.md)).

When you upgrade from a version before this, the notes that your bots shared
stay where they were, in Claude Code's folder for your bots repository under
`~/.claude/projects`. A bot then starts with no notes. `obk health` names each
bot whose own folder has no notes while the shared folder has some, and names
both folders. To keep a bot's notes, copy the ones that belong to it into its
`claude-memory/`, and make its `MEMORY.md` list them; Bot Father can do this
with you.

So: kill a tab, or reboot, and `obk up` brings the session back with the
conversation it was having, rather than starting a new one. Clear a session —
`/clear` on Claude Code, `/new` on Codex — and the kit writes down the new id,
keeps the old one, and gives the session its start prompt again, because that
prompt is what tells one session's duty from another's. A compaction of a
Claude Code session keeps its id, but the start prompt drops out of the
context, so the kit gives the prompt again after a compaction too, once.

Ask the kit to clear or compact a session, rather than typing into its tab:

```sh
obk session clear   --bots /path/to/my-bots --bot api-bot --session daily
obk session compact --bots /path/to/my-bots --bot api-bot --session daily
```

Each waits up to 30 s for the session to be idle, and types nothing into one
that is busy or has a question on its screen. It types the harness's own
command, checks the screen before it presses return, and then confirms the
result: for a clear, the new conversation in the book; for a compact, the
compaction in the harness's own record, within 5 minutes, or it says it is not
confirmed yet. A harness that does not offer `/compact` is told so, and nothing
is entered. A cleared session reads its `AGENTS.md` again, so a clear also
brings it onto changed rules.

A session paused before its first turn can have an id in the book and no
conversation behind it: the harness has nothing on record for that id. There is
nothing to resume, so it starts again with its duty, and the book moves the id
into its history as `no conversation`.

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

Closing the old tab ends the harness there, and the background shells it ran
end with it: a timer, a watch, a long build. So once a session whose tab the
restart closed is back with its conversation, the kit types one line into its
new tab. A session whose tab was already closed, or that starts fresh, gets no
line. The line says that its background shells
ended, that the kit cannot tell which ones ran or whether a scheduled job still
runs, and that it should look at its scheduled jobs before it makes one again.
It also asks the session to read its mail and do what it asks. The line goes in
only when the tab shows no question, form or menu, within 20 seconds. The
report says under each tab whether the line went in. When it did not, it says
why, and you tell the session yourself.

What it will not do, in order of how much it would cost you. It closes only a
tab your book names, so Bot Father's ops tab and anything you opened yourself
are left alone. It will not close a tab whose conversation the book cannot name:
that close would be the end of that conversation, so it refuses, tells you which
session and which file to settle it in, and touches nothing. The one exception
is a tab with only its shell in front: its harness has already quit, so there
is nothing in it to lose, and restart closes it and starts the session fresh
with its duty. It will not close
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
obk bot change --bots /path/to/my-bots --bot api-bot --role-cap reviewer=2
obk permission allow --bots /path/to/my-bots --bot api-bot --rule 'Bash(gh pr merge:*)'
obk permission disallow --bots /path/to/my-bots --bot api-bot --rule 'Bash(gh pr merge:*)'
obk permission approval --bots /path/to/my-bots --bot api-bot --session daily --approval ask
obk permission approval --bots /path/to/my-bots --bot api-bot --temps --approval dangerously-skip
obk session change --bots /path/to/my-bots --bot api-bot --session daily --model opus
obk session change --bots /path/to/my-bots --bot bot-father --session daily --harness codex
obk skills remove --bots /path/to/my-bots --bot api-bot --skill kit:obk-tdd
obk pause --bots /path/to/my-bots --bot api-bot [--session daily]
obk unpause --bots /path/to/my-bots --bot api-bot [--session daily]
obk retire --bots /path/to/my-bots --bot api-bot [--session daily]
```

A change to a charter or a setting is written at once, and a running session
takes it when it next starts. A session can move to the other harness with
`--harness`, Bot Father's management session too: it then starts a new
conversation there, the book keeps the old one in its history, and its model,
effort and context go back to the new harness's defaults unless you give them
too. A pause closes the tabs the way a restart does, with the
same refusals, and one more: it also refuses a tab with only its shell in front
whose conversation the book does not name. `obk up` leaves what is paused
closed until `obk unpause` brings it back with its conversations. The closed
tab ended the background shells of each paused session, as a restart does. So
the unpause tells each session it took off pause and resumed, in one typed
line, as a restart does: its old tab is closed and its background shells
ended, and it looks at its scheduled jobs and its mail. The report says under
each tab whether the line went in. In the `--json` answer, `restartLine` means
the same after an unpause as after a restart: `true` when the line went in, or
`false` with the reason in `restartLineTrouble`, and then you tell the session
yourself. Retiring a
session takes it off the bot and keeps its conversations in the book under
`retired`. Once its tab is closed, it stops what the session left running in
its work dir: each of your processes whose working folder is there, and what
they started, with SIGTERM and, after up to 3 seconds, SIGKILL. It names each
process it stopped, and each it left: one that only shares a process group with
them, or one it could not stop. Where it cannot read the processes, as inside
Codex's sandbox, it says so and stops nothing. Retiring a bot closes
its tabs, removes its Orca project and moves its folder to `retired/`; it will
not touch a bot whose Orca project holds a tab your book does not name. The
folder moves only once Orca no longer lists the project; if Orca still lists it,
or its list cannot be read, retire says so and leaves the bot where it is, and
retiring it again finishes the job. Bot
Father itself, and its management session `daily`, are never paused or
retired; its other sessions are like any bot's.

## Daily grooming

Grooming is an optional daily pass over the fleet: what each bot did, what it
cost, and what to improve, sent as one short report to Bot Father's management
session. It runs in a session of Bot Father's called `grooming`, on Claude
Code's own scheduler, at the model and effort you give that session.

```sh
obk session add --bots /path/to/my-bots --bot bot-father --name grooming --model sonnet --effort medium
obk up --bots /path/to/my-bots --bot bot-father
obk groom --bots /path/to/my-bots --now           # run it once, by hand, and read it
obk groom --bots /path/to/my-bots --on --at 04:00 # then schedule it
obk groom --bots /path/to/my-bots                 # what is scheduled
```

It starts off, and Bot Father asks you before it turns it on, because it spends
tokens every day. It fires only while its tab is open in Orca and Claude Code is
idle there, up to half an hour after its time, and a day it misses is not made
up. Each run renews its own schedule, which Claude Code would otherwise end
after a week, and `--on --at` puts it back if it lapses. A `/clear` in its tab
leaves it running until the session is next restarted; after that, `--on --at`
puts it back.
`obk groom --compact` compacts its conversation between runs.

The grooming session is always a Claude Code one, even on a Codex or Pi Bot Father
(add it with `--harness claude` there): it is the clock, and where the reports arrive.
To have the grooming itself done on Codex, turn it on with `--run-on codex`, and
give the runs their model and effort:

```sh
obk groom --bots /path/to/my-bots --on --at 04:00 --run-on codex --model gpt-6-sol --effort medium
```

Each fire then makes a temporary Codex session of the grooming session's, named
`groom-<date and time>`, which does the grooming, mails its report back, and is
retired; the grooming session sends the report on to the management session. A
run an earlier fire left behind is retired at the next one. Each run also
carries the grooming session's own prompt, as `--on` finds it: after you change
that prompt, run `obk groom --at <HH:MM>` alone, which keeps the runs on Codex.

## When something is wrong

```sh
obk health --bots /path/to/my-bots [--bot api-bot]
```

It reads your setup and says what it found, in plain sentences with `--json`
beside them for Bot Father to read. It writes nothing at all — not a file, not a
link, not a tab — so everything it finds is yours to decide about.

What it looks for:

- **configuration that will not work**: a `bot.yaml` nothing can read, a key
  in it the kit does not know (a typo such as `efort: high`, which nothing
  reads), a session the kit would refuse to start, a bot with no `AGENTS.md`,
  a block somebody edited by hand, a file bigger than the 32 KiB Codex reads, a
  `CLAUDE.md` that is not this bot's rules, and a hooks file without the kit's
  own hook in it, which is how a book goes stale without anything saying so;
- **a skill that is not where its list says**: a listed skill missing from one
  of the two harnesses, a skill of your own standing where a listed one would
  go, and a link with nothing at the end of it;
- **a session the book knows that Orca does not**: its tab was closed, or the
  machine was restarted, and `obk up` brings it back;
- **a session whose tab is open and whose harness is gone**: only the tab's
  shell is in front, because the harness quit or crashed. `obk up` leaves an
  open tab alone, so the finding names the `obk restart … --session` that
  brings it back; when the book names no conversation for it, restart would
  refuse, and the finding says to close the tab in Orca and run
  `obk up … --session`. A tab the kit cannot read is never called down;
- **a Claude session on an address the kit did not make**: such as the bare
  `<bot>.<session>` every fleet's sessions had before 0.10.0, which a session of
  another fleet can write to. Its next start through the kit gives it one of its
  own, so the finding names the `obk restart … --session` that does it;
- **a session whose mail waits and Orca has not told it**: mail older than an
  hour that is unread and that Orca's notice never reached, while the session's
  harness is idle now. Orca can stop telling a session that sat idle through an
  Orca restart or update, so the finding names the `obk restart … --session`
  that opens a new tab, which Orca tells. It counts the letters and gives the
  time of the oldest; it never shows their subject or text. A busy session is
  not named: Orca tells it when its turn ends;
- **a process still running in a retired session's work dir**: one from before
  retire stopped them, or one it could not stop, with its pid and command;
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
address ([ADR 0053](docs/adr/0053-messaging-transport.md)):

```sh
obk message to    --bots /path/to/my-bots --to api-bot/daily
obk message send  --bots /path/to/my-bots --to api-bot/daily \
                  --subject 'the schema changed' --text 'orders.total is cents now'
obk message check --bots /path/to/my-bots --bot api-bot --session daily
```

Two roads, and a bot never picks. Claude Code to Claude Code in the same
approval class (`auto` and `ask` are one class, `dangerously-skip` the other)
is the harness's own messaging: `message to` answers with the
session's name, `<bot>.<session>.<token>`, which `obk up` puts on its launch
line, and the sending session writes to that name itself, because no command
can send that message for it. The token is new for each new conversation and
kept when one is resumed, because Claude Code refuses a name that other fleets'
sessions also answer to. Ask `message to` each time rather than keeping the
name. Everything else goes through Orca's mailbox, which the kit does carry.

That includes a Claude session still running under a name from before the
token, `<bot>.<session>`: `message to` answers the mailbox road for it, never
that name, until the kit's launch line next starts it (`obk restart`, or
`obk up` after its tab is gone), which gives it a token name of its own.

It also includes a Claude session that the sender's own Claude Code does not
list as live. Claude Code's messaging reaches only the sessions in its own
registry, under its config folder (`CLAUDE_CONFIG_DIR`, or `~/.claude`). After
a Claude account switch, Orca starts new tabs under a config folder of its own,
so a session started before the switch and one started after it cannot reach
each other that way. `message to` and `message send` then take the mailbox.

A session's mailbox is made the first time the kit starts it, and written in
the book beside its tab. It is an Orca Run rather than the session's tab,
because a tab's address dies with the tab and a Run does not — so a message sent
while a session is down is still there when it comes back.

Orca lets a tab bind a mailbox to itself and to no other, so the mailbox is made
and bound from inside the session's own tab: the launch line the kit types there
runs `obk session mailbox` before the harness. For the same reason a session's
mail is read in its own tab. `message check` from any other tab reads nothing,
binds nothing, and says so; the mail waits.

For one session, that step, a `message check`, and `up` writing a new tab for it
into the book take turns. So two starts of the same session at once leave its
mailbox bound to the tab the book names, and no mail is read in the other one.
Each waits a minute at most for its turn. A step that waits it out leaves the
mailbox where it was and says so, and the harness starts all the same. A check
holds its turn for 40 seconds at most: with more mail than it reads in that
time, it shows what it read and says the rest is still waiting.

Nothing in a mailbox wakes anybody, so each message gets one signal: Orca's
own notice, which Orca types into the receiver's tab once it is idle. A busy
receiver gets it a minute or a few after its turn ends. The kit types nothing
into the receiver's tab, and the send says which road it took. For urgent mail,
`obk message send --interrupt` presses Escape once in a busy receiver's tab to
end its turn, and then sends the message, so the notice comes at once. Codex
keeps a command it was running as a background terminal after an Escape. A
receiver reads its mail with `obk message check`, which marks it read: a bare
`orca orchestration check` leaves it unread, and Orca then gives no more
notices for that mailbox
([ADR 0053](docs/adr/0053-messaging-transport.md)).

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

## Contributing

How to run the kit's own tests, and how they are laid out, is in
[CONTRIBUTING.md](CONTRIBUTING.md). The package does not ship it.
