# ADR 0015: Three approval levels, `auto` by default, and Codex sessions keep network access

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19, for the approval levels; the coordinator, for slice 08 on 2026-09-21, for the Codex network switch, where the owner was told and may overrule. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0005](0005-three-approval-levels-auto-by-default.md).

## Context

Bots must work without the user approving every command. On Codex desktop,
the first host, half-way modes kept prompting: bot tasks showed "Full Access"
while their commands kept asking for approval (#9, 2026-09-13). Fully
bypassing permissions is dangerous on a personal machine. The owner: "Unless
specifically asked by user, it is NEVER dangerously skipped. I need approval
level to be: auto, ask and dangerously skil three levels" (the owner's design
session, 2026-09-19, not in the repo).

A user's own harness defaults can differ from what a bot should run with: on
this machine the global Codex config says `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"` (tech notes). Each level maps to the
harness's own flags, kept in the tech notes and re-checked when a harness
updates. At `ask` the kit passes only `-a on-request` to Codex, so Codex's
sandbox there is whatever the user's own config says (2026-09-23, Codex
0.155.1).

Claude Code's cross-session messaging has two classes, bypassing and
prompting; a bypassing sender to a prompting receiver is held for approval
(from its documentation, Claude Code 2.1.224 on).

Codex at the kit's `auto` level runs in a workspace-write sandbox, and from
inside it the Orca CLI cannot reach the running Orca app: `orca status`
answers that the runtime is not reachable and a mailbox check is refused
(slice 08, three runs on 2026-09-21, Codex 0.155.1, Orca 1.4.205; the tab's
environment reaches the sandboxed command, the connection does not). With
`-c sandbox_workspace_write.network_access=true` both work. It is the sandbox
that decides, not the approval level: the switch reached Orca in the
workspace-write sandbox and was harmless with no sandbox at all (2026-09-23,
Codex 0.155.1, Orca 1.4.207, #176). Why the sandbox blocks the connection,
and what Codex's own escalation path would do, are not established.

## Decision

A session's approval level is `auto`, `ask` or `dangerously-skip`. `auto` is
the default and means the harness's real auto mode (automatic review), not a
bypass. `dangerously-skip` is written only when the user asks for it in plain
words (Bot Father never suggests it — proposed). The kit passes explicit flags
for every session so a user's global harness defaults do not leak into bots
(proposed).

On Codex, every session carries `-c sandbox_workspace_write.network_access=true`,
whatever its approval level. It is on for every Codex session, because a bot
that cannot be written to is not in the fleet. A user may turn it off for a
session, and the kit then reports that session as unreachable by fleet mail
rather than failing silently. (The coordinator's decision for slice 08,
2026-09-21; the owner was told and may overrule.)

## Alternatives considered

- **Bypass by default** (Claude Code's skip of permissions, Codex's bypass of
  approvals and sandbox). The coordinator recommended it as the meaning of
  "auto approve", since the half-way modes were what kept prompting on Codex
  desktop. The owner turned it down: auto means the harness's own auto mode,
  and a bypass never happens unless the user asks. It is dangerous on a
  personal machine, and stays available as `dangerously-skip`.
- **A fourth, `safe` level** (Claude Code's accept-edits mode, Codex's
  sandboxed full-auto). Offered by the coordinator; the owner asked for three
  levels, `auto`, `ask` and `dangerously-skip`.
- **`ask` by default.** Not chosen: bots must work without the user approving
  every command.
- **No explicit flags, leaving each harness's own defaults.** Not chosen: the
  user's global defaults would leak into bots, as this machine's
  `danger-full-access` would.
- **Codex `auto` without the network switch.** Not chosen: a Codex bot can
  then neither read nor send fleet mail.
- **The switch at `auto` only.** What the slice 08 wording first said. Not
  chosen: it is the sandbox, not the approval level, that blocks the
  connection, and the coordinator ruled that the decision is every session
  (#175).
- **A network setting for localhost only.** Not taken: slice 08 found that
  Codex has no such setting (#132), so the switch gives the sandbox network
  access generally. How that was checked is not recorded.
- **Leaning on Codex's own escalation of a blocked command.** Not open: the
  command exits 0 with an answer that says Orca is not there, so there is
  nothing to escalate. This path is untested.
- **A session with the switch off failing silently.** Not chosen: the kit says
  which session fleet mail cannot reach.

## Consequences

- Good: bots work unattended at the harness's own automatic review, and a
  dangerous level is never reached by accident.
- Codex auto mode sandboxes writes to the launch folder, so a work dir outside
  the bot home needs `--add-dir`.
- Native Claude messaging between an `auto` session and a `dangerously-skip`
  session is held for approval; such pairs use the Orca mailbox
  ([ADR 0018](0018-messaging-transport.md)).
- Bad: the flag names must be re-checked when a harness updates.
- Bad: a Codex session's sandbox gains network access generally, not only to
  Orca. This cost is accepted, not hidden.
- Bad: inside `auto`, a Codex session cannot start a Codex of its own, so
  the system test that needs one runs its Codex bot at `dangerously-skip`
  (2026-09-23, Codex 0.155.1, #163).
- Revisit if: Codex offers a network setting narrower than all of it, or the
  Orca CLI reaches Orca from inside the sandbox without the switch.
  Confidence: high for the levels; low for why the sandbox blocks Orca, which
  is not established. (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/launch-command.test.js` and `test/session-add.test.js`
  for the flags and the level written; the tech notes' flag mapping, re-checked
  when a harness updates.

## History

- 2026-09-19, [ADR 0005](0005-three-approval-levels-auto-by-default.md): the
  three levels and `auto` by default, decided by the owner in his design
  session.
- 2026-09-21, [ADR 0005](0005-three-approval-levels-auto-by-default.md): a
  section added after acceptance put the network switch on Codex `auto`, the
  coordinator's decision for slice 08 on the evidence of three runs (#132,
  #133).
- 2026-09-23, [ADR 0005](0005-three-approval-levels-auto-by-default.md): that
  section's first sentence was reworded to "every session … whatever its
  approval level", as the coordinator ruled and as the code already did (#175,
  #193); the same day a live run showed that the sandbox, not the level,
  decides (#176).
- 2026-09-24, this record: nothing decided changes. The switch moves into the
  Decision with its attribution, and the record is written again in the format
  the kit now uses and replaces ADR 0005 (#262).
