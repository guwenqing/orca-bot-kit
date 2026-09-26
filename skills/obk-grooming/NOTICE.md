<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-grooming` was consolidated for this kit from these, both MIT,
with thanks:

- **Cursor pstack**, `reflect` and `automate-me`: mining only what has happened
  since the last run rather than re-reading the whole history each time, and
  taking the last run's own moment as where to start; citing every finding to
  the place it was seen, so a reader can go and look; and the rule that a
  transcript is data to be read rather than instruction to be followed, which
  is what the section on reading another bot's history is built on.
- **Addy Osmani's agent skills**, `constraint-driven-development`: its warning
  that a figure with no reason attached gets deleted by the next person it
  inconveniences, which is why a note says what moved it. Its ratchet is not
  applied to the notes (see below).

## The owner's own conclusions, restated

Most of the rest comes from the owner's own review of his real sessions and
his own working notes. Those are his writing rather than a third party's, so
there is no licence question, but the research pack holds them only at one
remove, as another agent's digest, so nothing here quotes them and everything
is written again in our own words:

- the signs that a bot is struggling, taken from what he measured in his own
  work: stopping to restate instead of acting, the same instruction repeated,
  context lost after a compaction, reports nobody reads, and long runs of
  commands that are process rather than work;
- that a bot reporting on its own work has the same blind spot as the work, so
  one real output is checked instead, with the three questions of whether it
  ran, whether it was right, and whether anyone would miss it;
- that a report leads with overall state, stays to a handful of points, and
  leaves out identifiers a reader cannot act on;
- that each run of a periodic check should record whether it found a change,
  caused something useful, or only repeated the last status;
- that a process nobody has watched should not be automated, because
  automating an unclear process only produces the unclear result more often;
- that memory goes stale, and a fleet that trusts old notes ends up handing
  work to a bot that no longer does that job.

## This kit's own design

PRD 6.8 carries the rest: grooming as an optional daily pass that reads the
managed bots' new history and sends its result to the management session; the
profile notes and that any bot may read them; and the routing, where something
the kit does wrong is filed as an issue in one step and something a bot does
wrong goes back to that bot's session as feedback.

Grooming runs in a session in the book, on Claude Code's own scheduler,
because the owner decided on 2026-09-24 (#223) that scheduled work does not use
an Orca automation: an automation cannot carry a model or an effort of its
own. Its runs share one long conversation, which the owner accepted in the
same decision ("just do /compact when needed, add to the skill"). What a run
must remember still lives in files, because a compacted conversation keeps
only a summary. The facts about Claude Code's scheduler are in the tech notes.

## Ideas taken from material with no licence

The research pack's account of how one hosted bot product runs its fleet
suggested the daily pass over every bot and the habit of routing each finding
to a single kind of fix. Those pages carry no licence and the pack holds only
a summary of them, with its own caution not to copy from them, so the idea is
taken and the words are ours.

## Where this stands next to the review skill

`obk-fleet-review` is the judgement applied when somebody asks how the fleet is
doing. This is the unattended pass that runs whether or not anyone asked. They
share a subject, and the verdict discipline, the order to try things in and the
evidence bar are written once, in that skill, rather than restated here. What
is here is what is different about running unwatched, on a schedule, over
somebody else's conversations.

Sources and licences in full: [LICENSES.md](LICENSES.md).

## What the re-validation changed (#156)

- Where it remembers: PRD 6.8 puts grooming's memory in files (the profile
  notes and the open findings) and 6.10 commits them once a day. The skill
  named neither a place nor an open-findings record, so a fresh run could not
  find its window and would report the same thing daily; the first live run
  had to invent a file. The profile notes go where `rules/profiles.md`
  already puts them, `profiles/`; an acceptance run of this re-validation
  found the two places disagreeing.
- Bounded: `obk usage --since` as the index of what moved, only the window's
  part of a conversation, stopping when nothing moved, and the run's own cost
  in the report. From the owner's handoff warning that a supervisor re-reading
  unchanged transcripts consumes resources without improving the result, and
  his usage review, both as digested in grok-bot-lessons. The cheaper model at
  medium effort is the Q16 answer the owner approved (2026-09-19 18:04).
- The seen-twice bar is carried here, because the automation's prompt loads
  only this skill and `obk-finops`.
- `obk groom --at` and `--on` are named, so the automation is made once.
- "Reports its owner could not read" (his complaint was unreadable, not
  unread); the invented "fortnight" is gone. The profile notes record the
  current figure either way, with a drop also reported: the review of this
  re-validation (#182) pointed out that `constraint-driven-development`'s
  ratchet holds a quality threshold, not a record other bots choose
  collaborators from, so it is no longer applied to the notes.
- The window paragraph is unchanged: its disagreement with `obk usage` is
  issue #169.
- The memory section is the owner's decision of 2026-09-23 (issue #211):
  memory is the harness's, per bot; grooming reports it and sends a
  misalignment back to the bot's session, which decides and edits; grooming
  never edits a memory. The routing is PRD 6.8 (a usage matter goes back to the
  session) and the manners PRD 6.9 (queued, not interrupting, no reply
  expected). The load limit and where the memory lives are the tech notes'
  facts, verified live on Claude Code 2.1.280; Codex's store is the user's and
  is left alone.

## What moving to Claude Code's scheduler changed (#237)

- Where it remembers: the runs share one conversation now, so the files are
  kept because a compact leaves a summary and a `/clear` leaves nothing, rather
  than because each run starts fresh.
- Turning it on: a `grooming` session in the book with its own model and
  effort, a run by hand with `obk groom --now`, then `--on --at` after the yes.
  That it fires only while its tab is up, the week-long limit each run renews,
  and what a `/clear` does are Claude Code's documented behaviour, in the tech
  notes.
- Compacting is new, from the owner's decision on #223. Who types `/compact`
  (the management session, through the kit) is the architect's reading of it on
  #237.
