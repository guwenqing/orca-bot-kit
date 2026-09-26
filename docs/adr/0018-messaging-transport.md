# ADR 0018: Native messaging Claude to Claude; the Orca mailbox for everything else

Date: 2026-09-24.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19 and on 2026-09-19 in #51; the coordinator, for the sentences marked as the coordinator's, where the owner was told and may overrule. Consulted: the slice 08 developer and reviewer, whose runs the Orca road rests on. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0008](0008-messaging-transport.md).

## Context

Sessions and bots must talk, by default in a "good enough" way that does not
disturb normal work. The owner asked for native messaging within one harness
when it is supported and Orca across harnesses, for interrupts to be "used in
caution", and for no over-broadcasting (the owner's design session,
2026-09-19, not in the repo).

Claude Code has documented cross-session messaging addressed by session name;
a busy receiver reads between tool calls and an idle one wakes. It has two
classes, bypassing and prompting; within a class it delivers without asking,
and from a bypassing sender to a prompting receiver it holds the message for
approval (from its documentation, Claude Code 2.1.224 on). A name given at
launch survives a closed tab and a resume (Claude Code 2.1.278, 2026-09-21).
Codex's `codex queue` has no official docs, seems to need a shared daemon, has
no delivery receipt or sender identity, and left a message undelivered for a
week on this machine (2026-09-19).

The Orca mailbox is pull-only: a message addressed to a session never reaches
the harness in its tab, and Orca's own notice line is not something the kit
can lean on (it names a bare `orca` that fails on this machine, and goes only
to a loaded, idle pane). A terminal handle is not durable: Orca warns that
delivery does not outlive the tab, and refuses a send once the pane is gone. A
Run lasts, and cannot be deleted. Orca's own `reply` files the reply under the
replier's Run (Orca 1.4.205 to 1.4.209, 2026-09-21 to 2026-09-24; tech notes).
Both harnesses take a line typed while they are busy as queued. Whether a tab
holds a harness at all is read from its foreground process
([ADR 0023](0023-orca-is-the-host.md)).

## Decision

Claude to Claude in the same approval class uses native messaging; sessions
are launched with a stable name that is also their address (proposed;
confirmed for slice 08 by the coordinator, 2026-09-21). Codex to Codex,
cross-harness and mixed-approval pairs use the Orca orchestration mailbox. The
bot never picks the transport: it looks the target up and the skill tells it
which to use (proposed; confirmed for slice 08 by the coordinator,
2026-09-21). Messages are queued and non-interrupting by default, avoid
over-broadcasting, expect a reply only when asked, and interrupt only with
caution.

