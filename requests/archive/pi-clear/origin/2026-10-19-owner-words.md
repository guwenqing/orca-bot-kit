Source: standard input
Fetched: 2026-10-19T10:29Z
SHA-256: 934b3001908c779be19e0bdfeab904254f360f3f8e77d8a15cc54645d8e1fb27
---
The owner, 2026-10-10 at about 20:20Z, first-hand in the kit-dev architect's session, recorded by the architect in the body of https://github.com/guwenqing/orca-bot-kit/issues/547:
"add a new requirement to support pi, schedule that after all the ongoing ones are done. Do not start new ones except for pi."

The intent the architect wrote in #547's body for that ask:
"A bot or a session can run on Pi, the coding agent (`@earendil-works/pi-coding-agent`), in the same way as on Claude Code and Codex. `--harness pi` is a third choice wherever the kit takes `--harness claude|codex`, and a Pi session works with the rest of the fleet: mail, the book, temporary sessions, rules and skills."

The intent of issue #663, as kit-dev developer-662 filed it on 2026-10-19 on the architect's ruling on #662:
"`obk session clear` works on a Pi session, as it works on Claude Code (`/clear`) and Codex (`/new`). The kit types `/new` into the Pi tab with the same care it takes today, and confirms the clear by the new conversation in the book."
Its boundary: keep every check that `obk session clear` makes today; `obk session compact` on Pi stays refused unless the architect adds it; add no command, option or setting.
