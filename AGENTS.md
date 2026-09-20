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
- The author's tests are checked by mutation testing: `npm run mutate`. Once per
  piece of work, after the suite is green and before you call it done, on the
  code that work changed. The full rule, including when to skip it and what to
  do with a survivor, is PRD section 7.3.
- The reviewer is a separate agent and only comments. The implementer makes the
  change and verifies it again.
- Do not say it works from a plausible diff. Run the check and read the output.

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
