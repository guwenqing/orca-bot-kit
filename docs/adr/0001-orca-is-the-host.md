# ADR 0001: Orca is the host

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

The first version used Codex desktop projects as the host. Setting up a bot needed manual clicks, approval prompts kept appearing under a "Full Access" label, and projects were not visible on other devices. The owner already runs a similar setup on Orca.

## Decision

The kit is built on the Orca desktop app. A bot is an Orca project (backed by a plain folder — proposed). A session is a tab. Naming, ordering, phone and remote access are left to Orca. The kit drives Orca through its CLI (proposed).

## Consequences

- The kit depends on Orca's CLI, which changes often. The kit reads `--json` output and checks capabilities, and keeps Orca calls in one small module.
- Cross-harness messaging and scheduled grooming use Orca features, so the kit needs no scheduler or message service of its own.
- A user without Orca cannot use the kit.
