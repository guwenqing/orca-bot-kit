# ADR 0008: Native messaging Claude to Claude; the Orca mailbox for everything else

Date: 2026-09-19. Status: superseded by [ADR 0018](0018-messaging-transport.md). Until then, the Decision was the owner's unless a sentence is marked (proposed).

## Context

Sessions and bots must talk, by default in a "good enough" way that does not disturb normal work. The owner asked for native messaging within one harness when it is supported and Orca across harnesses. Research found: Claude Code has documented cross-session messaging addressed by session name; a busy receiver reads between tool calls and an idle one wakes. Codex's `codex queue` has no official docs, seems to need a shared daemon, and left a message undelivered for a week on this machine.

## Decision

Claude to Claude in the same approval class uses native messaging; sessions are launched with a stable name that is also their address (proposed). Codex to Codex, cross-harness and mixed-approval pairs use the Orca orchestration mailbox. The bot never picks the transport: it looks the target up and the skill tells it which to use (proposed). Messages are queued and non-interrupting by default, avoid over-broadcasting, expect a reply only when asked, and interrupt only with caution.

## Consequences

- Two transports to keep working. Retest `codex queue` during the build and switch if it proves reliable.
- Grooming reads both the Orca mailbox and the Claude transcripts to see traffic.
- The kit sets no message-acceptance override. Two `auto` sessions are in the same class, so Claude Code delivers between them without asking. Mixed pairs use the Orca mailbox, chosen in advance. A message the receiver's approval rule has held or refused is not re-sent by another route.

## Amendment, 2026-09-21 (coordinator's decision for slice 08; the owner was told and may overrule)

The Orca mailbox is pull-only: a message addressed to a session never reaches
the harness in its tab. So a send is two things: the message queued in the
receiver's mailbox, and one line typed into its tab telling it to look. Both
harnesses queue a typed line while busy, which is what "queued, not
interrupting" means here. A tab with something on screen waiting to be answered
is not typed into at all, and a session that is not up is not nudged; the
message waits in the mailbox.

A session's address on the Orca road is a Run (`run:<id>`), made once when the
session is first brought up and kept in the book. A terminal handle is not an
address: Orca calls it a live terminal-only mailbox, warns that delivery does
not outlive the tab, and refuses a send once the pane is gone. Runs cannot be
deleted, Orca offers no way, so a retired session leaves an inert Run behind,
which is the price of an address that survives a closed tab.

A reply is an ordinary send back to the sender's `run:<id>` with a thread id.
Orca's own `reply` files the reply under the replier's Run, where the
recipient's check does not look, so the kit does not use it.

Codex bots reach the mailbox only with the sandbox switch in ADR 0005's
amendment. The two sentences marked (proposed) in the Decision above, the
stable launch name as the address and the kit choosing the transport, were
confirmed for slice 08 by the coordinator on the same terms.
