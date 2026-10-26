# teach-form-off
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-26 the owner's words, snapshot origin/2026-10-26-owner-words.md

## Organized requirement

<!-- R1 from:2026-10-26-owner-words.md -->

### R1 No session stops on Claude Code's Teach auto mode form

No session of a fleet SHOULD stop and wait on Claude Code's "Teach auto mode about your environment?" form. When the kit writes its hook into a Claude Code bot's `.claude/settings.json` in the bot folder, it MUST also write `"skillOverrides": { "auto-mode-setup": "off" }` into that file. It MUST keep every other entry of the file, other `skillOverrides` entries included. Every session of the bot starts at the bot folder, so each of them reads the setting, and Claude Code then does not show the form. For this, the kit MUST NOT write user-level settings and MUST NOT send any key to the form. It MUST NOT answer the form with Continue. The cost: `/auto-mode-setup` is off in the bot's own sessions. The user's own sessions outside the bots folder keep it. A user who wants it in a bot's sessions sets `"auto-mode-setup": "on"` under `skillOverrides` in the bot's `.claude/settings.local.json`, which wins over the kit's entry; the kit MUST NOT write that file. `obk temp answer` and `obk session answer` stay for a Claude Code version that shows the form all the same.
Signed off: 2026-10-26 owner, origin/2026-10-26-signoff.md

## Outcome

Concluded 2026-10-26 with al conclude, on the working tree at 394c72b.

- R1 No session stops on Claude Code's Teach auto mode form, version 2, signed in S1:
  - KIT-26 rule: in docs/prd/prd.md, serves it
- Not known: whether the code, tests and documents do what the paragraphs say; whether the work has ended: the tool does not take a merged task or a reconciled spec as evidence of that.
