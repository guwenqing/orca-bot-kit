# ADR 0046: Orca is the host

Date: 2026-10-16.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, and on 2026-09-20 for the plain folder; the architect, for #232 and PR #260, for the sentences marked so; the owner on 2026-09-24 for calling Orca's runtime through Orca's own client (#224), with the architect deciding how the user is told, for the sentences marked so; the architect, for #329, for the kit's own reading of a tab's screen before it types into it, for the sentences marked so; the architect, for #298, for asking Orca's runtime who is in front of a tab where `ps` cannot read it, for the sentences marked so; the owner on 2026-09-26 for Orca's own Force Reload after a removal (#343), with the architect deciding how the menu item is found, for the sentences marked so; the architect, for #261, for recognising the harness the kit launched by its launch mark, for the sentences marked so; the owner on 2026-10-11 for fleet mail that types no line into the receiver's tab, with one Escape for urgent mail (#555), as [ADR 0042](0042-messaging-transport.md) records; the architect, for #575, for taking the kit's mail nudge and the Codex nudge hook out of this record. The owner may overrule the architect's sentences. Consulted: the coordinator, who researched Orca. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0034](0034-orca-is-the-host.md).

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

Since 2026-10-11 the kit types no mail nudge (#555,
[ADR 0042](0042-messaging-transport.md)): a send queues the letter, and Orca's
own notice tells the receiver once it is idle. What the kit still types into a
running session is the Escape of `obk message send --interrupt`,
`/reload-skills` after `obk skills build`, grooming's lines, the line a
resumed Codex session is given, and the typing of `obk session clear`.

The kit has to know whether a harness is running in a tab, to report a
session as up and to decide whether to type into it. Orca's own
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

