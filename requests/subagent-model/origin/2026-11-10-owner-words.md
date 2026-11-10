Source: owner-words.md
Fetched: 2026-11-10T03:14Z
SHA-256: 27c596d1ff99415f28c28c1b798e68b947fe0b15038aaad5e19d5291af74c9ef
---
The owner's words for #727 (https://github.com/guwenqing/orca-bot-kit/issues/727), quoted as the architect's triage states them (https://github.com/guwenqing/orca-bot-kit/issues/727#issuecomment-6757886074). The architect confirms that they are the owner's own, from the owner's answer on 2026-11-09.

"I want the subagent to be a bit smarter than a fixed value. So we can have a flex in choose"

The issue's own words hold too: "Leave the choice of model to the user. The kit gives only the setting."

What the architect told the owner the setting does. The owner's yes covers these four points:

1. A user names one model for a session, or for a `temp_roles` option. It is the model for routine subagent work.
2. The session chooses the model of each subagent by its task. Routine work (search, read, summarize) uses the named model. Tests, reviews and design use the session's own model.
3. A subagent that the session gives no model runs on the session's own model. No work becomes weaker by accident.
4. `obk health` shows the setting beside model and effort.
