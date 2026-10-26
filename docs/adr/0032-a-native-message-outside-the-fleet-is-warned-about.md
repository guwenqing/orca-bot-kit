# ADR 0032: A native message outside the fleet is warned about, never stopped

Date: 2026-10-02.
Status: accepted.
Decided by: the owner, "warning only and be clear" (2026-10-02, on #451); the architect, for the shape (ruling of 2026-10-02 on #451, comment 5960203353). Consulted: developer-1, who proposed it.

## Context

Claude Code's own messaging, `SendMessage`, reaches every Claude session on
the machine, not only the sessions of one bots folder. The kit gives each
session an address of its own (#286) and answers `obk message to` with the
right one, but nothing stops a session writing to another name it can see.

On 2026-09-29 that happened (#450): a test fleet's grooming session asked the
kit for its road and got the right address, its own fleet's daily. That
session was not live, so the model sent to the nearest listed name instead,
the owner's real Bot Father daily, under its bare pre-#286 name. The message
was delivered. A test reached outside its space (#220).

[ADR 0022](0022-kit-hooks-live-in-the-bot-folder.md) puts the kit's hook in
the bot folder, and asks each harness for one event, SessionStart. Claude
Code also runs a PostToolUse hook after a tool call, matched by the tool's
name, and the hook can hand the session text it reads on its next request
(`additionalContext`), without deciding anything about the call (Claude Code
hooks reference, read 2026-10-02; seen live on Claude Code 2.1.288 the same
day, see Checked by). A hook that
returns a permission decision would also approve or refuse the call, past
Claude Code's own permission check, which is not the kit's to do.

What a `SendMessage` returns says which kind of send it was, by its fields
(seen on Claude Code 2.1.283 in a session's own transcript): one to an
in-process teammate carries a `routing` object; one to another session
carries `display` and no `routing`. The tool's input names the target in
`to`, as a session's name with an optional ` [xxxxxx]` reference, or as a
`uds:` socket path when the session is answering a message it received. A
socket path names a process, not a session, and the book cannot map it to
one.

## Decision

We will add a second kit hook for Claude Code, in the same bot-folder file and
written by the same code as SessionStart: PostToolUse, matched to
`SendMessage`, running `obk session sent`.

After a send to another session, the hook compares the target's name with
every session address in the books of the bots folder. When the name is none
of them, it gives the session a short, plain warning: that the address is
outside this fleet, which address `obk message to` gives for the session it
probably meant when there is one, and to check before sending again. The send
has already gone, and nothing is undone or retried.

The hook never returns a decision. It says nothing about a send to a
teammate, to an address of the fleet's own, to a `uds:` or bridge address,
about a send that failed, or when what it was handed cannot be read: then it
prints nothing and exits 0. It never fails the turn.

Existing bots get the hook the way they got SessionStart, the next time
`obk up` runs for them.

## Alternatives considered

- **Refuse the send** (the first proposal on #451). Not chosen: the owner
  wants the session to stay free to write where it means to, a session
  outside the kit or another bots folder included, and to be told plainly
  when that is outside its fleet.
- **A PreToolUse hook.** It could warn before the send, but it sees only the
  target's name and not whether the target is a teammate or another session,
  so it would warn about every teammate message. Its decision field also
  invites approving the call by accident.
- **Judge `uds:` addresses too.** Not possible from the book: a socket path
  names a running process. Accepted as a limit; such sends answer a message
  the session received, so the peer has already reached it.
- **Prompt text only**, telling sessions to use `obk message to`. Already
  done for the grooming job (#450); the warning is what catches a model that
  goes past it.

## Consequences

- Good: a send that leaves the fleet is seen by the session that made it, the
  moment after, with the right road named.
- Good: a test fleet's run shows it in the transcript, where a test can check.
- Bad: it warns after the fact; the message has gone. Accepted with the
  owner's "warning only".
- Bad: a `uds:` send is never judged; a session answering a stray message
  from outside its fleet gets no warning.
- Bad: a second hook event to keep working as Claude Code changes the shape
  of what it hands the hook. An unreadable shape is silence, so a change
  shows as missing warnings, not as broken sessions.
- Revisit if: Claude Code gives native messaging a scope of its own, or a
  `uds:` address can be tied to a session. Confidence: high for the shape on
  the version it was proven on; low that the result's fields stay as they are.
- Checked by: `test/` cases for the hook command and its install (no decision
  field in any output), and `test/system/send-outside-fleet.test.js`, in which
  a session of one throwaway bots folder messages its own fleet and then a
  second throwaway bots folder. Run live on 2026-10-02 (Claude Code 2.1.288):
  the hook ran after the outside send (`hook_success`, `PostToolUse:SendMessage`)
  and the session got the warning as a `hook_additional_context` attachment;
  nothing followed the send inside its own fleet.

## History

- 2026-09-25, [ADR 0022](0022-kit-hooks-live-in-the-bot-folder.md): the kit's
  hook lives in the bot folder and asks for SessionStart alone. Still holds;
  this record adds a second event for Claude Code beside it.
- 2026-10-25 (#705): a send to a subagent of the same session answers with
  a `pin` and no `routing` (Claude Code 2.1.283 to 2.1.310), and the hook
  warned about it. The decision holds. The hook now takes a send as one to
  another session only when it went, its result has a `msg_id`, and it has
  neither `routing` nor `pin` (tech notes, section 2).
