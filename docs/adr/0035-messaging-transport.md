# ADR 0035: Native messaging Claude to Claude; the Orca mailbox for everything else

Date: 2026-10-09.
Status: superseded by [ADR 0042](0042-messaging-transport.md).
Decided by: the owner, in his design session of 2026-09-19 and on 2026-09-19 in #51; the coordinator, for the sentences marked as the coordinator's, where the owner was told and may overrule; the architect, for #394, for the sentences marked so, where the owner may overrule; the owner on 2026-10-09 for one signal for each fleet mail (#509), with the architect's rulings on how, for the sentences marked so, where the owner may overrule. Consulted: the slice 08 developer and reviewer, whose runs the Orca road rests on. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR 0030](0030-messaging-transport.md).

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
one signal that tells the receiver to look. Orca's own notice is the first
signal; the kit's typed line is a fallback only (the owner, #509). A tab with
something on screen waiting to be answered is not typed into at all, and a
session that is not up is not nudged; the message waits in the mailbox. (The
coordinator, for slice 08, 2026-09-21; the owner was told and may overrule.)
"Not up" means the tab's shell is in front. Where the kit cannot tell whether
the program in front is the session's harness, it types nothing either and
says the mail waits (the architect, #232; the owner may overrule; how a tab
is read is in [ADR 0034](0034-orca-is-the-host.md)).

Which signal goes (the architect's rulings for #509):

- A receiver that is idle is watched for up to 8 s. Orca's notice is known to
  have arrived when the receiver's own record of its turns, the Claude
  transcript or the Codex rollout, holds a turn written after the send that
  names `orchestration check --run <its mailbox>`. Then nothing is typed, and
  the send returns at once. A record that cannot be found or read counts as
  no notice. When no turn starts in the 8 s, the kit types its line, which an
  idle harness takes as a turn at once. When a turn of other work starts, a
  Claude session gets nothing typed and a Codex session gets the line.
- A receiver that is busy: its record is read for Orca's notice for up to
  1.5 s, since the notice can start the turn before the kit looks (seen live on
  Codex, #509); with the notice there, nothing is typed. Otherwise a Claude
  session gets nothing typed, and a Codex session gets the line, which it
  takes as a steer. That read is the most a send to a receiver busy with other
  work waits.
- A Claude session's own `Stop` hook, at each turn end, tells it once about
  each message the kit sent it that Orca still lists as unread, and says
  "still unread" and when it came. It types nothing. It tells as the Stop
  event's additional context, which Claude Code draws as "Stop hook feedback",
  and not as a block, which it draws as "Stop hook error". It says nothing when it
  cannot read Orca or the kit's record, never tells twice about one message,
  and lets the stop go when Claude Code says a stop hook is already active.
  Codex gets this reminder in #511, after #506, since it needs a new Codex hook
  entry.
- The kit keeps a hint of the mail it sent and that is not yet read, sender
  and subject only, in a private folder in the system temp folder. The hook
  reads it, so a session with no mail asks Orca nothing; `obk message check`
  takes out what it read; a retire says how many messages sent to the session
  were not read with `obk message check`, and from whom. The mailbox stays the
  record.
- The send says which signal went. The send says a line was taken only when
  Orca saw it start a turn; otherwise it says the line was typed but not seen
  to start a turn (the architect, #394).

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
  pull-only. Orca's notice is the first signal, and the kit's line stays for
  a receiver the notice does not reach.
- **The kit's line on every receiver beside Orca's notice** (#402).
  Replaced: a Claude receiver got two signals for one message, and a line
  typed into a busy Claude tab waited in its input box and was sent after the
  mail was read, or never, when the tab was closed (#509).
- **The kit's line first, and no Orca notice.** Not possible: nothing turns
  Orca's notice off for a Run, a terminal or a message (1.4.223, #509).
- **Taking any turn start during the watch as Orca's notice.** Not chosen:
  a turn of other work would then leave a Codex session, which has no
  turn-end hook yet, with no signal. The receiver's own record of its turns
  says whether the notice came.
- **Deciding from the clock alone**, such as typing the line after a fixed
  wait. Not chosen: the issue rules it out, and it cannot tell a notice that
  came from one that did not.
- **A Codex `Stop` hook in #509.** Deferred to #511: a new Codex hook entry
  puts every Codex session on "Hooks need review" at its next start, and only
  #506 answers that screen through the kit. The existing Codex `Stop` entry is
  `async`, and Codex drops a stop answer from it.
- **Telling a busy receiver after each tool call** (Codex's `PostToolUse`).
  Not chosen: it is not a turn end, and it reads as an interruption.
- **No line into a busy Codex tab either.** Not chosen: Codex takes the line
  into its running turn at once, nothing stays in its input box, and it is
  what wakes a Codex waiting in its sleep tool, which no hook reaches.
- **Asking Orca whether the notice went.** Not possible: a tab may not read
  another tab's mailbox, so the sender cannot see Orca's `delivered_at`.
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
- Good: one signal for each message in the usual case: Orca's notice, or
  the kit's line where the notice did not come, or the receiver's own hook.
- Bad: a send to an idle receiver whose notice does not come waits the whole
  8 s before the kit types its line. A send whose notice comes returns as soon
  as the record shows it.
- Bad: a line typed into an idle tab can still meet a turn that starts in the
  moment between the kit's last look and its keystroke; it then waits for
  that turn to end.
- Bad: Orca itself presses Enter on a tab that reads working, so its own
  notice can wait in an input box. That is Orca's, and outside the kit.
- Bad: until #511, a Codex session that does not read its mail after its
  signal is not told again.
- Bad: the kit's hint of unread mail lives in the system temp folder and is
  lost when that is cleaned; the hook and a retire then say nothing of that
  mail, which still waits in the mailbox. The hint cannot see a read made with
  Orca's own `check`, so a retire says only what it knows.
- Bad: a typed line is best effort, and a session the kit cannot tell about,
  a harness started through a wrapper among them, gets no nudge until #261;
  its mail waits.
- Good: nobody's approval rule is widened or gone around to deliver a message.
- Revisit if: `codex queue` proves reliable, Orca delivers into a harness by
  itself, Orca's notice can be turned off for a mailbox, Orca lets a sender see
  whether its notice went, or Claude Code's classes change. Confidence: high for the Orca road,
  proven live; low for `codex queue`, which is untested since 2026-09-19.
  (Proposed in #262; not recorded when it was decided.)
- Checked by: `test/message-send.test.js`, `test/message-nudge.test.js`,
  `test/message-nudge-seen.test.js`, `test/harness-in-tab.test.js`,
  `test/message-to.test.js`, and the tests #509 adds for the watch, the hook
  and the retire, with `test/system/messaging.test.js` live.

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
- 2026-10-09, this record: one signal for each fleet mail, Orca's notice
  first and the kit's line a fallback, the owner's decision for #509, with the
  architect's rulings on the watch, the Claude hook, Codex and the retire; the
  record replaces ADR 0030.