Not from everywhere the kit runs, though (#298). A Codex session at the kit's
`auto` level runs its commands in Codex's `workspace-write` sandbox, and
there `/bin/ps`, which is setuid root, does not start at all: `Operation not
permitted`, exit 126, even for its own pid (codex-cli 0.156.1, seen
2026-09-24). So every `obk message send` from a Codex reviewer said it could
not tell, and typed no nudge. Orca's runtime has a method its CLI does not
expose, `terminal.inspectProcess`, that reads the same thing from inside Orca:
its terminal daemon runs `ps` over the process table, walks down from the
tab's own process to its terminal's foreground group, and names what leads it
(read in the Orca 1.4.212 bundle, 2026-09-26). Orca's runtime runs in the app,
outside any sandbox of the caller, and only `orchestration.*` methods go
through Orca's attestation of the caller. Seen live on Orca 1.4.212 from a tab
of a probe's own: the shell at its prompt answered verdict `live` with no
process named and no child in front, `less` answered `foregroundProcess:
"less"`, and a `node` program `"node"`. A harness answers under its own name
(`processName` `claude` or `codex`, from its arguments): read in the bundle,
and seen for an idle Claude Code in #298's attended system test. Not while
it runs a command, though. On macOS `ps` prints `??` for a process with no
terminal, and Orca takes that for another terminal: any process in the tab
with no terminal makes the answer `unverifiable`, reason `tty_boundary`, with
`foregroundProcess` the leader's short kernel name (`2.1.282`, the version
file, for a native Claude Code). Claude Code runs its commands in a shell
with no terminal, so a Claude session running a command, or holding one in
the background, gets that answer (seen live in the same run, and read in
Orca's source; an Orca bug, #350). It is reported upstream as
stablyai/orca#23245; the fix proposed there, stablyai/orca#23251, was still
open on 2026-10-03, and Orca 1.4.219 does not have it.

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
on an id that does not exist with `Project not found`. No session can see
Orca's window on this machine; the owner looked for them in #343.

A re-read does not take a removed project out of the sidebar (Orca 1.4.212,
2026-09-26, #343). Read in the bundle: on the event the window replaces its
list of repos, but the sidebar builds its rows from the window's own list of
workspaces, and nothing drops the workspaces of a repo that has gone; only the
window's own removal does. Seen by the owner, with a throwaway folder project:
after `project setup-delete` its row stayed under its old name; after the
kit's `project.update` call the row stayed, now under "Unknown"; after Orca's
menu item View › Force Reload it was gone, and Orca had 11 terminals before and
11 after. Before that, the owner saw the project appear after the kit's call
on it. Force Reload rebuilds the window's page
(`webContents.reloadIgnoringCache()`, the same code as the `app.forceReload`
shortcut, ⌘⇧R by default). No runtime call and no CLI command does it. macOS
System Events can click that menu item in Orca's process without a keystroke,
when macOS allows the app it runs from to (Accessibility); from a kit session
inside Orca it was allowed and worked, with Orca the front app. With another
app in front, the click is taken and Orca does nothing: seen twice on
2026-09-26, once after a system test and once on its own, with the sidebar
read through Accessibility before and after (#343). One Force Reload drops
every stale row, not only the last removal's. The item's name is localized,
and it carries the shortcut after a tab, as the menu draws it:
`Force Reload\t⌘⇧R`. The shortcut is the user's to change.

## Decision

The kit is built on the Orca desktop app. A bot is an Orca project, backed by
a plain folder. A session is a tab. Naming, ordering, phone and remote access
are left to Orca. The kit drives Orca through its CLI (proposed).

To learn whether a harness is running in a tab, the kit also reads that tab's
foreground process group from the operating system, with `ps`, using the pane
pid Orca gives in `orca diagnostics memory`. It only reads, and it never
kills. The shell in front means no harness is in the tab. The kit types a
line or a key into a tab only when the process leading the foreground group is the
harness Orca names in `agentIdentity`, and Orca sees nothing on screen waiting
to be answered. (The architect, #232 and PR #260; the owner may overrule.) A
process under another name, such as `node` for a harness installed through
npm, counts as that harness when `ps` shows it carrying this tab's
`ORCA_TAB_ID` and an `OBK_TAB_SHELL` equal to its own parent's pid: the tab's
shell started it on the kit's launch line, which sets that variable for the
harness alone. A program the shell starts later has no mark, and one the
harness starts has the harness as its parent. This counts only where Orca names
an agent in the tab at all. A tab Orca restored by itself carries no mark, and
keeps the name rule: a native harness there is typed into as before, one under
another name is "cannot tell". A sender inside Codex's sandbox cannot read
another process's environment, since `ps` does not run there and Orca's
runtime gives no pid, so from there a program under another name is "cannot
tell", while the name rule works through the runtime as before. The
marker is proven: on macOS `ps -E` reads a same-user process's environment
(#318), and live on Orca 1.4.215 a Claude Code 2.1.283 run as the child of a
`node` wrapper on the kit's launch-line shape led its tab carrying the mark,
was nudged idle and busy by mail from a codex-cli 0.157.1 session, and a `less`
in its place got nothing (#261, PR #417; tech notes, section 1). A real npm
install, where `node` is the harness itself, and Codex through npm were not
seen. (The architect, #261; the owner may overrule.) A
program Orca names no agent for, one under another name without that mark,
and a pid, group or environment that cannot be read, are "cannot tell"; then
the kit says it cannot tell, and it types nothing.

Where `ps` cannot read the tab, as inside Codex's sandbox, the kit asks
Orca's runtime `terminal.inspectProcess` for the tab instead, through Orca's
own client, the same way as the window call below. Only an answer with the
verdict `live` counts. A process named there, by `processName` or else by
`foregroundProcess`, is the program in front, under that name, and the rules
above apply to it as to one `ps` named. No process named and nothing but the
shell in front (`hasChildProcesses` false) is the shell. Anything else, and
anything that goes wrong with the call, is "cannot tell". Where `ps` reads the
tab, Orca's runtime is not asked. The call is given at most 3 seconds and is
never retried. (The architect, #298; the owner may overrule.)

The kit types no mail nudge. A send queues the letter in the receiver's
mailbox, and Orca's own notice tells the receiver; only a sender's
`--interrupt` presses one Escape into a busy receiver's tab, through the
rules above and below, as [ADR 0042](0042-messaging-transport.md) says. A
Codex bot's `.codex/hooks.json` holds no nudge hook of the kit's, and `up`
takes the old entry out ([ADR 0042](0042-messaging-transport.md)). Where a
send from inside Codex's sandbox cannot tell, it presses nothing, and the
letter still goes.

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
Orca's own binary the way Orca's `bin/orca` runs its CLI. Today that is two
calls: `terminal.inspectProcess`, above, and the window call. After a run makes a bot's project, or turns a registration into its
folder project, the kit calls `project.update` with no changes on that
project. The call is made once and never retried, is given at most 3
seconds, and anything that goes wrong with it is passed over in silence: the
command succeeds and says the same thing. It lives in `src/orca.js` with every
other Orca call. This is the owner's yes of 2026-09-24: "can be as dirty as it
is, try to be protective in case orca changes".

After `retire` has removed a bot's project, and Orca's list no longer has it,
the kit has Orca's window force-reload itself when Orca is the front app: it
has macOS System Events click Orca's menu item Force Reload. When another app
is in front it clicks nothing, and never brings Orca to the front. (The
architect, #343; the owner may overrule.) That is the owner's ask of 2026-09-26, that
the sidebar drop a removed project "automatically, not that I have to do it"
(#343). The system tests do the same after they remove their throwaway
projects. The click is aimed at the Orca the kit talks to, the app its Orca CLI
belongs to, and at nothing else. The item is the one named "Force Reload" or
drawn with ⌘⇧R, Orca's own shortcut for it, in any of Orca's menus but the
Apple menu, so it is found in any language while the shortcut is Orca's own.
(The architect, #343; the owner may overrule.) It is tried once, given at most
5 seconds, and anything that goes wrong is passed over in silence, as with the
call above; it lives in `src/orca.js` too. The kit no longer makes the
`project.update` call after a removal: it only relabels the row.

After any run that made or renamed a project, the kit prints one line, whatever
became of the call: "If Orca's sidebar does not show it, reload the window with
Cmd+Shift+R." It stays until the owner has seen the window re-read with no
reload. After a removal the kit prints the same line only when the Force Reload
was not done, and otherwise says that it reloaded Orca's window. (The
architect, #224 and #343; the owner may overrule.)

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
  that has quit, so a line could go into a shell (#232).
- **`terminal.inspectProcess` for every tab, in place of `ps`.** Not chosen:
  the `ps` reading is what #232 measured, it rests on no unpublished method,
  and it needs no second process per look. The runtime is asked only where
  `ps` cannot answer (#298).
- **Orca's `terminal.isRunningAgent` or `terminal.agentStatus`.** Not chosen:
  both are guesses from the tab's title, its recent output, hook reports and
  the process name (read in the 1.4.212 bundle), so a stale title can say a
  harness is there after it quit. `isRunningAgent` also took more than 5
  seconds on a `node` program in front, and timed out (seen, #298).
- **Opening Codex's sandbox further, or changing the user's Codex config.**
  Out: ADR 0015 already opens the network for Orca, and any further opening is
  the owner's call (#298).
- **A Codex sender's `PostToolUse` hook that decides the nudge its send
  could not decide inside the sandbox** ([ADR 0034](0034-orca-is-the-host.md),
  #350), until Orca's fix to `tty_boundary` (stablyai/orca#23245) ships.
  Replaced: since #555 the kit types no mail nudge, so no nudge is left for a
  hook to decide ([ADR 0042](0042-messaging-transport.md)). Inside that
  design, Codex's `Stop` hook lost because it runs only when the sender's
  turn ends; the hook's `async` switch, because its answer could not reach
  the sender; the nudge left in the bot's folder, because the file would show
  in the user's git status; and the hook for every sender, because only Codex
  runs it.
- **On `tty_boundary`, taking the tab as the harness's when Orca's hook
  status says one is running there.** Not chosen: that is a guess from hooks
  where #232 asks for the process in front (#298).
- **Taking an `unverifiable` answer's `foregroundProcess` as the program in
  front.** Not chosen: it is the kernel's short name, which for a native
  Claude Code is its version file, and differs between sessions started
  before and after an update.
- **Orca's hook state from `orca worktree ps`.** Not enough: a resumed Codex
  has no entry until its first prompt (#226, #232).
- **Any program in front with an identity counts as the harness.** Not
  chosen: after Codex quit, `less` in front still carried the identity `codex`,
  and a line would have gone into `less` (PR #260 review).
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
  something. That trust list gets no typed line anyway while Orca names no agent in
  its tab (#329).
- **Orca's hook state, from `terminal show`'s `agentWait` or `worktree ps`.**
  Not enough on its own: nothing in it covers the update offer, which Codex
  shows before its session has started (#329).
- **Waiting for Orca to match the new footer.** Outside the repo, and the next
  change to a footer would open the same gap (#329).
- **The launch mark alone, without its parent.** Not chosen: a program the
  harness starts inherits the mark, so it would count as the harness (#261).
- **The launch mark counting where Orca names no agent.** Not chosen: a
  harness Orca has not named yet may be seconds into its launch and not ready
  for a line, which is why the name rule does not count it either (#261).
- **Loosening the name rule without a mark**, so that any program in front
  counts where Orca names an agent. Not chosen: #232's `less` after the
  harness quit would be typed into (#261's boundary).
- **An Orca CLI command that sends the event.** None does: `repo add` and
  `project setup-existing-folder` on a path Orca knows return without it,
  `repo set-base-ref` throws on a folder project first, `project setups` sends
  it only when it changed something, and `orca reload` reloads the embedded
  browser (#224).
- **Only the reload line, with no call.** Not chosen: it leaves every user to
  reload by hand after every new bot, when one call can spare them that.
- **Reloading the window by keystroke, or through Orca's computer-use
  helper.** Not chosen: it types into the user's window and takes their screen,
  which the kit does not do (#224). Clicking the menu item through System
  Events does neither, and is what the kit does after a removal (#343).
- **Force Reload after a make or a rename too.** Not chosen: the
  `project.update` call is enough there, as far as the owner has seen, and a
  reload redraws the whole window.
- **Keeping the `project.update` call after a removal as well.** Not chosen:
  the row it leaves reads "Unknown", which says less than the old name, and the
  Force Reload does not need it (#343).
- **Bringing Orca to the front for the click, and back after.** Not chosen
  for now: it takes the user's screen, and while Orca is in front whatever
  they type lands in Orca's focused tab, a harness or a shell, where an Enter
  sends it. That is the owner's to accept; it is put to them (#343).
- **The menu item by its English name alone.** Not chosen: Orca localizes it
  (#343).
- **The menu item by its place, the second in View.** Not chosen: a menu Orca
  reorders would get the wrong item clicked, where a name or a shortcut that no
  longer matches clicks nothing (#343).
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
  `diagnostics memory` may change. A harness run under another name, such as
  `node`, is typed into when the kit's launch line started it (#261). Such a
  harness in a tab Orca restored by itself carries no mark and stays "cannot
  tell", and so does such a harness for a sender inside a sandbox, where
  `ps` does not run and Orca's runtime gives no pid. A native harness in
  either place is typed into by the name rule, as before.
- Good: a Codex session at the kit's `auto` level reads a tab as a Claude
  session does, for `--interrupt`, `health`, `restart`, the skills reload and
  grooming (#298).
- Bad: from there, a Claude receiver running a command, or holding one in the
  background, which Orca's runtime cannot see past, is "cannot tell": a Codex
  sender's `--interrupt` presses no Escape there, and the letter waits for
  Orca's notice when that turn ends (#350, #555).
- Good: since #555 a Codex bot has no nudge hook, so Codex runs nothing of the
  kit's after each shell command, and no nudge waits in the temp folder
  ([ADR 0042](0042-messaging-transport.md)).
- Bad: from inside a sandbox, that reading rests on what Orca does not
  publish: `terminal.inspectProcess` and the shape of its answer. If they go
  in a release, a Codex session is back to "cannot tell", as before #298: its
  `--interrupt` presses nothing, and the letter waits for Orca's notice. A
  look from a sandbox can take up to 3 seconds longer when the client hangs.
- Good: after `obk up` of a new bot, the window can show it with its name and
  as a folder project without the user doing anything.
- Bad: the call rests on what Orca does not publish: where the client file is
  in the app, its `RuntimeClient` export, and the `project.update` method. Any
  of them can go in a release, and then the call fails quietly and the user
  reloads by hand, as before. A run that makes or removes a project can take up
  to 3 seconds longer when the client hangs.
- Bad: until the owner has seen the window re-read, every run that makes or
  renames a project prints the reload line, even when the call worked.
- Good: after `obk retire` run with Orca in front, as from one of its own
  tabs, the sidebar drops the removed project, and every older stale row
  with it, with no reload by hand and no restart (#343).
- Bad: a removal made while another app is in front, a system test run
  included, leaves its row until the next reload, and the user is told to
  reload by hand, as before.
- Bad: every `retire` redraws the whole of Orca's window, and every system
  test file that removed a project does it once more. The Force Reload rests on
  what Orca does not publish either: the menu item's name, its shortcut, and a
  reload keeping every terminal, which was seen once, with 11. Without
  Accessibility for the app the kit runs from, or with Orca in another
  language and its shortcut changed, the click is not made and the user is
  told to reload by hand, as before. The first time, macOS may ask the user
  whether that app may control System Events; the kit does not wait for the
  answer past its 5 seconds.
- Good: the interrupt and `/reload-skills` hold back on every numbered menu either
  harness draws, the update offer included, whether Orca names it or not.
- Bad: one more Orca call before every line typed. A tab whose screen Orca
  cannot render gets nothing typed, and an urgent letter waits for Orca's
  notice. A numbered list the user typed, sitting at the bottom of the screen
  under the harness's pointer, is taken for a question, and nothing is typed.
- Bad: a harness that draws a question another way, or changes its pointer, is
  not caught by the kit's reading; only Orca's own answer is left for it.
  Claude Code's unnumbered trust list is one such screen today: what keeps a
  typed line out of it is Orca naming no agent in that tab, seen live and not
  promised by Orca.
- Revisit if: Orca offers a supported way to tell whether a harness is running
  in a tab, or the kit has to run where Orca does not; or Orca's
  `setup-update` and `setup-delete` send the event themselves, or its CLI
  offers a call that does; or its window drops a removed project's row on a
  re-read (stablyai/orca#20102, stablyai/orca#23224), when the Force Reload can
  go behind a version check; or a harness draws its questions another way.
  Confidence: high for Orca as the host; the process-group reading was right
  in every run measured; low for the window call until the window has been
  seen to re-read. (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/harness-in-tab.test.js` for the reading of a tab,
  `test/node-harness-interrupt.test.js` for a harness under another name,
  `test/front-without-ps.test.js` for asking Orca's runtime where `ps` cannot,
  `test/gate-bounded.test.js` for a gate that one slow Orca reply cannot hold,
  `test/question-on-screen.test.js` for the reading of its screen,
  `test/orca-window.test.js` for the window call, the Force Reload and their
  fallbacks, and the
  system tests, which drive the real Orca, `test/system/harness-question.test.js`
  and `test/system/mail-interrupt.test.js` among them.

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
- 2026-09-26, [ADR 0023](0023-orca-is-the-host.md): before it types into a
  tab, the kit also reads the tab's rendered screen, and types nothing while a
  harness's own choice list is up (#329). The marker question (#261) stays
  open. It replaced ADR 0021.
- 2026-09-26, [ADR 0024](0024-orca-is-the-host.md): where `ps` cannot read a
  tab, as inside Codex's sandbox, the kit asks Orca's runtime
  `terminal.inspectProcess` instead (#298). It replaced ADR 0023.
- 2026-09-26, [ADR 0025](0025-orca-is-the-host.md): after a removal, the kit
  has Orca's window force-reload itself through Orca's menu when Orca is the
  front app, in place of the `project.update` call, and prints the reload line
  only when that was not done (#343). It replaced ADR 0024.
- 2026-09-28, [ADR 0031](0031-orca-is-the-host.md): a harness under another
  name is recognised by the kit's launch mark, read with `ps`, and nudged;
  such a harness in a restored tab, or for a sender inside Codex's sandbox,
  stays "cannot tell", while the name rule is unchanged (#261). It replaced
  ADR 0025.
- 2026-10-03, [ADR 0034](0034-orca-is-the-host.md): a nudge a Codex sender
  cannot decide inside its sandbox is left for its own `PostToolUse` hook,
  which decides it with `ps` outside the sandbox (#350). It replaced ADR 0031.
- 2026-10-11: the kit's mail nudge and the Codex nudge hook went, and an
  urgent letter's `--interrupt` presses one Escape through the same gate, the
  owner's decision for #555, recorded in
  [ADR 0042](0042-messaging-transport.md). ADR 0034 was not changed.
- 2026-10-16, this record: nothing decided changes. The mail nudge and the
  Codex nudge hook are taken out, as #555 left them, and the record replaces
  ADR 0034 (#575).
