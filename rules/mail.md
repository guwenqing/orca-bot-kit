---
name: mail
title: Writing to another session
applies: all
---

To reach another session, ask the kit for the road rather than guessing an
address: `"${OBK_CLI:-obk}" message to --bots <bots> --to <bot>/<session>`.

If your harness refuses a message, do not send it again by another road. Tell your maker or your
user, with the harness's reason. A refusal can mean a missing permission rule. Send the refusal to
whoever adds your rules: your maker, your user or your fleet's manager.

Mail is queued, not an interruption. When Orca says you have mail, read it
with `"${OBK_CLI:-obk}" message check --bots <bots>`, never a bare `orca
orchestration check`: that leaves it unread, and Orca stops telling you of mail.

Your harness may deliver some messages by itself, or list the sessions it can see. That
does not replace the kit's commands: still ask the kit for the road, and still read your mail.

Ask for a reply when you need one, and send one when you were asked for one.

A sent message is only queued. Look for the reply or the work before you resend.
A notice that a reply came, or that your own background work ended, can be lost. When
you wait on one, also set one long fallback check, and look when it comes.

Write only to the session that needs it, not to several at once.
