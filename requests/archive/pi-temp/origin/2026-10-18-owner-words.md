Source: standard input
Fetched: 2026-10-18T10:28Z
SHA-256: 3c65296b09595645aadbeec1eb95cd119a91c76c780e9b593d4d1d4450996979
---
The owner, 2026-10-10 at about 20:20Z, first-hand in the kit-dev architect's session, recorded by the architect in the body of https://github.com/guwenqing/orca-bot-kit/issues/547:
"add a new requirement to support pi, schedule that after all the ongoing ones are done. Do not start new ones except for pi."

The intent the architect wrote in #547's body for that ask:
"A bot or a session can run on Pi, the coding agent (`@earendil-works/pi-coding-agent`), in the same way as on Claude Code and Codex. `--harness pi` is a third choice wherever the kit takes `--harness claude|codex`, and a Pi session works with the rest of the fleet: mail, the book, temporary sessions, rules and skills."

And the slice #547 suggests for it:
"**Temporary sessions:** `temp make --harness pi`, retire, and any first-run screen that Pi shows."

The architect's recommendation in #547, which the owner accepted on 2026-10-10 ("yes I accept your proposal"):
"count every Pi session as `dangerously-skip`. The kit refuses `--approval auto` or `ask` for Pi, and says why. A Pi temporary session made by an `auto` maker needs `obk permission approval --temps` (#527), as kb and stockops do today."

This request is slice 3 of #547, issue #648: a temporary session on Pi.
