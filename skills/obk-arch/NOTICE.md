<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-arch` was consolidated for this kit from these, all MIT, with
thanks:

- **Cursor pstack**, `architect` with its `runner-prompt`, `design-red-flags`
  and `rationale-template` references. Writing the caller's usage and two or
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
  anything a later reader might take for an oversight; and the scrap tells (the
  repeated workaround, unrelated edge cases each needing a branch, escape
  hatches in the types, the lock reflex where nothing was meant to be shared,
  callers needing the internal rules), with deviations treated as signal and a
  few edge cases not condemning a design.
- **Cursor pstack**, `architect`'s `runner-prompt` further to the above.
  Grounding the design in what the code actually touches before sketching, and
  what a sketch is (types and signatures with unimplemented bodies, a reader
  able to trace input to output from the signatures alone); encoding invariants
  in types ahead of runtime checks ahead of comments; validating at boundaries
  and trusting types inside; one source of truth per invariant, derived rather
  than kept in step; and asking what happens if an operation runs twice or
  crashes halfway.
- **Cursor pstack**, `figure-it-out` further to the above. Capturing the
  baseline before the change so the check reads as the old value against the
  new; verdicts of verified, not verified or inconclusive with inconclusive not
  being a pass; inspecting the artefact rather than a report of it; and
  suspecting the observation method when something passes too easily.
- **Cursor pstack**, `blast-radius` further to the above. Looking where a
  symbol search stops: the library's own source and its pinned version, when
  things run, the shape of what an interface returns, a column, a wire format,
  another language reading the same bytes, a feature flag, code three hops
  downstream; giving each risk a real likelihood and a real cost; and listing
  separately what was checked and cleared, since a search that finds nothing is
  still a result.
- **Cursor pstack**, `create-verification-skill`. The whole of making a thing
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
  something never executed is a draft rather than a deliverable. Also fixing a
  checkout that does not build or start before writing the recipe against it,
  preferring stable handles over positions and coordinates, and the feature map
  (a short list of what the thing does for someone, one entry per feature),
  which that skill's own users praised most because an agent stops searching
  the codebase for where things are. Kept here in that reduced form rather than
  as its own generated directory.
- **Cursor pstack**, `principle-sequence-verifiable-units`, `figure-it-out`,
  `blast-radius`, `principle-foundational-thinking`, `principle-model-the-domain`,
  `principle-exhaust-the-design-space` and the `poteto-mode` planning playbooks.
  Ordering work as small units each ending in a state you can check and not
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
  blast-radius ladder (said so, pointed at the line, showed the bad case
  cannot happen, ran it, reproduced it) with "listing the callers is not the
  job" and anything short of running it said rather than written up as settled.
- **mattpocock/skills**, `codebase-design` with `DEEPENING` and
  `DESIGN-IT-TWICE`, `domain-modeling` with its `ADR-FORMAT`, `prototype` and
  `to-tickets`. The three questions to put to an interface (fewer ways in,
  simpler arguments, more hidden behind it); internal seams private to a
  module's own workings as distinct from the external one at its interface;
  the three conditions that must all hold before a decision is worth recording
  (hard to reverse, surprising without the context, and the result of a real
  trade-off) with what each one rules out; from `domain-modeling`, sharpening
  a term that is doing too much work, forcing a boundary open with a concrete
  scenario, and checking a claim about the domain against the code; from
  `prototype`, being trivial to start, keeping nothing between runs, showing
  the state after every action, and keeping only the decision it produced; and
  the vocabulary used precisely (module, interface as everything a caller must
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
review on any change crossing a function boundary. This skill is reached for
when there is a shape to get wrong, not on every change.
