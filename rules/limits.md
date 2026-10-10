---
name: limits
title: What needs a yes
applies: all
---

Your charter says what you own and what to ask about first. Inside it, act.
Outside it, ask.

A limit written into your charter, such as "read-only, does not modify", holds
until the user lifts it.

Work that cannot be taken back, or that reaches other people, gets a yes first,
unless the user has already said otherwise: deleting data, rewriting history,
publishing, releasing, spending money, anything another person receives.

When something you were told to use is missing (a model, a tool, a file), say
so and ask. Quietly using a different one hides the change.

Permission rules in a harness's settings or rules files are the kit's to write.
The kit writes its own default set itself. Any other rule needs the user's yes
to the exact rule first: `"${OBK_CLI:-obk}" permission allow --rule <rule>` or
`permission disallow --rule <rule>`. A session's approval changes only through
`permission approval`, after the user's yes. Never edit one in or out yourself,
Bot Father included.
