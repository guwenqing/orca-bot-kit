# ADR 0033: A temporary session makes one of its own, one level deep

Date: 2026-10-03.
Status: accepted.
Decided by: the owner, "A one-time developer session starts its own one-time reviewer session, and that reviewer is retired once it is not needed" (relayed by Bot Father, 2026-10-03, on #464), for one level, one open at a time, and the retire that takes them along. The builder, for the details marked so; the owner may overrule them.

## Context

A long-lived session makes temporary sessions of its own bot with
`obk temp make` and retires them with `obk temp retire` (PRD 6.4, #227,
#250). Until now a temporary session made none: `temp make` run in its tab
was refused. That sentence of PRD 6.4 was the builder's reading, not the
owner's.

The owner's way of working for a bot that builds software is one long-lived
architect that makes a one-time developer per issue; the developer has its
work reviewed by a one-time reviewer, on another harness. With the refusal,
the architect had to make every reviewer and retire it, a step that is only
mechanical.

## Decision

We will let a temporary session make a temporary session of its own bot, from
its own tab, with the same command, under two limits:

- One level only. A session made by a temporary session makes none, and
  `temp make` in its tab is refused with the reason.
- A temporary maker has at most one open temporary session at a time. A
  second is refused until the first is retired. A long-lived maker keeps no
  such limit here; a per-bot cap is #465.

The made session inherits from its maker as from any maker: on another harness
it takes only the approval (#238). Its maker answers its first-run screens and
may use `obk temp trust-hooks` for it.

Retiring a session retires, first, the temporary sessions it made, and theirs,
whichever road retires it: `obk temp retire` or `obk retire --session`. Each
one goes as it would on its own: tab closed, off `bot.yaml`, its book entry
moved to the retired list with its maker, its start-prompt file removed. The
answer names each one that went along (`retiredWith` in `--json`). (The
builder: the name of that field, and that a long-lived session's retire takes
its temporary sessions along too, which the owner's "nothing is left behind"
implies.)

Who may retire what is otherwise unchanged: a maker retires only what it made,
and `obk retire` still retires any session. Retiring a whole bot already takes
every session with it.

## Alternatives considered

- **The architect makes every reviewer** (how it was done). Not chosen: the
  owner wants the architect out of a mechanical step.
- **Any depth.** Not chosen: the owner asked for one level, and a chain of
  makers is harder to see and to clear up.
- **No limit on a temporary maker's open sessions.** Not chosen: the owner's
  title says "one", and with the architect's own limit on developers it gives
  his "at most 2 developers and 2 reviewers".
- **Leave a maker's temporary sessions when the maker is retired**, for
  grooming to find as left behind (#252). Not chosen: the owner wants nothing
  left behind.

## Consequences

- Good: a developer starts and retires its own reviewer; the architect only
  makes developers.
- Good: retiring a maker cannot leave its temporary sessions running without
  anyone who may retire them.
- Bad: a retire can close more tabs than the one it names. Accepted: the
  answer names each, and they are temporary by definition.
- Revisit if: the owner wants deeper nesting, or a cap per role (#465).
  Confidence: high for the shape, which is the owner's.
- Checked by: `test/` cases for `temp make` from a temporary session, the
  one-open and one-level refusals, inheritance across harnesses,
  `temp trust-hooks`, and the retire by both roads; and a live run in a
  throwaway bots folder in which a Claude temporary session makes a Codex one,
  answers its screens, and both are retired.

## History

- 2026-09-24, PRD 6.4 (#250): "A temporary session does not make one of its
  own", the builder's reading. Replaced by this record.
