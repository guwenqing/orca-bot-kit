# ADR 0058: Remote Control is on for every Claude Code session

Date: 2026-11-14.
Status: accepted.
Decided by: the owner, on 2026-11-14, for Remote Control on by default with a switch for each session, as R1 of `remote-control-on` says (#755); the architect, on 2026-11-14, for the setting on the session and not on the fleet, for `disableRemoteControl` as the off key, for no upgrade notice, for the limit when a session carries its own `--settings`, and for what `obk health` reports (#755); developer-755, for the place of the flag on the line and for the words of the report. The architect or the owner may overrule the architect's and developer-755's parts.

## Context

Claude Code has Remote Control. With it on, a person who holds the user's claude.ai account can read and drive a running session from claude.ai/code or the Claude app: read the conversation, type prompts that run at the session's approval level, answer its permission prompts, attach files, change its model, clear or end it, stop its subagents, rename it, change its MCP servers, and fork it into a new session on the machine. While a session is connected, Anthropic stores its transcript, with tool activity (Claude Code docs, `remote-control`, read on 2026-11-14). Trusted Devices limits this to enrolled devices; it is off until the user turns it on.

Until this record, [ADR 0046](0046-orca-is-the-host.md) left phone and remote access to Orca, and the kit started Claude Code with no Remote Control flag. The owner wants each Claude session reachable from the phone without an extra step (#755).

Facts from Claude Code 2.1.325 (docs and the binary, not checked live):

- `claude --remote-control [name]` starts an interactive session with Remote Control on. The value is optional. Without an eligible login the session still starts and shows a notice (docs).
- No flag turns Remote Control off for one session (docs, `settings-reference`).
- On a resume, Claude Code turns Remote Control on again for a conversation that has a stored `bridgeSessionId`, whatever `remoteControlAtStartup` says (binary). So `remoteControlAtStartup: false` does not keep a resumed session off.
- `disableRemoteControl: true`, in the merged settings, refuses the flag, auto-start, the in-session command and the resume path (docs; binary: the bridge start checks it before it makes a handle). `--settings` is part of the merged settings.
- Claude Code reads only the last `--settings` on a line (binary).
- A session's registry entry, `sessions/<pid>.json` under its config folder, holds `bridgeSessionId` while the Remote Control handle exists, and `null` after it goes. A failed or retrying connection keeps the handle, so the field says "enabled", not "connected" (binary).
- The entry also holds `procStart`, the process's start time as `ps -o lstart= -p <pid>` prints it under `LC_ALL=C` and `TZ=UTC` (binary; one entry on this machine matched its process this way). A pid is given out again, never with the same start time.
- Orca restores a tab after its own restart with a bare `claude --resume`, with none of the kit's flags (#318).

## Decision

We will start every Claude Code session that the kit starts, temporary sessions included, with Remote Control on, unless the user set it off for that session. Codex and Pi sessions do not change.

1. **The setting.** A session's `remote_control` in `bot.yaml` is `on` or `off`. With no value, it is on. `session add`, `session change` and `temp make` take `--remote-control on|off`. A temporary session on Claude Code takes its maker's value unless the flag says otherwise. There is no fleet-wide value. The setting on a Codex or Pi session is an error.
2. **On.** The launch line has `--remote-control` directly after `claude`, before the approval flag. Its optional name then never takes a word of the kit's. It gets no name: the `-n` address is also the remote title.
3. **Off.** The line has no flag. The kit's `--settings` JSON carries `"disableRemoteControl": true`. This keeps the session off at a fresh start and at a resume by the kit (`up`, `restart`, `unpause`, `temp make`), and against the user's own `remoteControlAtStartup: true`.
4. **One `--settings`.** The kit sends one `--settings` object at most, with every key it needs ([ADR 0060](0060-each-claude-bot-gets-a-memory-folder-of-its-own-named-in-the-kits-one-settings.md) lists them). It sends none when the session's own extra arguments carry `--settings`. The kit's off is then lost, and the kit says so in the launch report and in an `obk health` finding. For such a session, health never gives a restart as the way off.
5. **No second road.** `session add`, `session change` and `temp make` refuse `--remote-control` and `--rc` as an extra argument, and name `--remote-control on|off`. A hand-written one in `bot.yaml` gets a finding from `obk health`, and the kit leaves out its own flag.
6. **The launch report** says, for each Claude session it launched, whether Remote Control is on or off, and whether that came from the session or from the kit's default.
7. **`obk health`** reports, for each running Claude session, what was asked (on or off) and a state read from the session's own registry entry: `enabled` for a non-empty `bridgeSessionId`, `not enabled` for `null` or no key, and `unknown` for any other value or no readable entry. It finds the entry by the pid of the harness in the session's tab, in `$CLAUDE_CONFIG_DIR`, in `~/.claude` and in each of Orca's Claude profiles. It takes an entry only when its `procStart` equals the process's start time, as `ps -o lstart=` gives it under `TZ=UTC` and `LC_ALL=C`, as Claude Code writes it. So an entry that an earlier process with the same pid left does not count. When the kit cannot read the start time, the state is `unknown`. It never says "connected". It gives a finding when a session asked on is not enabled ("Its tab says why"), and when a session set off is enabled.
8. **The limit.** "Set off" does not hold after Orca's cold restore, or when the session carries its own `--settings`. The user's hard off for those cases is Claude Code's own `"disableRemoteControl": true` in the bot's, or the bots repo's, `.claude/settings.local.json`. The kit never writes that file.
9. **No upgrade notice.** The release notes and README say the change.

## Alternatives considered

- **A setting for each bot, written into the bot's `.claude/settings.json`.** Not chosen. It is the strongest off, but it is one switch for every session of a bot, and every other launch setting is on the session. `obk init` also starts Bot Father before a `bot change` could run.
- **Both a session setting and a bot setting.** Not chosen: two places for one switch, and nothing in #755 needs both.
- **Off by default, with a fleet-wide value in `defaults.yaml`.** Not chosen by the owner. It changes nothing for a user who upgrades, but the owner wants every session reachable with no step.
- **`remoteControlAtStartup: false` as the off key.** Not chosen: a resume turns Remote Control on again for a conversation that was once on, so off would not hold at a restart.
- **Health from `bridgeSessionId` as "connected".** Not chosen: the handle stays through a failed or retrying connection.
- **A user's `--remote-control` in extra arguments as a second switch.** Not chosen: one road keeps the setting the only switch.

## Consequences

- Good: each Claude session is reachable from the user's phone or browser with no step. A user turns one off with one command, and the off holds at every launch by the kit.
- Bad: every user who upgrades gets every Claude session connected to that user's account at its next launch by the kit. Anyone who holds that account can drive those sessions, on the user's machine, at their approval level. Anthropic stores the connected transcripts. An off switch does not delete a stored transcript, and does not stop messages between sessions on one machine.
- Bad: an off session's tab and `claude doctor` say that Remote Control is disabled by the organization's policy. The text is Claude Code's; the README says what it means here.
- Bad: each connected process adds an entry to the user's list at claude.ai/code. Entries of ended sessions may stay there until the user archives them (not known yet; a live check is due).
- Bad: a fork made from claude.ai/code is a new local session that the book, role caps and retirement do not cover.
- Revisit if: Claude Code adds a flag that turns Remote Control off for one session; Orca's restore starts to carry the kit's flags; or a live check shows that the flag stops a new tab on a consent question.
  Confidence: high on the launch line, from the docs and the binary; low on the connection life (entries, consent, fork) until the live checks run.
- Checked by: test/remote-control-*.test.js for the setting, the line, the report and health; test/repo-guards.test.js for the off setting in every live test; test/system/remote-control.test.js against the real Claude Code.

## History

- none. This is the first record of this decision. It replaces the sentence of [ADR 0046](0046-orca-is-the-host.md) that left remote access to Orca (see [ADR 0057](0057-orca-is-the-host.md)).
