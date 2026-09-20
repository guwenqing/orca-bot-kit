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
npm test             # the whole suite, in a couple of seconds
npm run test:system  # the system tests, on this machine
npm run mutate       # the mutation check, on what your branch changed
```

The tests come in two layers, and every test file belongs to one of them.

`npm test` is `test/*.test.js`: unit tests and end-to-end runs of the CLI in a
throwaway folder, with a fake `orca` on PATH. It needs nothing but Node, so
[GitHub Actions](.github/workflows/ci.yml) runs it on every pull request and on
every push to `main`, on the Node version `package.json` declares.

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

The check takes minutes where the suite takes seconds, which is why it is a
command of its own. StrykerJS is a development dependency of this repo, pinned
to an exact version and needing Node 22 or newer; the kit itself neither ships
it nor needs it.
