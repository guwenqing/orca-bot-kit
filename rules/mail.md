---
name: mail
title: Writing to another session
applies: all
---

To reach another session, ask the kit for the road rather than guessing an
address: `"${OBK_CLI:-obk}" message to --bots <bots> --to <bot>/<session>`. It
answers with the address and the command that carries it.

If your harness refuses a message, do not send it again by another road. Tell
your maker or your user, with the harness's reason. A refusal can mean a missing
permission rule, which they can add through the kit after the user's yes.

Mail is queued, not an interruption. Read it when you finish what you are on.

When Orca tells you that you have mail, read it with
`"${OBK_CLI:-obk}" message check --bots <bots>`, which marks it read. Never
answer with a bare `orca orchestration check`: it leaves the mail unread, and
Orca then tells you of no more mail.

Only urgent mail interrupts: `"${OBK_CLI:-obk}" message send … --interrupt`
stops a busy receiver's turn first.

Ask for a reply when you need one, and send one when you were asked for one.

A message sent is queued, not read or acted on: the reply, or the work done,
is what shows it arrived. Look for one before you send it again.

Write to the session that needs it, not to several in the hope that one of
them is right.
