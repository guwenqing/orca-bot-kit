Source: /private/tmp/claude-501/-Volumes-DevData-projects-ai-mybots-bots-kit-dev/393d9f99-49b7-4fd4-aa67-eac78a780eb4/scratchpad/stdin.md
Fetched: 2026-10-17T03:20Z
SHA-256: c7b8f93d19a5443ed4f2b3ee98ca43257284758d8234276d3b48309fec4d55cd
---
The owner's words on #575, in the issue's body (https://github.com/guwenqing/orca-bot-kit/issues/575) by qiragu, 2026-10-11:

## Problem

The Decision in `docs/adr/0034-orca-is-the-host.md:156-210` prescribes default mail nudges and a Codex PostToolUse nudge hook. The later accepted ADR 0042 says a normal send only queues mail and Orca gives the notice (`docs/adr/0042-messaging-transport.md:94-113`). It says `up` removes the old Codex nudge hook (`:180-183`). A contributor reading ADR 0034 as an active decision can rebuild removed behavior.

ADR 0036 also links to the superseded ADR 0037 at `docs/adr/0036-the-kit-writes-every-bots-default-permission-rules.md:44` and prescribes the bare Orca check at `:48-49`. Existing #564 covers the live default permission rule. This issue covers the accepted decision documents.

## Expected

Mark the superseded parts of ADR 0034 and ADR 0036 clearly, and point to ADR 0041 and ADR 0042. Keep the historical text readable, but make the current decision unambiguous.

Audit: commit `043bb17`, 2026-10-11. Related live rule: #564.

