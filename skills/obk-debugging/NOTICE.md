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
  paragraph meaning the code is wrong, asking why until it explains itself,
  checking for the pattern rather than the instance, instrumenting instead of
  guessing when stuck, suspecting stored state first when something fails after
  a restart, every shipped line tracing to runtime evidence with the smallest
  change the evidence justifies and reverting what a refuted idea motivated,
  verifying on the same surface with "inconclusive is not a pass" and a unit
  test showing branch behaviour rather than absence of the bug, and the
  families a performance fix usually takes, used as hypothesis generators only
  where the measurement shows what they need.
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

Left behind on purpose: the iron-law capitals and "refuse to give up" framing,
validating at every layer as a general answer (it contradicts fixing the cause,
and the kit's own rules say the smallest change that works), per-vendor tooling
names and control-skill machinery, fixed model choices, and the parts that
assume a particular tracker or pull-request flow.
