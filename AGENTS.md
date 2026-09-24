# Working rules for this repo

## What decides

`docs/prd.md` is the design, `docs/adr/` the lasting decisions, `docs/tech-notes.md`
what we know about Orca and the two harnesses. Issues state an intent and a boundary
and point at these; how to build is yours, and finding the right balance by your own
research and judgement is part of the work. A `[proposed]` item in the PRD is not
confirmed by the owner. A fact marked unverified in the tech notes is proven live
before code relies on it. Issues are vertical slices, worked in order; do not pull
work from a later slice into an earlier one.

## The owner's decisions on how code is made

- Test first, one vertical slice at a time, through the public interface.
- The test author is a separate agent; the implementer never changes a test to make
  it pass, and a test that looks wrong goes back to its author.
- The reviewer is a separate agent and only comments; the implementer makes the
  change and checks it again.
- The mutation check follows PRD 7.3: one pass per piece of work; the everyday way is a
  small hand check on the logic that changed; for a core product change one narrowed
  tool run in the background is allowed; a whole-suite tool run is an audit the owner asks for.
- Use what the standard library or the platform already does; do not hand-roll it,
  and take no requirement stricter than the intent. When you catch yourself listing
  the edge cases of a mechanism of your own, replace the mechanism.
- Do not say it works from a plausible diff. Run the check and read the output.

## The owner's decisions on rules and skills

A rule unit or a skill is writing, not code, and the bar is his: take the good parts
of the sources in full, consolidated into our version, not a summary and not made up;
lightweight is not fluffy; plain tone, no personal colour; defaults and techniques,
never bans on what a user may ask and no assumed way of working. His own words in the
research pack win over every source. A skill works in both harnesses (only `name` and
`description` are portable frontmatter) and never contradicts the everyday rules.
When the shape of a rule set or a skill is open, propose before writing.

## This machine's `obk`

The owner's decision (2026-09-24): the `obk` on this machine is the latest
published `@assuredloop/orca-bot-kit`, the same one a user has. Each developer
works in a clone of their own and runs its code by its full path
(`node <clone>/src/cli.js …`); `npm test` needs nothing else. The system tests
need more, because the kit's hooks and the bots in Orca's tabs call `obk` by
name: for a system-test run, switch the machine's `obk` to your clone with
`npm run use:checkout`, run `npm run test:system -- --yes`, then put the release
back with `npm run use:release`. The runner refuses to start unless the `obk` on
PATH is the checkout it belongs to. There is one `obk` for the whole machine:
tell the coordinator before you switch it and again when it is back.

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

## Authorisation and roles

Standing authorisation from the owner: commit, push, open the PR, and after the review
merge and close the issue; do not wait for him and do not ask him about routine steps.
Nothing merges while anything is outstanding: a test still being written or still running, a question still open, a check still to run. One PR per issue, one review round, squash merges. The kit's own skills are used to build the kit: obk-tdd for the change and its tests, obk-reviewing for giving and receiving the review, obk-debugging for a bug. They load from `.claude/skills` and `.agents/skills`, links to `skills/`; a new skill gets both links. Ask the reviewer directly: one line
typed into its Orca tab (titled "reviewer"; find it with `orca terminal list --json`,
check it is idle first); it answers on the PR and with a line in your tab. The
coordinator hands out issues, answers questions, and steps in only for something out
of the ordinary; take its answers as the owner's. Go to the owner only for what is
irreversible outside this repo, touches his accounts or other people, or changes what
the product does beyond the PRD.
