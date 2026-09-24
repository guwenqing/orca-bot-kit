# Working rules for this repo

## What decides

`docs/prd.md` is the design, `docs/adr/` the lasting decisions, `docs/tech-notes.md`
what we know about Orca and the two harnesses. Issues state an intent and a boundary
and point at these; how to build is yours, and finding the right balance by your own
research and judgement is part of the work. A `[proposed]` item in the PRD is not
confirmed by the owner. A fact marked unverified in the tech notes is proven live
before code relies on it. Issues are vertical slices, worked in order; do not pull
work from a later slice into an earlier one.

## How code is made here

The owner's bots build the kit with its own skills and rule units: `obk-tdd`,
`obk-reviewing`, `obk-debugging`, `obk-arch`, and the units in `rules/`. The skills
load from `.claude/skills` and `.agents/skills`, links to `skills/`; a new skill gets
both links.

The owner's decisions for this repo, which bind anyone working here:

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
When the shape of a rule set or a skill is open, propose before writing.

## Safety on the owner's machine

He works in this same Orca. In live checks and system tests: use a throwaway bots
folder; touch only the projects, tabs and sessions you create; remove them right
after; never type into or close a tab that is not yours; never
`orca terminal close --worktree … --all`; answer a harness's first-run prompts in
your own tabs yourself. The test author works against fakes and never touches the
real Orca or harnesses.

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