The kit sets no message-acceptance override. Two `auto` sessions are in the
same class, so Claude Code delivers between them without asking. Mixed pairs
use the Orca mailbox, chosen in advance. A message the receiver's approval
rule has held or refused is not re-sent by another route. ("Chosen in
advance" and the last sentence are the coordinator's, after a peer audit,
#109.)

On the Orca road a send is two things: the message queued in the receiver's
mailbox, and one line typed into its tab telling it to look. Both harnesses
queue a typed line while busy, which is what "queued, not interrupting" means
here. A tab with something on screen waiting to be answered is not typed into
at all, and a session that is not up is not nudged; the message waits in the
mailbox. (The coordinator, for slice 08, 2026-09-21; the owner was told and
may overrule.) "Not up" means the tab's shell is in front. Where the kit
cannot tell whether the program in front is the session's harness, it types
nothing either and says the mail waits (the architect, #232; the owner may
overrule; how a tab is read is in [ADR 0023](0023-orca-is-the-host.md)).

A session's address on the Orca road is a Run (`run:<id>`), made once when the
session is first brought up and kept in the book. A terminal handle is not an
address. A reply is an ordinary send back to the sender's `run:<id>` with a
thread id; the kit does not use Orca's own `reply`. Codex bots reach the
mailbox only with the sandbox switch in
[ADR 0015](0015-three-approval-levels-auto-by-default.md). (The coordinator,
for slice 08, 2026-09-21; the owner was told and may overrule.)

## Alternatives considered

- **`codex queue` for Codex to Codex.** Not trusted: no docs, a daemon, no
  receipt, no sender, a week undelivered. Deferred rather than rejected: it is
  to be retested during the build, and the kit switches if it proves reliable.
  The retest has not been done.
- **Native messaging for every pair.** Not possible: no native road crosses
  harnesses, and Claude Code holds a message between a bypassing and a
  prompting session.
- **The Orca mailbox as the record of every message, with a native nudge.**
  The coordinator's first pick in the design session, replaced after its own
  research by the table of transports above.
- **A message-acceptance override**, so unattended bots accept incoming native
  messages without a prompt. Proposed as security-relevant and awaiting the
  owner. The owner: two `auto` sessions deliver to each other without a
  prompt, so the kit sets nothing (#51).
- **Re-sending a held or refused message by the Orca road.** Not chosen: the
  receiver's approval rule said no, and another route would go around it
  (#109).
- **Terminal handles as addresses.** Not chosen: they do not outlive the tab.
  The cost of a Run is that a retired session leaves an inert one behind.
- **Orca's own `reply`.** Not used: the recipient's check does not look under
  the replier's Run, where Orca files it.
- **Relying on Orca to deliver into the tab, or on its own notice line.** Not
  possible: the mailbox is pull-only, and the notice line fails on this
  machine and reaches only some panes. So the kit types its own line.
- **Deciding whether to nudge from Orca's `tui-idle` alone.** Not chosen: a
  busy harness answers like a shell, and a busy session was told it was not up
  (#232).
- **Broadcast groups.** Not used, to avoid over-broadcasting.
- One transport for every pair, Orca's mailbox included: not recorded as
  considered.

## Consequences

- Bad: two transports to keep working. Retest `codex queue` during the build
  and switch if it proves reliable.
- Grooming reads both the Orca mailbox and the Claude transcripts to see
  traffic.
- Bad: Runs cannot be deleted, so a retired session leaves an inert Run
  behind, which is the price of an address that survives a closed tab.
- Bad: a typed line is best effort, and a session the kit cannot tell about,
  a harness started through a wrapper among them, gets no nudge until #261;
  its mail waits.
- Good: nobody's approval rule is widened or gone around to deliver a message.
- Revisit if: `codex queue` proves reliable, Orca delivers into a harness by
  itself, or Claude Code's classes change. Confidence: high for the Orca road,
  proven live; low for `codex queue`, which is untested since 2026-09-19.
  (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/message-send.test.js`, `test/message-nudge.test.js` and
  `test/message-to.test.js`.

## History

- 2026-09-19, [ADR 0008](0008-messaging-transport.md): decided by the owner in
  his design session, with the stable launch name and the kit choosing the
  transport marked proposed, and a consequence that an acceptance setting for
  incoming native messages awaited the owner.
- 2026-09-19, [ADR 0008](0008-messaging-transport.md): the owner dropped the
  acceptance setting; the kit sets no override and mixed pairs use the Orca
  mailbox (#51).
- 2026-09-20, [ADR 0008](0008-messaging-transport.md): mixed pairs "chosen in
  advance", and a held or refused message not re-sent by another route, by the
  coordinator after a peer audit (#109).
- 2026-09-21, [ADR 0008](0008-messaging-transport.md): a section added after
  acceptance set out how the Orca road works (the nudge, Runs as addresses,
  replies by send) and confirmed the two proposed sentences for slice 08, the
  coordinator's decision on the slice 08 runs (#132, #133).
- 2026-09-24: the nudge was changed to read the tab's foreground process, the
  architect's decision for #232, recorded in ADR 0001 (PR #260); ADR 0008 was
  not changed.
- 2026-09-24, this record: nothing decided changes. The later sections move
  into the Decision with their attribution, "not up" and "cannot tell" are said
  as #232 left them, and the record replaces ADR 0008 (#262).
