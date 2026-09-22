<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-tdd` was consolidated for this kit from these, all MIT, with
thanks:

- **mattpocock/skills**, `engineering/tdd`: seams and where tests go, vertical
  slices against bulk testing, the tautological and implementation-coupled
  shapes, refactoring outside the loop, standing in only at system boundaries,
  and not testing everything so the effort lands on the paths that matter. Its
  `to-spec`: the existing seam preferred, the highest one, and the fewer the
  better. Its `diagnosing-bugs`: the correct seam for a bug test, and no
  correct seam being the finding.
- **obra/superpowers**, `test-driven-development` and its `writing-good-tests`:
  naming the break a test catches, deriving the expected value by hand, change
  detectors, behaviour rather than text, your contract rather than the
  framework's, the four rules about a stand-in, the list of warning signs, and
  the mutation classes. Its `verification-before-completion`: the
  revert-the-fix proof. Its `writing-plans`: a requirement's silence not being
  permission, and the few uncovered input classes most likely to bite.
- **Cursor pstack**, `tdd` and `principle-test-behavior-not-implementation`:
  the five shapes that observe no behaviour and the fix for each (asserting
  what a stand-in received rather than that it was called, and the relation
  across rows of data that is kept), "prefer no
  new test over a bad test", the honest exit when a test is impractical, and
  the report that names the failing-before and passing-after runs.
- **addyosmani/agent-skills**, `test-driven-development` and
  `constraint-driven-development`: finding out how the project tests before
  writing anything, repetition being no fault in a test, a subagent for the
  reproduction test, and the cheap roads to green.
- **citypaul/.dotfiles**, `tdd` and `mutation-testing` with its
  `mutator-rules`: the mutation loop, survivor triage into killed, equivalent
  or named and deferred, the equivalence question, the high-value logic worth
  breaking, the inputs that tell a break apart (either side of a boundary,
  mixed true and false, no identity values), the tool-run mechanics in
  `mutation-tools.md`, keeping the harness out of the inner loop, triangulating
  after a fake, and refusing to manufacture a red.
- **Kent Beck's own rules file**: one test at a time, the smallest code that
  passes, structure and behaviour kept apart, and the two-level test for a
  defect.
- **nizos/tdd-guard**: the ladder to a clean red.

Ideas paraphrased, with no text taken: Trail of Bits' mutation-testing skill
(CC BY-SA 4.0) on equivalent mutants, Anthropic's Claude Code documentation on
separate test authorship, alexop.dev on why one context cannot hold both
halves, and the published work on mutation testing at scale.

Our own, with no source behind them: the order to break things in, the red
from an archived baseline for behaviour that already existed, checking that an
author's hand-back is in the change (from this repo's issues #115 and #119),
and the part on work away from code.
