# ADR 0022: Kit hooks live in the bot folder, not in user settings

Date: 2026-09-25.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19; for what the kit does when the book cannot name a conversation, what slice 04 built after its review (#88), recorded on 2026-09-23, which the owner may overrule; the architect, for #318, for how the hook knows the session's own harness in a tab the kit did not launch, which the owner may overrule. Consulted: the coordinator, who proposed the hook's place.
Supersedes: [ADR 0020](0020-kit-hooks-live-in-the-bot-folder.md).

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

Every program in a tab carries the tab's id, a harness the session starts
inside itself included, so the tab alone does not say whether a report is the
session's own (#88). Since slice 04 the kit's launch line gives the harness
the pid of the tab's shell, and a report counts only when its harness is that
shell's child.

When Orca brings its tabs back by itself, after a machine restart or an Orca
update, it resumes each harness with a bare `claude --resume <id>` or `codex
resume <id>`, with none of the kit's launch line. So a `/clear` there was not
written to the book, and the session was not told its duty again: the book
kept the conversation before the clear, which a later restart would resume
(seen on 2026-09-25, Orca 1.4.210, #318). The harness Orca resumes sits where
the kit's own does: the direct child of the tab's login shell, which is the
child of the pane's `login` (seen with `ps` the same day, for Claude Code and
Codex, restored and kit-launched alike; tech notes).

Writing is not banned: an AI acting on the user's instruction may write what
the user asks, user-level settings included. The kit's own mechanical code
does not reach into user-level settings by itself (PRD 6.3, the owner,
2026-09-20).

## Decision

The kit's hook lives in the bot's own folder inside the bots repo, for each
harness in the place that harness reads. Through it the kit updates the book
and makes sure the session has its start prompt again after a clear. The kit
never writes to user-level settings.

The hook writes down only what the session's own harness reports: the harness
in the tab the book names for the session, started by that tab's shell. The
launch line names the shell. In a tab that has no launch line, such as one
Orca brought back by itself, the tab's shell is the one `login` started for
the pane. A harness the session starts inside itself is never the session's
own. (The architect, #318, for the tab with no launch line; the owner may
overrule.)

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
  from the tab's shell instead.
- **Only the shell the launch line names.** What slice 04 built. Not enough on
  its own: a tab Orca brought back has no launch line, so its `/clear` went
  unrecorded and its duty was not handed back (#318).
- **Only the `login` shell, with no launch-line marker.** Not chosen: the
  marker is proven, and it still covers a tab whose shell hands over to
  another one, such as a shell that starts tmux, where the harness is not
  `login`'s grandchild (#318).
- **Putting the kit's variables into a tab it did not launch.** Out of bounds
  for #318: the kit does not fake its own variables or Orca's in a tab.
- **The hook asking Orca** which program is in the tab and what Orca names it.
  Not chosen: the hook runs inside the user's session and makes no calls, and
  the process table answers the question on its own (#318).
- **Noting the harness's pid in the book when it first reports**, and
  believing that pid afterwards. Not chosen: it churns a file that is
  committed, and in a tab whose book is already stale there is no first report
  to anchor on (#318).
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
- Good: a session Orca brought back by itself still has its clears written to
  the book and is told its duty again after one.
- Bad: Codex requires hooks to be trusted once; init handles it or tells the
  user the one step.
- The hook must be fast and must never block the session if `obk` is missing.
- Bad: a conversation the book cannot name is not guessed at; a person or Bot
  Father has to choose, and until then the session runs on a fresh
  conversation.
- Bad: the rule for a tab with no launch line rests on the pane being `login`
  with the shell as its child, which is what Orca does on macOS. Where the
  pane is the shell itself, or the tab's shell hands over to another, such a
  tab's reports are not recorded, as before #318.
- The hook reads the process table with `ps`. Codex runs its SessionStart hook
  outside its `workspace-write` sandbox, where `ps` would not start (#298), so
  the reading works on Codex at the kit's default level (tech notes).
- Revisit if: a harness reports every new conversation with a link to the
  session that had it, or offers a hook place outside the project folder that
  no other tool writes; or Orca brings tabs back through the kit's launch
  line, or gives a tab a way to say who launched its harness. Confidence:
  high; the fallback's failure was seen on real Codex, and the restored tabs'
  tree was read live. (Proposed in #262 for the first part; not recorded when
  it was decided.)
- Checked by: `test/session-hooks.test.js`, `test/session-unclaimed.test.js`,
  `test/session-ownership.test.js`, `test/restored-tab-record.test.js`,
  `test/hook-links.test.js` and the system test `test/system/restored-tab.test.js`.

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
  its review found the guess going wrong both ways, and with the launch line
  naming the tab's shell (#88). ADR 0010 was not changed.
- 2026-09-23, [ADR 0010](0010-kit-hooks-live-in-the-bot-folder.md): a section
  added after acceptance recorded that the fallback is not used and what the
  kit does instead (#175, #193).
- 2026-09-24, [ADR 0020](0020-kit-hooks-live-in-the-bot-folder.md): nothing
  decided changed. The later section moved into the Decision with its
  attribution, in place of the fallback sentence, and the record replaced ADR
  0010 (#262).
- 2026-09-25, this record: the hook also knows the session's own harness in a
  tab with no launch line, by the tab's `login` shell, and the rule moves from
  the alternatives into the Decision. It replaces ADR 0020 (#318).
