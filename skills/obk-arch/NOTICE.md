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
  in exchange for Y" with at least one alternative and why it lost, or "the
  only viable shape, because..." where the constraints forced it (from its
  `rationale-template`); keeping candidates genuinely apart rather than
  converging on a safe middle (from `runner-prompt`); naming
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
  another language reading the same bytes, a feature flag; giving each risk a
  real likelihood and a real cost; and listing separately what was checked and
  cleared, since a search that finds nothing is still a result.
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
  something never executed is a draft rather than a deliverable. Also fixing,
  or saying precisely what stopped, a checkout that does not build or start
  before writing the recipe against it,
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
  predicate stated before the run and never relaxed to declare victory (the
  last from the `autonomous-run` playbook);
  sequencing the riskiest unknown first; every box naming the evidence that
  checks it, ticked only when that evidence exists; skipping the plan when the
  change is one or two files with an obvious approach; settling an open
  question by prototype before writing; data structures first with types and
  data converging; a structure that carries the domain (a state machine, a
  lookup table, a typed object) making invalid states impossible and deleting
  branches, and the other side, not forcing an abstraction that removes no
  branch, no duplicated rule and no invalid state, with the tell that the
  modelling was skipped; the cases where exploring the design space is not worth it; and the
  blast-radius ladder (said so, pointed at the line, showed the bad case
  cannot happen, ran it, reproduced it) with "listing the callers is not the
  job", the one fact a change is safe because of, and anything short of
  running it said rather than written up as settled.
- **mattpocock/skills**, `codebase-design` with `DEEPENING` and
  `DESIGN-IT-TWICE`, `domain-modeling` with its `ADR-FORMAT`, `prototype` and
  `to-tickets`. The three questions to put to an interface (fewer ways in,
  simpler arguments, more hidden behind it) and the interface as everything a
  caller must know; the three conditions that must all hold before a decision
  earns a lasting record of its own
  (hard to reverse, surprising without the context, and the result of a real
  trade-off) with what each one rules out; from `domain-modeling`, sharpening
  a term that is doing too much work, forcing a boundary open with a concrete
  scenario, and checking a claim about the domain against the code; from
  `prototype`, being trivial to start, keeping nothing between runs, showing
  the state after every action, and keeping only the decision it produced;
  from `DESIGN-IT-TWICE`, combining the best of the candidates; the deletion
  test,
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
- **mattpocock/skills**, `triage` with its `AGENT-BRIEF`, and `to-tickets`
  further to the above. Handing work over behavioural rather than procedural,
  what the system should do and not how, the builder exploring fresh and
  making their own decisions; durable rather than precise, naming types,
  contracts and behaviours and never file paths or line numbers, because the
  code moves while the work waits; acceptance criteria that can each be
  checked on their own; saying what is out of scope so the builder does not
  gold-plate; the one exception of a prototype's snippet that encodes a
  decision more precisely than prose (from `to-tickets`); and, before handing
  a report on, verifying the claim (reproducing it from the reporter's steps
  and saying whether it was confirmed, failed or lacked detail, a confirmed one
  making a much stronger brief), searching for it by the concept rather than
  the reporter's wording to see whether it already exists, checking whether
  it was turned down before, asking the reporter specific questions rather
  than for more information, and noting when a piece needs a person's
  judgement rather than being delegated.

Left behind on purpose: the multi-model arena and its runners, fixed model
choices, the phase todolist and its ceremony, tracker and pull-request
machinery, the generated report formats, and the trigger that fires a design
review on any change crossing a function boundary; from `triage`, the labels,
the state machine, the brief template, the out-of-scope folder, the grilling
step and the AI disclaimer. This skill is reached for when there is a shape
to get wrong, not on every change.

What the owner said, and how it shaped this: he asked for a very light part on
what is wanted and on dividing the work, leaving the details and the tracking
to the user (research-pack dialogue, 2026-09-19 19:09). The five items of the
note are the proposal he was given then; three further items that had been
added since, with no source behind them, are gone. He wanted the design to
include a clear effort on the big test step so the app is runnable and
testable (2026-09-19 18:54, and 2026-09-20 02:21), which is why that part stays in full. He agreed
that the source's strict vocabulary be dropped for plain words (18:50), so the
list of defined terms is gone and the ideas stay. He did not want a
blast-radius skill of its own (18:08), so what is kept of it is a short part.
A small reshaping being part of the change follows PRD 7.3. He asked that work
be handed over by intention, without micro-management or baby steps, with
only brief research: enough to validate an issue, above all one reported from
outside, and to triage it (issue #263, 2026-09-24). That is the part on
handing a piece over, and why its research stops there.
