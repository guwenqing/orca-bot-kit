Source: standard input
Fetched: 2026-10-17T14:46Z
SHA-256: f50dba7c966084b87a793de62fd6b7b4fae870cbee60cc9126ec62e32f64eae4
---
Source: issue #564 (https://github.com/guwenqing/orca-bot-kit/issues/564), opened by the owner's account qiragu, 2026-10-11. The issue body, as written:

## Problem

After #555 (0.27.0), the kit's default allow list has two gaps. Bot Father found the first on the upgrade (2026-10-11), and developer-555 found the second during #555.

1. Every bot's allow list still holds `Bash(obk session mail ...)` and `Bash(obk session nudge ...)`. #555 removed those commands. `obk rules build` and `obk up` do not name these rules as held, because `heldRules` looks only at `NO_LONGER_DEFAULT`, which lists the #548 commands only. So the user is not told to take them back, as #548 does for `obk restart` and `obk bot create`. The rules do no harm, because the commands are gone.
2. The default allow still holds `Bash(orca orchestration check --run:*)`. rules/mail.md now tells every bot never to answer Orca's notice with a bare `orca orchestration check`, because that leaves the delivery unacknowledged and Orca rings no more (#555 R5).

## What is wanted

- The rules for commands that the kit removed are named as held, with the `obk permission disallow` command that takes each back, as #548 does.
- The default allow does not invite the bare check that rules/mail.md forbids. The developer decides how, and checks first whether any kit path still needs that rule.

## Boundary

The default allow set and how `rules build` and `up` report held rules. No change to a bot's allow list without the user's yes, as today.

Not started: the owner holds new work for the quota (2026-10-11).

https://claude.ai/code/session_01F6Czjf4TWjLmMQDW52JgfW

