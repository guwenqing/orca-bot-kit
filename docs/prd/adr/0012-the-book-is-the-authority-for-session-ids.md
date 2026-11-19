# ADR 0012: The kit's book is the authority for session ids

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19. Consulted: the coordinator, who found what Orca keeps and loses.
Supersedes: [ADR 0002](0002-the-book-is-the-authority-for-session-ids.md).

## Context

Sessions must come back after a reboot, a killed tab or a restart asked for by
Bot Father, and `/clear` creates a new session id that must not be lost (a new
id on every `/clear` is certain for Claude Code and likely for Codex, PRD 6.5).

Orca stores a resume record per pane and relaunches the harness with it, but
drops the record when the tab is closed. Orca's session history can find old
transcripts but does not know which bot and session they belonged to (Orca
1.4.205, 2026-09-19; tech notes). Orca's own record of a tab's conversation
was empty for tabs the kit made (#88). The harnesses keep no record that links
a new conversation to the one the same session had before: Claude Code's
registry covers only live processes, and Codex records no process id a reader
can use (Claude Code 2.1.278 and Codex 0.155.1, 2026-09-20).

The owner, asked whether the kit or Orca should own session identity: "I
prefer we have the authority, but unless this is done from them, then I am
fine to give up", on the condition that Orca could handle `/clear` and recover
a killed tab (the owner's design session, 2026-09-19, not in the repo). Orca
cannot recover a killed tab.

## Decision

Each bot has a book with the current session id of every session and the
history of old ids with the reason they ended. The kit writes it; Orca's own
resume is only a bonus for tabs that are still alive. The owner's condition:
the kit keeps the authority unless Orca one day handles this fully, including
clear and killed-tab recovery.

## Alternatives considered

- **Orca's own resume records as the authority.** Not chosen: they are dropped
  when a tab is closed, so a killed tab cannot be brought back from them. They
  stay a bonus for tabs that are still alive.
- **Orca's session history.** Not chosen: it finds old transcripts but does
  not know whose they are.
- **Orca's record of a tab's conversation as a cross-check.** Planned in the
  design session; not used, because it was empty for the kit's tabs (#88).
- **The harnesses' own records.** Not enough on their own: they cover live
  processes only, or name no process, and neither links a new conversation to
  the one before (#88).
- **Handing the authority to Orca.** The owner's stated way out, on his
  condition: open if Orca one day handles `/clear` and killed-tab recovery
  fully.

## Consequences

- Good: the fleet can be brought back from the book alone.
- Good: old session ids stay available for `obk-recall` and grooming.
- Bad: the book must be kept fresh by a hook
  ([ADR 0022](0022-kit-hooks-live-in-the-bot-folder.md)); if the hook fails,
  the book goes stale, so the kit's health check compares it with the
  harness's own records.
- Revisit if: Orca handles session identity fully, including `/clear` and
  killed-tab recovery (the owner's condition). Confidence: high; Orca drops the
  record with the tab today. (The confidence is proposed in #262; it was not
  recorded when this was decided.)
- Checked by: `test/session-book.test.js`, `test/session-resume.test.js` and
  the system test `test/system/session-identity.test.js`.

## History

- 2026-09-19, [ADR 0002](0002-the-book-is-the-authority-for-session-ids.md):
  decided by the owner in his design session. It named the book's file,
  `sessions.yaml`, the command `bot-kit up` and the `doctor` check against the
  newest transcript.
- 2026-09-19 and 2026-09-20,
  [ADR 0002](0002-the-book-is-the-authority-for-session-ids.md): wording
  only. The command became `obk up` (#55) and the recall skill `obk-recall`
  (#70); then the owner asked for decisions without mechanism names, and the
  file name, the command and `doctor` went out, the health check comparing the
  book "with the harness's own records" (#85, following #84).
- 2026-09-24, this record: nothing decided changes. It is written again in the
  format the kit now uses, with its alternatives, and replaces ADR 0002 (#262).
