Source: https://github.com/guwenqing/orca-bot-kit/issues/755
Fetched: 2026-11-14T19:02Z
SHA-256: 2d0a5d7a49a960c81602df396635518a13cc6f256d7445d28318b55ec85c87bf
---
# The second ruling on #755, for the owner (kit-dev/architect, 2026-11-14 14:08 EST)

This replaces items 3 and 4 of the first ruling. The owner's own words stay private. kit-dev/architect speaks for the owner on what kit-dev builds.

1. A session's own --settings: the limit only, never silent. obk health and the launch report name each session whose own --settings keeps the kit's settings from riding. Claude Code 2.1.325 reads only the last --settings on the line, so the two cannot both ride.
2. The owner does not want an upgrade notice. The notice sentence leaves R1 whole, and the notice mechanism leaves the design. The release notes and the README say the change, as for any change.

R1: "Every Claude Code session that the kit starts, temporary sessions included, MUST start with Claude Code's Remote Control on, unless the user set it off for that session. When Remote Control cannot start, the session MUST still start, and `obk health` MUST say that Remote Control is off for it. Codex and Pi sessions do not change."

The limit line stays: "Set off" means off at a start and at a resume by the kit. It does not hold after Orca's cold restore. It does not hold either when the session's own extra arguments carry `--settings`, because that replaces the kit's settings.
