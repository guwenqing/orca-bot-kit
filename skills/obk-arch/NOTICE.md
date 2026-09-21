<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-arch` was consolidated for this kit from these, all MIT, with
thanks:

- **Cursor pstack**, `architect` with its `runner-prompt`, `design-red-flags`
  and `rationale-template` references — writing the caller's usage and two or
  three real call sites before the types, with the usage as the specification
  and the sketch reconciled to it; data structures first with every dominant
  access pattern traced through the proposed shape, and "we'll add an index
  later" meaning the shape is wrong now; designing it twice with at least two
  structurally distinct whole-shape candidates before synthesis; comparing on
  interface depth; the red flags (callers coordinating several methods for one
  operation, options exposing internal stages, learning the interface not
  saving you from learning the implementation, information leakage, temporal
  decomposition, pass-through methods); the rationale in the form "we accept X
  in exchange for Y" with at least one alternative and why it lost, naming
  anything a later reader might take for an oversight; and the scrap tells —
  the repeated workaround, unrelated edge cases each needing a branch, escape
  hatches in the types, the lock reflex where nothing was meant to be shared,
  callers needing the internal rules — with deviations treated as signal and a
  few edge cases not condemning a design.
- **Cursor pstack**, `create-verification-skill` — the whole of making a thing
  runnable and drivable, which the owner asked to live inside this skill rather
  than have one of its own: interviewing the repository rather than the user
  about surface, how it starts and how you know it is ready, how to drive it
  without a person, what evidence can be captured, and whether two can run side
  by side; the read-only check that says whether an instance is worth driving;
  the proof standards (the real user path rather than an internal setter or a
  test-only endpoint, the action and the resulting state rather than the final
  screen, side effects verified alongside what is visible, stand-ins only where
  a production boundary already isolates the thing); finding out what a dry run
  actually skips by observing rather than trusting its name; cleanup that
  removes what the run started and never the evidence, killing what you started
  rather than by name; and running the instructions once end to end, because
  something never executed is a draft rather than a deliverable.
- **Cursor pstack**, `principle-sequence-verifiable-units`, `figure-it-out`,
  `blast-radius`, `principle-foundational-thinking`, `principle-model-the-domain`,
  `principle-exhaust-the-design-space` and the `poteto-mode` planning playbooks
  — ordering work as small units each ending in a state you can check and not
  advancing until it is green, with the reason (a break caught at the unit that
  caused it is cheap, one caught after a batch is buried); done as a falsifiable
  predicate stated before the run and never relaxed to declare victory;
  sequencing the riskiest unknown first; every box naming the evidence that
  checks it, ticked only when that evidence exists; skipping the plan when the
  change is one or two files with an obvious approach; settling an open
  question by prototype before writing; data structures first with types and
  data converging; not forcing an abstraction that removes no branch, no
  duplicated rule and no invalid state, and the tell that the modelling was
  skipped; the cases where exploring the design space is not worth it; and the
  blast-radius ladder — said so, pointed at the line, showed the bad case
  cannot happen, ran it, reproduced it — with "listing the callers is not the
  job" and anything short of running it said rather than written up as settled.
- **mattpocock/skills**, `codebase-design` with `DEEPENING` and
  `DESIGN-IT-TWICE`, `domain-modeling`, `prototype` and `to-tickets` — the
  vocabulary used precisely (module, interface as everything a caller must
  know, implementation, seam, adapter, depth as leverage); the deletion test,
  the interface being the test surface, and one adapter meaning a hypothetical
  seam against two meaning a real one; designing for testability by accepting
  dependencies rather than creating them, returning results rather than causing
  effects, and keeping the surface small; the four constraints that make
  candidates genuinely different; how the dependency decides the way you test
  across a seam, and "replace, don't layer" with the old shallow tests deleted
  once tests exist at the deeper interface; vertical slices that cut a narrow
  but complete path through every layer, each demoable on its own and sized to
  one fresh context, with prefactoring first; expand, migrate and contract as
  the exception for a change that has to happen everywhere; and a prototype
  being throwaway code that answers a question, with the polish skipped on
  purpose.

Left behind on purpose: the multi-model arena and its runners, fixed model
choices, the phase todolist and its ceremony, tracker and pull-request
machinery, the generated report formats, and the trigger that fires a design
review on any change crossing a function boundary — this skill is reached for
when there is a shape to get wrong, not on every change.
