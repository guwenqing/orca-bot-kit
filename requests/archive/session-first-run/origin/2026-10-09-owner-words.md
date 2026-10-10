Source: standard input
Fetched: 2026-10-09T21:12Z
SHA-256: db4ce632aa802e2211f7295c10efd3bac0aa64355665ba54ab044d0146312ea6
---
## What I expected

The kit already has a narrow, checked command for exactly this screen, but only for temporary sessions: `obk temp trust-hooks --bots <path> --name <session>`, run in the maker's tab (#489 did the same for Claude's Teach auto mode screen with `obk temp answer`). A long-lived session brought up by `obk init`, `obk up`, `obk restart` or `obk unpause` has no such command, so the caller has to type raw keys into another agent's tab. An auto-mode caller (Bot Father's own grooming session, or an assistant running SETUP.md) is then blocked, and the hooks screen is the one SETUP.md says must be answered or the book never learns the conversation.

A command along the lines of `obk session trust-hooks --bots <path> --bot <bot> --session <name>` (and the Claude `answer` equivalent), with the same checks as the temp one (reads the screen, answers only the exact shape it knows, refuses anything else, checks the screen went), would let one narrow permission rule cover it, as `Bash(<kit> temp answer:*)` does for temp sessions. SETUP.md §5 and `obk-bot-building` could then point at it instead of raw `terminal send`.


(The owner, in issue #506: https://github.com/guwenqing/orca-bot-kit/issues/506)
