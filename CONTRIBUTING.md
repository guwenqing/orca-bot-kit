# Contributing to the Orca Bot Kit

This page is for people who work on the kit itself. A user of the kit needs
only [README.md](README.md) and [SETUP.md](SETUP.md). The rules for working in
this repo are in [AGENTS.md](AGENTS.md).

## Working on the kit

```sh
npm test                      # the whole suite, in a few minutes
npm run test:system           # what the system tests would drive, and nothing else
npm run test:system -- --yes  # drive them, on this machine, for real
npm run test:system -- --yes test/system/groom.test.js  # only the ones you name
npm run mutate                # the mutation audit, on what your branch changed
```

The tests come in two layers, and every test file belongs to one of them.

`npm test` is `test/*.test.js` and `test/dev/*.test.js`: unit tests and
end-to-end runs of the CLI in a throwaway folder, with a fake `orca` on PATH. It
needs nothing but Node, so [GitHub Actions](.github/workflows/ci.yml) runs it on
every pull request, split into shards that run side by side, on Node 25.8.0, the
current line. A release runs every shard on 25.8.0 and again on 24.21.0, the
floor `engines.node` promises users, with only the kit's own dependencies
installed, before anything is published. The floor leaves out `test/dev/`, the
tests that need a development tool.

`npm run test:system` is `test/system/*.test.js`: the real `obk` against the
real Orca and the real harnesses on your own machine. No CI runner can do that,
so these are run by hand before a change that touches Orca or a harness is
merged. A system test touches only what it creates and removes it afterwards,
except the mailbox Runs Orca gives no way to delete, which the run names; it
never closes a tab it did not open. Before any test loads, the command copies
your `~/.claude.json` and `~/.codex/config.toml` into a new
`obk-config-backup-*` folder in your temp folder, readable by you alone, and
says where; if a copy fails, no test runs. After the run it says whether each
file still matches its copy, and never copies one back: that is yours to
decide. The trust its harnesses write into your `~/.codex/config.toml` and
`~/.claude.json` for the run's own throwaway folders is taken out again after
the run, and named; nothing else in them is changed.
An Orca project the run leaves in one of its own throwaway folders is named,
with its setup id, and fails the run; the command removes none itself.

They run on the machine the command is typed on, so the command will not start
them by itself. On its own it says what it is about to drive — whose machine,
which Orca, which files, and what they will do to it — and then stops without
driving any of it, answering non-zero so that a run which did not run them
cannot be read as one that passed. `-- --yes` is how you say you meant it. When
Orca is not answering, the command says which Orca it asked and skips, rather
than report a kit that is not broken. Name files after it to run only those;
each must be one of the `*.test.js` files under `test/system/`, links followed,
and a name that is not is refused before anything runs. This command is the
only way in: a system test loaded any other way, with `node --test` or an
editor's runner, skips and says how to run it.

`npm run mutate` runs [StrykerJS](https://stryker-mutator.io) over the
JavaScript this branch changed against `main` — committed, still in the working
tree, or not tracked yet — and reports the mutants the tests do not kill. It is
an audit, not a step of every pull request
([PRD 7.3](docs/prd/prd.md#prd-21-73-decided-rules-inside-the-skills)): the everyday
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
