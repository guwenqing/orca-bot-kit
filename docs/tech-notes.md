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
- **A removed project stays in the window's sidebar until the window is rebuilt.** `setup-delete`
  sends the window nothing, so the row keeps its old name. The `project.update` call the kit makes
  after a change (ADR 0034) makes the window re-read, and the row stays, now under "Unknown": the
  sidebar builds its rows from the window's own list of workspaces, which a re-read does not prune
  (read in the bundle). Orca's menu item View › Force Reload (`Force Reload\t⌘⇧R` as the menu draws
  it; the name is localized, the shortcut is `app.forceReload` and the user may change it) rebuilds
  the window and the row goes. macOS System Events can click it in the `Orca` process with no
  keystroke, but only with Orca the front app: with another app in front the click is taken (no
  error) and the window does not reload. That was seen twice with the sidebar read through
  Accessibility before and after, where each project row is a button "Project actions for <name>"
  and a stale one reads "Unknown" (#343). One Force Reload drops every stale row. Orca had 11
  terminals before the reload and 11 after. **verified** (live, the owner's
  eye on the sidebar, 2026-09-26, Orca 1.4.212, #343). Reported to Orca as stablyai/orca#23224 (open
  on 2026-09-26), with a proposed fix; once a release carries it, the kit's Force Reload can be
  retired behind a version check.
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
- **Orca 1.4.223 moved its settings into SQLite.** A fresh profile has no `orca-data.json`. It holds
  `profile-state.db` with its `-wal` and `-shm`, plus `.authority` and `.backup.*.db` files. Orca holds the db
  open in WAL mode, and its `-wal` can carry changes not yet checkpointed into the db. **verified** (the
  folder listed live, 2026-10-09). The settings are one JSON document: table
  `profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT, domain_version, revision, updated_at,
  content_hash)`, row `domain = 'settings'` (`domain_version` 1), with `agentDefaultArgs` at the top level of
  `payload`. **reported** in #507 by the owner; the kit's system test reads it live. Orca's CLI has no
  command that prints its settings: `orca --help` and `orca agent-context` list none. **verified** (1.4.223)
  A SQLite open of the live db, read-only included, writes reader marks into Orca's `-shm`, and is refused
  while a writer holds the db in exclusive locking mode. **verified** on a test db, not on Orca's own. So
  `obk health` reads a copy of the `-wal` and the db in a private temporary folder, and removes it at once
  (#507). A copy that Orca changed during the copy is thrown away: a part of the `-wal` over a db that was
  just checkpointed reads as older settings. On macOS `copyFileSync` does not return when its source is
  truncated during the copy, as a checkpoint truncates the `-wal`; `readFileSync` does return.
  **verified** (a 600 MB file truncated during each copy, and a test db checkpointed during the kit's copy)

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
  shell is ready (next entry). **verified** (live) A line can also land in the question whole: on
  obk 0.25.0 a `temp make` line went into `[Y/n]`, the `obk session mailbox` part was lost and the
  harness part ran (#498).
- **Orca holds a new tab's typed text only until its shell is ready, or for 15 s.** Read in the
  1.4.219 bundle (#498): the daemon queues input to a new pane until the shell prints Orca's
  `ESC]777;orca-shell-ready` mark, which Orca's zsh wrapper prints from `zle-line-init`, so at the
  first prompt and never during a start-up file. After 15 s (`shellReadyTimeoutMs`) it writes the
  queue to the shell anyway: into a question that is still open. The state is the daemon's own; no
  CLI command or runtime method gives it. Where the mark does not come, the daemon calls the shell
  ready when the shell is in front and `stty -a -f <tty>` shows `-icanon`, `-echo` and `lnext =
  <undef>` (shared/pty-slave-line-discipline-echo.js).
- **A shell at a ready prompt has its tty at `-icanon -echo` with `lnext = <undef>`; a start-up
  question does not.** Measured on 2026-10-05 and 10-06 in a pty with `stty -a -f` (#498): zsh 5.9 at
  a prompt `-icanon -echo`, lnext `<undef>`; zsh in `read -k 1` (oh-my-zsh's question) `-icanon echo`,
  lnext `^V`; zsh in `read -s -k 1` `-icanon -echo`, lnext `^V`; bash 3.2 at its readline prompt
  `-icanon -echo`, lnext `<undef>`; bash in `read -p` `icanon echo`, lnext `^V`; `/bin/sh` at its
  prompt `-icanon -echo`, lnext `<undef>`. The pane pid Orca gives is
  `/usr/bin/login`, which runs as root, and `lsof -p <it>` shows nothing to the user; `lsof -a -R -d 0
  -u <uid> -FpRn` lists the user's processes with their parents, and the shell, the pane's child, has
  the tty on fd 0 (`p88639`, `R88620`, `f0`, `n/dev/ttys010`). Both that `lsof` and `stty` ran under
  `codex sandbox` (0.160.0), where `ps` and `pgrep` do not. So before it types a launch line, the kit waits up to 15 s for the shell in front
  with its tty in that mode, and otherwise types nothing and names the screen. A question asked
  through bash's readline (`read -e -p`) looks ready (`-icanon -echo`, lnext `<undef>`), to Orca as
  well; none is known in a start-up file. The architect accepted that as a known limit (#498). **verified** (live,
  in a pty; the probe in an Orca tab is in #498's PR)
- **A variable set on the launch line reaches the session's own shell tool, on both harnesses; a
  `PATH` entry does not.** The kit's launch line starts `OBK_CLI=<the running CLI> …`, and a Claude
  Code bot and a Codex bot each running `printenv OBK_CLI` wrote that path back exactly, a space in
  it included, and their mail sent with `"$OBK_CLI" message send` reached that CLI (#220). A `PATH`
  prefix on the same line is not enough: Codex's shell tool puts `/opt/homebrew/bin` back in front of
  it, so a Codex bot runs the machine's `obk` whatever the line said (measured by the architect for
  #220). A hook the harness runs inherits `PATH` from the harness's launch, on both harnesses. So the
  kit names itself by path in its hook and nudge. **verified** (live, 2026-09-24, Claude Code
  2.1.281, Codex 0.156.1) It named itself by `OBK_CLI` in the rules a bot reads too, until #344: a
  Claude Code allow rule matches the command as written, not after the shell expands a variable, so
  the rules build now writes the building CLI's path and the bots folder's path where a rule unit
  says `"${OBK_CLI:-obk}"` and `<bots>` (ADR 0036).
- `orca terminal wait --for exit|tui-idle --timeout-ms <n>`. **`tui-idle` is about a TUI, not a shell.**
  All four answers seen live:
  - a tab running no TUI, sitting at a clean shell prompt: exit 1, `ok:false`,
    `error.code: "timeout"` — never satisfied, however long the timeout. So this is **not** a way to
    ask whether a shell is ready for typing; the tty's mode is (above, #498).
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
    Seen again on Orca 1.4.210: at 16:23Z on 2026-09-25, `tui-idle` answered idle for both kit-dev
    Codex reviewers that Orca's cold restore had resumed, while their screens showed Codex working
    (the architect, #318). The kit acts on the tab's foreground, not on this answer (below).
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
  **What `blockedReason` rests on, and what it misses (#329).** Read in the Orca 1.4.212 bundle on
  2026-09-26: the reason comes from one text match on the tab's output, lowercased, over its last 12
  non-blank lines, the lowest match winning, and dropped when the agent's own start screen shows below
  it. The reasons and their words: `agent-update-prompt` (`update available`, then `press enter to
  continue`), `agent-cwd-prompt` (`choose working directory to`, then the same),
  `codex-model-migration-prompt` (`codex just got an upgrade`, then the same),
  `agent-hooks-review-prompt` (`hooks need review`, then `press enter to confirm`),
  `agent-trust-workspace` (`do you trust`, `trust this` or `trusted workspace`, then workspace, folder,
  directory or repo), `agent-interactive-prompt` and `agent-approval-prompt`. No pattern covers Claude
  Code's menus; Orca sees those only through the harness's hooks. **verified** (read in the bundle)
  Measured against it live on 2026-09-26 (Orca 1.4.212, Codex 0.157.1, Claude Code 2.1.283):
  - Codex 0.156.1's update offer ended "enter continue · esc skip", matched nothing, and a system
    test's line typed with a return took `1. Update now` (#329).
  - Codex's hooks review now ends "enter confirm · esc skip", and its `/new` menu "enter select · esc
    back". Both answered `satisfied:true` with no reason.
  - Codex's trust screen answered `agent-trust-workspace`, and **went on answering it once it had
    been answered**: on the idle input line, and after a finished turn, until `/new` redrew the screen.
    While it did, Orca's gate refused a line sent with `--enter` (below).
    Not seen again in two careful tries for #342 (the architect, same versions, a throwaway fleet):
    trust answered with return alone, and then with `1` and a separate return (`1` alone only moves
    the selection), and the hooks review with arrow-down and return. Each time the reason was gone
    on the hooks screen, and a line sent with `--enter` went through in 2 s. The first time, Codex's
    start header was drawn after the trust text. So when it happens is not known. How it could happen,
    read in the 1.4.212 bundle and not seen: the "tab's output" is Orca's line model of the raw
    stream, which keeps only newlines, carriage returns, backspaces and `CSI A/K/G/D/C`. It drops
    absolute cursor moves, which Codex draws with, so Codex's screens pile up on a few long lines.
    The trust words stay in that text until 12 non-blank lines come after them, or a Codex start
    header ("openai codex", then "model:" and "directory:") does, and `/new` draws one. A replay of
    the #342 bytes through those functions, lifted from the bundle, did not match Orca's live answer
    on the trust screen itself, so it was not used as evidence. On a Codex tab where Orca names
    this reason and the screen shows no question, the kit types nothing and says so (#342). A
    plain `terminal read` (no `--screen`) came back with `source: "screen"` too, so the CLI does
    not show the text the match reads. **verified** (live, the two tries), the rest read in the bundle
  - Claude Code's trust list answered `timeout` with no reason, and `terminal show` named no agent in
    the tab for minutes, until its selection was moved; then it answered `agent-trust-workspace`.
  **verified** (live)
  **What a harness's own question looks like on screen.** `terminal read --screen --json` answers
  `{ terminal: { handle, status, tail: [rows], …, source } }`: one string per rendered row, and
  `source: "screen"`. An orphaned Codex tab's screen came back that way too. Every question of the
  harnesses' own seen here is a list of choices, one per row, with the harness's pointer at the start
  of one: `›` on Codex, `❯` on Claude Code. All of Codex's are numbered (trust
  `› 1. Trust and continue` / `2. Quit`, the hooks review, `/new`, the update offer), and so are Claude
  Code's but its trust list, which on 2.1.283 is ` ❯ No, exit` / `   Yes, I trust this folder` /
  ` Enter to confirm · Esc to cancel`. The same pointer starts each harness's input line and its echo
  of the user's past turns. Claude Code's idle input line is `❯` alone, or with placeholder text,
  between two rules of `─`. Codex 0.157.1's is `› Ask Codex to do anything`, with a status row right
  under it and lined up with it (`  GPT-6-Luna medium · <path>`), and a wrapped draft or echo goes on
  in rows lined up the same way. So the kit takes the lowest pointer row on the screen, which is the
  input line whenever that is up, and counts a question only when that row is a numbered choice with
  another numbered choice lined up beside it (ADR 0034). Claude Code's trust list does not count; what
  keeps the nudge out of it is Orca naming no agent in that tab. **verified** (live, 2026-09-26)
  **A slash command typed, and a harness at work (#391).** Seen live on 2026-10-03 in
  `test/system/session-clear.test.js`, runs 2 to 5 (Claude Code 2.1.288, Codex 0.160.0):
  - Codex 0.160.0 draws its slash menu above its input line: the selected row starts with `›`
    (`› /new  start a new chat during a conversation`), the other matches under it, a blank row, then
    the input line, as its own snapshot tests draw it (`codex-rs/tui/src/bottom_pane/snapshots/`,
    `*slash_popup_*.snap`, rust-v0.160.0). Orca's `terminal read --screen` shows that input line bare,
    `›`, while the menu is open: with the command sent whole, a character at a time 100 ms apart, or
    `/` alone. The snapshots draw the typed text there. Why Orca's read misses it is **not known**. So
    the kit takes a bare line on Codex only where the session's rollout says `cli_version` `0.160.0`
    (its `session_meta` line), with the input line empty or its placeholder before the first
    character, and the menu holding one command row, selected, naming the command; Return with the
    menu open runs the selected command (`chat_composer.rs`, rust-v0.160.0). Run 5 cleared and
    compacted a Codex session that way, each confirmed by its record (the architect's ruling on #391).
  - Orca's `tui-idle` timed out with Codex's menu open, and still after a backspace had closed it. On
    Claude Code it stayed satisfied with the menu open.
  - Claude Code 2.1.288 puts a non-breaking space (U+00A0) after its `❯` when the line holds text:
    `❯\u00a0/clear`. Its slash menu sits above the input box's top rule, a row per command with its
    description wrapped onto rows set far in, and no pointer marks a selection; with `/clear` typed,
    `/clear` was its one row.
  - Claude Code 2.1.296 marks the menu's selected row with its pointer: `  ❯ /compact  Free up
    context…`, then `    /autocompact …` under it, all above the input box's top rule. Under Orca
    1.4.223, `terminal read --screen --json` shows its input line bare, `❯`, whatever it holds, and
    gives the line's text as `result.terminal.draft` beside `tail`: `hello`, `hello/compact`,
    `/compact`, and no `draft` key when the line is empty. With `hello/compact` no menu came up.
    Seen in four probes on 2026-10-09 (#510), in a throwaway tab, before and after a turn.
    Whether the same `draft` is what made Codex 0.160.0's line bare is **not checked**.
  - Codex 0.162.0 under Orca 1.4.223 does the same: the screen's input line reads `›` alone whenever
    it holds text, and `draft` gives the text: `/`, `hello`, `hello/compact`, `/compact`, `/new`, the
    same at 300, 1000 and 3000 ms. An empty line gives no `draft`, and the screen shows `› Ask Codex
    to do anything`. With `/compact` or `/new` typed, the menu is the command's one row, selected,
    and the input line comes right under it, with no blank row between. `/` and one backspace left the
    line empty, with no turn before and after one. No warning row showed, and F2 showed "No
    warnings". Seen in one probe on 2026-10-10 (#516), in a throwaway tab, launched with the folder's
    trust and without `--dangerously-bypass-hook-trust`. So the kit reads `draft` on Codex as on
    Claude Code, and takes a bare line only with no `draft` on 0.160.0. **verified** (live, once)
  - Codex 0.162.0 renamed the first answer to "Where should the new conversation run?" after `/new`:
    `› 1. Use current Git worktree  Keep using the current working directory`, then `  2. Create new
    Git worktree   Create a separate checkout of this repository in another directory` and `  enter
    select · esc back`, in a git-initialized folder, with no `draft`. Esc closed it, and no new
    conversation began. 0.160.0 said `1. Current checkout`, and 0.162.0's binary holds no "Current
    checkout". The kit answers that whole row 1, as it answers `1. Current checkout`, and never row 2.
    Seen in a probe on 2026-10-10 (#516). **verified** (live, once)
  - At work, Codex shows `• Working (5s • esc to interrupt)` or `• Executing requested command (36s •
    esc to interrupt)`. Claude Code 2.1.288 never showed "esc to interrupt": its row is a spinner
    glyph, a word ending in `…`, then the time (`✶ Unfurling… (36s · ↓ 131 tokens)`); a finished turn's
    row has no `…` (`✻ Cooked for 1m 19s · done 3:48 PM`). While a 75 s foreground command ran,
    `tui-idle` timed out on both harnesses (runs 3 to 5).
  **verified** (live), but for the cause of the bare line.
  **A handle just listed can be refused as `terminal_handle_stale`, for a moment.** Seen five times
  between 2026-09-24 20:30Z and 2026-09-25 06:40Z (Orca 1.4.209), every time `obk message send`'s
  `terminal wait --for tui-idle` on a Codex review tab (four on `kit-dev/reviewer`, one on
  `kit-dev/review-271`), from developer-1 and from the architect. When it was checked, the same
  handle was listed again minutes later with `orphaned: false`, and `terminal wait`, `show` and
  `read` worked on it; once the same wait a minute later answered `timeout` instead. So it comes
  and goes on a handle that stays good (#294). Read in the 1.4.209 bundle: a handle's record keeps
  the renderer graph epoch it was issued in and the pane's pty generation, and a look at a tab the
  window has loaded refuses `terminal_handle_stale` when either has moved since, `terminal wait`
  and `terminal show` alike. A graph reload
  moves the epoch and also rejects every wait in progress with that code. `terminal list` issues
  the handle again at the current epoch, under the same `term_…` string while the pane's process
  is the same one. So `obk message send` lists the tab again and looks once more after that
  refusal, and reports a second one as it is (#294). What moves the epoch or the generation that
  often on that one tab was not found. **verified** (live, the five sightings) and read in the bundle.
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
  types nothing (ADR 0034). `diagnostics memory` is a diagnostics command and may change.
  **verified** (live, 2026-09-24, Orca 1.4.209, macOS 26.6.2, Claude Code 2.1.281, Codex 0.156.1, #232)
- **Orca's runtime says who is in front of a tab, from outside any sandbox: `terminal.inspectProcess`.**
  Its CLI does not offer it; Orca's own runtime client does (`call('terminal.inspectProcess', {
  terminal: <handle> })`), and no attestation of the caller applies to it (only `orchestration.*`
  goes through that). Read in the Orca 1.4.212 bundle on 2026-09-26: Orca's terminal daemon runs `ps
  -axo pid=,ppid=,pgid=,tpgid=,stat=,tty=,lstart=,command=`, walks down from the tab's own process to
  its terminal's foreground group, and answers `{ foregroundProcess, hasChildProcesses,
  foregroundProcessEvidence: { verdict: 'live'|'unverifiable'|'exited', processName, reason?, fence }
  }`. `processName` is set only for a program Orca knows as an agent, named from its arguments;
  anything else is named in `foregroundProcess` by its short kernel name. Seen live on 1.4.212 from a
  probe's own tab: the shell at its prompt gave `live`, `processName: null`, `foregroundProcess:
  null`, `hasChildProcesses: false`; `less` gave `foregroundProcess: "less"`, `hasChildProcesses:
  true`; a `node` program gave `"node"`. `terminal.isRunningAgent` took more than 5 s on that `node`
  program and timed out, and it guesses from titles and output as well. The kit asks
  `inspectProcess` where `ps` cannot read a tab (ADR 0034, #298). **verified** (live, 2026-09-26, Orca
  1.4.212, for the shell, `less` and `node`, and in #298's attended system test for an idle Claude Code,
  which was named in front).
  **On macOS it cannot see a harness that is running a command.** `ps` prints `??` for a process with
  no terminal, and the check that walks the tab's processes takes `??` for another terminal: the answer
  is `unverifiable`, reason `tty_boundary`, `foregroundProcess` the leader's short kernel name, and
  `hasChildProcesses: true`. Claude Code runs every command in `/bin/zsh -c …` with no terminal, so a
  Claude tab running a command, or holding one in the background, answers that way. The kernel name of
  a native Claude Code is its version file (`2.1.282`; `ps -o comm=` gives `claude`, `-o ucomm=` gives
  the version). Seen live on 2026-09-26 (Orca 1.4.212, Claude Code 2.1.282, the architect, #298's run
  and a direct call); read in Orca's source at `agent-foreground-process-remote-evidence.ts:74-78` and
  `process-table-snapshot.ts:156`, whose own pty code does treat `??` as no terminal. An Orca bug,
  reported as stablyai/orca#23245; its proposed fix, stablyai/orca#23251, was still open on 2026-10-03
  and is not in Orca 1.4.219. The kit's answer is a Codex sender's own hook, which reads the tab with
  `ps` outside the sandbox (#350, ADR 0034; section 3). **verified** (live)
- **Orca's runtime client answers in well under a second, even on a loaded machine.** The kit runs it
  as Orca's binary with `ELECTRON_RUN_AS_NODE=1` and `src/orca-runtime.cjs`, gives the client 2 s
  (`CLIENT_WAIT_MS`) and ends it at 3 s (`CLIENT_KILL_MS`) (ADR 0034). On 2026-09-27 (#384; Orca
  1.4.214, macOS, 10 cores) a throwaway probe run through `scripts/test-system.js` made its own folder
  project and one plain shell tab. It ran the client exactly as the kit does, with its own bounds
  raised to 30 s so that slow calls showed rather than being cut off, and timed each call to the end
  of the process. `terminal.inspectProcess` on its tab, p50 / p95 / max: idle (30 calls) 72–85 /
  156–199 / 200 ms; beside the full unit suite (1914 calls, 2502 tests passing, 29.5 min) 209 / 304 /
  721 ms; beside 20 CPU spinners for 60 s (94 calls) 136 / 333 / 425 ms. `project.update` on its
  project: idle max 90 ms, suite 124 / 178 / 446 ms. Under the suite, the call itself, after the client
  had loaded, took 6 / 132 / 447 ms. A bare Electron-as-node start (`-e 0`) cost about what a bare node
  start does: idle 43 against 40 ms, suite p95 102 against 87 ms. None of the 3918 calls under load
  took 2 s. So both bounds stay: the worst whole call was under a quarter of the kill, and the worst
  call inside the client under a quarter of its wait. The probe was not kept; its method is this
  paragraph. **verified** (live, once, on this machine)
- **A harness Orca resumed by itself sits where the kit's own does, and carries none of the kit's
  variables.** Read with `ps` on 2026-09-25, after that morning's machine restart and Orca's cold
  restore (below). Every kit-dev harness Orca had resumed, four Claude Code and two Codex, was the
  direct child of its tab's login shell (`-/bin/zsh`), which was the child of the pane's
  `/usr/bin/login`, and it led the terminal's foreground group. The two Codex sessions the kit
  launched that evening had the same tree. The restored ones carried `ORCA_TAB_ID`, the other `ORCA_*`
  variables and `ORCA_AGENT_LAUNCH_TOKEN`, and neither `OBK_TAB_SHELL` nor `OBK_CLI`. The kit-launched
  ones carried both, with `OBK_TAB_SHELL` equal to their parent's pid, and no launch token. So the
  process tree tells the tab's own harness from one the session started, launch line or not: a child
  of the shell that `login` started for the pane. The marker tells only whether the kit's launch line
  started it (#318). **verified** (live: the restore by Orca 1.4.210, read at 03:00Z on 2026-09-26
  under the 1.4.212 app and the 1.4.210 daemon; macOS 26.6.2, Claude Code 2.1.282, Codex 0.156.1)
- **`ps -E` reads a same-user harness's environment.** `ps -E -ww -o command= -p <pid>` answers with
  one line: the command and its arguments, then each variable as a `NAME=value` word, all separated
  by spaces. It did so for `claude` and `codex` alike (same date and versions). A value with a space
  in it cannot be told from the next word, and an argument such as a start prompt can look like a
  variable, so a reader should look for one whole word it knows. That answers the reading half of
  #261's open question on macOS. #318 uses the marker only to report in `obk health` which sessions
  the kit's launch line did not start, never to decide what is typed into a tab. Whether the mail
  nudge may rest on it was #261's to settle, as below, and ADR 0034 records it. **verified** (live)
  **#261 settles it: the kit types into a harness under another name when it carries the launch
  mark.** When the program in front of a tab is not named as the agent Orca names, the kit reads
  its environment and parent with `ps`. It types only when that process carries this tab's
  `ORCA_TAB_ID` and an `OBK_TAB_SHELL` equal to its own parent's pid, so the tab's shell started it
  on the kit's launch line, and only where Orca names an agent at all. A program the shell starts
  later has no mark, since the line sets it for the harness alone and does not export it. A program
  the harness starts has the harness as its parent. A tab Orca restored by itself has no mark, and
  keeps the name rule (a harness under another name there stays "cannot tell"). A sender inside
  Codex's sandbox cannot run `ps` at all (#298, #408), gets only Orca's runtime, which gives no pid,
  and so stays "cannot tell"; its own hook then decides it with `ps` (#350). Seen outside Orca first (2026-09-28): a shell starting
  `OBK_TAB_SHELL=$$ … node …` gave a `node` whose `ps -E` carried `OBK_TAB_SHELL=<the shell's pid>`
  with that shell as its parent. Seen live (2026-09-28, Orca 1.4.215, Claude Code 2.1.283 run as
  the child of a `node` wrapper typed on the kit's launch-line shape, codex-cli 0.157.1 as the
  sender, `test/system/node-harness-nudge.test.js`): `node` led the tab with the mark, Orca named
  `claude` as the agent, an idle session was nudged and read its mail, and a busy one was typed into
  (Orca saw no turn start, as #402 found). After it quit, `less` in its place got nothing typed;
  Orca named no agent at that moment, so the no-agent guard is what refused there (the fake tests
  cover `less` while an agent is still named). Not seen: a real npm install, where `node` is the
  harness itself, and Codex through npm. **verified** (live, as said)
- `orca terminal send [--terminal <h>] [--text <t>] [--enter] [--interrupt] [--wait-submit <s>] [--retry-request <id>]` — `accepted:true` means input accepted, not that the agent read it; never resend on silence; use `--retry-request` for an idempotent retry.
  **A carriage return or a line feed inside `--text` does not submit early.** Sent with `--enter` into a running agent, a line with `\r` or `\n` in the middle arrives as **one** message with a line break where the character was, and is answered once: Claude Code's transcript shows one user turn holding both lines, and Codex's screen shows one prompt of two lines and one answer. So the mail nudge, which carries the sender's subject as typed, cannot be split into two prompts by a subject that has one in it. **verified** (live, 2026-09-23, Orca 1.4.207, Claude Code 2.1.280 with `--model haiku`, Codex 0.155.1; #176)
  **While Codex sits on its own update offer, Orca refuses a line with `--enter` as `agent_prompt_blocked`.** Seen three times in a row on 2026-09-23 (Codex 0.155.1 offering 0.156.0); answered `2` (Skip), the next line went through. **verified** (live)
  Not every time: the gate rests on the same text match as `blockedReason` (above; read in the
  1.4.212 bundle). On Codex 0.156.1's offer, whose footer matched nothing, a system test's line sent
  with `--enter` went through, and its return took `1. Update now` (#329). And on a Codex tab whose
  trust screen had been answered, the stale `agent-trust-workspace` refused every line sent with
  `--enter` (2026-09-26); the gated runs below may have been that, which was not checked. In the
  bundle, a re-issue with `--retry-request` runs the gate again rather than getting past it, and a
  send without `--enter` passes no gate. On Codex 0.157.1, text sent that way with a return inside it
  landed in the input line as a draft and was not submitted. **verified** (live, except what is said
  to be read in the bundle)
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
  **`--tab` can answer `tab_not_found` for a tab Orca lists, and a close without `--tab` then closes it (#405).** Read in the 1.4.215 bundle: `terminal list` builds its rows from the window's pane graph and the PTY records, while `close --tab` looks the tab up in a per-worktree tab snapshot the renderer publishes separately (`mobileSessionTabsByWorktree`), and throws `tab_not_found` when the tab is not in it; the snapshot has rows for a tab only when it is in a group's tab order and has leaf ids. Seen by Bot Father after a machine restart (Orca 1.4.214): `close --tab` refused with `tab_not_found` while `terminal list` listed the terminal with its tab id and `orphaned: false`. What put the tab outside the snapshot is not known, and the state was not reproduced. Read in the bundle: `terminal close --terminal <h>` without `--tab`, for a tab of one pane, asks the renderer to close that tab by id and then stops its PTY; for a tab of several panes it closes only that pane. Seen live (2026-09-28, Orca 1.4.215, Claude Code, `test/system/close-without-tab.test.js`): on a kit-made one-pane tab, orphaned, whose harness had quit, the close without `--tab` answered `ptyKilled: true`, the listing dropped the tab within 87 ms, the pane's and the shell's processes were gone, and `obk up` resumed the book's conversation in a new tab. So `obk restart` closes that way when `--tab` answers `tab_not_found`. **verified** (live for the close without `--tab`; the refusal itself only as Bot Father saw it)
- `orca terminal list --worktree path:<p>` **fails with `selector_not_found`** for a path Orca has no project for; it does not answer an empty list. So anything that asks Orca what tabs a folder has looks in `project setups` first. **verified** (live)
- **A tab can be listed under another id while it is orphaned.** `terminal create` answers `terminal: { handle, tabId, paneKey: "<tabId>:<leafId>", ptyId, … }`, with `ptyId` of the form `<setupId>::<path>@@<8 hex>`. `terminal list` then gives that terminal its `tabId` with `orphaned: false`, until the pty is missing from the renderer's current pane graph. From then on it lists the same `handle` and `ptyId` with `tabId` and `leafId` both `"pty:<ptyId>"` and `orphaned: true`. This is Orca's `buildPtyTerminalSummary`: `orphaned = !Eea(pty, ptySurfaceTopology())`, `tabId = orphaned ? "pty:" + ptyId : pty.tabId`. A running harness advances the graph. Claude Code typed into a tab of a project the window has not loaded turned it orphaned within 2 s. A plain shell, with or without a title change, stayed `false` for 75 s. It clears again once the pane is in the graph (#185). While orphaned, the scoped listing still includes the terminal. **`terminal show --terminal <h>` answers with the real `tabId`**, still marked `orphaned: true`. `terminal close --terminal <h> --tab` works on it, answers with the real `tabId`, and leaves nothing running. So the tab id stays the key: the kit reads an orphaned entry's real id from `terminal show`. **verified** (live, 2026-09-23, Orca 1.4.207, Claude Code; #187, the `show` fact first found in review)
  Whether an orphaned tab's screen can be read varies. On 2026-09-25, before the machine restarted (1.4.209 then), two throwaway fleets' Bot Father tabs were orphaned and `terminal read --screen` showed only the launch line: the harness ran, but nothing it drew could be read, so its trust question could not be answered with sight. After the restart (Orca 1.4.210), a fresh throwaway fleet's tabs were also listed `orphaned: true` right after `obk init`, which sends the window its quiet `project.update` nudge (#224). Yet `terminal read --screen` rendered Claude Code's trust screen and then its prompt, `terminal send` reached it, and no `terminal switch` was needed. Not established: whether the Orca version, the restart, or the window's state made the difference. So the nudge alone does not clear `orphaned`, but a tab can be orphaned and still readable. **verified** (live, 2026-09-25, #235's live check)
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
  It reads one key: `n` alone, with no return, answered it and left the shell prompt, and the update
  check's `LAST_EPOCH` moved to today. **verified** (live, 2026-09-27, oh-my-zsh bf77e35, brought up
  with `ZSH_CACHE_DIR` set to a throwaway folder holding `LAST_EPOCH=0`, so the user's own cache was
  not touched)
- A folder-trust question. Claude Code draws a list whose selection starts on **`No, exit`**, so it
  takes an arrow down and then return, not a bare return. Codex draws `1. Yes, continue` / `2. No, quit`
  (`Trust this folder?` with `1. Trust and continue` / `2. Quit` on 0.156.1, seen 2026-09-24) with the selection already on yes, and says plainly that trusting applies to the **repository root**,
  not the bot folder — for a bot that means the whole bots repo. Click yes either way. The harness then
  writes its own config, which is fine.
  On Codex 0.157.1 the screen ends `enter continue · esc quit`, and return alone took
  `1. Trust and continue`: the hooks review came next and `~/.codex/config.toml` gained the root.
  **verified** (live, 2026-09-27, #335)
- A harness update offer. Codex shows `✨ Update available! … 1. Update now / 2. Skip / 3. Skip until
  next version`. Accept it. The selection starts on `1. Update now` and the screen ends
  `enter continue · esc skip`, so return accepts it. A digit then return is no way to pick an option
  here: `2` then return, meant as Skip, took **Update now** on 0.156.1 (2026-09-26, #329). **verified**
  (live, 0.156.1). 0.157.1 has had no newer release to offer, so it has not shown there.
- Codex's hooks review, because the kit's own hook is new to it: `Hooks need review … 1. Review hooks /
  2. Trust all and continue / 3. Continue without trusting`. Trust them, or the kit's hook never runs
  (section 3). The selection starts on `1`, so it takes an arrow down and then return; the screen ends
  `enter confirm · esc skip`. On some runs it started on `2` already, and then return alone is the
  answer, so read where it starts. **verified** (live, 2026-09-27, 0.157.1: the kit's hook ran and the
  book got the session's id, #335)
- Codex's `/new` may ask `Where should the new conversation run?` with `1. Current checkout` /
  `2. New worktree`, ending `enter select · esc back`. The selection starts on `1`, and return took
  it: a new conversation in the same folder, and no worktree added. **verified** (live, 2026-09-27,
  0.157.1, #335; also seen on 0.156.1)
- Claude Code may offer to learn the machine: `Teach auto mode about your environment?` with
  `1. Yes / 2. Not now / 3. Don't show again`. Answer **Not now**: it would write settings of the
  user's, and that is not the kit's to start. **verified** (live, 2.1.278)
  Read in the 2.1.283 binary: Esc on it is Not now (both the list's and the dialog's cancel choose
  "later"). It shows in auto mode when the user has no auto-mode environment set, at least 5 startups
  and at least 5 auto-mode denials, and not within 7 days of a Not now; Don't show again ends it for
  good. On this machine the last Not now was 2026-09-21T09:26Z, so no run before 2026-09-28T09:27Z
  can show it. Proving Esc live waits for that (#370).
  **On 2.1.283 it is a form, not a numbered list, and Enter on it is Continue (#416).** Seen live
  (2026-09-28, about 09:42Z, Claude Code 2.1.283 in auto mode, a throwaway tab of #261's live test):
  it came right after the session's first turn finished, not at startup, and read `Teach auto mode
  about your environment?`, a line on reading this project, recent sessions and optionally the shell
  history and other repos, then `How you use Claude here  Mixed`, `❯ Also scan shell history  true`,
  `Also scan your other repos  false`, `Continue`, and `←/→ to change usage · Enter to continue · Esc
  to cancel`. No numbers, so a check for numbered choices does not see it. The test's `/exit` with
  a return most likely pressed Continue: by 09:47Z `~/.claude.json` had lost `autoModeEnvSetup`, which
  in 2.1.283's code only the accept path clears (read by the architect); no scan was found in the
  transcripts or settings. So nothing may send this form a return, and the kit's screen check refuses
  it by its own words (#416). Esc cancelling it stays read in code, not seen live (#370). **verified**
  (live, the form and its words; the Continue, worked out from the code)
  Seen again (2026-09-28, about 17:00Z, 2.1.283 in auto mode, #239's live run 1), also right after
  the first turn. `~/.claude.json` had no `autoModeEnvSetup` at all when read at 17:07Z, just after the
  run, and nothing is known to have set it since 09:47Z; so the conditions read in the code above look
  like not the whole story (worked out, not proven). Nothing answered it; the
  test's teardown closed the tab, and `~/.claude/settings.json` was unchanged. Esc still not seen.
  **On 2.1.289 it is a numbered list again, drawn above the input box (#489).** Seen live
  (2026-10-05, about 03:15 local, Claude Code 2.1.289 in auto mode, `temp-answer`'s live run 1), right
  after a temporary session's first turn: `Teach auto mode about your environment?`, `Auto mode works
  better when it knows your environment. Takes about a minute.`, `❯ 1. Yes`, `2. Not now`, `3. Don't
  show again`, and `Enter to confirm · Esc to cancel`. Below that foot sits the input box, with its
  own `❯`, so the list is not the lowest pointer row on the screen. The selection starts on `1. Yes`.
  Nothing answered it (the architect's ruling on #489: no key to a real Teach screen in a test, since
  a Not now is recorded for the whole machine); the teardown closed the tab. **verified** (live, the
  list, its words and where it sits; what `2. Not now` and Esc do on 2.1.289, not seen)
- Anything else: type nothing and raise it with the user, naming the bot, the tab and what is on screen.

The kit's own code does not change user-level settings on its own initiative.

Codex started in a brand-new folder on this machine showed no trust question at all (the owner's global
config puts it in "YOLO mode"), only the update offer.

### Session resume inside Orca (verified)

Orca stores a resume record per pane key (`sleepingAgentSessionsByPaneKey`) and relaunches with `claude --resume <id>` / `codex resume <id>`. Closing a tab drops the record. Orca's Session History can find old transcripts but does not know which bot and session they belonged to. This is why the kit keeps its own book (ADR 0012).

### When Orca restores its tabs by itself (cold restore)

- **Seen on 1.4.210, after the owner's machine restart on 2026-09-25, when Orca also moved from 1.4.209
  to 1.4.210** (the architect, about 16:20Z, #318). Orca resumed every kit-dev tab's harness by itself,
  3 s after it started, as a bare `claude --resume <id>` or `codex resume <id>`. None of the kit's launch
  line came with it. The harnesses carried `ORCA_AGENT_LAUNCH_TOKEN` and no `OBK_*` variable (the tree
  and the variables are in section 1). With no kit flags, Codex fell back to the user's
  `~/.codex/config.toml`. kit-dev's `reviewer` and `review-286` ran on `approval_policy never` with
  `sandbox danger-full-access`, where `bot.yaml` asks for `auto`, and `obk health` flagged both. The
  Claude Code sessions matched their settings only because the user's own defaults happen to match.
  Bot Father's `daily` and `grooming` and amc-tutor's `prep` were not brought back. A `/clear` in a
  restored Claude tab was not written to the book, and the session was not told its duty again (#318).
  **verified** (live)
- **How it works, read in the 1.4.212 bundle.** Orca's own trace (`logs/main.trace.ndjson`,
  `updater.install`) records 1.4.210 installed at 16:08Z on 2026-09-25 and 1.4.212 at 00:13Z on
  2026-09-26. The restore above ran on 1.4.210, whose bundle was not read.
  - The id is the agent's `providerSession` for the pane while its state is not `done`, and otherwise
    the pane's sleeping record (`sleepingAgentSessionsByPaneKey`).
  - The command is the agent's configured command with `--resume <id>` (Claude Code) or `resume <id>`
    (Codex) added, plus Orca's default launch arguments: `settings.agentDefaultArgs`, or the arguments
    the pane's own Orca launch saved. A bypass there reaches every restored session (section 1, and
    `obk health`'s finding on Orca's settings).
  - It is the pane's startup command. The daemon starts the login shell with Orca's wrapper, and the
    wrapper `eval`s the command at the first prompt. So the harness is the shell's child, as seen.
  - It mints `ORCA_AGENT_LAUNCH_TOKEN` for the pane.
  - It runs when the daemon has no live session for the pane and the pane's terminal history is on
    disk. A pane the daemon still holds is attached again and nothing is run.
  - Sleeping records are written when Orca quits and every 60 s, and only for an agent that is not
    `done`, has a provider session id and is on Orca's resumable list. That would explain the tabs
    that were not brought back; it was not checked for them.
  - No setting turns the restore off.
- **An Orca update that leaves the daemon running leaves the tabs and their harnesses running.** The
  update to 1.4.212 restarted the app at 00:13:54Z on 2026-09-26. At 03:40Z the terminal daemon was
  still the 1.4.210 one (`daemon/daemon-v36.pid`, `appVersion` 1.4.210, running since 16:20Z), and so
  were the harnesses the morning's restore had started, so nothing was restored again. The bundle says
  an update keeps an old daemon that owns live sessions. A pane's `ORCA_APP_VERSION` is the daemon's:
  a tab opened after the update still read 1.4.210. So the version a fact was seen on is the app's
  (the trace above, or `orca --version` once the app has restarted), and for anything about a pane,
  also the daemon's. **verified** (live, with `ps` and Orca's own files)
- **What the kit does with such a tab, proven live with a stand-in** (#318,
  `test/system/restored-tab.test.js`, passed on 2026-09-26: Orca app 1.4.212 with the 1.4.210 daemon,
  Claude Code 2.1.283, Codex 0.156.1). A cold restore can't be staged without restarting the owner's
  Orca. So the kit's harness is quit, and the same bare resume is typed into the tab's shell. The
  harness in front then had the tab's `ORCA_TAB_ID` and no `OBK_TAB_SHELL`. `obk health` named each
  such session, with its restart. A `/clear` (Claude Code) and a `/new` (Codex) there were written to
  the book, the old id went into history, and the session was told its duty again. A stranger's
  `claude` in another tab of the same project was not written down. **verified** (live)
- **Not what the 2026-09-25 restore showed, and not explained:** in that stand-in, the bare `codex
  resume <id>` of a conversation the kit had started with `--approve-for-me`, and the `/new` after it,
  recorded `approval_policy on-request` and `sandbox_policy workspace-write`. That is the kit's `auto`,
  not the user's `never` and `danger-full-access`. Orca's own restore runs the command through its
  shell wrapper, with its default arguments, which this stand-in did not. **verified** (live, from the
  rollouts)
- Not known: whether 1.4.209 restored the same way. No older bundle is on disk.

### Orca's own agent hooks (verified)

Orca writes hooks into the user-level harness settings (`~/.claude/settings.json`, Codex hooks). They post to a local port using env vars set in each pane: `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID`, `ORCA_TERMINAL_HANDLE`, `ORCA_AGENT_HOOK_PORT`, `ORCA_AGENT_HOOK_TOKEN`. Those variables are inherited all the way down — a harness started in a tab has them, and so does a hook the harness runs — so `ORCA_TAB_ID` is how anything running in a tab knows which tab it is in. **verified** (live). Orca's own per-pane record (`providerSessionId` in `…/orca/agent-hooks/last-status.json`) was empty for kit-made tabs, so it is not a cross-check to lean on. `…/orca/agent-hooks/last-status.json` holds per pane: state, last hook event, provider session id, transcript path. Internal; a cross-check only. The kit's hooks live in the bot folder and must not touch these (ADR 0022).

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
  - `--from` may name a tab other than the caller's. That was accepted from a kit-made Claude tab and from a shell with no `ORCA_*` variables at all, and the caller's own binding was left as it was. Orca's `consumer_fenced` guard only compares `--from` with an attested agent launch, and needs `ORCA_AGENT_LAUNCH_TOKEN` to attest one (read in the 1.4.209 bundle). No tab the kit makes had that variable then. On 1.4.210 that no longer holds: see the 1.4.210 entry below.
  - A `--from` naming a handle with no live pane is refused: `stable_pane_required`.
  - Closing a tab does not clear its binding: the Run keeps the dead handle as `coordinator_handle`. So when the kit opens a new tab for a session that already has a Run (a restart, or a closed tab brought back by `obk up`), that Run has to be bound to the new tab (on 1.4.209 the kit did it with `run-use --from`; on 1.4.210 it is done from inside the new tab, below). Seen live: the same Run, generation 1 on the closed tab, generation 2 on the new one.
  - `run-show --id <run>` answers `{ run: { id, objective, coordinator_handle, consumer_generation, legacy, created_at, updated_at } }`.
  - **A Run another Orca made is not found, and only `run-show` says so plainly** (#508). Runs live in Orca's own database on the machine, not in the bots folder, so a fleet moved to a new machine has a book that names Runs the new Orca has never had. `run-show --id <run>` for an id not in the database is refused `run_not_found`, "Run <run> was not found."; a legacy Run is answered, with `legacy` set. `run-use --id <run>` is refused `run_not_found`, "Run <run> was not found or is inspect-only.", for a missing Run and for a legacy one alike, so its refusal alone cannot tell the two apart. So the kit replaces a session's Run only when `run-show` says it is not found. **read in code** (the 1.4.223 bundle, `out/main/index.js`, `orchestration.runShow` and `bindRun`, 2026-10-10); the missing case seen by the owner after a move to a new machine (#508).

  The kit used to make each session's Run from wherever `obk up` ran. So the Run was bound to that tab, usually Bot Father's, and the tab got lines about other sessions' mail (seen 2026-09-21 and in issue #228). Every new Run also emptied the Run that tab held before. The kit then made a session's Run with `--from` the session's own tab, so it was bound there from the moment it existed. Seen live after that change (1.4.209): a session brought up from another session's tab got a Run bound to its own tab, and the tab that ran `obk up` kept its own Run and coordinated no other. Orca 1.4.210 refuses that `--from` from inside another tab, so the kit now makes and binds the Run from inside the session's own tab (#317, below).

  Orca writes the notice only into a pane the window has loaded, and only once the agent there has reported idle (read in the bundle: delivery walks the window's loaded panes). A tab the kit opened and nobody has looked at is listed as orphaned and gets no notice, even when it is the coordinator. Seen live on 2026-09-24: four kit-made Claude tabs, each coordinating its own Run and each with unread mail, some after checking in their own tab, showed no line. So Orca's notice is not a delivery mechanism the kit can lean on; the kit's own nudge is. **verified** (live, 1.4.209)

  **When Orca 1.4.214 types its notice, and why a Codex tab never gets it (#402).**
  Read in code (the 1.4.214 bundle, 2026-09-27): the notice goes into a tab only when the tab is its Run's current consumer, Orca's status for the tab is `idle` as seen live, and the tab is TUI-idle; it is tried again when the tab's title turns idle and on a short timer. Orca's status comes from the tab's title alone: `✳ ` or a title naming an agent reads idle, braille spinner characters read working, anything else gives no status. Orca writes a title of its own for Codex, `Codex ready`, only from its Codex hook. No notice goes to a mailbox while an earlier delivery to it is still open. Enter is pressed once, 500 ms after the notice, and nothing checks that it was taken.
  Seen live (2026-09-27, Claude Code 2.1.283, Codex 0.157.1, the kit's own line held back by a wrapper so that only Orca's notice could arrive, throwaway fleet since removed): Claude Code titles its tab `✳ <name>` when idle. An idle Claude receiver got the notice within 1 s; it ran Orca's check, which showed the subject and not the body, so it did not act on the mail, and the message stayed delivered and unread. Mail sent to the same receiver while it was busy was never announced, 3 minutes after its turn ended with its title back to `✳` (the open delivery above is the likely reason, not proven). Codex titles its tab with a spinner while working and the thread's name when idle (`Follow live test instructions | bots`). An idle and a busy Codex receiver got no notice in 80 s and 100 s, and Orca never marked either message delivered. So on 1.4.214 the kit's own line was what reached a Codex tab, and a Claude tab got both (#402; replaced by ADR 0035 for #509). **verified** (live, 1.4.214, and read in code as said)
  **When Orca 1.4.223 types its notice, and what it records (#509).**
  Read in code (the 1.4.223 bundle, `out/main/index.js`, minified, 2026-10-09; nothing of 1.4.214 is left on this machine to compare): the live path stores its state in Orca's database. A new message is tried at once when the coordinator tab's status is `idle` and was seen live, and again 2 s later. The notice goes in only when the tab's mailbox is a `run:` or `dispatch:` one, no delivery to it is open (`status='outstanding'` with a message still unread), no `check --wait` is waiting in that tab, and the tab is settled (a hook's turn end, an idle title, or the screen says ready). It is tried again when the title turns idle, on a timer of about 3 s after the last output, and after a pane change, with no cap. Each message gets one notice: when it settles, Orca sets the message's `delivered_at` and never points at it again, read or not. Enter follows 500 ms later, pressed when the status is `idle` **or `working`**; nothing checks that a turn started, and the input box is not looked at. Nothing turns the notice off: no flag on `send`, `run-create`, `run-use` or `check`, no setting and no environment variable (only an end-to-end test's Enter delay). `check` without `--peek` opens a delivery and marks nothing read; `--peek` changes nothing; `--ack` marks the messages read. `check` and `inbox --json` show `delivered_at`. A tab may not act as another: a check naming another tab's terminal is refused "This terminal is attested as <h> and cannot act as <other>", so a sender cannot see whether its notice went. A Codex tab reads idle when its title does, which is the `Codex ready` title Orca's own Codex hook writes at rest; Orca's hooks are in `~/.codex/hooks.json` and trusted on this machine (read 2026-10-09). **read in code**; live: see below.
  Seen live (2026-10-09, `test/system/mail-one-signal.test.js` at b6c10e5, Orca 1.4.223, Claude Code 2.1.296, Codex 0.162.0, throwaway fleet since removed): Orca typed its notice into an idle kit-made Codex tab at once after the send, and Codex took it as a turn, so a Codex tab does get Orca's notice now, with Orca's Codex hook trusted in `~/.codex`. In the same run an idle kit-made Claude tab got no notice within 8 s, and the kit's line went in instead. Which tabs the window had loaded was not recorded. **verified** (live, once)
  Seen live in a second run (2026-10-10, the same test at b410c57): a busy Claude receiver got nothing typed, and the kit's `Stop` hook in the bot's `.claude/settings.json` told it at the turn end, with two mails named once in one reason. Claude Code 2.1.296 showed no screen about the new hook, and draws a blocking Stop hook's reason as "Stop hook error: <reason>"; the session goes on with it all the same. A busy Codex receiver took the kit's line as a user message inside its running turn, 18 s after the send (at its next step), left nothing in its input box, read the mail in that turn, and got no Orca notice for it in the 60 s after the turn ended. A Codex receiver whose first turn had just ended was being named by the kit's own naming hook (#480), which held its typing turn, so the send typed nothing and said so. **verified** (live, once)
  Seen live in a third run (2026-10-10, the same test at 484c009, all seven cases passing): Orca's notice reached an idle Codex in about 2 s, and the send typed nothing; an idle Claude got no notice in 8 s, and the kit's line went in. A Codex the kit's naming hook was typing into got nothing from the send, and Orca's notice reached it 30 s later, once the naming was done. The kit's Claude hook, now telling as the Stop event's `additionalContext`, was drawn as "Stop hook feedback" and not "Stop hook error", and the session went on and read its mail. A busy Codex took the kit's line 17 s after the send, at its next step. **verified** (live, once)
  Read in the Claude Code 2.1.296 binary: a Stop hook's `{"decision":"block","reason":…}` is drawn as "Stop hook error: <reason>" in red, with a "Stop hook error occurred" notice; its `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":…}}` is drawn as "Stop hook feedback: <text>" in gold, and is added to the messages the turn goes on with, except in its bare mode (`CLAUDE_CODE_SIMPLE` or `--bare`). **read in code**, the drawing **verified** (live, run 3)
  Read in the Codex source (rust-v0.162.0, `hooks/src/engine/discovery.rs`, `dispatcher.rs`, `events/stop.rs`), not seen live: a `Stop` hook may answer `{"decision":"block","reason":…}` (or exit 2 with the reason on stderr), and Codex goes on with the reason as a prompt; an `async` hook's stop answer is dropped. A hook's trust hash covers its event, its matcher and its whole entry (command, timeout, `async`), and its key the file, the event and its place, so a new or changed entry is untrusted and shows "Hooks need review". The TUI takes a line entered during a turn as a steer into that turn. **read in code**
  Seen in a real fleet's Codex rollout (guanxi/architect, 2026-10-08, read 2026-10-09 for #509): Orca's notice started a turn in a Codex tab (06:31:39Z), and three kit lines typed while that turn ran each went in as a user message of the same turn at once (06:36:48, 06:39:11, 06:42:22Z), so Codex took them as steers and none waited. A "Fleet mail from …" line seen in that tab's input box the next day, after its session was resumed, was not one left unsent: nothing after the resume is in the rollout, and on resume Codex seeds its input history with the conversation's own user messages (`tui/src/chatwidget.rs`, `record_replayed_user_message_history`, rust-v0.162.0), so an Up key brings back the newest one. What sent that key is not known; the kit sends none. **verified** (rollout) and **read in code**
  Read in the Claude Code 2.1.296 binary's strings, not seen live: no review screen for a new or changed hook in a project's `.claude/settings.json`; the only "Hooks changed in …" text is for a cloud session's pinned settings. **unverified**
- **Reading a Run is fenced to one reader.** `check --run <id>` reads as the caller's terminal, or as `--terminal <handle>`. A reader bound to another Run is refused with `consumer_fenced: This coordinator terminal is bound to <other run>, not <run>`. `run-use --id <run>` binds the reader, and the read then works. `check --run <id> --terminal <h>` (also with `--peek` or `--ack`) reads and acknowledges as `<h>`, from another tab or from a shell with no Orca at all. So `obk message check` bound and read as the session's own tab when it was live, wherever it was typed. **verified** (live, 2026-09-24, 1.4.209). On 1.4.210 a read as another terminal is refused from inside a tab (below).
- **A read binds nothing; `run-use` is what binds.** `check --run <id> --terminal <h>` is judged on whether `<h>` is the Run's coordinator, and a closed tab stays its Run's coordinator. So reading as the handle `run-show` names works after that tab is closed: peek, read and `--ack` all went through, and `run-show` still named the closed handle with the same `consumer_generation`. A live tab that holds no Run is refused `consumer_fenced: This coordinator terminal is no longer bound to Run <id>`, a handle Orca never issued `stable_pane_required`, and once `run-use --from <new tab>` rebinds the Run, the old closed handle is fenced out the same way. So `obk message check` for a session with no live tab reads as the Run's own coordinator and calls no `run-use`: the old way, binding the caller's terminal first, handed the session's Run to whoever read it and left the reader's own Run with no coordinator (#249). A Run with no coordinator has no reader to read as, and its mail waits until the session's tab is up and bound again. Seen through the kit in a throwaway fleet: a paused session's mail read with `--peek` and without, from a shell tab holding no Run and from another session's tab, left all three Runs with the same coordinator and generation, and `obk unpause` bound the Run to the new tab. Orca's own notice for the next message showed in no tab, the new one included: the window had not loaded it (orphaned), as above. Not seen: whether a closed handle still reads after Orca itself restarts. **verified** (live, 2026-09-24, 1.4.209)
- **On Orca 1.4.210 a caller in an attested tab may name only itself** (#317). From inside a kit session's Claude tab, `run-create --from <another tab>`, `run-use --id <run> --from <another tab>` and `check --run <run> --terminal <another tab>` are all refused, and change nothing: `consumer_fenced`, "This terminal is attested as <caller> and cannot act as <other>", `effectsApplied: false`. The same holds for a closed tab's handle, so a closed tab's Run can no longer be read from elsewhere. `run-show` and `send --to run:<id>` still work from any tab. Inside a tab from `terminal create` with no `--command`, a plain `run-create` binds that tab, `run-use --id <run>` with no `--from` (or with its own handle) binds it too and takes a Run over from a closed tab, and `check` as itself reads. **verified** (live, 2026-09-25, 1.4.210, a throwaway folder project; its probe Run `run_00967974a507` is left behind, as Runs cannot be removed). Read in the 1.4.210 bundle and not tested live: every orchestration call sends `ORCA_TERMINAL_HANDLE`, `ORCA_PANE_KEY` and `ORCA_AGENT_LAUNCH_TOKEN`, and the caller is attested only when all three are there, the token matches the one Orca stored for that pane, and the pane has reported a hook event; an unattested caller may still name any live handle. A tab from `terminal create` with no `--command` gets no launch token. When Orca restores its tabs after an update or restart it resumes each harness itself, mints a token for it, and does not type the kit's launch line. Orca's own guide says `--from` cannot nominate another coordinator and is to be left off for ordinary calls. So the kit makes or binds a session's Run from inside the session's own tab: the launch line starts with `obk session mailbox`, which runs in the tab's shell before the harness does, and a session Orca restored gets its Run back at its first `obk message check` in its own tab, which binds the book's Run to that tab. Not known: what a shell outside Orca gets on 1.4.210 (allowed by the code as read, against Orca's stated intent, so the kit does not build on it).
- **`reply --id` is filed under the replier's Run, not the recipient's**, so the recipient's `check --run` does not return it. A reply the recipient can actually read is an ordinary `send` back to their `run:<id>`, with `--thread-id`.
- **No wake-up reaches a harness that has not read that mailbox.** A message addressed to the tab of a running Claude session left that session's screen untouched. But once a terminal is bound to a Run — which `run-use` does, which `obk up` does for the session's own tab when it makes the Run, and which `obk message check` does again for a session whose tab is live — and the window has loaded that tab, Orca writes a line of its own into that tab for the next message: `You have 1 orchestration message. Run orca orchestration check --run run_…`. Seen live in a kit-made Claude tab. **On this machine that advice fails**: it says bare `orca`, which is the root-only symlink at `/usr/local/bin/orca`, and the session answered `Unable to determine Orca.app path from symlink`. So the kit types its own line naming `obk message check`, and the rules tell a bot to use that one. The mailbox is pull-only in every case: something has to run `check`. What does carry, and is what PRD 6.9 means by "queued, not interrupting", is one line typed into the tab: a busy Claude Code tab takes it as a queued message and finishes what it was doing first, and Codex takes it as the next turn. **verified** (live, 2.1.278 and 0.155.1)
- **What a message carries, and what a delivery is.** A message is `{ id, run_id, delivery_contract, from_handle, to_handle, subject, body, type, priority, thread_id, payload, created_at, delivered_at }`; the sender is `from_handle`, as `run:<id>` when a Run sent it, and `thread_id` is null unless it answers something. A plain `check --run <id>` hands over the oldest batch that has not been acknowledged and names it: `{ runId, deliveryId, messages, count, acknowledged, … }`. `check --run <id> --ack <delivery_id>` acknowledges that batch and checks in the same call, answering `acknowledged: "<delivery_id>"` with the next batch beside it — an empty one when there is no more mail, `deliveryId: null` and `count: 0`. `--peek` answers `{ runId, messages, count, acknowledged }` with no `deliveryId` and changes nothing. **verified** (live)
  **A Run has one outstanding batch at a time, and newer mail waits behind it.** A plain `check` replays the outstanding delivery, the same messages under the same `delivery_…` id, however much mail has come in since; only when there is none does it make a new one, of the oldest unread messages, at most 50. `--ack` takes a delivery id, not a message id (`stale_delivery`), marks exactly that delivery's messages read, and makes the next. `--peek` lists every unread message, up to 100, whatever batch it is in. So a delivery left unacknowledged — by a read that stopped before its `--ack`, or by Orca's own `check` typed by hand — hides everything after it from a reader that takes one batch per check, and `obk message check` takes batches until none is left (#299). Read in the bundle (`getOrCreateRunDelivery`, `acknowledgeMailboxDelivery` and the Run `check` handler, 1.4.209); the head-of-line part seen live in #299, the limits of 50 and 100 not.
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
- **The name is an address, and it survives a resume.** Proved live on 2026-09-21 (2.1.278, in Orca tabs): a session launched `claude --permission-mode auto -n obk-nameprobe` was addressed by that name from another session, woke while idle and answered. Its tab was then closed and it was brought up in a new tab with `--resume <id>` **and no `-n`**: the registry still held the name, the conversation came back, and a message sent to the name reached it and was answered from what it had been told before the close. The kit passes `-n` on every launch line it types: a fresh start gets a new name, a resume of a conversation the kit gave a name of its own keeps that one (#286), and a resume of any other conversation gets a new one (#319). **verified** (live)
- **A name more than one session holds is refused.** On 2026-09-24 a send to `bot-father.daily` was refused with "72 agents are named 'bot-father.daily'. Re-send with the ref of the one you mean": one live session, the rest offline sessions of this account listed through Remote Control, from earlier runs, other machines and throwaway test fleets. Offline ones count. So `<bot>.<session>` is not an address, and the kit adds a token of its own for each new conversation (#286); a session still under the bare name is written to through its mailbox until the kit's launch line next starts it, which renames it (#319). **verified** (live, in the issue)
- The name is kept inside the conversation: its transcript carries `agent-name` lines (`agentName`) beside `custom-title` and `bridge-session` lines, and the `bridge-session` id stays the same across a `/clear` in one process (seen in kit-dev transcripts, 2.1.281). **seen on disk**.
- **`--resume <id> -n <other name>` renames a conversation that already has a name.** Run live by the owner on 2026-09-25 (2.1.282, macOS, a scratch folder): a conversation started `claude -n obk-probe286-a` recorded `customTitle`/`agentName` `obk-probe286-a`; `claude --resume <its id> -n obk-probe286-b` reopened the same conversation (same id), its process record said `name: obk-probe286-b`, the transcript's latest `customTitle`/`agentName` was `obk-probe286-b`, the peer listing showed `obk-probe286-b` and no `obk-probe286-a`, and a native message to `obk-probe286-b` was delivered. So the kit's launch line moves a session under an old name to an address of its own (#319). The kit's own restart of a session under `<bot>.<session>` was then run live in `test/system/old-named-session.test.js` (2026-09-26, Claude Code 2.1.283, Orca 1.4.212): the same conversation came back in a new process registered under the new address the book held, and one native send to it arrived. Orca's own restore types a bare `claude --resume <id>`, with no `-n`, and renames nothing. **verified** (live, in #319). Not checked: whether the old name still reaches the conversation for a native send; it was not listed.
- Subagents: a subagent starts with a fresh context; a fork inherits the conversation. Test authors and reviewers must be fresh subagents. **verified** (docs)
- Transcripts: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, where the slug is the working directory with every character that is not a letter or a digit turned into `-` (checked against real folders on this machine). One folder per working directory is how the kit asks Claude Code what conversations a bot home has had. Usage per API call in `assistant.message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); dedupe by `requestId` + `message.id`, and **keep the last of a repeated pair, not the first**: the same request and message id can be written twice with the usage still rising, seen live with `output_tokens` going from 16 to 301 between `09:29:21.187Z` and `09:29:21.936Z`. 4,736 repeated pairs in 137 transcripts carried identical usage and one did not, so keeping the first looks correct for a long time and then quietly undercounts. Model in `message.model`; effort in `effort`; each line carries its own `timestamp`, so usage can be counted from a moment rather than from a whole conversation. `/clear` starts a new session file. **`input_tokens` excludes the cache reads**: a real line reads `input_tokens: 2` beside `cache_read_input_tokens: 13460`. Compaction marker is a line with `type: "system"` and `subtype: "compact_boundary"`, carrying `compactMetadata` with `trigger`, `preTokens`, `postTokens` and `cumulativeDroppedTokens`. **verified** (2026-09-21, 2.1.278: 131 transcripts read, 2 genuine markers; 15 files held the string and 13 of those were only sessions discussing it, so match the two fields and not the text).
- **A subagent's calls are in files of their own, beside the conversation that started it**: `~/.claude/projects/<cwd-slug>/<sessionId>/subagents/agent-<name>.jsonl`, with an `agent-<name>.meta.json` beside each (`agentType`, `description`, `toolUseId`, `spawnDepth`), which is not a transcript. The lines have the main transcript's shape, with `isSidechain: true`, `agentId`, and `sessionId` set to the parent conversation's id, so usage is counted from them the same way and belongs to the conversation that started them. The same call (`requestId` + `message.id`) can be written into more than one subagent file of one conversation, at the same moment and with its figures still rising (`output_tokens` 8 in one, 322 in four others), so a call counts once across the main transcript and all its subagent files together. Read on this machine on 2026-09-27: 286 subagent files under 71 conversations, none nested, none without its main transcript, 25 calls in two or more subagent files, none also in the main transcript. Over one grooming window they held about 3,900 calls that `obk usage` did not count (#371). **seen on disk**
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

- **Claude Code's own scheduler, which grooming runs on (#237).** A session schedules a prompt with its `CronCreate` tool (`cron`, `prompt`, `recurring`); `CronList` and `CronDelete` list and cancel. From the docs (code.claude.com/docs/en/scheduled-tasks, read 2026-09-25): jobs belong to the conversation and fire only while Claude Code runs and is idle, a fire due while it is busy waits for the turn to end, and missed fires are not made up; a recurring job fires up to 30 minutes after its time and expires 7 days after it was made, firing once more and then deleting itself; a `--resume` or `--continue` restores the jobs that have not expired, and a new conversation starts with none; a fire cannot run a built-in command such as `/clear` or `/compact`, which reaches Claude as plain text; a session holds at most 50 jobs; `CLAUDE_CODE_DISABLE_CRON=1` turns it off. **verified** (docs). The tool's own description in 2.1.282 gives a different jitter, "up to 10% of their period late (max 15 min)", and says a job is "Session-only (not written to disk, dies when Claude exits)"; its `durable` parameter reads "Has no effect — durable persistence is not available" on this account (seen 2026-09-24 by the architect, and 2026-09-25). **verified** (the tool's description)
  How a job is written in the conversation's transcript, seen live on 2026-09-25 (2.1.282, a one-shot probe job made and deleted in a kit-dev session): the call is an `assistant` line with a `tool_use` item `{ name: "CronCreate", input: { cron, prompt, recurring } }`; its answer is a `user` line whose `tool_result` names that `tool_use_id` and whose `toolUseResult` is `{ id, humanSchedule, recurring, durable }`, the `id` 8 characters, with the line's `timestamp`. A `CronDelete` is answered with `toolUseResult: { id }`, and a `CronList` with `toolUseResult: { jobs: [{ id, cron, humanSchedule, prompt, durable }] }`, while the text Claude reads cuts each prompt at about 100 characters with `…`. A call that failed has `is_error: true` on its `tool_result` and a string `toolUseResult` beginning `Error:`. So the kit reads which grooming jobs a conversation holds from its transcript, as it reads usage. **verified** (live)
  Seen live in #237's system test (2026-09-26, Claude Code 2.1.283, Orca 1.4.212, five runs of `test/system/groom.test.js` on throwaway fleets, the grooming session on `sonnet` at `medium`; the fifth passed end to end):
  - **A line typed into the tab is obeyed**, even a long one, which arrives wrapped as pasted text (`<pasted_content …>`): the session called CronList and then CronCreate as `obk groom --on --at` asked.
  - **A fire is written** as a line `{"type":"system","subtype":"scheduled_task_fire"}` and then the job's prompt as a `type: "user"` line with string content, about 60 ms later. All five daily jobs fired 30 minutes after their time, to the second or one second more (the scheduler checks once a second), so the tool's own "max 15 min" is wrong on this version and the docs' 30 is right.
  - **The run uses the session's model and effort**: every assistant line of the fired run had `message.model` `claude-sonnet-5` and `effort` `medium`, the ones on its launch line.
  - **A cross-session message arrives** as a `type: "user"` line whose content begins `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/<n>.sock" from-name="<the sender's name>" from-mode="prompting">`: `from` is the sender's socket and its name is `from-name`.
  - **A run renews its own job**: it made a new one with the same cron and prompt, and deleted the one that fired, leaving one with a later expiry.
  - **The job survives `obk restart`** (a `--resume`) **and a compact** (`obk groom --compact`, a `compact_boundary` line): CronList answered it after each.
  - **The job survives `/clear`**, against the docs' "a fresh conversation clears them": the conversation the `/clear` began answered CronList with the job made before it. A job lives in the running process, not in one conversation. So the kit reads the jobs from the conversations the current process has had: the book's current one, and back through its `clear` history until the conversation where the process began.
  - **A resume brings back only the jobs of the conversation it resumes.** After a `/clear`, `obk restart` resumed the conversation the clear began, and CronList answered no job: the one made before the clear, still running a moment earlier, was gone. A resume of a conversation that did not begin with a clear brought its job back, as the docs say.
  - **Where a process began is in the transcript**: the kit's SessionStart hook leaves an `attachment` line `{"type":"hook_success","hookEvent":"SessionStart","hookName":"SessionStart:<source>"}` in the conversation, with `startup` on a fresh start, `resume` after `--resume`, `clear` in the conversation a `/clear` began and `compact` after a compact. A bare `claude --resume <id>` typed into the tab after `/exit`, with none of the kit's launch line, as Orca's cold restore starts a session (#318), wrote the same `resume` line.
  **verified** (live). **unverified**: that Orca's own cold restore runs exactly that bare command; it was not triggered, because it means restarting Orca under everyone's tabs.
- **Claude Code writes a folder it runs in into `~/.claude.json` (#240).** Read in the 2.1.284 binary, with its docs: `projects["<git root, or the folder>"]` is written on every interactive start past the folder trust (on mount and on exit: `lastSessionId`, costs and the like), trusted or not by any setting, and `numStartups` and tip counters change on every start, so the file is never the same after a run. Seen live on 2026-09-28 (2.1.284): a session whose folder trust was left unanswered wrote no key for its folder. Nothing found gives an interactive session trust without writing: `--dangerously-skip-permissions` does not, `-p` is not interactive, `CLAUDE_CODE_SANDBOXED` changes what the session may do, and an ancestor's trust stops at the git root, which a bots folder is. `CLAUDE_CONFIG_DIR` moves both `~/.claude` and `.claude.json`, and the login's keychain item with them. The owner chose (b) on 2026-09-29: after a run, the test runner takes out exactly the keys that run added under its own throwaway folders, from this record and from Codex's `config.toml`, the known writers' included, and names them; everything else in both files stays as it was. It reads, changes and writes each file straight away, through a temp file and a rename. A harness that writes the same file in that moment can lose its own write, or put a removed key back; the owner accepted that race with (b). **verified** (live, the unanswered trust); **unverified** (the rest, read in the binary)
- **A folder whose `.claude/settings.json` pre-approves a permission asks for trust, naming it (#238).** Seen live once, on 2026-09-29 (Claude Code 2.1.284, Orca 1.4.215, `codex-groom-run`'s live run 4): after `obk bot change --allow 'Bash(<kit> temp trust-hooks:*)'` on a throwaway Bot Father, its next new session stopped on the folder trust with `⚠ This folder pre-approves 1 tool permission in .claude/settings.json:`, the rule cut short with `…`, `These will apply without asking. Only proceed if you trust this configuration.`, and the usual ` ❯ No, exit` / `   Yes, I trust this folder`. **seen** (live, developer-1). Worked out, not proven: the rule is what brought the screen up. Runs 2 and 3 of the same test, with no rule, came up in the same kind of fresh folder with no screen, and Claude recorded the folder in `~/.claude.json`, which it does only past the trust. The architect's cleanup of `~/.claude.json` between them removed only entries for folders no longer on disk. **Not known**: whether a folder already trusted is asked again when a rule is added. So the owner's Bot Father may show this screen once after the rule goes on. `codex-groom-run` answers it in its own throwaway tab, and only when the rule named is exactly its own (the architect's ruling on #238).

## 3. Codex CLI

- Launch flags (**verified** from `codex --help` on 0.155.1): `--approve-for-me` (automatic review, workspace-write sandbox), `-a/--ask-for-approval on-request|never`, `-s/--sandbox read-only|workspace-write|danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd <dir>`, `--add-dir <dir>`, `-c key=value`, `codex resume <id>`.
- **Codex 0.157 shares one background server between its sessions by default, and the kit starts Codex without it.** `codex features list` reports `daemon_auto_start experimental false` on 0.156.1 and `stable true` on 0.157.1. **verified** (both versions on this machine, 2026-09-26). On 0.157.1 a bare `codex resume <id>` typed into a tab failed once in two tries with `Error: Cannot use the shared background server: Experimental feature request failed. To work without the background server, rerun the same command with --no-daemon`, and the same resume with `--no-daemon` came up (developer-2, #318's live runs, 2026-09-26). **seen** (live, once). `--no-daemon` ("Run without the shared background server, even if it is already running") is accepted by `codex` and `codex resume` on 0.156.1 and 0.157.1, and 0.155.1 refuses it with `unexpected argument '--no-daemon'`. **verified** (from each version's parser). So every Codex launch line the kit types carries `--no-daemon`, which on 0.157 is how 0.156 ran by default, and the kit needs Codex 0.156.1 or newer (#330). Orca's own cold restore types a bare `codex resume <id>` (section 1), so it can still meet the error on 0.157. `obk health` names a session the kit's line did not start, and `obk restart` brings it back on the kit's line.
  **A command run through the shared server carries the tab of the session that started it (#408).** Seen by kit-dev/architect after a machine restart (2026-09-27, Orca 1.4.214, codex-cli 0.157.1): Orca brought three Codex sessions back as bare `codex resume <id>`. The shared server's processes (`codex app-server --listen` and its children) all carried one session's `ORCA_TAB_ID` and terminal handle, and another of those sessions, whose own process had its own tab id, reported that the commands it ran saw the first one's. After `obk restart` of that second session, its new Codex (with `--no-daemon`) stopped at "This conversation is open in another app. Close it there and press R to continue here.", and `lsof` showed the server, a child of the first session's restored Codex, still holding its rollout. **seen** (live, by the architect). A tool command of `codex exec` (0.157.1, no server) inherits Codex's own environment whole (`OBK_TAB_SHELL`, `ORCA_TAB_ID` as given) and adds `CODEX_THREAD_ID` and `CODEX_SESSION_ID`, both the conversation id, `CODEX_SANDBOX=seatbelt` and `CODEX_VERSION`. **seen** (live, developer-1, a scratch folder, 2026-09-27). So the kit's launch-line mark reaches the commands of a Codex it started, and that Codex never uses the shared server; a command with no mark in a Codex session's tab cannot be taken to be that session, and the kit refuses to take its caller from the tab. Not seen: which environment the server gives a hook.
  **Whether a restart frees a conversation the server holds depends on whether the server is still the child of the Codex that started it.** In the real case above, the server was a direct child of the first session's restored Codex (ppid 1324), and when that session was restarted the server went with it; the second session then came back after one retry. **seen** (live, by the architect). In the kit's system test (`test/system/restored-codex-caller.test.js`, 2026-09-28, the same versions), the server started by a bare resume ran as `codex app-server --listen unix:// --managed-daemon` under pid 1, with a `codex app-server daemon pid-update-loop` beside it; after `obk restart` of both sessions, one came back at "This conversation is open in another app" and stayed there through one more restart of it alone. **seen** (live, developer-1). `codex app-server daemon stop` ended that server (`{"status":"stopped"}`) but not the updater helper, which Codex records in `~/.codex/app-server-daemon/daemon-updater.pid` and which no command of Codex's ends; a later run's server reused the running helper rather than starting another. **seen** (live, developer-1). In a later run both sessions came back at "open in another app" after the restart, and `codex app-server daemon stop` followed by `obk restart` of each brought both back ready, with the kit's commands working in them. **seen** (live, developer-1, 2026-09-28). So the kit's advice leads with the stop, once every session using the server is back on the kit's line, and warns that it stops the server for everything using it. The kit does not run it itself.
- **Codex fires SessionStart for a resumed conversation only at its first turn, and Orca lists the pane only then (#226).** Seen live twice on 2026-09-28 (codex-cli 0.157.1, Orca 1.4.215, Claude Code 2.1.283 as the control; `test/system/codex-resume-listed.test.js`): after `obk restart` of a Codex session whose conversation was in the book, a SessionStart hook in the bot folder did not run, and `orca worktree ps --json` listed no agent for the project, for 45 s and more. One typed line later the hook ran with `source: "resume"` about 2 s after it, and the pane was listed with `agentType: "codex"` about 5 s after it. A resumed Claude session's hook ran at the resume (+3 s) and it was listed at +4 s, with no line. Orca's `agentIdentity` named `codex` 7–11 s after the restart, before any hook, from the tab's title. The agent row names neither the bot nor the session: `displayName` and `taskTitle` are null for both harnesses. So the kit types one line into a Codex session it has just resumed (#226, the owner's decision of 2026-09-24), through the gate every typed line goes through, and reports `listLine`. **verified** (live, twice)
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

- **Rules: a bot folder's `.codex/rules/*.rules` is read by the TUI the kit starts there**, below the bots repo's git root. The form is `prefix_rule(pattern=["word", …], decision="allow"|"prompt"|"forbidden")`, one command's leading words per rule, and `codex execpolicy check --rules <file> -- <command>` answers which rules match. Seen live on 2026-09-26 (Codex 0.157.1, Orca 1.4.212, #354), with the rollout and the disk as the evidence: in a kit-made throwaway fleet, a session on the kit's `auto` launch line (the rollout's `turn_context`: `on-request`, `auto_review`, `workspace-write`), with a hand-written `<bot>/.codex/rules/obk.rules`, had `echo obk-forbid-probe` rejected ("policy forbids commands starting with `echo obk-forbid-probe`"), ran a `touch` of a file outside every writable root that an `allow` rule named (the file was made, with no review), and had the same `touch` of another file, which no rule named, stopped by the sandbox (`Operation not permitted`, no file). `codex exec` in a folder two levels below a git root read that folder's rules too, and the same run without the file ran the echo. **verified** (live). So an `allow` rule runs its command **outside the sandbox**, without the reviewer. developer-1 saw the same for `codex exec` the same day: an allowed `curl` reached the network that the sandbox had refused it without the rule.
  **The sandbox reads everywhere and writes only the bot folder, `/tmp` and `$TMPDIR`**: the same rollout's `permission_profile` gives the root `read` and those three `write`, and the bot folder's own `.codex` `read` only. **verified** (read in the rollout)
  **Codex ignores an untrusted project's `.codex/` layers, rules included** (its advanced-config docs: "ignores project `.codex/` layers, including `.codex/config.toml`, project-local hooks, and project-local rules"). Not tried live: `codex exec` writes `trust_level = "trusted"` into `~/.codex/config.toml` for the folder it runs in, even one under `$TMPDIR` that nothing trusted before (seen 2026-09-26, 0.157.1), so it cannot run in an untrusted project, and a `-c projects."<folder>".trust_level="untrusted"` did not stop the rules either. The TUI's trust screen offers only to trust or to quit, so a kit session is always in a trusted project. **verified** (docs); **unverified** (live)
  **A review by Codex's automatic reviewer is a conversation of its own**: a rollout whose `session_meta` carries `thread_source: "guardian_review"`, `source: {subagent: {other: "guardian"}}` and `parent_thread_id` set to the conversation it reviews, and whose last answer is JSON with `outcome` `allow` or `deny`. The command it reviews asked for `sandbox_permissions: "require_escalated"`. **verified** (read on this machine, a 0.156.1 kit-dev reviewer's rollouts) Seen again on 2026-10-02 (#449): all 71 guardian rollouts in kit-dev's folder name in `parent_thread_id` a conversation kit-dev's book claims, and `session_id` holds the same value; a session's spawned subagent names its parent under `source.subagent.thread_spawn.parent_thread_id` instead. So `obk usage` counts a session's spawned subagents, at any depth, in its conversation's row as subagent calls, and its reviews there as `review_calls`, apart; one whose parent no session claims stays unclaimed. **verified** (session_meta read, 2026-10-02)
- Hooks: `~/.codex/hooks.json`, **and `<project>/.codex/hooks.json` in the folder the session starts in** — same JSON shape as Claude Code's `hooks` block, same events, same payload on stdin (`{ session_id, transcript_path, cwd, hook_event_name, source, model, permission_mode }`). A SessionStart hook can put text into the session the same way, with `additionalContext`. **verified** (live, 0.155.1).
- **While the hooks review is on screen, the conversation has not started.** Measured live (0.155.1): a tab left on `Hooks need review` for four minutes had no rollout in `~/.codex/sessions` for its folder at all — Codex does not begin the conversation behind that screen. So there is no "conversation running while the hooks file is untrusted" to be had by leaving the screen alone; the third choice, `3. Continue without trusting (hooks won't run)`, is what gives one: the conversation runs and no hook fires. On the numbered screen `2` trusts every hook and continues, `1` opens the review list — Orca's own hook sits there beside the kit's — and `esc` backs out of it. `t` does nothing on the numbered screen; it is the review list that answers to it. **verified** (live)
- A project hooks file must be **trusted once**. The TUI shows `Hooks need review … 1. Review hooks / 2. Trust all and continue / 3. Continue without trusting`; `t` on the review screen trusts all. Until then the hook does not run and nothing else says so. Orca has reported that screen as `blockedReason: "agent-hooks-review-prompt"`, but on Orca 1.4.209 it does not: see the next line. Trust is recorded per hook entry in `~/.codex/config.toml` under `[hooks.state."<file>:<event>:<n>:<m>"]` as a hash, so **changing an entry asks again** while an unrelated change to the file does not. `--dangerously-bypass-hook-trust` skips it; the kit does not use it. **verified** (live)
- **What the hooks review covers, and how Codex records trust (#506).** Read in the Codex 0.162.0 source (tag `rust-v0.162.0`, commit c1382380, `codex-rs/tui/src/startup_hooks_review.rs`, `hooks/src/engine/discovery.rs`, `hooks/src/lib.rs`, `config/src/fingerprint.rs`). The review counts every hook that is new or changed, from every source but the managed ones: `$CODEX_HOME/hooks.json` and `[hooks]` in `$CODEX_HOME/config.toml` (Orca keeps its own hooks there), hooks given with `-c`, plugins, and the `.codex/` folder of each trusted folder from the git root down to the session's folder. The count row is `1 hook is new or changed.` or `<n> hooks are new or changed.`, and the screen does not show at a count of 0. `2. Trust all and continue` trusts exactly the hooks it counted, and writes them to the user's config.toml. Trust is one table a hook: `[hooks.state."<file>:<event>:<group>:<handler>"]` with `trusted_hash = "sha256:<hex>"`. `<event>` is snake case (`session_start`, `post_tool_use`, `stop`), and the two numbers are the 0-based places of the group in the event's list and of the hook in the group. The hash is SHA-256, in lowercase hex, of the JSON with every key sorted and no spaces of `{"event_name", "matcher" (left out when the group has none, and always for `stop`), "hooks": [{"type": "command", "command", "timeout", "async"}]}`. A hook with no table is new, and one with another hash is changed. So moving a hook in the file changes the key of each hook after it. **verified** for the hash: computed for amc-tutor's three kit hooks, it matched all three tables Codex wrote in the owner's config.toml (2026-10-09, read only). The rest is read in the source, not seen live. So `obk session trust-hooks` and `obk temp trust-hooks` answer only when the count on the screen is the number of the kit's own hooks that have no table with their current hash.
- **Rollouts can be too big for one string, and archived ones move (#396).** A rollout is one JSON record a line, with `session_meta` first; a kit session's was seen at 1.28 GB and a carried-in one at 1.56 GB (2026-09-28), past what a single string holds, so the kit reads the first line alone and a whole rollout a line at a time, never whole (`src/lines.js`). Codex moves a rollout the user archives into `~/.codex/archived_sessions/`, one flat folder of `rollout-<time>-<id>.jsonl` (seen: 1,232 files, no subfolders), so the kit's lookup by id searches there after `sessions/`; a fork's origin can be there (the live case's was). Whether Codex archives in any other way, or to any other place, is not known. **verified** (live, the folder and the sizes)
- **A GPT-6 Codex told to wait sleeps in its own turn (#432).** Codex 0.158.0 has a built-in `sleep` tool (feature `sleep_tool`, stable and on by default; offered to models that list "clock", which `models_cache.json` shows for gpt-6-astra, gpt-6-sol and gpt-6-luna, not gpt-5.x), which holds the turn open for up to 12 h and ends early when new input arrives. Seen live on 2026-09-28 (Orca 1.4.215, `test/system/codex-sleep.test.js`): a bot whose prompt ends "Say nothing now and wait." called `sleep` (1 h, then 12 h), its tab stayed busy, and the kit's mail notice, typed into that busy tab, ended the sleep about 11 s after the send; the bot read its mail 16 s after it, twice. The send then reports `nudgeUnseen` ("no turn start was observed"), which is misleading here. Once the woken tab went idle at 16 s; the other time it was not yet idle when the test stopped watching, at about 16 s, and what came after was not seen. So a real bot still gets its mail, and the kit's launch line keeps the tool. `-c features.sleep_tool=false` removes it (seen live: no sleep call, the turn ends); the system tests pass it, since their waits for an idle tab never end otherwise. **verified** (live); the source reading is **unverified**.
- **A system test gives Codex its trust at launch, so nothing is written into the user's config (#240).** On the launch line, through the session's `extra_args`: `-c 'projects={"<bots folder realpath>"={trust_level="trusted"}}'` (the whole table in one `-c`; the dotted form `-c projects."<path>".trust_level=…` cannot work, since Codex splits a `-c` key on every `.`), `--dangerously-bypass-hook-trust`, and `-c tui.show_tooltips=false` (which stops a model-notice counter being written at startup). On 0.160.0 that counter is `[tui.model_availability_nux]`, a count per model of its new-model notice. Read in its source (tui/src/app/startup_prompts.rs, tag rust-v0.160.0), not seen live: it is written at startup only while `tui.show_tooltips` is on, and at most 4 times per model, and a `-c` reaches it, since the TUI takes the setting from the effective config. `codex-first-run-screens` gives its Codex that one override, and none of the trust ones, which it answers on purpose; `codex-groom-run`'s Codex run, made inside its grooming job, does not, so the runner names a changed counter as a harness write and leaves it (#456). Seen live on 2026-09-28 (Codex 0.158.0, Orca 1.4.215): no folder trust and no hooks review showed, the kit's SessionStart hook ran, and `~/.codex/config.toml` gained no `[projects]` or `[hooks.state]` table for the test's folder, across 12 converted system tests; a resumed Codex kept the arguments (`restart`, 3 of 3). Only `codex-first-run-screens`, which answers the screens on purpose, added its one of each. **verified** (live). Read in the 0.158.0 source, not seen: the trust check tries the session's folder and then its git root, realpath first, so the bots folder covers every bot; with the folder trusted and no bypass, the hooks review still shows and the hooks do not run; its `3. Continue without trusting` writes nothing. Also read, not seen: a `codex exec` in a folder already trusted this way writes no trust of its own (the write happens only while `trust_level` is unset); #240's live run did not reach it. This is for tests only; a user's own bots answer their trust as before.
- **Orca does not flag either Codex first-run screen on 1.4.209.** Measured live (2026-09-24, Orca 1.4.209, codex-cli 0.156.1, #288): a tab the kit opened stopped on `Trust this folder?`, and after that was answered, on `Hooks need review`. On each screen `terminal wait --for tui-idle` answered `ok:true`, `satisfied:true` with no `blockedReason`, three times in a row, and `agentIdentity` was null. `obk up` reported both tabs as come up. The rendered screen (`terminal read --screen`) is the only thing that shows either question. So `up`, `restart` and `unpause` do not say a tab came up when Orca names no reason; they say the kit cannot see whether a screen is waiting, and point the caller at the tab. **verified** (live)
- **A hook runs as a child of the harness process here too.** Measured live (0.155.1): the hook command's process has `codex` as its parent, and `codex`'s parent is the shell the launch line ran in. A `codex exec` the session starts is a harness of its own, further down that chain, and it fires the same hook with its own conversation id — which is how a child's conversation can be mistaken for the session's. **verified** (live)
- **Codex runs its SessionStart hook outside its `workspace-write` sandbox**, where `/bin/ps` does not
  start at all (#298). Seen through the kit on 2026-09-25 (codex-cli 0.156.1). kit-dev's `review-237`
  and `review-325` ran at the kit's `auto` level, and their rollouts' `turn_context` records
  `sandbox_policy.type: "workspace-write"`. The book holds each one's conversation id. The only code
  that writes that id is the hook's `recordSession`, and it writes only after its `ps -Ao
  pid=,ppid=,comm=` has answered. So the hook's `ps` ran, and the process-tree check works on Codex at
  the kit's default level. Codex says so itself: its `Hooks need review` screen reads "Hooks can run
  outside the sandbox after you trust them" (seen 2026-09-26 on 0.156.1 and on 0.157.1). A `/new`
  goes the same way: in #318's live check (0.156.1), a `/new` in a `workspace-write` session was
  written to the book. **verified** (through the kit's own record, and on Codex's screen)
- **Codex runs a `PostToolUse` hook for its shell tool outside the sandbox too, right after the
  command** (#350). Seen on 2026-10-03 (codex-cli 0.160.0, `codex exec -s workspace-write` in a
  throwaway folder, trust given at launch): with `{"PostToolUse":[{"matcher":"Bash","hooks":[…]}]}`
  in the folder's `.codex/hooks.json`, the model's one shell command could not start `/bin/ps`
  (`zsh:1: operation not permitted: /bin/ps`), and the hook that ran straight after it ran `/bin/ps`
  with exit 0. Its stdin was `{ session_id, turn_id, transcript_path, cwd, hook_event_name:
  "PostToolUse", model, permission_mode, tool_name: "Bash", tool_input: { command }, tool_response,
  tool_use_id }`, with `tool_response` the command's output as a string and `transcript_path` null.
  Both saw the same `TMPDIR`, and a file the command wrote there was there for the hook: Codex lists
  the sandbox's writable places as `[workdir, /tmp, $TMPDIR]`. The hook inherited `ORCA_TAB_ID` and
  `OBK_TAB_SHELL` from the launch. Its `{"hookSpecificOutput":{"hookEventName":"PostToolUse",
  "additionalContext":"…"}}` reached the model before its reply. 0.160.0's binary also names
  `PreToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SessionEnd`, `UserPromptSubmit`,
  `SubagentStart`, `SubagentStop`, `Stop` and `Interrupt`, and a hook may be `async`. **verified**
  (live, once) Then through the kit, in `test/system/codex-nudge.test.js` (2026-10-03, Orca 1.4.219,
  codex-cli 0.160.0, Claude Code 2.1.288): a Codex sender in its sandbox left the nudges for a Claude
  receiver running a loop and one holding a background `sleep`, both `tty_boundary`; the kit's hook
  typed both, and each receiver read its mail, the busy one after its loop. **verified** (live)
- **A new hook entry does not run until it is trusted, and nothing says so.** Codex's hooks
  documentation (read 2026-10-03): "Codex records trust against the hook's current hash, so new or
  changed hooks are marked for review." The same `codex exec` without the bypass switch ran Codex's
  other, trusted hooks and not the new entry, and printed nothing about it (0.160.0, 2026-10-03). So
  a hook entry the kit adds to a Codex bot's file brings up `Hooks need review` there once more.
  **verified** (live, for the entry not running; the review screen for an added entry not seen)
- **A Codex tab shows the thread's name, and only `/rename` gives a thread one (#480).** Codex
  titles its terminal from `tui.terminal_title`, by default `activity`, `thread-name` and
  `project-name`; no item is fixed text, and `orca terminal rename` is overwritten at the next turn
  (the reporter, 0.160.0). No flag or `-c` key names a thread at launch (`codex --help`, and the
  source at rust-v0.160.0). `/rename <name>` calls the app server's `thread_set_name`, cancels the
  title Codex would make up, and appends `{ id, thread_name, updated_at }` to
  `~/.codex/session_index.jsonl`, the newest line for an id winning
  (`codex-rs/rollout/src/session_index.rs`). With a space after the command name Codex closes its
  slash menu (`chat_composer.rs` `sync_command_popup`), so the input line shows the whole command.
  A `Stop` hook gets `{ session_id, turn_id, transcript_path, cwd, hook_event_name: "Stop", model,
  permission_mode, stop_hook_active, last_assistant_message }`, and an entry with `"async": true`
  runs in the background without holding the turn (`hooks/src/engine/discovery.rs`, every event
  but `SessionEnd`). So the kit names a session's thread `<bot>.<session>` from an async `Stop` hook,
  once the session is idle, through the safe typing path of `obk session clear` (the architect's
  ruling on #480). The name survives `codex resume` (the reporter). **verified** (live, once) in
  `test/system/codex-thread-name.test.js` (2026-10-04, codex-cli 0.160.0): Codex wrote its own
  title for the throwaway thread into `session_index.jsonl` as the first turn ended ("Acknowledge
  system test", 17:55:28Z); the kit's hook typed `/rename name-codex.main` and Codex wrote that
  line at 17:56:41Z; the tab's title read `name-codex.main | <folder>`; after `obk restart` it read
  the same with nothing typed, since the index already named the thread. The one hook run took
  about 73 s: each character waits on a look through Orca's gate, up to 2 s while the slash menu is
  open, so the hook's timeout is 300 s. With the looks between keys cut to 250 ms (#480 review), a
  second live run (2026-10-04, PR #481 at b5c2425) went from the turn's end (19:59:46Z) to the name
  in the index (20:00:15Z) in 29 s, the hook's start, the wait for idle and the typing turn
  included; how much of that the turn was held was not measured. Codex prints nothing for a rename and draws typed text a
  cell at a time, so the tab's output does not show the command whole; `session_index.jsonl` is
  the record of it. The screen with the whole command typed was not captured.
  Read in the same source (`hooks/src/engine/command_runner.rs`), not seen live: Codex starts each
  command hook in a session of its own (`ProcessMode::NewSession`), and at the hook's timeout it
  kills the hook's whole process group. A hook still running when its Codex is killed hard can
  outlive it, and the closing terminal does not reach it. So the naming types only while the book
  still holds the hook's tab and conversation, and stops well before the timeout.
- **Trusting a hooks file does not replay what it missed.** A conversation that was already running when the file was still untrusted is never reported: no SessionStart arrives for it after `t`, and nothing else says the kit missed one. The next conversation reports normally. So "no id recorded" cannot be read as "there was no conversation". **verified** (live, in the PR #88 review)
- **Codex records no pid anywhere a reader can use.** `~/.codex/thread-writer-locks/<thread>.lock` is an empty lock file; `~/.codex/session_index.jsonl` holds `{ id, thread_name, updated_at }`; a rollout's `session_meta` carries the id, the folder and the time and no pid. So there is no Codex equivalent of Claude Code's live-session registry. **verified** (read on this machine, 0.155.1)
- **Neither harness links a new conversation to the one the same process had before.** A `/clear` or a `/new` leaves nothing behind saying "this replaced that". With the point above, that means **a conversation that has ended cannot be tied to the session that had it** by anything either harness writes down — which is why the kit never assigns an unrecorded conversation to a session and says what it found instead. **verified** (live, and by reading both harnesses' own files)
- **Codex's own record of every conversation**: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl`, whose first line is `{"type":"session_meta","payload":{ id, cwd, timestamp, … }}`. `cwd` is the folder the conversation ran in, which for a kit session is always the bot home. A conversation spawned as a subagent says so under `payload.source`. **verified** (live, read on this machine)
- **The user's turn in a rollout is a `response_item` message with `role: "user"`** and `input_text` content. Codex's AGENTS.md goes in the same way, as `# AGENTS.md instructions for <cwd>…`. The `event_msg` `user_message` line is not always written: read on this machine on 2026-09-25, about 300 rollouts from 0.153 to 0.156.1 all carried the `response_item` for their user turns, while `user_message` was in 17 of them. A kit-started 0.156.1 session (kit-dev review-300) had its whole start prompt, work-dir note included, as that `response_item`, with an `item_completed` event of `item.type: "UserMessage"` beside it, and no `user_message`. **verified** (read on this machine; #274)
- **Codex has no `/clear`; `/new` is its clear**, and Codex reports it as an ordinary start: no hook fires at `/new` itself, and when the first prompt of the new conversation arrives, SessionStart fires with `source: "startup"` and the **new** id. So the source word cannot tell a `/new` from a program start on Codex — the id can. `codex resume <id>` keeps the **same** id and fires SessionStart for it. **verified** (live)
- **Codex 0.156.1's `/new` asks a question before the new conversation starts**: `Where should the new conversation run?` with `1. Current checkout` (keep the current working directory) and `2. New worktree` (an isolated managed checkout). Text typed while it is up goes into the menu: its return picks option 1 and the rest is lost. Whatever clears a Codex session answers it with `1` and waits for it to go before asking anything (#245). For a bot, option 1 is the bot home; the kit never makes a git worktree (PRD 6.2), so `2` is never the answer. The answer is in the tables in SETUP.md step 5 and `obk-bot-building`. **verified** (live, screen recording of the tab, 2026-09-24, Codex 0.156.1)
  **On 0.157.1 the menu did not show** in #318's and #329's live runs (developer-2, 2026-09-26), and the screen's tip said worktrees had moved to `/worktree`. **seen** (live, twice). The menu's text is still in the 0.157.1 binary, so whether it can still appear, and when, is **not known**. The answer when it does is the same. `--worktree` as a launch flag is not new in 0.157: `codex --help` on 0.156.1 lists it too. **verified** (from both versions' help, 2026-09-26)
- No in-session scheduler in the CLI. **verified** (help)
- Subagents: spawned only after a direct request or an instruction in a skill, so a skill must ask explicitly. **verified** (docs)
- `codex queue --thread <id|name> --message <text>` (since 0.149): no official docs page, seems to reach only sessions on a shared app-server daemon, no delivery receipt, no sender identity; a queued row from 12 Sep was still undelivered a week later on this machine. Not trusted; retest. **verified as untrusted**
- Transcripts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, grouped by date, not by project. Lines are `{timestamp,type,payload}`. `session_meta` (id, cwd, context_window); `turn_context` (model, effort, approval_policy); `event_msg/token_count` (`info.last_token_usage`, `info.total_token_usage`, `info.model_context_window`); top-level `compacted` records; `event_msg/turn_aborted` with `reason="interrupted"`; `thread_settings_applied`. There is no `/clear`; a new conversation is a new rollout file. **verified** locally
- **What a session really runs with, in its rollout.** The latest `turn_context` carries `model`, `effort`, `approval_policy`, `approvals_reviewer` and `sandbox_policy.type`, and the latest `token_count` carries `info.model_context_window`. Seen live on 2026-09-24 (0.156.1, `codex exec` in a throwaway folder): `--approve-for-me`, the kit's `auto`, records `on-request`, `auto_review` and `workspace-write`; `-c model_context_window=200000` records 190000. `-c approval_policy=on-request`, the setting the kit's `-a on-request` gives (from `codex --help`; `codex exec` has no `-a`), records `on-request` with this machine's own `approvals_reviewer = "auto_review"` and `sandbox_mode = "danger-full-access"` from `~/.codex/config.toml`. So on this machine an `ask` session's approvals go to Codex's automatic reviewer, not to the user: the user's defaults leak in, and health reports it. **verified** (live). That `--dangerously-bypass-approvals-and-sandbox` records `never` and `danger-full-access` is **unverified**: its help says it skips every prompt and the sandbox, and the pair is on this machine's rollouts, but no run tied them (a throwaway run was refused, as in section 2).
- **A new conversation (`/new`) reads `AGENTS.md` again.** On 0.157.1 the new rollout's first turn carried an `AGENTS.md instructions` message holding text added before the `/new` (assuredloop/reviewer, 2026-09-27, in #391's thread). On 0.160.0, `obk session clear` on a Codex session after a charter change gave a new rollout whose `AGENTS.md instructions` message held the added line (#391, live run 5, 2026-10-03). So the kit stamps the rules when its hook hears a Codex clear, a new id in the same tab, as it does for Claude Code's `/clear`, and `obk health` offers `obk session clear` for a session on older rules. **verified** (live, 0.157.1 and 0.160.0)
- **Neither summing `last_token_usage` nor taking the final `total_token_usage` is right.** `total_token_usage` is a running total, so adding it up across events double counts: a conversation that used 80,565 came to 200,901 that way. But the two obvious repairs each fail on real data, and both failures were found in a review of this note's first version, which claimed summing the lasts was safe:
  - **A record can be repeated.** Two adjacent events can carry an identical positive `last_token_usage` while `total_token_usage` does not move; the second is the same call written down again. 128 such pairs in 250 rollouts on this machine. Summing the lasts counts those twice.
  - **The running total can reset.** Mid-conversation it can drop back and start again, a new window; 26 such resets in the same 250. Taking the final `total_token_usage` then reports only the last window. One conversation's true total was 2,854,977 across two windows and its final cumulative said 1,489,245.
  So count by the **difference in `total_token_usage` between one event and the one before**, field by field: a positive difference is that call's usage, no difference is a repeat and not a call at all, and a negative difference is a new window, where the event's own `last_token_usage` is the usage. Within a window the difference equals `last_token_usage` exactly, which is why a short conversation makes the wrong rules look right. A reader counting from a moment has to walk the earlier events anyway, because the difference is only meaningful against the one before. **verified** (2026-09-21, 0.155.1)
- **Every `token_count` event with usage carries both figures, whole.** Read on this machine on 2026-09-27, streaming every rollout in `~/.codex/sessions` (959 files, Codex 0.133.0 to 0.158.0-alpha.2, three of them over 700 MB): 197,240 `token_count` events with an `info`, and none without `total_token_usage`, none with it null, none with a figure missing from it, none without `last_token_usage`. So the case #302 worked out, an event with only its own figure followed by a running total that includes it, has not been seen. The kit treats such an event as it treats a broken running total: not counted, and said to be (#371). **seen on disk**
- **A child rollout can start from its parent's spend, in two ways.** Read on this machine on 2026-09-27, every rollout in `~/.codex/sessions` matched against its parent's (942 with usage, Codex 0.133.0 to 0.158.0-alpha.2):
  - **Copied history.** A rollout whose `session_meta` has `forked_from_id` can begin with its origin's `token_count` records copied in, the same `total_token_usage` and `last_token_usage` as in the origin's rollout. They are always a leading run, and the child's own calls carry the running total on from the last of them. The copy can start part way into the origin, where one child's first record has a total of 26,461,432 against its own call of 98,340, or at the origin's first record. 36 rollouts have copies, and all 36 have `forked_from_id`; no rollout without it has any.
  - **A running total carried in, nothing copied.** 118 children, with `forked_from_id` or without (`source.subagent.thread_spawn` with `parent_thread_id`, and three `guardian` reviews), copy no record but start with the parent's running total inside their own: a first record's total of 1,706,960,430 against its own call of 47,221, where 1,706,913,209 was the parent's total when the child started.
  - **Where the copy ends is told by the origin's records, not by time or position.** In rollouts Codex rebuilt, every line has one timestamp, copies and own calls alike, so "stamped at the child's start" drops real calls. The first `inter_agent_communication_metadata`, the child's first message from its parent, marks the end in most children but not in rebuilt ones. `subagent_history_start_ordinal` in `session_meta` points into the parent's history, not at a line of the child's. The origin of every fork on this machine was in `~/.codex/sessions`, found by its id in the file name.
  - **A record whose own figure is nothing is not a call.** 1,720 `token_count` records on this machine have every field of `last_token_usage` at 0 and a `total_tokens` above 0 (one reads 81,522). Wherever one is not a rollout's first record, 1,624 of 1,624, the running total does not move at it. 96 children begin with one, with the parent's running total inside it.
  So a rollout's first record counts its own `last_token_usage`, never its running total, and one whose own figure is 0 in every field is not a call, and a fork's leading records that are also in its origin's rollout, running total and own figure both, are the origin's calls and are not counted under the fork. A fork whose origin cannot be read whole (missing, unreadable, a broken line, a figure missing from a record) cannot be split, so none of it is counted, and it is said to be (#376). Counted the old way, the 154 affected rollouts came to 283.3 billion tokens; counted this way, 1.39 billion, equal for every one of them to the sum of its own calls' `last_token_usage`. None of the 120 rollouts in the kit's bot folders was affected. **seen on disk**
- **Cached tokens are inside `input_tokens` here, unlike Claude Code.** A real record reads `input_tokens: 21265`, `cached_input_tokens: 20992`, `output_tokens: 39`, `total_tokens: 21304`, and 21265 + 39 = 21304. `reasoning_output_tokens` sits inside `output_tokens` the same way. So uncached input on Codex is `input_tokens - cached_input_tokens`, and a figure that takes each harness's `input_tokens` as it stands compares unlike things and prices Codex's cached tokens at full rate. **verified** (2026-09-21, 0.155.1)
- **Codex 0.157.1 shows nothing of a running command's output.** Watched live on 2026-09-26 (Orca 1.4.212, a kit-made tab in a throwaway fleet, `terminal read --screen` about every 0.7 s, #363): the start prompt asked for a 40-second shell loop printing one line a second. No line of it was on screen while it ran. The status row read `• Working (Ns • esc to interrupt)` and, from about 22 s, added `· 1 background terminal running · /ps to view · /stop to close`. Once a command ends, the screen shows `• Ran <command>` with its last few lines, or `(no output)`, and `+ Show details` (seen once here, and in the architect's run for #341). A file the loop appended to in the bot home grew line by line all the while, and the `workspace-write` sandbox allowed the write. So a watcher reads a Codex command's progress from what it writes, not from the screen. **verified** (live)
  The model can also lose the end of a long command. Codex ran the loop through its exec tool with a 30 s yield, received STEP-01 to STEP-30, and failed to poll for the rest (`write_stdin failed: Unknown process id`). The loop ran to its end in the background, but the model summed only the first thirty lines and printed that. It happened in one run of two (the architect's summed all forty). So a result the model states about a command's output is not proof that it saw all of it. **seen** (live, once)

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
9. ~~Whether Codex reads `AGENTS.md` again at `/new` (section 3, #271).~~ **done** (2026-10-03, #391): it does, on 0.157.1 and 0.160.0; see section 3.
10. ~~That `claude --resume <id> -n <other name>` gives the conversation the new name.~~ **done** (2026-09-25, by the owner, #319): it does; see section 2.
11. ~~Grooming on Claude Code's scheduler (#237), in `test/system/groom.test.js`.~~ **done** (2026-09-26, run 5 passed end to end): see section 2. Still owed: that Orca's own cold restore runs a bare `claude --resume <id>`.
