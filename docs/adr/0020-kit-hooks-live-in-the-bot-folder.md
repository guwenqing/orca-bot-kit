# ADR 0020: Kit hooks live in the bot folder, not in user settings

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19; for what the kit does when the book cannot name a conversation, what slice 04 built after its review (#88), recorded on 2026-09-23, which the owner may overrule. Consulted: the coordinator, who proposed the hook's place.
Supersedes: [ADR 0010](0010-kit-hooks-live-in-the-bot-folder.md).

## Context

The book must learn a new session id when a session starts, resumes or is
cleared ([ADR 0012](0012-the-book-is-the-authority-for-session-ids.md)), and
the start prompt must be re-sent after `/clear`: the owner, "resend
automatically after clear. This is the only differenciation of the different
agents" (the owner's design session, 2026-09-19, not in the repo).

Tools such as Orca write their own hooks into the user-level settings file.
On this machine Orca wrote its hooks into the owner's versioned settings, and
that file had to be taken out of version control because of it (2026-09-19).

Both harnesses read a hooks file in the folder a session starts in, and hand
the hook the session's id and why it started; a SessionStart hook can also
put text into the session (Claude Code 2.1.278 and Codex 0.155.1, proven live
2026-09-20). A Codex hooks file must be trusted once, per entry, and trusting
it does not replay a start it missed. A hook runs as a child of the harness.
A bot's folder holds the conversations of every one of its sessions and of
anything they start inside themselves, and neither harness links a new
conversation to the one the same session had before (tech notes).

Writing is not banned: an AI acting on the user's instruction may write what
the user asks, user-level settings included. The kit's own mechanical code
does not reach into user-level settings by itself (PRD 6.3, the owner,
2026-09-20).

## Decision

The kit's hook lives in the bot's own folder inside the bots repo, for each
harness in the place that harness reads. Through it the kit updates the book
and makes sure the session has its start prompt again after a clear. The kit
never writes to user-level settings.

The kit does not fall back to the newest transcript in a bot's folder. When
the book cannot name a session's conversation, the kit writes the ones it
found and nobody claims into the book as `unclaimed`, starts the session on a
fresh conversation with its duty, and leaves the choice to a person or Bot
Father (README, "Sessions that come back"). (What slice 04 built after its
review, #88, recorded on 2026-09-23; the owner may overrule.)

## Alternatives considered

- **The hook in user-level settings.** Not chosen: other tools write there,
  and the file had to leave version control once already because of them.
- **The newest transcript for the bot folder as the fallback**, when a Codex
  hook does not report the new id. The coordinator's proposal, which the owner
  accepted with the hook plan on 2026-09-19. Dropped in the review of slice 04:
  a bot's folder holds the conversations of every session and of anything
  they start, so the newest one says nothing about whose it is. A child
  `codex exec` put its id into its parent's history, and two sessions
  reporting in reverse order swapped ids (#88).
- **The tab's `ORCA_TAB_ID` alone as proof that a conversation is the
  session's.** Not chosen: a child `codex exec` in the same tab carries the
  same value and took the session over (#88). The kit uses the process tree
  from the launch shell instead.
- **`up` adopting a single unclaimed conversation, or refusing to start while
  there are several.** Tried and dropped in the same review: a fleet that will
  not come up because the kit is unsure is worse than one that starts fresh
  and says so (#88).
- **The kit owning the whole hook group in a settings file.** Not chosen: it
  deleted a user's own hook in the same group. The kit owns only its own entry
  (#88, #165).
- **Following a link out of the bot folder**, for example into the user's
  home. Refused: through it the kit would be writing the user's own settings
  (#170).
- Codex's switch that bypasses hook trust: the kit does not use it; no reason
  is recorded.

## Consequences

- Good: bot-level settings are versioned with the bot and do not collide with
  other tools.
- Bad: Codex requires hooks to be trusted once; init handles it or tells the
  user the one step.
- The hook must be fast and must never block the session if `obk` is missing.
- Bad: a conversation the book cannot name is not guessed at; a person or Bot
  Father has to choose, and until then the session runs on a fresh
  conversation.
- Revisit if: a harness reports every new conversation with a link to the
  session that had it, or offers a hook place outside the project folder that
  no other tool writes. Confidence: high; the fallback's failure was seen on
  real Codex. (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/session-hooks.test.js`, `test/session-unclaimed.test.js`
  and `test/hook-links.test.js`.

## History

- 2026-09-19, [ADR 0010](0010-kit-hooks-live-in-the-bot-folder.md): decided
  by the owner in his design session, with the hook in the bot's
  `.claude/settings.json` and the Codex hooks file, calling
  `bot-kit session-seen`, and the newest-transcript fallback for Codex.
- 2026-09-19 and 2026-09-20,
  [ADR 0010](0010-kit-hooks-live-in-the-bot-folder.md): wording only. The
  command became `obk` (#55); then the owner asked for decisions without
  mechanism names, and the file names and the command went out (#85, following
  #84).
- 2026-09-20: slice 04 built the book and the hook without the fallback, after
  its review found the guess going wrong both ways (#88). ADR 0010 was not
  changed.
- 2026-09-23, [ADR 0010](0010-kit-hooks-live-in-the-bot-folder.md): a section
  added after acceptance recorded that the fallback is not used and what the
  kit does instead (#175, #193).
- 2026-09-24, this record: nothing decided changes. The later section moves
  into the Decision with its attribution, in place of the fallback sentence,
  and the record replaces ADR 0010 (#262).
