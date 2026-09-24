# ADR 0001: Orca is the host

Date: 2026-09-19. Status: superseded by [ADR 0011](0011-orca-is-the-host.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

The first version used Codex desktop projects as the host. Setting up a bot needed manual clicks, approval prompts kept appearing under a "Full Access" label, and projects were not visible on other devices. The owner already runs a similar setup on Orca.

## Decision

The kit is built on the Orca desktop app. A bot is an Orca project (backed by a plain folder — proposed). A session is a tab. Naming, ordering, phone and remote access are left to Orca. The kit drives Orca through its CLI (proposed).

2026-09-24: where Orca's CLI has no call for what the kit needs, the kit calls Orca's runtime through Orca's own client, `runtime-client.js` from the installed app, run by Orca's binary the way Orca's `bin/orca` runs its CLI. Today that is one call: `project.update` with no changes, which makes the window read its projects again after the kit makes, renames or removes one (#224). The call is not part of Orca's published interface, so when it fails in any way the kit carries on quietly and tells the user how to reload the window. This is the owner's yes of 2026-09-24: "can be as dirty as it is, try to be protective in case orca changes".

## Consequences

- The kit depends on Orca's CLI, which changes often. The kit reads `--json` output and checks capabilities, and keeps Orca calls in one small module.
- Cross-harness messaging and scheduled grooming use Orca features, so the kit needs no scheduler or message service of its own.
- A user without Orca cannot use the kit.

## Amendment, 2026-09-24 (the architect's decision for #232; the owner may overrule)

To learn whether a harness is running in a tab, the kit also reads that tab's
foreground process group from the operating system, with `ps`, using the pane
pid Orca gives in `orca diagnostics memory`. It only reads, and it never kills.
Orca's own answers do not tell a harness from a shell
(Orca 1.4.209, Claude Code 2.1.281, Codex 0.156.1, measured 2026-09-24):
- `terminal wait --for tui-idle` answers `timeout` for a busy harness, the
  same as for a shell.
- After Codex quits, the shell it leaves answers `satisfied:true`.
- `agentIdentity` stayed `codex` on a tab back at a shell prompt for more than
  70 s, and it can come up to 5 s after a launch.
- The foreground process group was right every time: the shell at a prompt,
  the harness while it runs, and the shell again within 3 s of every quit.
The kit runs only on the machine Orca runs on (PRD 5's "No cloud execution",
itself still marked proposed), so reading the local process table is enough.
When the pid or the group cannot be read, the kit says it cannot tell, and it
types nothing.
