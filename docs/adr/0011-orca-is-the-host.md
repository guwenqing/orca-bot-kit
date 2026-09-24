# ADR 0011: Orca is the host

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, and on 2026-09-20 for the plain folder; the architect, for #232 and PR #260, for the sentences marked so, which the owner may overrule. Consulted: the coordinator, who researched Orca. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0001](0001-orca-is-the-host.md).

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
- **A marker in the launch shell's environment, read with `ps -E`.** Open, not
  yet proven (#261). Until then a harness run through a wrapper such as `node`
  is "cannot tell".

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
- Revisit if: Orca offers a supported way to tell whether a harness is running
  in a tab, or the kit has to run where Orca does not. Confidence: high for
  Orca as the host; the process-group reading was right in every run measured.
  (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/harness-in-tab.test.js` for the reading of a tab, and the
  system tests, which drive the real Orca.

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
- 2026-09-24, this record: nothing decided changes. It states the #232 rule as
  it was merged, drops the proposed mark from the plain folder, replaces the
  scheduling consequence with what holds, and replaces ADR 0001 (#262).
