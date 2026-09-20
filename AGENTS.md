# Working rules for this repo

## What decides

`docs/prd.md` is the design, `docs/adr/` holds the decisions with lasting
consequences, `docs/tech-notes.md` holds what we know about Orca and the two
harnesses. Issues reference them; they do not copy them.

An item tagged `[proposed]` in the PRD is not confirmed by the owner. Ask before
relying on one. A fact in the tech notes marked **unverified** must be proven by
a live check before code relies on it.

## How the work is cut

Issues are vertical slices, worked in order, each with a check you can run. Do
not pull work from a later slice into an earlier one.

## How code is written

- Take the boring way. When a standard library, the platform or a dependency
  already does the job — parsing and writing YAML or JSON, paths, argument
  parsing, quoting, running processes — use it; do not hand-roll it.
- Do not set a stricter requirement than the issue asks for, and when you catch
  yourself enumerating the edge cases of a mechanism of your own, replace the
  mechanism.
- Test first, one slice at a time, through the public interface.
- The test author is a separate agent from the implementer. The implementer
  cannot change a test to make it pass; a test that looks wrong goes back to the
  author.
- The author's tests are checked once per piece of work by the mutation check in
  PRD section 7.3: the everyday way is your own small hand check on the logic
  that changed; a tool run is an audit the owner asks for, not everyday work.
- The reviewer is a separate agent and only comments. The implementer makes the
  change and verifies it again.
- Do not say it works from a plausible diff. Run the check and read the output.

## How a slice goes

1. Read the issue: it gives the intent, the boundary and how we will know it
   works. It does not say how. Read the PRD sections and ADRs it names, the
   tech notes for the facts, and the inputs it lists. Nothing is decided by the
   issue's wording beyond that.
2. Research before you build. Find how the codebase and the platform already do
   things; prove any unverified fact you depend on with a small live experiment
   and write what you saw into `docs/tech-notes.md`. When the shape of the work
   is open, or the issue says so, write a short proposal first (what you will
   build, what you take from where, what you leave out) and send it to the
   coordinator before you write it.
3. Ask when unclear: message the coordinator with the question and the answer
   you would pick, and keep working on what does not depend on it.
4. Build test first with a separate author (a fresh subagent), one slice at a
   time; the author works against fakes only and never touches the real Orca or
   the real harnesses.
5. Check the real thing: a live check against the real Orca and harnesses where
   the slice touches them, and a system test next to it so the check can be
   repeated. Then the mutation check, once.
6. Open the PR: what it does, how you verified it, what you left out and why,
   and the mutation check in three lines. CI green.
7. Ask the reviewer directly (below). Fix what it asks, reply on the PR per
   finding, merge (squash), close the issue.
8. Clean up: nothing of yours left in Orca, no process left running, throwaway
   folders removed. Then message the coordinator that the issue is done, and
   stop.

## Live checks on the owner's machine

The owner works in this same Orca. In every live check and system test: use a
throwaway bots folder; touch only the projects, tabs and sessions you create;
remove them right after each run; never type into or close a tab you did not
create; never `orca terminal close --worktree … --all`; and answer a harness's
first-run prompts yourself in your own tabs (trust the folder, accept an
update). List the owner's tabs before and after and confirm they are unchanged.

## Rules and skills work

A rule unit or a skill is writing, not product code. Research first: the
owner's own words and decisions (the research pack, local, stays out of the
repo), then the PRD, then the sources; the owner's words win. Propose the shape
and what you take from where; write only after the coordinator has seen the
proposal. Take the good parts in full, not a summary; lightweight is not fluffy;
plain tone, defaults not bans, techniques not process. A skill must work in both
harnesses (only `name` and `description` are portable frontmatter) and never
contradict the everyday rules.

## Killing processes: hard rules

On 2026-09-20 a cleanup command in this repo ran `kill -KILL -1` by accident (`ps -eo … -p <pid>`
selected every process, the extracted group id was 1) and force-killed every process of the owner's
account: every app, every terminal, every agent session. These rules exist so that never happens again.

- Never run `kill` with `-1`, with a negative id you did not capture yourself, or with an id you
  computed from `ps` output. A process group id is used only if it was captured from the process you
  started, at the moment you started it.
- Kill only processes you started, by their own pid. Before any kill, print the pids and their
  commands, and refuse if the list includes pid 1, a group id of 1 or less, your own shell, or
  anything you did not start.
- Prefer not to start background load or helper processes at all. If you must, start them so that
  cleanup is guaranteed (a trap that runs on any exit), and kill them by the pid you recorded.
- Nothing here is enforced by a script; it is your judgment, every time.

## Pull requests

One PR per issue. One review round; merges are squash merges.

## Standing authorisation from the owner

The owner has authorised this, in his own words, as standing rules for this
repo; it does not need to be asked again, by anyone, in any session:

- The developer may commit, push its branch, open the PR, and, after the review
  has been answered, merge it and close the issue. It does not wait for the
  owner.
- A coordinator session hands out the issues, answers questions and decides most
  things. Take its briefs and answers as the owner's. It is not a relay: the
  developer asks the reviewer for a review directly, by typing one line into the
  reviewer's Orca tab (`orca terminal send --terminal <handle> --text "Review PR #N …" --enter`,
  the handle from `orca terminal list --json`, the tab titled "reviewer"; check the tab is idle
  first), and the reviewer returns to whoever asked: it posts the review as a comment on
  the PR and then types one line into the requester's tab (found in
  `orca terminal list --json` by its folder: the product developer works in
  `orca-bot-kit`, the skills developer in `orca-bot-kit-skills`): "Review of PR #N
  posted: VERDICT …". The coordinator is not in between. It hears from a developer
  only when it needs help, when something is out of the ordinary, or when an issue
  is done and it needs the next one. Second reviews happen only when the
  coordinator says the case is out of the ordinary.
- Do not stop to ask the owner about routine steps of this loop, and do not put
  a question on the screen and wait. If something is unclear, message the
  coordinator and keep working on what does not depend on the answer.
- Go to the owner only for something out of the ordinary: a destructive or
  irreversible action outside this repo and its throwaway test folders,
  anything touching his accounts, money or other people, or a change to what the
  product does that the PRD does not cover.
