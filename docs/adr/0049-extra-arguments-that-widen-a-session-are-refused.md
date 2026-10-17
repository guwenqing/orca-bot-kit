# ADR 0049: Extra arguments that widen a session are refused

Date: 2026-10-17.
Status: accepted.
Decided by: the architect, on 2026-10-16, for refusing the extra arguments that widen what a session may write or run, for failing closed on Codex's `-c` with a list of keys known to be safe, for refusing Claude Code's `--settings`, for the one trust shape, and for keeping this a record beside [ADR 0041](0041-permission-changes-and-risky-operations-have-commands-of-their-own.md) (#567); reviewer-567, for refusing `--restricted`; developer-567, for the lists of flags and keys; the architect, on 2026-10-17, for taking `check_for_update_on_startup` with `false` only (#581). The architect or the owner may overrule.
Supersedes: [ADR 0044](0044-extra-arguments-that-widen-a-session-are-refused.md).

## Context

[ADR 0041](0041-permission-changes-and-risky-operations-have-commands-of-their-own.md)
keeps permission changes in commands of their own. It has `session add`,
`session change`, `temp make` and `groom --run-on codex` refuse an extra
argument that sets approval or permissions, from a fixed list of flags. It
names a known gap: "an extra argument the kit does not know can still change
permissions, such as Claude Code's `--settings` or Codex's `-c` and
`--profile`".

An audit on 2026-10-11 found that the guard took extra arguments that widen
what a session may write without naming approval (#567). Codex's
`--add-dir <dir>` adds "Additional directories that should be writable
alongside the primary workspace" (`codex --help`, 0.163.0). Codex's `-c`
overrides any key of Codex's config, `sandbox_mode` and
`sandbox_workspace_write.writable_roots` included.

Codex 0.163.0's own config schema (`codex-rs/core/config.schema.json`, tag
`rust-v0.163.0`) has about a hundred top-level keys. Many of them widen what a
session may write or run: the sandbox and approval keys, `auto_review`,
`permissions`, `default_permissions`, `profile` and `profiles`,
`projects.<path>.trust_level`, `hooks`, `mcp_servers`, `notify`,
`shell_environment_policy`, `plugins`, `skills`, `features`, `log_dir` and
`sqlite_home`. A value can also be a whole table that sets several keys at
once. On Claude Code, `--settings` can carry permission rules, extra folders
and hooks. The kit cannot see what a settings file or a plugin holds.

A live check on 2026-10-16 (Codex 0.163.0,
`test/system/codex-extra-arg-scope.test.js`) showed what two of these do. A
session at `auto` started with `--add-dir A` and
`-c sandbox_workspace_write.writable_roots=["B"]` wrote in A and in B, with no
escalation. A third folder that nothing named stayed closed to it. A session
with neither argument wrote in none of the three.

## Decision

`session add`, `session change`, `temp make` and `groom --run-on codex`
refuse an extra argument that widens what the session may write or run, on
the session's harness. This adds to ADR 0041's list of refused flags:

- On Claude Code: `--add-dir`, `--settings`, `--setting-sources`,
  `--plugin-dir`, `--plugin-url`, `--mcp-config`, `--agents`, `--agent`,
  `--debug-file`, `--bare` and `--restricted`, each alone or with `=` and a
  value. Claude Code 2.1.302 refuses a shortened long option (`--sett` and
  `--add-di` give "unknown option"), so no shorter spelling is matched.
- On Codex: `--add-dir`, `-C` and `--cd`, `-p` and `--profile`, `--enable`
  and `--disable`, `--remote` and `--remote-auth-token-env`. Each is refused
  alone, with `=` and a value, and, for `-C` and `-p`, with the value glued
  on. Codex 0.163.0 refuses a shortened long option (`--strict-conf`).
- On Codex, `-c` and `--config` fail closed. A `-c` passes only when its key,
  with blanks at either end trimmed, is a plain dotted key on the list below.
  A plain dotted key has letters, digits, `_` and `-`, with parts joined by
  single dots. Every other `-c` is refused: a quoted key, a blank inside the
  key, an empty key, no `=`, and no value. The value is taken with `-c` as the
  next argument, with `=`, or glued on.
  - Any value: `model`, `model_reasoning_effort`, `model_reasoning_summary`,
    `model_verbosity`, `model_context_window`,
    `model_auto_compact_token_limit`, `plan_mode_reasoning_effort`,
    `service_tier`, `hide_agent_reasoning`, `show_raw_agent_reasoning`,
    `tool_output_token_limit`, and the display keys `tui.animations`,
    `tui.show_tooltips`, `tui.notifications`, `tui.notification_method`,
    `tui.notification_condition`, `tui.alternate_screen`, `tui.theme`,
    `tui.vim_mode_default`, `tui.status_line`, `tui.terminal_title`,
    `tui.raw_output_mode`, `tui.disable_paste_burst`,
    `tui.fullscreen_transcript`, `tui.mouse_scroll_speed` and
    `tui.show_server_version_notice`.
  - `sandbox_workspace_write.network_access` with `true` or `false` and
    nothing else, so a user can still turn off the network that the kit
    turns on.
  - Settings that only narrow, with exactly these values:
    `sandbox_workspace_write.exclude_tmpdir_env_var` and
    `sandbox_workspace_write.exclude_slash_tmp` with `true` or `false`
    (`false` is Codex's default), `features.sleep_tool` with `false`, and
    `check_for_update_on_startup` with `false`.
  - One trust setting in one shape only, read as TOML:
    `projects={"<absolute path>"={trust_level="trusted"}}`. It holds one
    folder, in a basic string with no backslash and no `..`, and nothing else
    in either table.

Every refusal names `obk permission approval`, where a session's approval and
sandbox change, and changes nothing. A Codex setting off the list goes in the
user's own `~/.codex/config.toml`. A Claude Code setting goes in the user's
own settings. The kit's explicit launch flags still win over both.

## Alternatives considered

- **Replacing ADR 0041 with a whole new record.** Not chosen: ADR 0041's
  decision, that permission changes have commands of their own, does not
  change. This record adds which arguments are refused. A replacement would
  also change the PRD's citation of ADR 0041, which is a baseline change for
  a link alone (the architect, 2026-10-16).
- **A list of refused `-c` keys.** Not chosen: Codex reads a key as TOML, and
  a whole table sets many keys in one value. The schema holds dozens of keys
  that widen a session, with more in each release. A short list of keys
  known to be safe fails closed. A key that Codex adds later is refused until
  someone puts it on the list.
- **Refusing every `-c`.** Not chosen: the kit's users set the model, effort
  and display that way. The README tells them to turn the network off with
  `-c sandbox_workspace_write.network_access=false`, and the system tests
  start each Codex session trusted at launch with `-c projects=…` (#240).
- **Refusing `projects` with the rest, and moving the system tests' launch
  arguments into a bot.yaml written by hand.** Not chosen: the `temp make`
  cases have no bot.yaml road, so they would answer Codex's trust screen and
  write trust into the user's config, against #240. It would also depend on
  `up` not checking hand-written extra arguments (#585).

## Consequences

- Good: no extra argument the kit knows can widen what a session may write or
  run, and an unknown Codex config key is refused. This closes the known gap
  that ADR 0041 names.
- Bad: a flag that a harness adds later can still widen a session until
  someone adds it here. The lists come from `claude --help` 2.1.302,
  `codex --help` 0.163.0 and Codex 0.163.0's config schema.
- Left out on purpose, because they do not let a session write or run more
  without asking:
  - On Claude Code: `--safe-mode` (its help: "Admin-managed (policy) settings
    still apply ... and permissions work normally"), `--tools` and
    `--disallowedTools` (they narrow), `--chrome`, `--remote-control`,
    `--cloud`, `--desktop`, `--bg`, `-w` and `--worktree`, and
    `--system-prompt` and `--append-system-prompt` (text only).
  - On Codex: `--worktree` (a new worktree of the same repository, written in
    place of the bot folder), `--search` (web search, no write), `-m`, `--oss`
    and `--local-provider` (which model answers), and `--no-alt-screen` and
    `--no-daemon`.
- `--bare` is refused, not left out. Its help does not say whether settings
  files and their permission rules still load, and that cannot be checked
  without a model call.
- `--restricted` is refused too. Its help says that it removes Bash and keeps
  the file tools in the working folders. But it ignores the user, project and
  local settings files, and their deny rules go with them. reviewer-567 showed
  this on 2026-10-16 with Claude Code 2.1.302 at `--permission-mode auto`. With
  a project `permissions.deny` of `Write`, the session refused Write. With
  `--restricted` added, Write was available, and the file was written with no
  prompt. `--tools` can also give Bash back.
- The one trust shape lets a session start trusted in a folder whose trust
  the user declined. It grants no more than the kit grants already. The kit
  answers Codex's trust screen with "trust" for a bot folder
  (`obk session answer`). A `-c` holds for that run only and writes nothing to
  `config.toml`. Codex looks up trust only at the session's folder and its git
  root. So it gives what the kit's own first-run answer gives, without the
  write into the user's config that the system tests avoid (#240). It matters
  most for a session at `ask`. The kit passes no sandbox flag there, and Codex
  takes its sandbox from the user's config, or from its default for a trusted
  folder (the architect, 2026-10-16).
- A session's work dir outside its bot folder also reaches Codex as
  `--add-dir`. That road is a session setting, not an extra argument: #585.
- `check_for_update_on_startup=false` turns off Codex's update check at
  start, for that run only (#581). A live check on 2026-10-17 (Codex 0.163.0,
  `test/system/codex-update-offer.test.js`) ran Codex with a throwaway
  `CODEX_HOME` whose `version.json` offered a newer version. Without the key,
  Codex drew "Update available". With it, Codex drew no update text. Neither
  run wrote `version.json`. The key opens nothing: no write, no command, no
  trust. Every Codex session of the system tests takes it, so a new Codex
  release does not stop them on the offer, and no test takes the update or
  dismisses it in the user's own Codex state. It takes `false` only. `true` is
  Codex's default, so the key with `true` gives nothing.
- `obk up` does not judge a hand-written `extra_args`. The system test uses
  that to show what the refused arguments do.
- Revisit if: a harness adds a flag or a config key that widens a session.
  Confidence: high.

## History

- 2026-10-10, [ADR 0041](0041-permission-changes-and-risky-operations-have-commands-of-their-own.md):
  the extra arguments that set approval or permissions are refused, with a
  known gap for the ones the kit did not know (#527).
- 2026-10-16: the extra arguments that widen what a session may write or run
  are refused too, and Codex's `-c` passes only for a list of keys known to be
  safe (#567).
- 2026-10-17: `check_for_update_on_startup` with `false` goes on the list, so
  a new Codex release does not stop the system tests on its update offer
  (#581). This record replaces ADR 0044 whole.
