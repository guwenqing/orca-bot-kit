Source: /Volumes/DevData/projects/ai/mybots/bots/kit-dev/work/developer-671/notes/owner-words.md
Fetched: 2026-10-20T09:29Z
SHA-256: f1226f129e02c776fe3108784c456030e80014af5a721b9d9fe6a3731c1a1f37
---
The owner, 2026-10-10 at about 20:20Z, first-hand in the kit-dev architect's session, recorded by the architect in the body of https://github.com/guwenqing/orca-bot-kit/issues/547:
"add a new requirement to support pi, schedule that after all the ongoing ones are done. Do not start new ones except for pi."

The intent the architect wrote in #547's body for that ask:
"A bot or a session can run on Pi, the coding agent (`@earendil-works/pi-coding-agent`), in the same way as on Claude Code and Codex. `--harness pi` is a third choice wherever the kit takes `--harness claude|codex`, and a Pi session works with the rest of the fleet: mail, the book, temporary sessions, rules and skills."

The intent of issue #671, as the architect filed it on 2026-10-20 after #663's boundary ("`obk session compact` on Pi is a separate question. Leave it refused unless the architect adds it."):
"`obk session compact` works on a Pi session, as it works on Claude Code and Codex. The kit types Pi's `/compact` into the Pi tab with the same care it takes for `/new` there, and confirms the compact by Pi's own record, as the PRD says for every harness."
Its boundary: keep every check that `obk session compact` makes today, and every Pi screen check from #663; a stale menu row must not apply a command other than `/compact`; confirm by Pi's own record; read nothing that holds a credential, write nothing into `~/.pi/agent`, and delete nothing by hand in Pi's session store; add no command, option or setting.
