# Technical notes: Orca and the two harnesses

Facts gathered on 2026-09-19 on the owner's Mac: Orca 1.4.205, Claude Code 2.1.278, Codex CLI 0.153.4
(Codex has since moved to 0.155.1; the Codex facts below were taken on 0.153.4 unless they say otherwise).
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
- Terminal handles are issued at runtime and go stale after a restart, so re-list with
  `orca terminal list [--worktree <sel>] --json` and match on the `tabId` that `orca terminal create`
  returned. **The tab id is the key, never the title.** Always set a title (`--title` at creation, kept
  as the tab's `customTitle`), but do not identify a tab by it: the title `terminal list` reports is
  whatever the program in the tab last wrote, and Claude Code writes its own — a tab whose `customTitle`
  is `Kit Arch` lists as `✳ Chatgpt-bot-kit orca migration`, one titled `orca-bot-kit dev` lists as
  `◐ orca-bot-kit-dev`, and a zsh prompt rewrites a shell tab's title to its folder. Orca's own
  `settings.tabAutoGenerateTitle` is `false` on this machine, so that option is not what moves them.
  **verified** (live) **unverified:** that a tab id survives an Orca restart.
- Orca calls every workspace a "worktree", a plain folder included. Say "Orca project" or "folder
  workspace" in anything a user reads, so nobody thinks a git worktree was made. The kit never makes
  one: no `git worktree add`, no `orca worktree create`, and no bot folder left registered as git kind.
- State file: `~/Library/Application Support/orca/profiles/local-default/orca-data.json`. Internal; read only as a cross-check.

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
  `xec codex`. Gate every send on `orca terminal wait --for tui-idle`, which answers `timeout` for as
  long as such a question is on the screen. **verified** (live)
- `orca terminal wait --for exit|tui-idle --timeout-ms <n>`. **`tui-idle` is about a TUI, not a shell.**
  All three answers seen live:
  - a tab running no TUI, sitting at a clean shell prompt: exit 1, `ok:false`,
    `error.code: "timeout"` — never satisfied, however long the timeout. So this is **not** a way to
    ask whether a shell is ready for typing; there is no such way.
  - a TUI that Orca can see is blocked: `ok:true`, `wait.satisfied:false`, `status:"running"`, and
    `wait.blockedReason` says what it is — `"agent-interactive-prompt"` for Codex sitting on its
    folder-trust question.
  - a TUI waiting for work: `ok:true`, `wait.satisfied:true`.
  **`blockedReason` does not catch everything.** Claude Code showing its folder-trust screen answers
  `satisfied:true` with no `blockedReason` at all, while Codex on the same kind of screen answers
  `satisfied:false` with one. So it is a useful hint and not a test: whether something on screen wants
  answering is settled by reading the screen, not by this field.
  So a `timeout` means "no TUI in this tab", and an `ok:true` answer means one is running, idle or not.
  **verified** (live, both harnesses)
  **What that costs, proven the hard way.** A start prompt sent as a second `terminal send` into a fresh
  Claude tab that had answered `satisfied:true` landed on the folder-trust list and confirmed its
  default `No, exit`: the harness quit back to the shell. Nothing Orca offers tells that screen from a
  ready one — `terminal list` carries no agent identity for a tab either. So the kit types one line into
  a tab it opens and no more: the start prompt goes on that line as the harness's own prompt argument,
  and the harness holds it until the trust question and the update offer are answered. Both harnesses
  then run it by themselves. **verified** (live, Claude Code 2.1.278 and Codex 0.155.1)
- `orca terminal send [--terminal <h>] [--text <t>] [--enter] [--interrupt] [--wait-submit <s>] [--retry-request <id>]` — `accepted:true` means input accepted, not that the agent read it; never resend on silence; use `--retry-request` for an idempotent retry.
- `orca terminal read [--terminal <h>] [--cursor <n>] [--limit <n>] [--screen]`, `rename`, `show`,
  `split`. Use `--screen` to see what the tab renders; the default read returns emitted output with the
  escapes stripped, so a TUI comes back as stacked fragments. `--screen` is how an agent looks at a tab
  to decide whether something is waiting to be answered. **verified** (live)
- `orca terminal close --terminal <h> [--tab]` closes one. **Never use `orca terminal close --worktree <sel> --all`: it removes tabs, layouts and resume records.**
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
  with the selection already on yes, and says plainly that trusting applies to the **repository root**,
  not the bot folder — for a bot that means the whole bots repo. Click yes either way. The harness then
  writes its own config, which is fine.
- A harness update offer. Codex shows `✨ Update available! … 1. Update now / 2. Skip / 3. Skip until
  next version`. Accept it.
- Anything else: type nothing and raise it with the user, naming the bot, the tab and what is on screen.

The kit's own code does not change user-level settings on its own initiative.

Codex started in a brand-new folder on this machine showed no trust question at all (the owner's global
config puts it in "YOLO mode"), only the update offer.

### Session resume inside Orca (verified)

Orca stores a resume record per pane key (`sleepingAgentSessionsByPaneKey`) and relaunches with `claude --resume <id>` / `codex resume <id>`. Closing a tab drops the record. Orca's Session History can find old transcripts but does not know which bot and session they belonged to. This is why the kit keeps its own book (ADR 0002).

### Orca's own agent hooks (verified)

Orca writes hooks into the user-level harness settings (`~/.claude/settings.json`, Codex hooks). They post to a local port using env vars set in each pane: `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID`, `ORCA_AGENT_HOOK_PORT`, `ORCA_AGENT_HOOK_TOKEN`. `…/orca/agent-hooks/last-status.json` holds per pane: state, last hook event, provider session id, transcript path. Internal; a cross-check only. The kit's hooks live in the bot folder and must not touch these (ADR 0010).

### Mailbox (verified from help)

`orca orchestration send --subject <s> [--to <handle|run:id|…>] [--body <b>] [--type status|handoff|question|…] [--priority normal|high|urgent] [--thread-id <id>] [--payload <json>]`.
`orca orchestration check [--wait --types … --timeout-ms <n>] [--peek] [--ack <delivery_id>]` — FIFO, replayed until acked. `ask` blocks; `reply --id <id>`. `inbox`.
Send means durably queued; a wake-up is best effort; there is no read proof. Group addresses exist (`@all`, `@idle`, `@claude`, `@codex`); the kit does not use broadcast groups. Store: `…/orca/orchestration.db` (SQLite), readable for grooming.

### Automations (verified from help)

`orca automations create --name <n> --prompt <p> --provider claude|codex --trigger hourly|daily|weekdays|weekly|<cron>|<rrule> [--time] [--timezone] [--precheck <cmd>] [--missed-run-grace-minutes <n>] [--workspace <sel> --workspace-mode existing] [--reuse-session]`; also `list|show|edit|remove|run|runs`.
`--reuse-session` sends later runs to "the previous live automation session when it is still available". It can only reuse a session the automation itself started; it cannot target a tab the kit created. **unverified:** that it keeps one long conversation; that missed runs fire after a reboot beyond the grace window.

## 2. Claude Code

- Launch flags (**verified** from `claude --help`): `-n/--name <name>`, `--model <m>`, `--effort low|medium|high|xhigh|max`, `--permission-mode acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`, `--dangerously-skip-permissions`, `--resume <id>`, `--add-dir <dir>`. There is no context-window flag; the context window is a suffix on the model name, `--model 'sonnet[1m]'`, and the quotes are needed because `[1m]` is a glob to zsh. **verified** (live on 2.1.278: `claude -p 'reply with the single word ok' --model 'sonnet[1m]'` answered, and the same model in an Orca tab came up as `Sonnet 5 with high effort`).
- A prompt given as a positional argument (`claude [options] -- '<prompt>'`) starts an interactive session and is run as its first message, after the folder-trust question is answered. `--` is needed: a prompt that starts with a dash is otherwise read as an option and the session never starts. **verified** (live, and against 2.1.278's parser)
- The suffix really reaches the session: with `--model 'sonnet[1m]'`, `/status` in the tab reports `Model: sonnet[1m] (claude-sonnet-5[1m])`. **verified** (live)
- Approval levels: `auto` = `--permission-mode auto`; `ask` = `--permission-mode manual`; `dangerously-skip` = `--dangerously-skip-permissions`.
- `AGENTS.md` is read directly from v2.1.277, but only when no `CLAUDE.md` / `CLAUDE.local.md` exists in the working directory or above it, and not on Bedrock or with telemetry disabled (docs: code.claude.com/docs/en/memory). The kit symlinks `CLAUDE.md` → `AGENTS.md` in each bot folder, which always works. **verified**
- Skills: `<project>/.claude/skills/<name>/SKILL.md`, `~/.claude/skills`. Symlinked skill folders are followed. Skill directories are watched; add, edit, remove is picked up in a running session. The command comes from the folder name. A user skill named like a built-in (`debug`, `design`, `review`, `simplify`, `run`, `verify`, `loop`) replaces the built-in. **verified** (docs)
- Hooks: project settings in `<project>/.claude/settings.json`. SessionStart fires on startup, resume, clear and compact; the hook input carries `session_id` and `transcript_path`. **unverified:** the exact `source` values and that the id after `/clear` is the new one — prove live (issue 04).
- Cross-session messaging (docs: code.claude.com/docs/en/cross-session-messaging, min 2.1.224) **verified in docs, unverified live:** addressed by session name; works across folders; a busy receiver reads between tool calls; an idle receiver starts a turn. Two classes: bypassing (`bypassPermissions`) and prompting (everything else). Same class delivers without asking; a bypassing sender to a prompting receiver is held (dialog expires after 5 min). Sender gets a delivery notice (held, delivered, denied, expired, refused). Rate limits and duplicate suppression are built in. A resumed session keeps its name unless a live session holds it. Registry: `~/.claude/sessions/<pid>.json`.
- Subagents: a subagent starts with a fresh context; a fork inherits the conversation. Test authors and reviewers must be fresh subagents. **verified** (docs)
- Transcripts: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`. Usage per API call in `assistant.message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); dedupe by `requestId` + `message.id`. Model in `message.model`; effort in `effort`. `/clear` starts a new session file. Compaction marker `system.subtype="compact_boundary"` — **unverified** locally.

## 3. Codex CLI

- Launch flags (**verified** from `codex --help` on 0.155.1): `--approve-for-me` (automatic review, workspace-write sandbox), `-a/--ask-for-approval on-request|never`, `-s/--sandbox read-only|workspace-write|danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd <dir>`, `--add-dir <dir>`, `-c key=value`, `codex resume <id>`.
- `-c model_reasoning_effort=<effort>` and `-c model_context_window=<n>` are taken as written, with no quotes of their own: a value that is not TOML is used as a raw string. **verified** (live on 0.155.1: `codex exec --skip-git-repo-check --strict-config -c model_context_window=200000 -c model_reasoning_effort=low` ran, and the header printed `reasoning effort: low`; `--strict-config` would have refused a key it did not know).
- A prompt given as a positional argument (`codex [options] -- '<prompt>'`) is run as the session's first message, after the trust question is answered. `--` is needed: `codex` exits 2 with `unexpected argument` on a prompt that starts with a dash. **verified** (live, and against 0.155.1's parser)
- `-c model_context_window=<n>` really reaches the session: the rollout's `token_count.info.model_context_window` follows it, at 95% of the number given — 123456 came back as 117283, 200000 as 190000, and a session with no override as 258400, which is 95% of gpt-6-astra's own 272000. A value that is not a whole number is refused by Codex itself, at startup: `invalid type: string "1m", expected i64`. **verified** (live, 0.155.1)
- Approval levels: `auto` = `--approve-for-me`; `ask` = `-a on-request`; `dangerously-skip` = `--dangerously-bypass-approvals-and-sandbox`. In `auto` the sandbox limits writes to the launch folder plus `--add-dir`; network and outside commands (`orca`, `gh`, `git fetch`) go through the auto reviewer — **unverified** that bot messaging works under it.
- The owner's global `~/.codex/config.toml` sets `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`. Pass explicit flags per session so this does not leak into bots.
- Instructions: `AGENTS.md` from the project root down to the working directory; discovery stops at a git root, which is why sessions start at the bot home. 32 KiB cap. **verified** (docs)
- Skills: `.agents/skills` in the cwd and parents up to the repo root; `$HOME/.agents/skills`. Symlinks are followed. "Codex detects skill changes automatically. If an update doesn't appear, restart Codex." User-only invocation needs `allow_implicit_invocation: false` in the skill's `agents/openai.yaml`. **verified** (docs)
- Hooks: a hooks file exists (`~/.codex/hooks.json`); hooks must be trusted once (`--dangerously-bypass-hook-trust` exists for automation). **unverified:** a per-project hooks location, and whether a hook reports the new id on a new conversation. Fallback: newest rollout file whose `session_meta.cwd` equals the bot home.
- No in-session scheduler in the CLI. **verified** (help)
- Subagents: spawned only after a direct request or an instruction in a skill, so a skill must ask explicitly. **verified** (docs)
- `codex queue --thread <id|name> --message <text>` (since 0.149): no official docs page, seems to reach only sessions on a shared app-server daemon, no delivery receipt, no sender identity; a queued row from 12 Sep was still undelivered a week later on this machine. Not trusted; retest. **verified as untrusted**
- Transcripts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, grouped by date, not by project. Lines are `{timestamp,type,payload}`. `session_meta` (id, cwd, context_window); `turn_context` (model, effort, approval_policy); `event_msg/token_count` (`info.last_token_usage`, `info.total_token_usage`, `info.model_context_window`); top-level `compacted` records; `event_msg/turn_aborted` with `reason="interrupted"`; `thread_settings_applied`. There is no `/clear`; a new conversation is a new rollout file. **verified** locally

## 4. Skill names (verified in docs and spec)

Agent Skills spec: `name` is 1–64 chars, lowercase letters, digits and hyphens, no leading, trailing or double hyphen, and must match the parent folder. Colon or slash prefixes fail to load in some hosts. Only `name` and `description` are portable frontmatter. Kit skills are `obk-<name>`; folder = `name` = symlink name (ADR 0009).

## 5. Live checks still owed

1. The session id reported after `/clear` is the new one, on Claude Code and on Codex.
2. A Claude session launched with `-n` keeps its name after `--resume`, and messaging works inside an Orca tab.
3. Two `auto` Claude sessions deliver to each other without a prompt.
4. Codex `auto` mode lets a bot run `orca` and `gh`.
5. An Orca automation with `--reuse-session` keeps one grooming conversation.
6. `codex queue` retest.
7. An Orca tab id is still the same after Orca restarts.
