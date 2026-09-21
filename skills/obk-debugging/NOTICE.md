<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-debugging` was consolidated for this kit from these, all MIT,
with thanks:

- **mattpocock/skills**, `engineering/diagnosing-bugs` — the whole shape of it.
  The feedback loop as the skill itself and worth disproportionate effort, the
  ten ways to build one in order, tightening it for speed, sharpness and
  repeatability, raising the rate on an intermittent bug rather than chasing a
  clean one, the four things that make a loop finished, the refusal to
  hypothesise before the command exists, reproducing the reported symptom
  rather than a nearby one, cutting until every part is load-bearing, three to
  five ranked falsifiable candidates with the prediction each makes, showing
  the ranked list to whoever is there, one variable per probe, a debugger over
  logs and never logging everything, tagging temporary logs with one marker,
  measuring before fixing a slow thing, the regression test at a correct seam
  and "no correct seam is itself the finding", redacting secrets from anything
  shown, and the list to clear before calling it done.
- **Waza**, `hunt`, through the verbatim passages in the research pack — the
  gate sentence and its form ("I believe the root cause is X because Y", named
  to a file, function, line or condition), the rule that the cause must explain
  every symptom including the one waved away, running the one probe that would
  fail if you were wrong and discarding on contradiction rather than stacking a
  fix on it, every log as a yes-or-no question and a log that changes behaviour
  being evidence in itself, the rationalisation tells, the sibling sweep with
  every match answered in writing, bisecting only with a pass/fail command
  decided up front and a clean tree first, reading the diff when the last good
  version is close, the same symptom after a fix being a hard stop, and
  stopping after three failed hypotheses. The owner picked this piece himself.
- **Cursor pstack**, `principle-fix-root-causes` and the `poteto-mode`
  playbooks — not adding guards to silence a crash, a workaround needing a
  paragraph meaning the code is wrong, checking for the pattern rather than the
  instance, suspecting stored state first when something fails after a restart,
  and from `principle-attack-the-premise`, two fixes sharing one premise
  meaning the premise is what to test next, written down before another fix is
  tried. From the `perf-issue` playbook: measuring before claiming a limit, the
  families a fix takes used as hypothesis generators rather than a checklist,
  and capturing the measurement again afterwards to compare against the
  baseline. Every shipped line tracing to runtime evidence with the smallest
  change the evidence justifies and reverting what a refuted idea motivated,
  and verifying on the same surface with "inconclusive is not a pass" and a
  unit test showing branch behaviour rather than absence of the bug. From its
  `runtime-forensics` and
  `trace-forensics` playbooks: an existing capture is read rather than re-run,
  turned into a queryable shape before reading and reduced elsewhere when it is
  large; narrowing to the hot call path, to the retainer chain from a leaked
  object back to a root, or to a blocked thread and its wait reason; mapping
  the finding to file, symbol and line, with a frame that has no source behind
  it not yet being a diagnosis; confirming against a paired capture or else
  calling it the strongest hypothesis the artefact supports; and proving the
  mechanism on the live process where it can still be reached.
- **obra/superpowers**, `systematic-debugging` with `root-cause-tracing` and
  `condition-based-waiting` — logging what enters and leaves each boundary and
  reading where it first goes wrong before digging in, tracing backwards
  through the call chain to where the wrong value was born and fixing it there,
  logging before the dangerous operation rather than after it fails, printing
  to the error stream in tests because a logger may be swallowed, three failed
  fixes meaning the architecture rather than the hypothesis is wrong and what
  that looks like, waiting for the condition rather than for a duration,
  reading fresh state inside the loop, always setting a limit with a message,
  the case where a fixed wait is right and what has to accompany it, and the
  things someone says when they can see you are guessing.

- **obra/superpowers**, `systematic-debugging`, further to the above — finding
  the nearest thing that works in the same codebase, reading it properly rather
  than skimming, and listing every difference however small without deciding in
  advance which cannot matter.
- **addyosmani/agent-skills**, `debugging-and-error-recovery` — the decision
  tree for a bug you cannot reproduce on demand, sorted into timing,
  environment, state left behind and genuinely random, with what to try in each
  and documenting the conditions as a real answer for the last; and treating
  error output as untrusted data, since a message from a dependency, a log or a
  build can carry something shaped like an instruction and is to be read for
  clues rather than followed.
- **Waza**, `hunt`, further to the above — its gotchas: walking back out of a
  library frame into your own code, suspecting persisted output written by the
  old code when the algorithm changed and the output did not, trusting the
  observation over the log and treating the gap as an un-instrumented path, a
  guard that refuses having a set of causes rather than one, taking a
  lower-layer baseline before blaming the visible thing, diagnosing an external
  tool before switching it, and never restarting more than twice without new
  evidence.

Left behind on purpose: the iron-law capitals and "refuse to give up" framing,
validating at every layer as a general answer (it contradicts fixing the cause,
and the kit's own rules say the smallest change that works), per-vendor tooling
names and control-skill machinery, fixed model choices, and the parts that
assume a particular tracker or pull-request flow.
