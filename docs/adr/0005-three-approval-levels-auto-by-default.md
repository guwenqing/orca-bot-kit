# ADR 0005: Three approval levels, `auto` by default

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

Bots must work without the user approving every command. On Codex desktop, half-way modes kept prompting. Fully bypassing permissions is dangerous on a personal machine.

## Decision

A session's approval level is `auto`, `ask` or `dangerously-skip`. `auto` is the default and means the harness's real auto mode (automatic review), not a bypass. `dangerously-skip` is written only when the user asks for it in plain words (Bot Father never suggests it — proposed). The kit passes explicit flags for every session so a user's global harness defaults do not leak into bots (proposed).

## Consequences

- Codex auto mode sandboxes writes to the launch folder, so a work dir outside the bot home needs `--add-dir`.
- Native Claude messaging between an `auto` session and a `dangerously-skip` session is held for approval; such pairs use the Orca mailbox.
- The flag names must be re-checked when a harness updates.
