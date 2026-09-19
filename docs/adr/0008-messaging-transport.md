# ADR 0008: Native messaging Claude to Claude; the Orca mailbox for everything else

Date: 2026-09-19. Status: the Decision is the owner's unless a sentence is marked (proposed).

## Context

Sessions and bots must talk, by default in a "good enough" way that does not disturb normal work. The owner asked for native messaging within one harness when it is supported and Orca across harnesses. Research found: Claude Code has documented cross-session messaging addressed by session name; a busy receiver reads between tool calls and an idle one wakes. Codex's `codex queue` has no official docs, seems to need a shared daemon, and left a message undelivered for a week on this machine.

## Decision

Claude to Claude in the same approval class uses native messaging; sessions are launched with a stable name that is also their address (proposed). Codex to Codex, cross-harness and mixed-approval pairs use the Orca orchestration mailbox. The bot never picks the transport: it looks the target up and the skill tells it which to use (proposed). Messages are queued and non-interrupting by default, avoid over-broadcasting, expect a reply only when asked, and interrupt only with caution.

## Consequences

- Two transports to keep working. Retest `codex queue` during the build and switch if it proves reliable.
- Grooming reads both the Orca mailbox and the Claude transcripts to see traffic.
- Unattended bots need incoming native messages accepted without a prompt; that setting is security-relevant and awaits the owner's confirmation.
