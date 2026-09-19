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

Early. The CLI currently does one thing: create the bots folder.

## Install

Node.js >= 20.19.0, git, and Orca with at least one of Claude Code or Codex
installed and configured.

```sh
npm install
npm link
obk --version
```

## Create your bots folder

```sh
obk init --bots /absolute/path/to/my-bots
```

This makes the folder a git repository and seeds it:

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

## Working on the kit

```sh
npm test          # the whole suite, in a couple of seconds
npm run mutate    # the mutation check, on what your branch changed
```

`npm run mutate` runs [StrykerJS](https://stryker-mutator.io) over the
JavaScript this branch changed against `main` — committed, still in the working
tree, or not tracked yet — and reports the mutants the tests do not kill. A
surviving mutant is a change to the code that no test objects to: kill it with a
better test, or say in the pull request why it does not matter. Name targets
yourself to check a whole area instead:

```sh
npm run mutate -- 'src/**/*.js'
```

The check takes minutes where the suite takes seconds, which is why it is a
command of its own. StrykerJS is a development dependency of this repo, pinned
to an exact version and needing Node 22 or newer; the kit itself neither ships
it nor needs it.
