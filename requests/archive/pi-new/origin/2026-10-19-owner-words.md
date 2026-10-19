Source: standard input
Fetched: 2026-10-19T07:07Z
SHA-256: 7c297488045ca69e90e1ba99fa7e84d48b33f3ed6ef45c07932e04bfd5fa4d28
---
The owner, 2026-10-10 at about 20:20Z, first-hand in the kit-dev architect's session, recorded by the architect in the body of https://github.com/guwenqing/orca-bot-kit/issues/547:
"add a new requirement to support pi, schedule that after all the ongoing ones are done. Do not start new ones except for pi."

The intent the architect wrote in #547's body for that ask:
"A bot or a session can run on Pi, the coding agent (`@earendil-works/pi-coding-agent`), in the same way as on Claude Code and Codex. `--harness pi` is a third choice wherever the kit takes `--harness claude|codex`, and a Pi session works with the rest of the fleet: mail, the book, temporary sessions, rules and skills."

The intent of slice 6, issue #662, as the architect filed it on 2026-10-19:
"The book follows a `/new` in a Pi tab, as it follows a `/clear` in Claude Code and a `/new` in Codex (#391). After a new conversation starts in a Pi session's tab, by a person's `/new` or by the kit, the book holds the new conversation's id. A restart then resumes the conversation the tab was in last, not the old one. Where the kit already clears a session (`obk session clear`), it works for a Pi session too, or says plainly why it does not."

The architect's ruling on #662 (2026-10-19): `obk session clear` on Pi keeps a plain refusal in this slice; a `/new` that a person types is followed; the kit's clear on Pi is a follow-up issue.
