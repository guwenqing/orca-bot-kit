# ADR 0042: Native messaging Claude to Claude; the Orca mailbox for everything else

Date: 2026-10-11.
Status: accepted.
Decided by: the owner, in his design session of 2026-09-19 and on 2026-09-19 in #51; the coordinator, for the sentences marked as the coordinator's, where the owner was told and may overrule; the architect, for #394, for the sentences marked so, where the owner may overrule; the owner on 2026-10-11 for one road and one signal for each fleet mail, Orca's own notice, and an interrupt for urgent mail (#555). Consulted: the slice 08 developer and reviewer, whose runs the Orca road rests on. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0035](0035-messaging-transport.md).

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
the harness in its tab. Orca types a notice line of its own, "You have N
orchestration message(s). Run `orca orchestration check --run <run>`", into
the tab of the Run's coordinator. On Orca 1.4.223 it does so only once that tab
reads idle and settled, never while an earlier delivery to that mailbox is
still open, and tries again when the tab's title turns idle and on a timer of
about 3 s. Each message gets one notice, and Orca marks it delivered then.
Nothing turns the notice off. Orca does not check that its notice started a
turn, and it presses Enter on a tab that reads working too. A Codex tab reads
idle only through the `Codex ready` title Orca's own Codex hook writes, and
with that hook in place Orca's notice did reach an idle kit-made Codex tab, at
once after the send (live, 2026-10-09, #509). A tab
may not read another tab's mailbox, so a sender cannot see whether the notice
went (read in the 1.4.223 bundle, 2026-10-09, #509; tech notes). Orca's
`check` shows the subject and not the body, and leaves the delivery open,
which holds back the next notice (1.4.214, #402). A terminal handle is not durable: Orca warns that
delivery does not outlive the tab, and refuses a send once the pane is gone. A
Run lasts, and cannot be deleted. Orca's own `reply` files the reply under the
replier's Run (Orca 1.4.205 to 1.4.209, 2026-09-21 to 2026-09-24; tech notes).
Both harnesses take a line typed while they are busy, and Orca's
receipt for it shows no turn start, the same as for a line that was lost
(#394). Claude Code holds such a line in its input box and sends it when the
turn ends, which can be after the mail it announces was read, or never, when
the tab is closed first. Codex takes it into the running turn at once as a
steer, which also ends its sleep tool (#432). A line typed into a busy Claude
tab therefore outlived its mail, and the owner asked for one signal for each
mail, with the second "only when the first way is not received" (#509).
Both harnesses run a `Stop` hook at a turn end that can answer with a reason
the session then goes on with, typing nothing into the tab; Codex drops that
answer from an `async` hook, and a new or changed Codex hook entry puts every
Codex session on its "Hooks need review" screen (read in the Codex 0.162.0
source, #509). Whether a tab
holds a harness at all is read from its foreground process
([ADR 0034](0034-orca-is-the-host.md)).

A probe on Orca 1.4.224 (2026-10-11, #555), with the raw `orca orchestration
send` and no line of the kit's, showed that Orca parks its notice for a busy
receiver and offers it again once the receiver is idle. A busy Codex got it
about 75 s after its turn ended, an idle one at once, and a Claude Code
session about 3.5 min after its turn ended. After one Escape into a busy tab,
the notice came about 1 s (Claude Code) or 2 s (Codex) later. Orca rings no
more for a mailbox while a delivery is open: its notice text names `orca
orchestration check`, which does not acknowledge, and `obk message check`
does. The owner judged the kit's line, its watch and its hook too much for a
simple thing, and asked to rely on Orca's own notice, with one interrupt for
urgent mail (#555).

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

On the Orca road a send is the message queued in the receiver's mailbox, and
nothing else: Orca's own notice tells the receiver to look once it is idle,
which the probe saw about 1 to 4 min after its turn ended; that delay is
accepted. The kit types nothing into the receiver's tab, and the send says
which road it took (the owner, #555).

For urgent mail the sender asks for an interrupt: `obk message send
--interrupt`. Where the receiver's harness is in its tab and busy, the kit
presses Escape once there, to end its turn, and then queues the letter; Orca's
notice then comes at once. Never by default. The Escape goes through the gate
every key the kit types goes through: a tab with something on screen waiting
to be answered, a tab with its shell in front, or one the kit cannot tell
about gets no Escape, and the letter still goes, with the send saying why
(the owner, #555; the gate as [ADR 0034](0034-orca-is-the-host.md) reads a
tab). After an Escape, Codex keeps a command it was running as a background
terminal, and the send says so for a Codex receiver.

A receiver answers Orca's notice with `obk message check`, which
acknowledges, and never with a bare `orca orchestration check`, which leaves
the delivery open, so Orca rings no more. The kit's rules say so to every bot
(#555).

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
- **Relying on Orca to deliver into the tab.** Not possible: the mailbox is
  pull-only. Orca's notice is the signal.
- **The kit's line on every receiver beside Orca's notice** (#402).
  Replaced: a Claude receiver got two signals for one message, and a line
  typed into a busy Claude tab waited in its input box (#509).
- **The kit's line as a fallback after an 8 s watch, a Claude turn-end hook
  for mail still unread, and a hint of unread mail in the temp folder**
  ([ADR 0035](0035-messaging-transport.md), #509). Replaced: too much for a
  simple thing, the owner said; Orca's notice reaches a busy receiver once it
  is idle by itself, as the probe showed (#555).
- **An Escape on every send to a busy receiver.** Not chosen: mail is queued
  and not an interruption by default (PRD 6.9).
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
- Good: one signal for each message, Orca's own, and nothing the kit types
  into a tab unless the sender asks for an interrupt.
- Bad: a busy receiver learns of its mail 1 to 4 min after its turn ends, and
  not before, unless the sender interrupts it.
- Bad: a receiver that reads its mail with a bare `orca orchestration check`
  gets no further notice for that mailbox until the mail is read with `obk
  message check`.
- Bad: an Escape can meet a turn that ends between the kit's look and the key;
  it then falls on an idle harness.
- Good: nobody's approval rule is widened or gone around to deliver a message.
- Revisit if: `codex queue` proves reliable, Orca delivers into a harness by
  itself, Orca's notice stops reaching a receiver once it is idle, or Claude
  Code's classes change. Confidence: high for the Orca road,
  proven live; low for `codex queue`, which is untested since 2026-09-19.
  (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/message-send.test.js`, `test/harness-in-tab.test.js`,
  `test/message-to.test.js`, and the tests #555 adds for the interrupt and
  what it removes, with `test/system/messaging.test.js` and
  `test/system/mail-interrupt.test.js` live.

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
- 2026-09-24, [ADR 0018](0018-messaging-transport.md): nothing decided
  changes. The later sections move into the Decision with their attribution,
  "not up" and "cannot tell" are said as #232 left them, and the record
  replaces ADR 0008 (#262).
- 2026-09-27: the send says a tab was told to look only when Orca saw the line
  start a turn, the architect's decision for #394 (PR #403); ADR 0018 was not
  changed.
- 2026-09-27, [ADR 0030](0030-messaging-transport.md): the kit's line stays
  on both harnesses beside Orca's own notice, the architect's decision for
  #402 on its finding, and #394's rule is recorded; the record replaces ADR
  0018.
- 2026-10-09, [ADR 0035](0035-messaging-transport.md): one signal for each fleet mail, Orca's notice
  first and the kit's line a fallback, the owner's decision for #509, with the
  architect's rulings on the watch, the Claude hook, Codex and the retire;
  [ADR 0035](0035-messaging-transport.md) replaces ADR 0030.
- 2026-10-11, this record: one road and one signal, Orca's own notice, and an
  interrupt for urgent mail, the owner's decision for #555; the kit's line,
  its watch, the Claude hook and the hint of unread mail are gone; the record
  replaces ADR 0035.
