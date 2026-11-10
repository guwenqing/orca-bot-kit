# subagent-model
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-11-10 the owner's words, snapshot origin/2026-11-10-owner-words.md

## Organized requirement

<!-- R1 from:2026-11-10-owner-words.md -->

### R1 A model for a session's routine subagent work

A user MAY name one model for a session, or for an option of a `temp_roles` role, as the model for the session's routine subagent work. The kit MUST give that setting to the session, so that the session chooses the model of each subagent by its task: routine work, such as a search, reading files or a summary, runs on the named model, and tests, reviews and design run on the session's own model. A subagent that the session gives no model MUST run on the session's own model, so that no work becomes weaker by accident. `obk health` MUST show the setting beside the session's model and effort.
