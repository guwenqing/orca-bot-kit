# Working rules for this repo

## What decides

`docs/prd/prd.md` is the design, `docs/adr/` the lasting decisions, `docs/tech-notes.md`
what we know about Orca and the two harnesses. Issues state an intent and a boundary
and point at these; how to build is yours, and finding the right balance by your own
research and judgement is part of the work. A `[proposed]` item in the PRD is not
confirmed by the owner. A fact marked unverified in the tech notes is proven live
before code relies on it. Issues are vertical slices, worked in order; do not pull
work from a later slice into an earlier one.

## AssuredLoop

AssuredLoop keeps this project's requests and spec: before work that changes a promise, read the skill of al 1.0.0 and run `al context`.

`al` is the npm package `@assuredloop/cli` at exactly `1.0.0`. Wherever this file says
`al`, run that version in one of two ways: through npx, as
`npx -y @assuredloop/cli@1.0.0 <args>`, or from an install of its own in a folder outside
the global one, made with `npm install --prefix <dir> @assuredloop/cli@1.0.0` and run
as `<dir>/node_modules/.bin/al <args>`. Do not install it globally: the global `al`
belongs to every project on the machine, and another version may not read this repo's
records. The skill ships in the package, at
`@assuredloop/cli/skills/assuredloop/SKILL.md`; this prints it:
`npx -y -p @assuredloop/cli@1.0.0 -c 'cat "$(dirname "$(command -v al)")/../@assuredloop/cli/skills/assuredloop/SKILL.md"'`.
In an install of its own, the skill is
`<dir>/node_modules/@assuredloop/cli/skills/assuredloop/SKILL.md`.
CI runs `al check --strict` at that version on every pull request. The baseline is `docs/prd/`
(`root:` in `.assuredloop/config.yaml`), and al keeps its records in `.assuredloop/records/`,
committed with the change. Each paragraph of the PRD has a hidden marker before it, with
its ID and kind: keep the marker when you edit the paragraph. The decision records are
`docs/adr/`; al 1.0.0 reads ADRs only in `docs/prd/adr/`, so it does not read them.
The requests that al 0.1.0 concluded stay in `requests/archive/` as files; al 1.0.0 does
not read them. To check one, run al 0.1.0 at its commit.
Every PR states its tier, in its commit message (`al check` reads it there) and the PR:

- No promise in the baseline changes: tier 0. Write no record. `Tier: 0 — <what it restores>`.
- A small change to a promise: tier 1. `al new <name> --tier 1 --from -`, the owner's
  words on stdin; the organized requirement `R1` in `requests/<name>/request.md`;
  `al index`; the owner's sign-off recorded with `al record <name> signoff`; the PRD
  paragraph edited, with `serves:<name>/R1` in its marker; and `al conclude <name> --yes`,
  all in the PR. `Tier: 1 — <claim>`. The owner signs, not you.
- A new paragraph is written with no marker. `al spec --add-ids docs/prd/prd.md --yes`
  gives it the next ID; then write its kind and links in the marker.
- Tier 1d, 2, 3 and S keep their records in the PR the same way; the skill says how.

## How code is made here

The owner's bots build the kit with its own skills and rule units: `obk-tdd`,
`obk-reviewing`, `obk-debugging`, `obk-arch`, and the units in `rules/`. The skills
load from `.claude/skills` and `.agents/skills`, links to `skills/`; a new skill gets
both links.

The owner's decisions for this repo, which bind anyone working here:

- Core is core and test is test: "All the test related stuff please build it out side the
  kit core!!!! Core is core and test is test." (the owner, 2026-10-18, #652). The core is
  what the package ships: `src/`, `rules/`, `skills/`, `README.md` and `SETUP.md`. Build
  what only the kit's own tests use under `test/` or `scripts/`. Never add a command, an
  option or an environment setting to the core for the tests. PRD section 6.1 lists every
  command and setting the core has, and CI fails when they differ (ADR 0052).
- Take no requirement stricter than the intent.
- One PR per issue, squash-merged.
- CI runs a good current Node version, not the lowest one the package supports.
- Test volume stays as it is for now: the owner wants to see whether tests at five to
  ten times the product code help quality.

## The owner's decisions on rules and skills

A rule unit or a skill is writing, not code, and the bar is his: take the good parts
of the sources in full, consolidated into our version, not a summary and not made up;
lightweight is not fluffy; plain tone, no personal colour; defaults and techniques,
never bans on what a user may ask and no assumed way of working. His own words in the
research pack win over every source. A skill works in both harnesses (only `name` and
`description` are portable frontmatter) and never contradicts the everyday rules.
Its NOTICE names, for each source, the revision actually read: a repository's commit,
a page's date (#280). When the shape of a rule set or a skill is open, propose before writing.

## Safety on the owner's machine

He works in this same Orca. In live checks and system tests: use a throwaway bots
folder; touch only the projects, tabs and sessions you create; remove them right
after; never type into or close a tab that is not yours; never
`orca terminal close --worktree … --all`; answer a harness's first-run prompts in
your own tabs yourself. The test author works against fakes and never touches the
real Orca or harnesses.

This machine's `obk` is the published `@assuredloop/orca-bot-kit`, as any user has
it, and nothing a developer or a test does changes it: no `npm link`, no global
install, no switch. On 2026-09-24 a system test linked it to a checkout and the
owner's real fleet ran that checkout for ten minutes (#220). Work in your own clone
and run its `src/cli.js` by its full path, as the system tests do; the kit calls
itself back with the path of the CLI that started it, so a fleet a checkout brings
up calls back into that checkout. A system test touches nothing outside its own
throwaway space, the machine's `obk` included.

Killing processes: on 2026-09-20 a cleanup command here ran `kill -KILL -1` by
accident (`ps -e` overrode `-p`; the group id became 1) and force-killed every process
of the owner's account. So: never `kill -1`, never a negative id you did not capture
yourself at spawn time, never an id computed from `ps`; kill only processes you
started, by their own pid, after printing the list; and prefer not to start background
processes at all. Nothing enforces this but your judgment.

## Who builds this

How the owner's bots build this repo (who hands out issues, who writes the tests, who
reviews, when a session is cleared, what they may do without asking) belongs to those
bots, in the kit-dev bot's charter and start prompts, not to this repo. Anyone else
working here follows the rules above and their own way of working.
