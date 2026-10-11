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

Mail is queued, not an interruption. When Orca says you have mail, read it
with `"${OBK_CLI:-obk}" message check`, never a bare `orca orchestration
check`: that leaves it unread, and Orca then stops telling you of mail.

Ask for a reply when you need one, and send one when you were asked for one.

A sent message is only queued. Look for the reply or the work before you resend.

Write only to the session that needs it, not to several at once.
