# Technical notes: Orca and the two harnesses

Facts gathered on 2026-09-19 on the owner's Mac: Orca 1.4.205, Claude Code 2.1.278, Codex CLI 0.153.4
(Codex has since moved to 0.155.1; the Codex facts below were taken on 0.153.4 unless they say otherwise).
The hook and session-id facts in sections 2 and 3 were proved live on 2026-09-20, on Claude Code 2.1.278 and Codex 0.155.1.
Each fact is marked **verified** (seen in local help output, local files or official docs) or **unverified** (must be proven by a live check before code relies on it).
Tools change fast. Re-check a flag with `--help` before using it.

## 1. Orca

- Project: github.com/stablyai/orca, MIT, releases almost daily. No stated CLI stability promise. **verified**
- The CLI that works: `/Applications/Orca.app/Contents/Resources/bin/orca`. `/usr/local/bin/orca` is a root-only symlink on this machine and fails for a normal user. Resolve the CLI path in one place, allow an override (env var or config). **verified**
- `orca agent-context --json` prints the full command schema. `orca <group> <cmd> --help` per command. Nearly every command takes `--json`; parse that, never the human text. `orca status --json` lists capabilities. **verified**
- Most commands need a running runtime (`orca open`, or `orca serve` for headless). **verified**

### Data model (verified)

project → repo (`kind: "git" | "folder"`) → worktree (id = `<repoId>::<absPath>`) → tabs → panes (paneKey = `<tabId>:<paneId>`) → terminal (handle `term_…`).

- A bot's folder becomes a workspace in two steps, and it must end up kind `folder`:
  `orca repo add --path <p>` registers it, then
  `orca project setup-update --setup <repoId> --kind folder [--display-name <n>]` makes it a folder
  workspace and renames the project. Only then does the worktree `<repoId>::<absPath>` exist and take
  tabs. Straight after `repo add` there is no worktree, and `orca terminal create --worktree path:<p>`
  fails with `selector_not_found`. **verified** (Orca 1.4.205, live)
- `orca repo add` only accepts a path inside a git work tree; anywhere else it answers
  `runtime_error: Not a valid git repository`. A folder inside a git repo is registered with its own
  path and `kind: "git"`, whatever the repository root is. **verified** (live)
- `orca repo add` is idempotent for one path string and answers with the same repo id, but it does not
  resolve symlinks: the same folder reached through a link becomes a second repo with a second project.
  Give it one canonical path (`realpath`). **verified** (live)
- `orca project setup-existing-folder` only accepts a project identity Orca already knows
  (`Imported folder does not match the selected project identity`), so it is not a way to make a new
  folder project from the CLI. **verified** (live)
- `orca project setup-delete --setup <id>` removes the setup, the project and the repo record in one
  call. `orca project setups --json` lists every setup with its `path` and `kind`, which is how the kit
  finds a workspace it made earlier. **verified** (live)
