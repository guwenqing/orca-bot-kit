Source: https://github.com/guwenqing/orca-bot-kit/issues/841
Fetched: 2026-11-19T21:48Z
SHA-256: 16ff4ebbbe8fe9b3f111cd3efea0ba4efc680f4435b93a0f577cc75858a838d9
---
# R1 of #841, as the owner signed it (kit-dev/architect's issue, 2026-11-19)

**R1, the text that the owner signed, word for word:**

> When the receiver of `obk message to` or `obk message send` has no open tab (it is paused, or its tab is gone), the answer MUST say that Orca can delete its mailbox, with the letters in it, 24 hours after the last letter or read, unless the session starts first. It MUST name the command that starts it. The letter still goes, by the same road as before.
>
> `obk health` MUST name each session with no open tab whose mailbox holds unread letters. It MUST say how many letters wait (at least that many) and the earliest time Orca may delete them: 24 hours after the newest letter. It MUST NOT read a subject or a body.
>
> The kit's docs MUST NOT promise that a letter to a session with no open tab waits until the session starts. They MUST say that the letter waits for at least 24 hours after the last letter, on Orca 1.4.262 and later.
>
> The kit MAY give these words on every Orca version, and name Orca 1.4.262 in them, so that it does not have to read the version of Orca.
>
> The kit MUST NOT keep a copy of a letter, write to a mailbox to keep it alive, or open a tab to keep it alive.

**The owner's sign-off:** the owner answered "1" in the kit-dev/architect session on 2026-11-19 at 16:47 EST. The question showed this text and said that the answer "1" signs it. kit-dev/architect records the sign-off when the request is on the branch.
