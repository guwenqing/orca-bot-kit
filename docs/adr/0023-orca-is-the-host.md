# ADR 0023: Orca is the host

Date: 2026-09-26.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, and on 2026-09-20 for the plain folder; the architect, for #232 and PR #260, for the sentences marked so; the owner on 2026-09-24 for calling Orca's runtime through Orca's own client (#224), with the architect deciding how the user is told, for the sentences marked so; the architect, for #329, for the kit's own reading of a tab's screen before it types into it, for the sentences marked so. The owner may overrule the architect's sentences. Consulted: the coordinator, who researched Orca. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0021](0021-orca-is-the-host.md).

## Context

The first version used Codex desktop projects as the host. Setting up a bot
needed manual clicks, approval prompts kept appearing under a "Full Access"
label, and projects were not visible on other devices (#9, 2026-09-13). The
owner already runs a similar setup on Orca (PRD 1), and he set the new direction:
"change it to be orca based", with "bot = project, and session = tab" and
phone visibility, remote handling, naming and ordering left to Orca (the
owner's design session, 2026-09-19, not in the repo).

Orca is MIT-licensed and releases almost daily, with no stated promise that
its CLI stays stable. Nearly every command answers `--json`, and
`orca status --json` lists capabilities. A bot's folder can host tabs only as a
folder workspace: registered as a git repo, it gets no worktree and cannot
host tabs (Orca 1.4.205, 2026-09-20; tech notes).

The kit has to know whether a harness is running in a tab, to report a
session as up and to decide whether to type a mail nudge into it. Orca's own
answers do not tell a harness from a shell (Orca 1.4.209, Claude Code 2.1.281,
Codex 0.156.1, macOS 26.6.2, measured 2026-09-24, #232):

- `terminal wait --for tui-idle` answers `timeout` for a busy harness, the same
  as for a shell, and a busy harness can also answer `satisfied:true`.
- After Codex quits, the shell it leaves answers `satisfied:true`.
- `agentIdentity` comes 0.5 to 6 s after a launch, and it stayed `codex` on a
  tab back at a shell prompt for more than 70 s; with `less` then in front, it
  still said `codex`.
- The foreground process group of the tab's terminal was right every time: the
  shell at a prompt, the harness while it runs, and the shell again within 3 s
  of every quit. Orca gives the pane's pid in `orca diagnostics memory`, which
  is a diagnostics command and may change.

The kit runs only on the machine Orca runs on (PRD 5's "No cloud execution",
itself still marked proposed), so reading the local process table is enough.

Orca's word on whether something on a tab's screen wants answering does not
cover every question a harness asks (#329). Read in the Orca 1.4.212 bundle on
2026-09-26: the `blockedReason` of `terminal wait --for tui-idle`, and the gate
that refuses a line sent with `--enter` as `agent_prompt_blocked`, both come
from one text match on the last 12 non-blank lines of the tab's output, and
from the harnesses' hooks. The match knows Codex's update offer only by the
footer "press enter to continue". Codex 0.156.1 drew "enter continue · esc
skip" instead, and nothing matched. There is no pattern for Claude Code's
numbered menus at all. Seen on 2026-09-26: a system test's first line, typed
with Enter into a Codex tab that was showing the offer, took its default,
`1. Update now`, and Codex updated itself on the owner's machine (#329). Every
question of the harnesses' own seen here is drawn the same way: a list of
choices, one per row, with the selection pointer at the start of one, `›` on
Codex and `❯` on Claude Code. All of Codex's are numbered, and so are Claude
Code's but one: its folder-trust list (2.1.283). Both harnesses also start
their input line, and their echo of the user's past turns, with the same
pointer. Codex 0.157.1 puts a status row right under its input line, lined up
with it, and a wrapped draft looks the same; by layout alone, neither can be
told from an unnumbered list. On a fresh Claude Code tab sitting on its trust
list, Orca named no agent for minutes, and `tui-idle` timed out. `terminal
read --screen` gives the rendered screen, row by row.

Orca's window reads its projects again only when its runtime sends the
`repos:changed` event, and nothing polls (read in the Orca 1.4.209 bundle,
2026-09-24, #224). The two calls the kit makes a project with, `repo add` and
then `project setup-update`, end in one that does not send it, and
`project setup-delete`, which `retire` uses, does not send it either. So after
`obk up` the window can go on showing a new bot under its folder's name as a
git project, and after `obk retire` it can go on showing the removed project,
until the user reloads it. The delete half is reported to Orca as
stablyai/orca#20102 (open on 2026-09-24), which also says a re-read can leave
the removed project's row under an "Unknown" heading. No Orca CLI command sends
the event for a project Orca already knows, and none reloads the window.
Orca's runtime has a method `project.update` that its CLI does not expose; it
sends the event, and with no changes it only moves the project's `updatedAt`.
Orca's own `bin/orca` runs its CLI as `ELECTRON_RUN_AS_NODE=1
<Orca.app>/Contents/MacOS/Orca <script>`, and a script run that way can load
Orca's client from `app.asar.unpacked/out/cli/runtime-client.js`. Live on
2026-09-24, that client answered `project.list`, and refused `project.update`
on an id that does not exist with `Project not found`. Nobody here has seen the
window re-read: no session can see Orca's window on this machine.

## Decision

The kit is built on the Orca desktop app. A bot is an Orca project, backed by
a plain folder. A session is a tab. Naming, ordering, phone and remote access
are left to Orca. The kit drives Orca through its CLI (proposed).

To learn whether a harness is running in a tab, the kit also reads that tab's
foreground process group from the operating system, with `ps`, using the pane
pid Orca gives in `orca diagnostics memory`. It only reads, and it never
kills. The shell in front means no harness is in the tab. The kit types a
nudge into a tab only when the process leading the foreground group is the
harness Orca names in `agentIdentity`, and Orca sees nothing on screen waiting
to be answered. A program Orca names no agent for, or one under another name,
is "cannot tell", as is a pid or group that cannot be read; then the kit says
it cannot tell, and it types nothing. (The architect, #232 and PR #260; the
owner may overrule.)

Before the kit types a line into a tab with a harness running in it, it also
reads the tab's rendered screen with `terminal read --screen`. When the
lowest row there that starts with the harness's pointer is on a numbered
choice, with another numbered choice lined up beside it, the kit types nothing
and says the tab is waiting on a question. The lowest such row is the
input line whenever that is on screen, so the conversation above it never
counts. That holds for any question a harness draws that way, whatever it
asks: the kit keeps no list of screens. A screen that cannot be read, or that
Orca gives as anything but the rendered screen, is "cannot tell", and nothing
is typed. `up` and `restart` report the same question on a tab they have just
started. (The architect, #329; the owner may overrule.)

Where Orca's CLI has no call for what the kit needs, the kit calls Orca's
runtime through Orca's own client, loaded from the installed app and run by
Orca's own binary the way Orca's `bin/orca` runs its CLI. Today that is one
call. After a run makes a bot's project, or turns a registration into its
folder project, the kit calls `project.update` with no changes on that
project; after `retire` removes one, it makes the same call on Bot Father's
project, which is never retired, and makes none when Orca has no project for
Bot Father. The call is made once and never retried, is given at most 3
seconds, and anything that goes wrong with it is passed over in silence: the
command succeeds and says the same thing. It lives in `src/orca.js` with every
other Orca call. This is the owner's yes of 2026-09-24: "can be as dirty as it
is, try to be protective in case orca changes".

After any run that made, renamed or removed a project, the kit prints one
line, whatever became of the call: "If Orca's sidebar does not show it, reload
the window with Cmd+Shift+R." After a removal it stays for good, because of
stablyai/orca#20102. After a make or a rename it stays until the owner has seen
the window re-read with no reload. (The architect, #224; the owner may
overrule.)

## Alternatives considered

- **Codex desktop projects**, the first version's host. Left for the reasons
  in the context: manual steps, approval prompts under a "Full Access" label,
  and projects not visible on other devices.
- **ChatGPT web Projects.** Ruled out before the first version, because the
  work runs on the user's own computer (#9).
- No other host is recorded as considered.
- **A bot folder registered as a git repo.** Not possible: Orca gives it no
  worktree and it cannot host tabs (#65).
- **Orca's `tui-idle` alone to tell a harness from a shell.** Not chosen: a
  busy harness answers like a shell, and a shell Codex left answers like an
  idle harness (#232).
- **`agentIdentity` alone.** Not chosen: it is late, and it can name a harness
  that has quit, so a nudge could go into a shell (#232).
- **Orca's hook state from `orca worktree ps`.** Not enough: a resumed Codex
  has no entry until its first prompt (#226, #232).
- **Any program in front with an identity counts as the harness.** Not
  chosen: after Codex quit, `less` in front still carried the identity `codex`,
  and the nudge would have gone into `less` (PR #260 review).
- **A program with no identity counts as not up.** Not chosen: it is as often
  a harness seconds into its launch, so it is "cannot tell" (PR #260 review).
- **Orca's `blockedReason` alone to tell whether a question is up**, as
  before #329. Not enough: its text match missed Codex 0.156.1's update offer,
  and it has nothing for Claude Code's menus (#329).
- **A list of the known screens, each by its own text**, the way Orca does it.
  Not chosen: a list that grows with every screen a harness adds is what
  [ADR 0016](0016-no-kit-owned-expert-systems.md) rules out, and Orca's own list
  fell behind one Codex release (#329).
- **Any choice list, numbered or not**, to take in Claude Code's trust list
  too. Not chosen: Codex's idle input line has a status row lined up under it,
  which reads as the same shape, so every idle Codex tab would count as asking
  something. That trust list gets no nudge anyway while Orca names no agent in
  its tab (#329).
- **Orca's hook state, from `terminal show`'s `agentWait` or `worktree ps`.**
  Not enough on its own: nothing in it covers the update offer, which Codex
  shows before its session has started (#329).
- **Waiting for Orca to match the new footer.** Outside the repo, and the next
  change to a footer would open the same gap (#329).
- **A marker in the launch shell's environment, read with `ps -E`.** Open, not
  yet proven (#261). Until then a harness run through a wrapper such as `node`
  is "cannot tell".
- **An Orca CLI command that sends the event.** None does: `repo add` and
  `project setup-existing-folder` on a path Orca knows return without it,
  `repo set-base-ref` throws on a folder project first, `project setups` sends
  it only when it changed something, and `orca reload` reloads the embedded
  browser (#224).
- **Only the reload line, with no call.** Not chosen: it leaves every user to
  reload by hand after every new bot, when one call can spare them that.
- **Reloading the window by keystroke, or through Orca's computer-use
  helper.** Not chosen: it types into the user's window and takes their screen,
  which the kit does not do (#224).
- **Speaking Orca's runtime protocol from the kit's own code.** Not chosen: the
  transport and its authentication would be the kit's to keep up with. Through
  Orca's own client, a change there is Orca's.
- **Waiting for Orca to send the event from `setup-update` and
  `setup-delete`.** The real fix, and outside the repo. The kit carries the
  call until then.

## Consequences

- The kit depends on Orca's CLI, which changes often. The kit reads `--json`
  output and checks capabilities, and keeps Orca calls in one small module.
- Good: cross-harness messaging uses Orca's mailbox, so the kit needs no
  message service of its own.
- Scheduled work does not use an Orca automation, because an automation cannot
  carry a model or an effort of its own (the owner, #223). How it runs instead
  is PRD 6.8's, #237's and #238's.
- Bad: a user without Orca cannot use the kit.
- Bad: the kit reads the operating system's process table as well as Orca, and
  `diagnostics memory` may change. A harness installed through a wrapper gets
  "cannot tell", so its mail waits without a nudge, until #261.
- Good: after `obk up` of a new bot, the window can show it with its name and
  as a folder project without the user doing anything.
- Bad: the call rests on what Orca does not publish: where the client file is
  in the app, its `RuntimeClient` export, and the `project.update` method. Any
  of them can go in a release, and then the call fails quietly and the user
  reloads by hand, as before. A run that makes or removes a project can take up
  to 3 seconds longer when the client hangs.
- Bad: until the owner has seen the window re-read, every run that changes a
  project prints the reload line, even when the call worked.
- Good: the nudge and `/reload-skills` hold back on every numbered menu either
  harness draws, the update offer included, whether Orca names it or not.
- Bad: one more Orca call before every line typed. A tab whose screen Orca
  cannot render gets no nudge, and its mail waits in the mailbox until it is
  checked. A numbered list the user typed, sitting at the bottom of the screen
  under the harness's pointer, is taken for a question, and the nudge waits.
- Bad: a harness that draws a question another way, or changes its pointer, is
  not caught by the kit's reading; only Orca's own answer is left for it.
  Claude Code's unnumbered trust list is one such screen today: what keeps the
  nudge out of it is Orca naming no agent in that tab, seen live and not
  promised by Orca.
- Revisit if: Orca offers a supported way to tell whether a harness is running
  in a tab, or the kit has to run where Orca does not; or Orca's
  `setup-update` and `setup-delete` send the event themselves, or its CLI
  offers a call that does; or a harness draws its questions another way.
  Confidence: high for Orca as the host; the process-group reading was right
  in every run measured; low for the window call until the window has been
  seen to re-read. (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/harness-in-tab.test.js` for the reading of a tab,
  `test/question-on-screen.test.js` for the reading of its screen,
  `test/orca-window.test.js` for the window call and its fallbacks, and the
  system tests, which drive the real Orca, `test/system/harness-question.test.js`
  among them.

## History

- 2026-09-19, [ADR 0001](0001-orca-is-the-host.md): decided by the owner in
  his design session, with the plain folder and driving Orca through its CLI
  both marked proposed, and the consequence that scheduled grooming uses Orca
  features.
- 2026-09-20: the plain folder was proven on Orca and decided (#65, #66); the
  owner accepted "A bot home is a plain folder" in his review of the rules
  that day (the owner's design session, 2026-09-20, not in the repo). ADR 0001
  kept its mark.
- 2026-09-24, [ADR 0001](0001-orca-is-the-host.md): a section added after
  acceptance recorded reading the tab's foreground process group, the
  architect's decision for #232 (PR #260). The review rounds of PR #260 then
  narrowed the nudge to the process Orca names, and made a program with no
  identity "cannot tell"; the section did not record those.
- 2026-09-24: the owner decided that scheduled work does not use an Orca
  automation (#223, PRD 6.8). ADR 0001's consequence was not changed.
- 2026-09-24, [ADR 0011](0011-orca-is-the-host.md): nothing decided changed. It
  stated the #232 rule as it was merged, dropped the proposed mark from the
  plain folder, replaced the scheduling consequence with what holds, and
  replaced ADR 0001 (#262).
- 2026-09-24, [ADR 0021](0021-orca-is-the-host.md): the kit calls Orca's
  runtime through Orca's own client where the CLI has no call, today to make
  the window read its projects again, and prints a reload line after any
  change to a project (#224). It replaced ADR 0011.
- 2026-09-26, this record: before it types into a tab, the kit also reads the
  tab's rendered screen, and types nothing while a harness's own choice list is
  up (#329). The marker question (#261) stays open. It replaces ADR 0021.
