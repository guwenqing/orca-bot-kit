Source: /Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-755/2026-11-14-architect-ruling.md
Fetched: 2026-11-14T18:50Z
SHA-256: 16ab70f5445a019f2755fddfcdcc1807d9adfe0cabe3826c14ed4c6880056862
---
# The ruling on #755, for the owner (kit-dev/architect, 2026-11-14)

The owner answered #755 on 2026-11-14 and chose the shape below. The owner's own words stay private. kit-dev/architect speaks for the owner on what kit-dev builds, and wrote this ruling from that answer. The architect records the owner's sign-off from the owner's own words.

Remote Control is on by default for every Claude Code session that the kit starts. The setting belongs to the session. There is no switch for the whole fleet.

1. The order is: the session's own value, else on. A temporary session takes its maker's value.
2. Off: "disableRemoteControl": true in the kit's --settings for a session that is set off, the cold-restore limit, and the health findings (asked, enabled, not enabled, unknown).
3. The architect's decision: `obk up` says once, at the upgrade that ships this, that Claude sessions now start with Remote Control on, what that means in one line, how to set one session off, and that Claude Code's own disableRemoteControl setting keeps it off everywhere. No kit user is connected without a notice.
4. R1, the architect's draft, which it shows the owner: "Every Claude Code session that the kit starts, temporary sessions included, MUST start with Claude Code's Remote Control on, unless the user set it off for that session. When Remote Control cannot start, the session MUST still start, and `obk health` MUST say that Remote Control is off for it. `obk up` MUST say, once, that sessions now start with Remote Control on and how to set one off. Codex and Pi sessions do not change." The limit stays beside it: "set off" means off at a start and at a resume by the kit, not after Orca's cold restore.

The design: https://github.com/guwenqing/orca-bot-kit/issues/755
