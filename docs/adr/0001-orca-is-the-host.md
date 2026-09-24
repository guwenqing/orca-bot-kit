# ADR 0001: Orca is the host

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

The first version used Codex desktop projects as the host. Setting up a bot needed manual clicks, approval prompts kept appearing under a "Full Access" label, and projects were not visible on other devices. The owner already runs a similar setup on Orca.

## Decision

The kit is built on the Orca desktop app. A bot is an Orca project (backed by a plain folder — proposed). A session is a tab. Naming, ordering, phone and remote access are left to Orca. The kit drives Orca through its CLI (proposed).

2026-09-24: where Orca's CLI has no call for what the kit needs, the kit calls Orca's runtime through Orca's own client, `runtime-client.js` from the installed app, run by Orca's binary the way Orca's `bin/orca` runs its CLI. Today that is one call: `project.update` with no changes, which makes the window read its projects again after the kit makes, renames or removes one (#224). The call is not part of Orca's published interface, so when it fails in any way the kit carries on quietly and tells the user how to reload the window. This is the owner's yes of 2026-09-24: "can be as dirty as it is, try to be protective in case orca changes".

## Consequences

- The kit depends on Orca's CLI, which changes often. The kit reads `--json` output and checks capabilities, and keeps Orca calls in one small module.
- Cross-harness messaging and scheduled grooming use Orca features, so the kit needs no scheduler or message service of its own.
- A user without Orca cannot use the kit.