- Many tabs can share one folder: call `orca terminal create --worktree path:<p>` repeatedly.
- Terminal handles are issued at runtime and are not promised to outlast a restart (three did outlast
  the 2026-09-22 reboot, below, but that is one observation, not a contract), so re-list with
  `orca terminal list [--worktree <sel>] --json` and match on the `tabId` that `orca terminal create`
  returned. **The tab id is the key, never the title.** Always set a title (`--title` at creation, kept
  as the tab's `customTitle`), but do not identify a tab by it: the title `terminal list` reports is
  whatever the program in the tab last wrote, and Claude Code writes its own — a tab whose `customTitle`
  is `Kit Arch` lists as `✳ Chatgpt-bot-kit orca migration`, one titled `orca-bot-kit dev` lists as
  `◐ orca-bot-kit-dev`, and a zsh prompt rewrites a shell tab's title to its folder. Orca's own
  `settings.tabAutoGenerateTitle` is `false` on this machine, so that option is not what moves them.
  **verified** (live)
- **A tab keeps its tab id across an Orca restart.** On 2026-09-22 the machine was rebooted and Orca started
  again (the running Orca started at 16:06). The three working tabs read before and after by the coordinator
  kept their tab ids, and on that occasion their handles too (`term_8de5ea5c…`, `term_ee149c15…`,
  `term_46f87f78…`). The tab id is what the kit keys on; a handle is still re-listed rather than kept. Orca afterwards was 1.4.207, which its own trace log first records at 16:03 that day. The
  last version on record before it is 1.4.205 (2026-09-21); whether another ran in between is not recorded.
  **verified by observation** of one reboot, not by a deliberate test. A deliberate restart test is still
  owed if the owner wants one; it closes every tab on the machine, so it is his to schedule (#176).
- Orca calls every workspace a "worktree", a plain folder included. Say "Orca project" or "folder
  workspace" in anything a user reads, so nobody thinks a git worktree was made. The kit never makes
  one: no `git worktree add`, no `orca worktree create`, and no bot folder left registered as git kind.
- State file: `~/Library/Application Support/orca/profiles/<profile>/orca-data.json`, one per profile
  (`local-default` on this machine). Internal; read only as a cross-check.
- **Orca's own default launch arguments**, the "yolo" setting of PRD 6.5, live in that file under
  `settings.agentDefaultArgs`: a mapping of agent name to one string of extra arguments, e.g.
  `{"claude": "", "codex": "", "gemini": "", ...}`. Orca adds them to the agents it launches, relaunches
  and resumes itself, so they override what a session was started with. On this machine every entry is
  an empty string. **verified** (live, read on 2026-09-21)
  **A missing entry is not "no arguments".** In Orca's own code (`out/shared/tui-agent-launch-defaults.js`
  and `tui-agent-permissions.js`, 1.4.205) `resolveTuiAgentLaunchArgs` falls back to
  `DEFAULT_TUI_AGENT_ARGS` whenever the settings hold no string for that agent, and that default is
  `YOLO_TUI_AGENT_ARGS` — `--dangerously-skip-permissions` for `claude`, `--dangerously-bypass-approvals-and-sandbox`
  for `codex`, which are exactly the kit's own `dangerously-skip` flags. So a file with no entry for a
  harness means Orca will add the bypass. **verified** (read in the installed app)

### Terminal commands (verified from help)

- `orca terminal create [--worktree <sel>] [--title <t>] [--command <text>] [--focus]`.
  **`--command` with a harness fails for a workspace that was just created.** It answers
  `runtime_error: Timed out waiting for terminal handle after creation` and leaves a tab that never goes
  live and never appears in `terminal list`. Eight combinations, all eight failed: folder kind and git
  kind, an ordinary project path and one under /private/tmp, `claude` and `codex`, bare and with flags.
  The same call works in a workspace the user already has open in Orca. Non-harness commands
  (`echo hi`, `sleep 30`, `codex --version`, `sh -lc codex`) work in a just-created workspace too.
  So: create the tab plain and type the launch command in with `terminal send`; model, effort, approval
  and resume flags go in that text. **verified** (live)
  **Why it sometimes works is unknown.** The same call succeeded twice from another session, in
  workspaces just as newly made and just as unopened, one `repo add` earlier. Eight failures from one
  session, two successes from another, no variable found that separates them. The kit does not depend
  on it, and it is not worth more probing.
- There is no way to give a tab environment variables: `terminal create` takes only `--worktree`,
  `--title`, `--command` and `--focus`. A shell's own startup question therefore cannot be turned off
  per tab; it has to be answered in the tab. **verified** (from the command schema)
- `--command` and `terminal send` both type into the tab's **interactive shell**, so a shell that is
  busy with a question of its own swallows the first characters: with the owner's zsh asking
  `[oh-my-zsh] Would you like to update? [Y/n]`, `claude` arrived as `laude` and `exec codex` as
  `xec codex`. `tui-idle` cannot gate this: its answer for a shell says nothing about whether the
  shell is ready (next entry). So the kit types the launch line into a new tab without waiting, then asks whether a harness
  came up; a line the shell swallowed shows as no harness, and the caller answers the shell and opens
  the tab again (SETUP.md, section 5). **verified** (live)
- **A variable set on the launch line reaches the session's own shell tool, on both harnesses; a
  `PATH` entry does not.** The kit's launch line starts `OBK_CLI=<the running CLI> …`, and a Claude
  Code bot and a Codex bot each running `printenv OBK_CLI` wrote that path back exactly, a space in
  it included, and their mail sent with `"$OBK_CLI" message send` reached that CLI (#220). A `PATH`
  prefix on the same line is not enough: Codex's shell tool puts `/opt/homebrew/bin` back in front of
  it, so a Codex bot runs the machine's `obk` whatever the line said (measured by the architect for
  #220). A hook the harness runs inherits `PATH` from the harness's launch, on both harnesses. So the
  kit names itself by path in its hook and nudge, and by `OBK_CLI` in the rules a bot reads.
  **verified** (live, 2026-09-24, Claude Code 2.1.281, Codex 0.156.1)
- `orca terminal wait --for exit|tui-idle --timeout-ms <n>`. **`tui-idle` is about a TUI, not a shell.**
  All four answers seen live:
  - a tab running no TUI, sitting at a clean shell prompt: exit 1, `ok:false`,
    `error.code: "timeout"` — never satisfied, however long the timeout. So this is **not** a way to
    ask whether a shell is ready for typing; there is no such way.
    **Except after Codex:** a shell that Codex has quit back to answers `ok:true`, `satisfied:true`,
    and went on answering so for more than 45 s and after an `echo` was run in it. A shell that Claude
    Code quit back to answers `timeout`. **verified** (live, 2026-09-24, Orca 1.4.209, Codex 0.156.1,
    Claude Code 2.1.281, #232)
  - a TUI that Orca can see is blocked: `ok:true`, `wait.satisfied:false`, `status:"running"`, and
    `wait.blockedReason` says what it is — `"agent-interactive-prompt"` for Codex sitting on its
    folder-trust question.
  - a TUI waiting for work: `ok:true`, `wait.satisfied:true`.
  - **a TUI busy working: exit 1, `ok:false`, `error.code: "timeout"`**, the same answer as a tab with
    no TUI at all, until it goes idle. A Claude Code bot mid-turn (`✽ Architecting…`) answered a
    2-second wait that way, and `ok:true`, `satisfied:true` two seconds later once the turn was done.
    So `timeout` means "nothing went idle in time", not "no harness". `obk up` takes its second look
    for 2 seconds, so a session already working on its start prompt then is reported as not started
    (#232). **verified** (live, 2026-09-24, Orca 1.4.209, Claude Code 2.1.281; seen again for #232 on
    a Claude tab writing out a long answer). Codex busy on a `sleep 25` it ran answered `ok:true`,
    `satisfied:true` throughout, and so did a Claude Code and a Codex bot each busy on a `sleep 45`
    their start prompt gave them, so a busy harness can read as idle too (same day, Codex 0.156.1).
  **`blockedReason` does not catch everything.** Claude Code showing its folder-trust screen answers
  `satisfied:true` with no `blockedReason` at all, while Codex on the same kind of screen answers
  `satisfied:false` with one. So it is a useful hint and not a test: whether something on screen wants
  answering is settled by reading the screen, not by this field.
  Seen once since (2026-09-24, Orca 1.4.209, Codex 0.156.1, the #221 live check): `obk up` reported a
  Codex tab that was sitting on its trust question as up, with no `blockedReason`, so Codex's screen is
  not caught every time either.
  So **neither answer says whether a harness is in the tab**: `timeout` comes from a busy harness as
  well as from a shell, and `ok:true` from a shell Codex left as well as from a harness. This entry
  used to say that a `timeout` meant "no TUI". That was wrong, and it is how a busy session was told
  it was not up (#232). The kit asks the process table instead (the entry on the foreground process
  group, below). **verified** (live, 2026-09-24, Orca 1.4.209, both harnesses)
  **What that costs, proven the hard way.** A start prompt sent as a second `terminal send` into a fresh
  Claude tab that had answered `satisfied:true` landed on the folder-trust list and confirmed its
  default `No, exit`: the harness quit back to the shell. Nothing Orca offers tells that screen from a
  ready one — `terminal list` carried no agent identity for a tab then, and the `agentIdentity` it
  carries on 1.4.209 names the harness on either screen. So the kit types one line into
  a tab it opens and no more: the start prompt goes on that line as the harness's own prompt argument,
  and the harness holds it until the trust question and the update offer are answered. Both harnesses
  then run it by themselves. **verified** (live, Claude Code 2.1.278 and Codex 0.155.1)
- **`agentIdentity`** (`"claude"`/`"codex"`) is on a harness tab in `terminal list --json` and
  `terminal show --json` on 1.4.209, and is absent on a plain shell tab. Orca builds it from ranked
  evidence (`out/shared/pane-agent-evidence-sources.js` in the app bundle): a live hook, the
  foreground process, a launch Orca saw, a finished hook, a sleeping session, a sibling pane, the
  title. It is **late** and it can be **stale**:
  - late: it came 0.5–1 s after the launch line, and for a first-run Codex it was still missing at
    1 s, when the tab already answered `blockedReason: "agent-trust-workspace"`, and there at 6 s.
  - cleared: within 2 s of Claude Code's `/exit`, about 1 s after Claude Code's Ctrl-C twice, and
    within about 3 s of Codex's `/quit` after a turn.
  - stale: Codex started and quit with `/quit` before any turn left a tab at a zsh prompt whose
    `terminal list` still said `codex` more than 70 s later, while `terminal show` for the same tab said
    `claude`, left over from an earlier run in it. `orca worktree ps` still listed a `claude` agent
    `done` for that pane.
  So it names the harness that is or was in a tab, not one that is running now. **verified** (live,
  2026-09-24, Orca 1.4.209, Claude Code 2.1.281, Codex 0.156.1, #232)
- **The foreground process group of a tab's terminal says whether a program is running in it.**
  `orca diagnostics memory --json` lists every pane under `result.worktrees[].sessions[]` as
  `{ sessionId, paneKey, pid, cpu, memory }`; `sessionId` is the tab's `ptyId`, and `pid` is the
  pane's own process, `/usr/bin/login` on macOS, with the login shell (`-/bin/zsh`) as its child. The
  call took 0.15 s. `ps -o pid=,ppid=,tpgid=,comm= -p <pid>` gives the terminal's foreground group:
  the shell's own pid at a prompt, the harness's (`claude`, `codex`) while it runs, and the shell's
  again within 3 s of every quit above, the stale-identity one included. The harness leads its own
  group, and its `comm` is exactly `claude` or `codex` (native installs, started by the kit's launch
  line, which has no `exec`). A stale identity can sit over another program: Codex quit before any
  turn, then `less` run in the same tab, gave `agentIdentity: "codex"`, `less` in front and `tui-idle`
  `satisfied:true` for 20 s. So the kit takes a harness to be in a tab when the foreground is not its
  shell (a busy one included), and the mail nudge types only when the process in front is the one
  Orca names. When the pid or the group cannot be read it says it cannot tell and
  types nothing (ADR 0021). `diagnostics memory` is a diagnostics command and may change.
  **verified** (live, 2026-09-24, Orca 1.4.209, macOS 26.6.2, Claude Code 2.1.281, Codex 0.156.1, #232)
- `orca terminal send [--terminal <h>] [--text <t>] [--enter] [--interrupt] [--wait-submit <s>] [--retry-request <id>]` — `accepted:true` means input accepted, not that the agent read it; never resend on silence; use `--retry-request` for an idempotent retry.
  **A carriage return or a line feed inside `--text` does not submit early.** Sent with `--enter` into a running agent, a line with `\r` or `\n` in the middle arrives as **one** message with a line break where the character was, and is answered once: Claude Code's transcript shows one user turn holding both lines, and Codex's screen shows one prompt of two lines and one answer. So the mail nudge, which carries the sender's subject as typed, cannot be split into two prompts by a subject that has one in it. **verified** (live, 2026-09-23, Orca 1.4.207, Claude Code 2.1.280 with `--model haiku`, Codex 0.155.1; #176)
  **While Codex sits on its own update offer, Orca refuses a line with `--enter` as `agent_prompt_blocked`.** Seen three times in a row on 2026-09-23 (Codex 0.155.1 offering 0.156.0); answered `2` (Skip), the next line went through. **verified** (live)
  **A line into a tab with an agent in it can be gated, and the recovery can be refused too.** Seen live on 2026-09-21, in system test runs:
  `ok:false`, `error.code: "agent_prompt_blocked"`, with `error.data.orchestrationRequestId` and the message
  "Re-issue the exact command with `--retry-request <id> --wait-submit <seconds>`; do not retry it without
  that ID." The kit does exactly that, once, with a short wait. What sets it off is not known: it did not
  happen again in a probe of the same shapes — a short line, three long ones, and three sent while the agent
  was working — so treat it as a thing that happens rather than a thing you can bring about. It has since
  hit three runs out of four, always on a line typed into a freshly started agent tab by something other
  than the kit, and never on the kit's own nudge. **And the re-issue is not a cure**: one of those runs got
  `operation_unknown — Terminal prompt <id> may have reached its exact terminal incarnation before restart.
  It will not be sent again`, with the line demonstrably not on the tab's screen. So a typed line into an
  agent tab is best effort, whatever Orca's message says; anything that matters must survive it not
  arriving. Fleet mail does: it is in the mailbox either way. **verified** (live)
- `orca terminal read [--terminal <h>] [--cursor <n>] [--limit <n>] [--screen]`, `rename`, `show`,
  `split`. Use `--screen` to see what the tab renders; the default read returns emitted output with the
  escapes stripped, so a TUI comes back as stacked fragments. `--screen` is how an agent looks at a tab
  to decide whether something is waiting to be answered. **verified** (live)
- `orca terminal close --terminal <h> [--tab]` closes one. **Never use `orca terminal close --worktree <sel> --all`: it removes tabs, layouts and resume records.**
  With `--tab` it answers `{ close: { handle, tabId, closeMode: "tab", ptyKilled } }`, and **what was running in the tab is gone with it**: a tab whose shell was sitting on a `sleep` left neither the shell nor the sleep behind, though `ptyKilled` read `false`. So a tab the kit closes leaves no process behind to be found later. **verified** (live, 2026-09-21, Orca 1.4.205)
- `orca terminal list --worktree path:<p>` **fails with `selector_not_found`** for a path Orca has no project for; it does not answer an empty list. So anything that asks Orca what tabs a folder has looks in `project setups` first. **verified** (live)
- **A tab can be listed under another id while it is orphaned.** `terminal create` answers `terminal: { handle, tabId, paneKey: "<tabId>:<leafId>", ptyId, … }`, with `ptyId` of the form `<setupId>::<path>@@<8 hex>`. `terminal list` then gives that terminal its `tabId` with `orphaned: false`, until the pty is missing from the renderer's current pane graph. From then on it lists the same `handle` and `ptyId` with `tabId` and `leafId` both `"pty:<ptyId>"` and `orphaned: true`. This is Orca's `buildPtyTerminalSummary`: `orphaned = !Eea(pty, ptySurfaceTopology())`, `tabId = orphaned ? "pty:" + ptyId : pty.tabId`. A running harness advances the graph. Claude Code typed into a tab of a project the window has not loaded turned it orphaned within 2 s. A plain shell, with or without a title change, stayed `false` for 75 s. It clears again once the pane is in the graph (#185). While orphaned, the scoped listing still includes the terminal. **`terminal show --terminal <h>` answers with the real `tabId`**, still marked `orphaned: true`. `terminal close --terminal <h> --tab` works on it, answers with the real `tabId`, and leaves nothing running. So the tab id stays the key: the kit reads an orphaned entry's real id from `terminal show`. **verified** (live, 2026-09-23, Orca 1.4.207, Claude Code; #187, the `show` fact first found in review)
- **A close is answered before the listing agrees.** `terminal close` answers `ok` while `terminal list`
  still reports the tab, for a second or two on a busy machine — seen live when the slice 04 system
  tests were written, which is why they poll for the tab to go rather than list once. So anything that
  closes a tab and then lists must wait for the listing to catch up: a caller that believes the answer
  finds the tab it has just closed and takes it for one that is still live. **verified** (live)
- Worktree selectors: `id:<repo-id>::<path>`, `name:<displayName>`, `path:<path>`, `active`.

### What a fresh kit-made tab asks, and the usual answer (verified live unless said otherwise)

A tab the kit opens may be waiting on a question before the harness is running. The kit types nothing
into a tab that is not idle and reports the tab instead; the agent driving the setup answers. These are
what to do when the user has said nothing. When he asks for something else, do that — whatever it is.
Nothing in the kit's code, tests or skills stands in his way.

- The shell's own question. On this machine zsh asks `[oh-my-zsh] Would you like to update? [Y/n]`, and
  it swallows anything typed while it is up. The usual answer is `n`; the user updates his shell
  himself. It cannot be turned off per tab, since a tab cannot be given an environment of its own.
- A folder-trust question. Claude Code draws a list whose selection starts on **`No, exit`**, so it
  takes an arrow down and then return, not a bare return. Codex draws `1. Yes, continue` / `2. No, quit`
  (`Trust this folder?` with `1. Trust and continue` / `2. Quit` on 0.156.1, seen 2026-09-24) with the selection already on yes, and says plainly that trusting applies to the **repository root**,
  not the bot folder — for a bot that means the whole bots repo. Click yes either way. The harness then
  writes its own config, which is fine.
- A harness update offer. Codex shows `✨ Update available! … 1. Update now / 2. Skip / 3. Skip until
  next version`. Accept it.
- Codex's hooks review, because the kit's own hook is new to it: `Hooks need review … 1. Review hooks /
  2. Trust all and continue / 3. Continue without trusting`. Trust them, or the kit's hook never runs
  (section 3). The selection starts on `1`, so it takes an arrow down and then return.
- Claude Code may offer to learn the machine: `Teach auto mode about your environment?` with
  `1. Yes / 2. Not now / 3. Don't show again`. Answer **`2. Not now`**: it would write settings of the
  user's, and that is not the kit's to start. **verified** (live, 2.1.278)
- Anything else: type nothing and raise it with the user, naming the bot, the tab and what is on screen.

The kit's own code does not change user-level settings on its own initiative.

Codex started in a brand-new folder on this machine showed no trust question at all (the owner's global
config puts it in "YOLO mode"), only the update offer.

### Session resume inside Orca (verified)

Orca stores a resume record per pane key (`sleepingAgentSessionsByPaneKey`) and relaunches with `claude --resume <id>` / `codex resume <id>`. Closing a tab drops the record. Orca's Session History can find old transcripts but does not know which bot and session they belonged to. This is why the kit keeps its own book (ADR 0012).

### Orca's own agent hooks (verified)

Orca writes hooks into the user-level harness settings (`~/.claude/settings.json`, Codex hooks). They post to a local port using env vars set in each pane: `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID`, `ORCA_TERMINAL_HANDLE`, `ORCA_AGENT_HOOK_PORT`, `ORCA_AGENT_HOOK_TOKEN`. Those variables are inherited all the way down — a harness started in a tab has them, and so does a hook the harness runs — so `ORCA_TAB_ID` is how anything running in a tab knows which tab it is in. **verified** (live). Orca's own per-pane record (`providerSessionId` in `…/orca/agent-hooks/last-status.json`) was empty for kit-made tabs, so it is not a cross-check to lean on. `…/orca/agent-hooks/last-status.json` holds per pane: state, last hook event, provider session id, transcript path. Internal; a cross-check only. The kit's hooks live in the bot folder and must not touch these (ADR 0020).

### Mailbox

`orca orchestration send --subject <s> [--to <run:id|dispatch:id|legacy_handle>] [--from <handle|run:id>] [--body <b>] [--type status|handoff|question|…] [--priority normal|high|urgent] [--thread-id <id>] [--payload <json>]`.
`orca orchestration check [--terminal <h>] [--run <id>] [--wait --types … --timeout-ms <n>] [--peek|--all] [--ack <delivery_id>]` — FIFO, replayed until acked. Also `reply --id <id>`, `inbox`, `run-create --objective <t>`, `run-use --id <run>`, `run-current`. **verified** (from help)

Proved live on 2026-09-21 (Orca 1.4.205), in throwaway workspaces since removed:

- **A tab's terminal handle is not an address to keep.** A send to a live handle works, from a sender in no Run, and `check --terminal <h>` reads it — but Orca warns `legacy_terminal_recipient`: "a live terminal-only mailbox. Delivery is not durable after that terminal closes." A send to a handle with no live pane is refused outright: "has no live pane or durable Run/Dispatch mailbox." Handles are issued per tab, so mail sent to the handle a session had yesterday has nobody to reach.
- **A Run is the mailbox that lasts.** `run-create` answers a `run_<id>`; `send --to run:<id>` goes through with no warning, and `--from run:<id>` is taken, so a reply has an address to go back to. A Run cannot be removed: there is no `run-delete`, and `orchestration reset --messages` would empty the whole machine's mailbox, which the kit never runs.
- **A Run is bound to one coordinator terminal, and Orca's notice goes there and nowhere else.** When mail arrives, Orca writes `You have 1 orchestration message. Run orca orchestration check --run <id>` into the Run's coordinator tab, not into the tab of whoever the mail is for. The binding rules, proved live on 2026-09-24 (Orca 1.4.209) in throwaway projects:
  - `run-create --objective <t> [--from <handle>]` binds `--from` when it is given, and otherwise the caller's own terminal (`ORCA_TERMINAL_HANDLE`). With neither, Orca picks the one active terminal it can find and refuses when there is more than one: `no_active_sender_terminal`. A read-only probe run outside any Orca tab resolved to a terminal that was not the prober's, so the kit never leaves the choice to Orca.
  - `run-use --id <run> [--from <handle>]` rebinds by the same rule.
  - **One terminal holds one Run.** Binding a terminal to a Run empties the coordinator of the Run it held before (`coordinator_handle: null`). So a Run made without `--from` in a session's tab takes that session's own notices away.
  - `--from` may name a tab other than the caller's. That was accepted from a kit-made Claude tab and from a shell with no `ORCA_*` variables at all, and the caller's own binding was left as it was. Orca's `consumer_fenced` guard only compares `--from` with an attested agent launch, and needs `ORCA_AGENT_LAUNCH_TOKEN` to attest one (read in the 1.4.209 bundle). No tab the kit makes has that variable.
  - A `--from` naming a handle with no live pane is refused: `stable_pane_required`.
  - Closing a tab does not clear its binding: the Run keeps the dead handle as `coordinator_handle`. So when the kit opens a new tab for a session that already has a Run (a restart, or a closed tab brought back by `obk up`), it binds that Run to the new tab with `run-use --from`. Seen live: the same Run, generation 1 on the closed tab, generation 2 on the new one.
  - `run-show --id <run>` answers `{ run: { id, objective, coordinator_handle, consumer_generation, legacy, created_at, updated_at } }`.

  The kit used to make each session's Run from wherever `obk up` ran. So the Run was bound to that tab, usually Bot Father's, and the tab got lines about other sessions' mail (seen 2026-09-21 and in issue #228). Every new Run also emptied the Run that tab held before. The kit now makes a session's Run with `--from` the session's own tab, so it is bound there from the moment it exists. Seen live after the change: a session brought up from another session's tab got a Run bound to its own tab, and the tab that ran `obk up` kept its own Run and coordinated no other.

  Orca writes the notice only into a pane the window has loaded, and only once the agent there has reported idle (read in the bundle: delivery walks the window's loaded panes). A tab the kit opened and nobody has looked at is listed as orphaned and gets no notice, even when it is the coordinator. Seen live on 2026-09-24: four kit-made Claude tabs, each coordinating its own Run and each with unread mail, some after checking in their own tab, showed no line. So Orca's notice is not a delivery mechanism the kit can lean on; the kit's own nudge is. **verified** (live, 1.4.209)
- **Reading a Run is fenced to one reader.** `check --run <id>` reads as the caller's terminal, or as `--terminal <handle>`. A reader bound to another Run is refused with `consumer_fenced: This coordinator terminal is bound to <other run>, not <run>`. `run-use --id <run>` binds the reader, and the read then works. `check --run <id> --terminal <h>` (also with `--peek` or `--ack`) reads and acknowledges as `<h>`, from another tab or from a shell with no Orca at all. So `obk message check` binds and reads as the session's own tab when it is live, wherever it was typed. **verified** (live, 2026-09-24, 1.4.209)
- **A read binds nothing; `run-use` is what binds.** `check --run <id> --terminal <h>` is judged on whether `<h>` is the Run's coordinator, and a closed tab stays its Run's coordinator. So reading as the handle `run-show` names works after that tab is closed: peek, read and `--ack` all went through, and `run-show` still named the closed handle with the same `consumer_generation`. A live tab that holds no Run is refused `consumer_fenced: This coordinator terminal is no longer bound to Run <id>`, a handle Orca never issued `stable_pane_required`, and once `run-use --from <new tab>` rebinds the Run, the old closed handle is fenced out the same way. So `obk message check` for a session with no live tab reads as the Run's own coordinator and calls no `run-use`: the old way, binding the caller's terminal first, handed the session's Run to whoever read it and left the reader's own Run with no coordinator (#249). A Run with no coordinator has no reader to read as, and its mail waits until the session's tab is up and bound again. Seen through the kit in a throwaway fleet: a paused session's mail read with `--peek` and without, from a shell tab holding no Run and from another session's tab, left all three Runs with the same coordinator and generation, and `obk unpause` bound the Run to the new tab. Orca's own notice for the next message showed in no tab, the new one included: the window had not loaded it (orphaned), as above. Not seen: whether a closed handle still reads after Orca itself restarts. **verified** (live, 2026-09-24, 1.4.209)
- **`reply --id` is filed under the replier's Run, not the recipient's**, so the recipient's `check --run` does not return it. A reply the recipient can actually read is an ordinary `send` back to their `run:<id>`, with `--thread-id`.
- **No wake-up reaches a harness that has not read that mailbox.** A message addressed to the tab of a running Claude session left that session's screen untouched. But once a terminal is bound to a Run — which `run-use` does, which `obk up` does for the session's own tab when it makes the Run, and which `obk message check` does again for a session whose tab is live — and the window has loaded that tab, Orca writes a line of its own into that tab for the next message: `You have 1 orchestration message. Run orca orchestration check --run run_…`. Seen live in a kit-made Claude tab. **On this machine that advice fails**: it says bare `orca`, which is the root-only symlink at `/usr/local/bin/orca`, and the session answered `Unable to determine Orca.app path from symlink`. So the kit types its own line naming `obk message check`, and the rules tell a bot to use that one. The mailbox is pull-only in every case: something has to run `check`. What does carry, and is what PRD 6.9 means by "queued, not interrupting", is one line typed into the tab: a busy Claude Code tab takes it as a queued message and finishes what it was doing first, and Codex takes it as the next turn. **verified** (live, 2.1.278 and 0.155.1)
- **What a message carries, and what a delivery is.** A message is `{ id, run_id, delivery_contract, from_handle, to_handle, subject, body, type, priority, thread_id, payload, created_at, delivered_at }`; the sender is `from_handle`, as `run:<id>` when a Run sent it, and `thread_id` is null unless it answers something. A plain `check --run <id>` hands over the oldest batch that has not been acknowledged and names it: `{ runId, deliveryId, messages, count, acknowledged, … }`. `check --run <id> --ack <delivery_id>` acknowledges that batch and checks in the same call, answering `acknowledged: "<delivery_id>"` with the next batch beside it — an empty one when there is no more mail, `deliveryId: null` and `count: 0`. `--peek` answers `{ runId, messages, count, acknowledged }` with no `deliveryId` and changes nothing. **verified** (live)
- **Size.** A 200 KB body is stored and read back whole. A body near 1 MB never reaches Orca at all: it travels as a command-line argument and dies on `ARG_MAX`. So the kit's own limit sits well below that, and a long message goes as a file the message names (PRD 6.9).
- Group addresses exist (`@all`, `@idle`, `@claude`, `@codex`) and reach the live Dispatches of the sender's own Run; the kit does not use broadcast groups. Store: `…/orca/orchestration.db` (SQLite), readable for grooming.
- **Listing Runs, for anything that wants to know what it left behind.** `orca orchestration run-list --json` answers the usual envelope, `{ id, ok, result: { runs, nextCursor }, _meta }`. Each run carries `id`, `objective`, `coordinator_handle`, `consumer_generation`, `legacy`, `created_at`, `updated_at`. **Newest first.** `--limit` is capped at a hundred: `--limit 101` is refused outright with `invalid_argument: Too big: expected number to be <=100`, rather than clamped. `nextCursor` is a base64 `{createdAt, id}` and `--cursor <it>` returns the next page, which is how anything counting Runs on a machine that has many of them has to read. **verified** (live, 2026-09-21, Orca 1.4.205, on a machine holding a hundred of them)
- Two Runs made while proving the above are still listed, "obk probe run for beta" and "obk size probe". Orca offers no way to delete a Run, they belong to nothing, and they can be ignored. The binding checks of 2026-09-24 left "obk probe 228 A", "B", "C" and "S", and the Runs of a throwaway bots folder named `obk bot-father/daily` and `obk p228/…`. The checks for #249 left "obk probe 249 S" and "obk probe 249 R", and a throwaway fleet's `obk bot-father/daily` and `obk coder/daily`.

### Automations (verified from help)

`orca automations create --name <n> --prompt <p> --provider claude|codex --trigger hourly|daily|weekdays|weekly|<cron>|<rrule> [--time] [--timezone] [--precheck <cmd>] [--missed-run-grace-minutes <n>] [--workspace <sel> --workspace-mode existing] [--reuse-session]`; also `list|show|edit|remove|run|runs`.
`--reuse-session` sends later runs to "the previous live automation session when it is still available". It can only reuse a session the automation itself started; it cannot target a tab the kit created. **unverified:** that it keeps one long conversation; that missed runs fire after a reboot beyond the grace window.
- **Orca does not deduplicate an automation by name.** Creating the same `--name` twice against the same workspace made two automations, both listed, both schedulable. So anything that wants one automation rather than a growing pile has to look for its own before creating, and edit that instead. **verified** (2026-09-21, 1.4.205)
- `--workspace path:<dir>` resolves to the same project and setup ids the kit's book records for that bot, and the created automation carries them as `runContext.projectId` / `projectHostSetupId` beside `runContext.path`. `automations list --json` reports `enabled` per automation, so whether grooming is on is readable without keeping a copy of the fact. `--disabled` at creation makes one that exists and does not run, and `reuse-session` is off unless asked for. `automations edit --id <id> --enabled|--disabled` toggles one; changing the time needs `--trigger` passed with `--time`, or the edit is refused with `--time requires --trigger or --schedule`. **verified** (2026-09-21, 1.4.205)

## 2. Claude Code

- Launch flags (**verified** from `claude --help`): `-n/--name <name>`, `--model <m>`, `--effort low|medium|high|xhigh|max`, `--permission-mode acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`, `--dangerously-skip-permissions`, `--resume <id>`, `--add-dir <dir>`. There is no context-window flag; the context window is a suffix on the model name, `--model 'sonnet[1m]'`, and the quotes are needed because `[1m]` is a glob to zsh. **verified** (live on 2.1.278: `claude -p 'reply with the single word ok' --model 'sonnet[1m]'` answered, and the same model in an Orca tab came up as `Sonnet 5 with high effort`).
- A prompt given as a positional argument (`claude [options] -- '<prompt>'`) starts an interactive session and is run as its first message, after the folder-trust question is answered. `--` is needed: a prompt that starts with a dash is otherwise read as an option and the session never starts. **verified** (live, and against 2.1.278's parser)
- The suffix really reaches the session: with `--model 'sonnet[1m]'`, `/status` in the tab reports `Model: sonnet[1m] (claude-sonnet-5[1m])`. **verified** (live)
- Approval levels: `auto` = `--permission-mode auto`; `ask` = `--permission-mode manual`; `dangerously-skip` = `--dangerously-skip-permissions`.
- `AGENTS.md` is read directly from v2.1.277, but only when no `CLAUDE.md` / `CLAUDE.local.md` exists in the working directory or above it, and not on Bedrock or with telemetry disabled (docs: code.claude.com/docs/en/memory). The kit symlinks `CLAUDE.md` → `AGENTS.md` in each bot folder, which always works. **verified**
- Skills: `<project>/.claude/skills/<name>/SKILL.md`, `~/.claude/skills`. Symlinked skill folders are followed. Skill directories are watched; add, edit, remove is picked up in a running session. The command comes from the folder name. A user skill named like a built-in (`debug`, `design`, `review`, `simplify`, `run`, `verify`, `loop`) replaces the built-in. **verified** (docs)
- **`/reload-skills` is Claude Code's own reload, and a busy tab queues it as a command.** It is described as "Pick up skills added or changed on disk during this session", and the 2.1.271 changelog fixes it, so it is at least that old. Seen live on 2026-09-24 (2.1.281, `--model haiku`, Orca 1.4.209). The session ran in an Orca tab, in a throwaway folder whose `.claude/skills` was there from the start, and each line went in with `terminal send --enter`:
  - Idle, a skill just linked in: `Reloaded skills: 56 skills available (no changes)`, and the Skill tool loaded the skill (`Successfully loaded skill`). After the link was taken away, a reload answered `55 … (no changes)` and the Skill tool answered `Unknown skill: zq-alpha`. The watcher had already done the work, as section 3 says for a directory there at start. Once, a reload typed at the same moment as the link answered `(1 added)`, so the reload can beat the watcher. It never did harm.
  - Busy, in the middle of a 50-second foreground command (`tui-idle` answered `timeout`): Orca accepted the line, and Claude Code showed it as a queued message (`Press up to edit queued messages`). When the turn ended it ran as a local command: the transcript holds `<command-name>/reload-skills</command-name>` and a `local_command` line with its stdout, and no model turn follows. So nothing reached the model as text. The skill linked in during that turn had been picked up mid-turn by the watcher, and it loaded afterwards.
  - An edit to a linked skill's `SKILL.md` was read by a running session the next time it loaded the skill, with no reload.
  - Earlier the same day, the architect ran `claude -p` kept open across turns. A `.claude/skills` made after the session started was refused (`Unknown skill`) until `/reload-skills` answered `(1 added)`, and then the skill loaded. So the reload also covers the one case the watcher misses (section 3).
  **verified** (live)
- Hooks: project settings in `<project>/.claude/settings.json`, read out of the folder the session starts in. A hook there runs with nothing in user-level settings, and needs no approval of its own: once the folder is trusted, it runs. The hook input is JSON on stdin — `{ session_id, transcript_path, cwd, hook_event_name, source }` — and `source` is `startup`, `resume`, `clear` or `compact`. **verified** (live, 2.1.278): `/clear` gives `source: "clear"` with a **new** `session_id`; `--resume <id>` gives `source: "resume"` with the **same** id.
- A SessionStart hook can put text into the session: print `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` on stdout and the session has it. **verified** (live: a session answered from text only the hook gave it, including straight after `/clear`).
- **The registry of live sessions** is `~/.claude/sessions/<pid>.json`: `{ pid, sessionId, cwd, startedAt, procStart, status, name, messagingSocketPath, … }`. It maps a **live process** to the conversation it is having **now**, and holds nothing about a conversation that process had before — so it can say which conversation a running harness is in, and never which one it was in earlier. **verified** (read on this machine, 2.1.278)
- **A hook runs as a child of the harness process.** Measured live (2.1.278): the hook command's process has `claude` as its parent, and `claude`'s parent is the shell the launch line ran in. So the process tree, not an environment variable, is what says which conversation a hook belongs to — everything a session starts inherits the session's environment, `ORCA_TAB_ID` included. **verified** (live)
- Cross-session messaging (docs: code.claude.com/docs/en/cross-session-messaging, min 2.1.224): addressed by session name; works across folders; a busy receiver reads between tool calls; an idle receiver starts a turn. Two classes: bypassing (`bypassPermissions`) and prompting (everything else). Same class delivers without asking; a bypassing sender to a prompting receiver is held (dialog expires after 5 min). Sender gets a delivery notice (held, delivered, denied, expired, refused). Rate limits and duplicate suppression are built in. Registry: `~/.claude/sessions/<pid>.json`, where the entry carries the name beside the session id. **verified** (docs)
- **The name is an address, and it survives a resume.** Proved live on 2026-09-21 (2.1.278, in Orca tabs): a session launched `claude --permission-mode auto -n obk-nameprobe` was addressed by that name from another session, woke while idle and answered. Its tab was then closed and it was brought up in a new tab with `--resume <id>` **and no `-n`**: the registry still held the name, the conversation came back, and a message sent to the name reached it and was answered from what it had been told before the close. The kit passes `-n` on every launch anyway, so the name is re-applied whatever a future version does. **verified** (live)
- Subagents: a subagent starts with a fresh context; a fork inherits the conversation. Test authors and reviewers must be fresh subagents. **verified** (docs)
- Transcripts: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, where the slug is the working directory with every character that is not a letter or a digit turned into `-` (checked against real folders on this machine). One folder per working directory is how the kit asks Claude Code what conversations a bot home has had. Usage per API call in `assistant.message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); dedupe by `requestId` + `message.id`, and **keep the last of a repeated pair, not the first**: the same request and message id can be written twice with the usage still rising, seen live with `output_tokens` going from 16 to 301 between `09:29:21.187Z` and `09:29:21.936Z`. 4,736 repeated pairs in 137 transcripts carried identical usage and one did not, so keeping the first looks correct for a long time and then quietly undercounts. Model in `message.model`; effort in `effort`; each line carries its own `timestamp`, so usage can be counted from a moment rather than from a whole conversation. `/clear` starts a new session file. **`input_tokens` excludes the cache reads**: a real line reads `input_tokens: 2` beside `cache_read_input_tokens: 13460`. Compaction marker is a line with `type: "system"` and `subtype: "compact_boundary"`, carrying `compactMetadata` with `trigger`, `preTokens`, `postTokens` and `cumulativeDroppedTokens`. **verified** (2026-09-21, 2.1.278: 131 transcripts read, 2 genuine markers; 15 files held the string and 13 of those were only sessions discussing it, so match the two fields and not the text).
- **What a session really runs with, in its transcript.** The model is `message.model` on `assistant` lines, the effort is `effort` on the same lines, and the approval is `permissionMode`, on `user` lines and on lines of their own, `{"type":"permission-mode","permissionMode":"auto","sessionId":…}`, which carry no timestamp. Seen live on 2026-09-24 (2.1.282, `claude -p` in a throwaway folder): `--permission-mode auto` records `auto` and `--permission-mode manual`, the kit's `ask`, records `default`. `--model 'sonnet[1m]'` records `claude-sonnet-5`, with nothing that shows the context window, so a transcript cannot say which window a session runs with. A `haiku` session given `--effort low` records no `effort` at all. **verified** (live). That `--dangerously-skip-permissions` records `bypassPermissions` is **unverified**: the value is on this machine's transcripts, and the flag's help says it bypasses every permission check, but no run tied the two (a throwaway run with the flag was refused by the session's auto-mode classifier, 2026-09-24).
- **A `/clear` reads the instructions again.** A transcript carries an `attachment` of type `instructions` holding the instruction files a conversation loaded. On kit-dev on 2026-09-24 (2.1.281), developer-2's conversation `2336e09a…` began at 03:18Z, and its `instructions` attachments (03:18Z and 03:37Z) lack three passages that reached `AGENTS.md` between 04:00Z and 04:31Z. The book ends it by `clear` at 05:06:24Z, and the conversation that the clear began, `c009a7c2…`, carries all three. The book saying `clear` rather than a restart is what shows the process ran on. So the kit notes the rules a Claude session read when its hook hears a clear, as it does when it starts one. **verified** (read from the harness's own records by the architect and checked again for #271)
- **A start prompt on the launch line is in the transcript as the user's turn, word for word, and not before the folder is trusted.** It is a `type: "user"` line whose `message.content` is the prompt as the kit gave it. Seen live on 2026-09-25 (2.1.282, Orca 1.4.209, a throwaway bots folder): a tab held on the folder-trust list had no id in the book and no transcript; three seconds after the list was answered, the conversation the hook named held the prompt. In a folder already trusted, the hook's id and that line were both there 4.4 to 7.1 seconds after the launch line was typed, about as `up`'s second look ends. **verified** (live; #274)
- **A resume of an id the harness never wrote down fails.** A session paused before its first turn had an id in the book from its hook, and `claude --resume <id>` answered "No conversation found" (developer-1, 2026-09-24, 2.1.281, #295). **verified** (live, once). So the kit resumes an id only when the harness has a record of it, and asks that of the file name (`<id>.jsonl`, or a Codex rollout ending `-<id>.jsonl`). And such a session has no file at all: on 2026-09-25 (2.1.282, a throwaway folder in a trusted one) a session left 15 seconds with no turn had its SessionStart hook report `source: "startup"` with an id and a `transcript_path`, and neither that file nor its project folder existed after it was ended. **verified** (live). What `codex resume <id>` does with an id that has no rollout is **unverified**.

- **Auto memory, and how one bot gets its own.** Claude Code keeps what it learns in a memory folder with a `MEMORY.md` index and one file per memory; the first 200 lines or 25 KB of the index, whichever comes first, load at the start of every conversation, and Claude is told to shorten the index when it nears the limit, whatever is past it being dropped on the next load. Memory files are kept out of the transcript clean-up. **verified** (docs, code.claude.com/docs/en/memory). The docs describe no background consolidation.
  Measured live on 2026-09-23 (2.1.280, `claude -p` with `--model haiku` in throwaway projects, each asked to save one codeword to its memory):
  - **The default folder is the git repository's, not the working folder's.** Started in a subfolder of a repo, the memory landed under `~/.claude/projects/<slug of the repo root>/memory/`, and nothing under the subfolder's slug. So every bot in one bots repo shares one memory unless each is given its own. The docs say the same: "all worktrees and subdirectories within the same repo share one auto memory directory".
  - **A project's `autoMemoryEnabled: true` does not beat `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.** This machine turns memory off with that variable in the `env` block of the user's `~/.claude/settings.json`; with only `autoMemoryEnabled: true` in the project's `.claude/settings.json` the session said it had saved and nothing was written. With the project's settings also carrying `env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" }`, it was written.
  - **`autoMemoryDirectory` in a project's settings puts that project's memory where it names.** The docs' contract (memory page, "Storage location"): read from any settings scope, project included; the value must be an absolute path or start with `~/`; in a project's `.claude/settings.json` it is honoured under the same workspace-trust rule as hooks there, so only once the folder is trusted; and while `permissions.blockReadsOutsideWorkingDirectories` is on, no memory is loaded from or saved to a directory a repository-supplied settings file chooses. Live: with `autoMemoryEnabled: true`, the variable set to `"0"` and `autoMemoryDirectory` naming a folder of its own, the memory went to that folder and nowhere else, and a new session in the same project, asked for the codeword, answered it. So one bot gets a memory of its own with those three keys in its own `.claude/settings.json`, in a trusted bot folder.
  **verified** (live)

## 3. Codex CLI

- Launch flags (**verified** from `codex --help` on 0.155.1): `--approve-for-me` (automatic review, workspace-write sandbox), `-a/--ask-for-approval on-request|never`, `-s/--sandbox read-only|workspace-write|danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd <dir>`, `--add-dir <dir>`, `-c key=value`, `codex resume <id>`.
- `-c model_reasoning_effort=<effort>` and `-c model_context_window=<n>` are taken as written, with no quotes of their own: a value that is not TOML is used as a raw string. **verified** (live on 0.155.1: `codex exec --skip-git-repo-check --strict-config -c model_context_window=200000 -c model_reasoning_effort=low` ran, and the header printed `reasoning effort: low`; `--strict-config` would have refused a key it did not know).
- A prompt given as a positional argument (`codex [options] -- '<prompt>'`) is run as the session's first message, after the trust question is answered. `--` is needed: `codex` exits 2 with `unexpected argument` on a prompt that starts with a dash. **verified** (live, and against 0.155.1's parser)
- `-c model_context_window=<n>` really reaches the session: the rollout's `token_count.info.model_context_window` follows it, at 95% of the number given — 123456 came back as 117283, 200000 as 190000, and a session with no override as 258400, which is 95% of gpt-6-astra's own 272000. A value that is not a whole number is refused by Codex itself, at startup: `invalid type: string "1m", expected i64`. **verified** (live, 0.155.1)
- Approval levels: `auto` = `--approve-for-me`; `ask` = `-a on-request`; `dangerously-skip` = `--dangerously-bypass-approvals-and-sandbox`. In `auto` the sandbox limits writes to the launch folder plus `--add-dir`; network and outside commands (`orca`, `gh`, `git fetch`) go through the auto reviewer.
- **The Orca CLI does not reach Orca from inside a Codex session at the kit's default approval level, and one Codex setting changes that.** Run through the kit on 2026-09-21 (Codex 0.155.1, Orca 1.4.205), the bot writing down what it got. Plain `--approve-for-me`: `orca status --json` runs and exits 0 but answers `"app": {"running": false, "pid": null}` and `"runtime": {"state": "stale_bootstrap", "reachable": false, "connectionState": "disconnected"}`, and `orca orchestration check --terminal $ORCA_TERMINAL_HANDLE --peek --json` is refused with `runtime_unavailable: Could not connect to the running Orca app` (exit 1). The same bot at the same approval level with `-c sandbox_workspace_write.network_access=true` answers `"app": {"running": true, "pid": 15485}`, `"runtime": {"state": "ready", "reachable": true}`, and the mailbox check answers `ok: true` (exit 0). So the calls the kit makes are refused without that switch and succeed with it, and the kit sets it for Codex sessions. **verified** (live)
  **It is the sandbox that decides, not the approval level.** Run on 2026-09-23 (Codex 0.155.1, Orca 1.4.207) with `codex exec` in throwaway folders, each asked to run `orca status --json`: the `workspace-write` sandbox with the switch reached Orca (`reachable: true`), the same sandbox without it did not (`false`), and `--dangerously-bypass-approvals-and-sandbox` with the switch reached it too, so the switch is accepted and harmless where there is no sandbox. The approval policy only decides who says yes to a command. So the switch goes on every Codex session, as ADR 0015 says (#176). At `ask` the kit passes only `-a on-request`, so the sandbox is whatever the user's own Codex config says: `danger-full-access` on this machine, `workspace-write` by Codex's own default. **verified** (live)
  **Codex's folder trust in a subfolder of a git repo is given to the repo root**: its question says "Trusting will apply to the repository root". A bot folder is always inside the bots repo, so one trust answer covers every bot folder on that machine. **verified** (live, 2026-09-23, Codex 0.155.1)
- **A Codex session at the kit's default level cannot start a Codex of its own.** Inside `--approve-for-me` (with the network switch above), `codex exec --skip-git-repo-check '…'` exits 1 at once: `WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)` then `Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)`. No rollout is written. At `--dangerously-bypass-approvals-and-sandbox` the child runs and is on record. So a Codex child that takes over the book's conversation needs a session outside the sandbox. The system test for it runs its Codex bot at that level (#163). **verified** (live, 2026-09-23, Codex 0.155.1)
  **What those runs do not establish**, said here because the first version of this note claimed more than they show (review of PR #132). They do not establish *why*: the `task_name_for_pid` line the CLI prints is in the **successful** run too, so it is not the cause of the failure, whatever it is. And they do not exercise Codex's own approval or escalation path: the command exits 0 carrying JSON that says the runtime is not there, so there is nothing for Codex to escalate, and what a Codex session would do with a command it did consider blocked is untested. The finding is about the answer the kit's own calls get, not about the whole of what auto mode can be made to do.
- The owner's global `~/.codex/config.toml` sets `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`. Pass explicit flags per session so this does not leak into bots.
- Instructions: `AGENTS.md` from the project root down to the working directory; discovery stops at a git root, which is why sessions start at the bot home. 32 KiB cap. **verified** (docs)
- **Memories are the user's, not a project's.** Codex keeps them in `~/.codex/memories/` (`MEMORY.md`, `memory_summary.md`, `raw_memories.md`, `rollout_summaries/`), written from past sessions and consolidated by Codex itself. `codex features list` reports `memories  stable  false` on 0.155.1, and this machine also sets `[memories] generate_memories = false` and `use_memories = false`. There is no folder per project, so a Codex bot cannot have a memory of its own: turning memories on for its sessions (`-c features.memories=true` and the `[memories]` keys, as extra arguments) lets it read and add to the one store every Codex session of the user shares. **verified** (on disk and from `codex features list`, 2026-09-23, 0.155.1); how Codex consolidates is its own and not observed here.
- Skills: `.agents/skills` in the cwd and parents up to the repo root; `$HOME/.agents/skills`. Symlinks are followed. "Codex detects skill changes automatically. If an update doesn't appear, restart Codex." User-only invocation needs `allow_implicit_invocation: false` in the skill's `agents/openai.yaml`. **verified** (docs)
- **A skill added while a session runs: Claude Code needs the skills directory to have existed when the session started; Codex picks up a directory made later, at least once.** Checked live on 2026-09-22 (Claude Code 2.1.280, Codex 0.155.1) for issue #157, adding a skill through `obk skills add` and `skills build` to sessions already running.

  **Claude Code, verified.** In a `.claude/skills` that was there at start, the Skill tool loaded the new skill (`Successfully loaded skill`). Where the directory was made after the session started, the Skill tool refused it: `Unknown skill: <name>`. That refusal comes from Claude Code's own skill registry, not from the model, so it is the harness saying it never registered the skill. So "skill directories are watched" (section 2) holds only for a directory that existed when the session began. **verified** (live)

  **Codex, not the same, and not fully settled.** Codex's own rollout is the evidence here, not what the model answered. A bot started with no `.agents/skills` was given a skill mid-session. At the start of the next turn the rollout carries a fresh `<skills_instructions>` catalog that lists the new directory and the skill, and the model loaded it (`cx-without-probe`, 23:34:23Z). The reviewer of #157 saw the same thing independently on unchanged `main` (`cold-codex-probe`, a catalog update at 01:38:36Z). So Codex does register a skills directory created after the session started, and "Codex needs the directory at start" is **not** true. **verified** (live, twice)
  One thing did not follow the same way, once. A *second* skill added to that same late-made directory got no catalog update before the next question, and the model said it did not know. With the directory present from the start, a later second skill was registered and chosen from its description. That is one observation each way: enough to suspect Codex rescans a late-made root once and does not watch it afterwards, which would fit its docs ("if an update doesn't appear, restart Codex"), and not enough to state it. **unverified**

  What the kit does about it: every bot has both directories from the start (#157). That is what Claude Code needs, and for Codex it is at worst harmless and plausibly what keeps a second skill visible.
- **With `.agents/skills` there from the start, Codex takes a skills change at the start of its next turn, resumed or not, and not in the middle of a turn.** Codex has no reload command: `/skills` only lists skills and turns them on and off. Seen live on 2026-09-24 (Codex 0.156.1, Orca 1.4.209), with the rollout as the evidence:
  - A fresh session: after one turn, a skill was linked in. The next turn's rollout carries a new `<skills_instructions>` catalog that lists it.
  - The same conversation after `/quit` and `codex resume <id>`: one skill linked in and another taken away between turns. The next turn's catalog lists the new one and not the old one, and asked to use the new skill, the session read its `SKILL.md` and followed it.
  - **The model's own account of its catalog is not evidence.** Asked for its `zq-` skills in that same turn, the resumed session answered `NONE` while the catalog it had just been given listed one.
  - An edit to a linked skill's body was read at the next use, since the model reads `SKILL.md` from disk. The edited description did not reach the catalog: no new catalog came at the next turn, and the old description stayed. That is one sample.
  - The report behind #231, read afterwards from the reviewer's own rollout (resumed, `.agents/skills` there from the start): the catalog lacked `obk-bot-building` until 03:45:23Z and had it from then on. The answer "absent from this session's catalog" came during a long turn that began before the link was made. At the next turn the model said the skill was "now in this session's skill catalog". So that session was not a miss. The skill arrived at the start of the next turn.
  So the kit types nothing into a Codex tab when skills change. It says the change arrives at the start of the next turn, that a restart makes a skill appear if it is still missing then (Codex's own docs), and that meanwhile the session can read the skill's `SKILL.md` by its path. **verified** (live)

- Hooks: `~/.codex/hooks.json`, **and `<project>/.codex/hooks.json` in the folder the session starts in** — same JSON shape as Claude Code's `hooks` block, same events, same payload on stdin (`{ session_id, transcript_path, cwd, hook_event_name, source, model, permission_mode }`). A SessionStart hook can put text into the session the same way, with `additionalContext`. **verified** (live, 0.155.1).
- **While the hooks review is on screen, the conversation has not started.** Measured live (0.155.1): a tab left on `Hooks need review` for four minutes had no rollout in `~/.codex/sessions` for its folder at all — Codex does not begin the conversation behind that screen. So there is no "conversation running while the hooks file is untrusted" to be had by leaving the screen alone; the third choice, `3. Continue without trusting (hooks won't run)`, is what gives one: the conversation runs and no hook fires. On the numbered screen `2` trusts every hook and continues, `1` opens the review list — Orca's own hook sits there beside the kit's — and `esc` backs out of it. `t` does nothing on the numbered screen; it is the review list that answers to it. **verified** (live)
- A project hooks file must be **trusted once**. The TUI shows `Hooks need review … 1. Review hooks / 2. Trust all and continue / 3. Continue without trusting`; `t` on the review screen trusts all. Until then the hook does not run and nothing else says so. Orca has reported that screen as `blockedReason: "agent-hooks-review-prompt"`, but on Orca 1.4.209 it does not: see the next line. Trust is recorded per hook entry in `~/.codex/config.toml` under `[hooks.state."<file>:<event>:<n>:<m>"]` as a hash, so **changing an entry asks again** while an unrelated change to the file does not. `--dangerously-bypass-hook-trust` skips it; the kit does not use it. **verified** (live)
- **Orca does not flag either Codex first-run screen on 1.4.209.** Measured live (2026-09-24, Orca 1.4.209, codex-cli 0.156.1, #288): a tab the kit opened stopped on `Trust this folder?`, and after that was answered, on `Hooks need review`. On each screen `terminal wait --for tui-idle` answered `ok:true`, `satisfied:true` with no `blockedReason`, three times in a row, and `agentIdentity` was null. `obk up` reported both tabs as come up. The rendered screen (`terminal read --screen`) is the only thing that shows either question. So `up`, `restart` and `unpause` do not say a tab came up when Orca names no reason; they say the kit cannot see whether a screen is waiting, and point the caller at the tab. **verified** (live)
- **A hook runs as a child of the harness process here too.** Measured live (0.155.1): the hook command's process has `codex` as its parent, and `codex`'s parent is the shell the launch line ran in. A `codex exec` the session starts is a harness of its own, further down that chain, and it fires the same hook with its own conversation id — which is how a child's conversation can be mistaken for the session's. **verified** (live)
- **Trusting a hooks file does not replay what it missed.** A conversation that was already running when the file was still untrusted is never reported: no SessionStart arrives for it after `t`, and nothing else says the kit missed one. The next conversation reports normally. So "no id recorded" cannot be read as "there was no conversation". **verified** (live, in the PR #88 review)
- **Codex records no pid anywhere a reader can use.** `~/.codex/thread-writer-locks/<thread>.lock` is an empty lock file; `~/.codex/session_index.jsonl` holds `{ id, thread_name, updated_at }`; a rollout's `session_meta` carries the id, the folder and the time and no pid. So there is no Codex equivalent of Claude Code's live-session registry. **verified** (read on this machine, 0.155.1)
- **Neither harness links a new conversation to the one the same process had before.** A `/clear` or a `/new` leaves nothing behind saying "this replaced that". With the point above, that means **a conversation that has ended cannot be tied to the session that had it** by anything either harness writes down — which is why the kit never assigns an unrecorded conversation to a session and says what it found instead. **verified** (live, and by reading both harnesses' own files)
- **Codex's own record of every conversation**: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl`, whose first line is `{"type":"session_meta","payload":{ id, cwd, timestamp, … }}`. `cwd` is the folder the conversation ran in, which for a kit session is always the bot home. A conversation spawned as a subagent says so under `payload.source`. **verified** (live, read on this machine)
- **The user's turn in a rollout is a `response_item` message with `role: "user"`** and `input_text` content. Codex's AGENTS.md goes in the same way, as `# AGENTS.md instructions for <cwd>…`. The `event_msg` `user_message` line is not always written: read on this machine on 2026-09-25, about 300 rollouts from 0.153 to 0.156.1 all carried the `response_item` for their user turns, while `user_message` was in 17 of them. A kit-started 0.156.1 session (kit-dev review-300) had its whole start prompt, work-dir note included, as that `response_item`, with an `item_completed` event of `item.type: "UserMessage"` beside it, and no `user_message`. **verified** (read on this machine; #274)
- **Codex has no `/clear`; `/new` is its clear**, and Codex reports it as an ordinary start: no hook fires at `/new` itself, and when the first prompt of the new conversation arrives, SessionStart fires with `source: "startup"` and the **new** id. So the source word cannot tell a `/new` from a program start on Codex — the id can. `codex resume <id>` keeps the **same** id and fires SessionStart for it. **verified** (live)
- **Codex 0.156.1's `/new` asks a question before the new conversation starts**: `Where should the new conversation run?` with `1. Current checkout` (keep the current working directory) and `2. New worktree` (an isolated managed checkout). Text typed while it is up goes into the menu: its return picks option 1 and the rest is lost. Whatever clears a Codex session answers it with `1` and waits for it to go before asking anything (#245). For a bot, option 1 is the bot home; the kit never makes a git worktree (PRD 6.2), so `2` is never the answer. The answer is in the tables in SETUP.md step 5 and `obk-bot-building`. **verified** (live, screen recording of the tab, 2026-09-24, Codex 0.156.1)
- No in-session scheduler in the CLI. **verified** (help)
- Subagents: spawned only after a direct request or an instruction in a skill, so a skill must ask explicitly. **verified** (docs)
- `codex queue --thread <id|name> --message <text>` (since 0.149): no official docs page, seems to reach only sessions on a shared app-server daemon, no delivery receipt, no sender identity; a queued row from 12 Sep was still undelivered a week later on this machine. Not trusted; retest. **verified as untrusted**
- Transcripts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, grouped by date, not by project. Lines are `{timestamp,type,payload}`. `session_meta` (id, cwd, context_window); `turn_context` (model, effort, approval_policy); `event_msg/token_count` (`info.last_token_usage`, `info.total_token_usage`, `info.model_context_window`); top-level `compacted` records; `event_msg/turn_aborted` with `reason="interrupted"`; `thread_settings_applied`. There is no `/clear`; a new conversation is a new rollout file. **verified** locally
- **What a session really runs with, in its rollout.** The latest `turn_context` carries `model`, `effort`, `approval_policy`, `approvals_reviewer` and `sandbox_policy.type`, and the latest `token_count` carries `info.model_context_window`. Seen live on 2026-09-24 (0.156.1, `codex exec` in a throwaway folder): `--approve-for-me`, the kit's `auto`, records `on-request`, `auto_review` and `workspace-write`; `-c model_context_window=200000` records 190000. `-c approval_policy=on-request`, the setting the kit's `-a on-request` gives (from `codex --help`; `codex exec` has no `-a`), records `on-request` with this machine's own `approvals_reviewer = "auto_review"` and `sandbox_mode = "danger-full-access"` from `~/.codex/config.toml`. So on this machine an `ask` session's approvals go to Codex's automatic reviewer, not to the user: the user's defaults leak in, and health reports it. **verified** (live). That `--dangerously-bypass-approvals-and-sandbox` records `never` and `danger-full-access` is **unverified**: its help says it skips every prompt and the sandbox, and the pair is on this machine's rollouts, but no run tied them (a throwaway run was refused, as in section 2).
- **Whether a new conversation (`/new`) reads `AGENTS.md` again is not established.** Nothing like Claude Code's `instructions` attachment has been checked for it. Until it is, only a start (`obk restart`) is said to bring a Codex session onto changed rules. **unverified**
- **Neither summing `last_token_usage` nor taking the final `total_token_usage` is right.** `total_token_usage` is a running total, so adding it up across events double counts: a conversation that used 80,565 came to 200,901 that way. But the two obvious repairs each fail on real data, and both failures were found in a review of this note's first version, which claimed summing the lasts was safe:
  - **A record can be repeated.** Two adjacent events can carry an identical positive `last_token_usage` while `total_token_usage` does not move; the second is the same call written down again. 128 such pairs in 250 rollouts on this machine. Summing the lasts counts those twice.
  - **The running total can reset.** Mid-conversation it can drop back and start again, a new window; 26 such resets in the same 250. Taking the final `total_token_usage` then reports only the last window. One conversation's true total was 2,854,977 across two windows and its final cumulative said 1,489,245.
  So count by the **difference in `total_token_usage` between one event and the one before**, field by field: a positive difference is that call's usage, no difference is a repeat and not a call at all, and a negative difference is a new window, where the event's own `last_token_usage` is the usage. Within a window the difference equals `last_token_usage` exactly, which is why a short conversation makes the wrong rules look right. A reader counting from a moment has to walk the earlier events anyway, because the difference is only meaningful against the one before. **verified** (2026-09-21, 0.155.1)
- **Cached tokens are inside `input_tokens` here, unlike Claude Code.** A real record reads `input_tokens: 21265`, `cached_input_tokens: 20992`, `output_tokens: 39`, `total_tokens: 21304`, and 21265 + 39 = 21304. `reasoning_output_tokens` sits inside `output_tokens` the same way. So uncached input on Codex is `input_tokens - cached_input_tokens`, and a figure that takes each harness's `input_tokens` as it stands compares unlike things and prices Codex's cached tokens at full rate. **verified** (2026-09-21, 0.155.1)

## 4. Skill names (verified in docs and spec)

Agent Skills spec: `name` is 1–64 chars, lowercase letters, digits and hyphens, no leading, trailing or double hyphen, and must match the parent folder. Colon or slash prefixes fail to load in some hosts. Only `name` and `description` are portable frontmatter. Kit skills are `obk-<name>`; folder = `name` = symlink name (ADR 0019).

## 5. Live checks still owed

1. ~~The session id reported after `/clear` is the new one, on Claude Code and on Codex.~~ **done** (2026-09-20, issue 04): see sections 2 and 3 above.
2. ~~A Claude session launched with `-n` keeps its name after `--resume`, and messaging works inside an Orca tab.~~ **done** (2026-09-21, issue 08): see section 2.
3. ~~Two `auto` Claude sessions deliver to each other without a prompt.~~ **done** (2026-09-21, issue 08): see section 2.
4. ~~Codex `auto` mode lets a bot run `orca`~~ **done** (2026-09-21, issue 08): only with `-c sandbox_workspace_write.network_access=true`; see section 3. `gh` under `auto` is still owed.
5. ~~An Orca automation with `--reuse-session` keeps one grooming conversation.~~ **no longer needed** (slice 11): grooming does not use `--reuse-session` and is a fresh conversation each run (PRD 6.8). Whether the flag keeps one conversation is still unverified.
6. `codex queue` retest.
7. ~~An Orca tab id is still the same after Orca restarts.~~ **verified by observation** (2026-09-22 reboot, see section 1); a deliberate restart test is still owed if the owner wants one (#176).
8. That `dangerously-skip` records `bypassPermissions` on Claude Code and `never` with `danger-full-access` on Codex (sections 2 and 3, #271).
9. Whether Codex reads `AGENTS.md` again at `/new` (section 3, #271).
