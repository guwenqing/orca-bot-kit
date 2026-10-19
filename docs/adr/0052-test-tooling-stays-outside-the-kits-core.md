# ADR 0052: Test tooling stays outside the kit's core

Date: 2026-10-18.
Status: accepted.
Decided by: the owner, on 2026-10-18, for the rule and for taking `obk run` and `OBK_POLICY_ROOT` out (#652, requests/test-out-of-core: "All the test related stuff please build it out side the kit core!!!! Core is core and test is test.", and "Yes" to "Shall I take `obk run` and `OBK_POLICY_ROOT` out of the kit?"); the owner, on 2026-10-18, for a check that keeps it from coming back ("Please add it to the chart and repo make sure this will not happen again"); the architect, on 2026-10-18, for the other settings and parts that go under the rule (#652's boundary, and its rulings on `projectName`'s mark and on the README's section for people who work on the kit).
Replaces: the decision of #532 (PR #626, tier 0, with no ADR and no PRD line), which added `obk run`.

## Context

The kit's core is what the package ships: `src/`, `rules/`, `skills/`,
`README.md` and `SETUP.md`. Until #652 it also held things that only the kit's
own tests used.

- `obk run --timeout <seconds> -- <command>` (#532) runs any command with a
  time limit. It came from a need of the fleet's own test runs. In the product,
  it made a hole: any allow rule that covers `obk` broadly also allowed any
  command, and the harness did not judge that command. #635 then added a
  health finding for rules that let `obk run` run any command, and
  `OBK_POLICY_ROOT`, which told that finding where the machine's policy files
  are, as in a test.
- `OBK_PS`, `OBK_LSOF`, `OBK_STTY`, `OBK_OSASCRIPT` and `OBK_KILL` chose the
  program the kit runs for `ps`, `lsof`, `stty`, `osascript` and `kill`, "so
  the suite runs on fakes and sends no real signal" (src/processes.js).
- `projectName` gave a fleet under the system temp folder "· temp fleet
  <folder>" in its Orca project names (#401), so that "a system test's, or a
  developer's live check" Bot Father was never taken for the owner's. No user
  keeps a fleet there.
- README.md's "Working on the kit" told people who work on the kit how to run
  its tests. It is not for a user of the kit.

The owner, 2026-10-18: "I don't understand why you add a sub command where our
user will use for its own testing. You could have added a test wrapper somehow
and we can whitelist that in our own testing env only. Now you have added a
loop hole in security."

`obk run` came in as tier 0 with no PRD line, so it never reached the owner.

## Decision

The core holds only what a user of the kit uses. Everything that exists only
for the kit's own tests lives outside the core, under `test/` or `scripts/`,
and is allowed only in kit-dev's own test setup. Core is core and test is
test.

- `obk run` goes, with its help, its docs, the broadness check for its rules
  and #635's health finding. `run` joins `REMOVED`: a bot that still holds an
  allow rule for it is told that the rule names a command the kit no longer
  has, as for `session mail` (#564).
- The five program settings and `OBK_POLICY_ROOT` go. The core runs `/bin/ps`,
  `/usr/sbin/lsof`, `/bin/stty`, `/usr/bin/osascript` and `/bin/kill`. The
  tests reach their fakes from test code.
- `projectName`'s mark goes. Every fleet's Orca project carries its bot's
  display name. The tests find their own projects by folder path.
- "Working on the kit" moves to `CONTRIBUTING.md`, which the package does not
  ship. README.md points to it.
- `OBK_ORCA` and `OBK_ORCA_DATA` stay: a user whose Orca is elsewhere, or is
  another build, sets them (SETUP.md).
- PRD section [PRD-8] lists every `obk` command and every environment setting
  the core reads. A test that CI runs fails when the core and the list
  differ. A new command or setting needs a PRD edit, so `al check --strict`
  holds it to tier 1 and the owner's sign-off.

## Alternatives considered

- **Keeping `obk run`, allowed only by a narrow rule** (#532), with a health
  finding for a broad one (#635). Not chosen: the command exists only for the
  kit's own tests, and a user can still allow it broadly. The owner called it
  "a loop hole in security".
- **Keeping the five program settings, read only in a test mode.** Not chosen:
  a test mode is itself a setting in the core, and a user can turn it on.
- **A script outside the core that wraps the five programs.** Not chosen: the
  kit runs each program by its absolute path, so a script on PATH does not
  reach it. A preload under `test/` that the tests put in `NODE_OPTIONS`
  sends each fixed path to its fake, and the core does not know of it.
- **Keeping the mark on a temp fleet's Orca projects.** Not chosen: no user
  keeps a fleet under the temp folder, so the mark serves only the tests.
- **A check that looks for words such as "test" in the core.** Not chosen: it
  cannot tell a test helper from a feature. A list in the PRD that the owner
  signs can, and CI holds the core to it.

## Consequences

- A user's kit has one command less and no finding about it. Nothing else a
  user does changes.
- The check cannot see a new flag on a command that is already listed, or a
  test-only branch inside a command. Review and this ADR are the guard there.
- kit-dev's own live test runs need their time limit from outside the core:
  `scripts/test-system.js` gives it (#653).

## History

- 2026-09-28: `projectName` marked a fleet under the temp folder (#401).
- 2026-10-17: `obk run` came in as a kept-back command, tier 0, with no ADR
  and no PRD line (#532, PR #626).
- 2026-10-18: `obk health` named each rule that lets `obk run` run any
  command, and `OBK_POLICY_ROOT` came in for its tests (#635).
- 2026-10-18, this record: test tooling leaves the core, and the PRD lists
  every command and setting the core has (#652).
