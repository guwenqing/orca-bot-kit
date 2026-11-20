# mail-no-open-tab
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-11-19 the owner's words, snapshot origin/2026-11-19-owner-words.md

## Organized requirement

<!-- R1 from:2026-11-19-owner-words.md -->

### R1 A letter to a session with no open tab: the kit says that Orca can delete it, and when

When the receiver of `obk message to` or `obk message send` has no open tab (it is paused, or its tab is gone), the answer MUST say that Orca can delete its mailbox, with the letters in it, 24 hours after the last letter or read, unless the session starts first. It MUST name the command that starts it. The letter still goes, by the same road as before.

`obk health` MUST name each session with no open tab whose mailbox holds unread letters. It MUST say how many letters wait (at least that many) and the earliest time Orca may delete them: 24 hours after the newest letter. It MUST NOT read a subject or a body.

The kit's docs MUST NOT promise that a letter to a session with no open tab waits until the session starts. They MUST say that the letter waits for at least 24 hours after the last letter, on Orca 1.4.262 and later.

The kit MAY give these words on every Orca version, and name Orca 1.4.262 in them, so that it does not have to read the version of Orca.

The kit MUST NOT keep a copy of a letter, write to a mailbox to keep it alive, or open a tab to keep it alive.
Signed off: 2026-11-19 owner, origin/2026-11-19-signoff.md

## Outcome

Concluded 2026-11-20 with al conclude, on the working tree at 9f6aacc.

- R1 A letter to a session with no open tab: the kit says that Orca can delete it, and when, version 1, signed in S1:
  - KIT-56 rule: in docs/prd/prd.md, serves it
  - ADR-62: decides it (accepted)
- Not known: whether the code, tests and documents do what the paragraphs say; whether the work has ended: the tool does not take a merged task or a reconciled spec as evidence of that.
