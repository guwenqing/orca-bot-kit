<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-handoff` was consolidated for this kit from these, both MIT,
with thanks:

- **mattpocock/skills**, `productivity/handoff` — writing the note so a fresh
  agent can continue the work, putting it somewhere other than the workspace,
  not duplicating what other artefacts already hold and pointing at them by
  path instead, redacting anything sensitive, tailoring it to what the next
  session is for, and naming the techniques the next session should reach for.
- **Cursor pstack**, the `poteto-mode` `pause-safely` playbook — stopping at a
  safe boundary by finishing or backing out of the current step and never
  stopping mid-edit in a known-broken state, starting nothing new and stopping
  anything nested that is running, taking no irreversible action in order to
  pause, making the work durable as one clearly marked work-in-progress commit
  with a line in the message when the tree is broken, writing the note away
  from the working tree, the fields it carries, and the closing reply that says
  where you are, what is on disk against what is still only in the
  conversation, the commits and whether the tree is clean, and the first action
  on resume — "this is a pause, not a final report". Also its rule that a pause
  is explicit: on "keep going", do not pause.

Two additions are not from either source, both from an acceptance run of this
skill: commit your own work and only your own, since the durable-work
instruction otherwise reads as licence to sweep another session's uncommitted
edits into a handover commit; and a command from the project's own
instructions that does not work from where you are, with whatever you used
instead, belongs in what will bite them.

PRD 6.5 decides the part neither source covers: clearing a session triggers no
handoff. This skill runs when it is asked for.
