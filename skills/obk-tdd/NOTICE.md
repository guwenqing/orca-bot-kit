<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-tdd` was consolidated for this kit from these, all MIT, with
thanks:

- **mattpocock/skills**, `engineering/tdd`: seams and where tests go, vertical
  slices against bulk testing, the tautological and implementation-coupled
  shapes, refactoring outside the loop, standing in only at system boundaries.
- **obra/superpowers**, `test-driven-development` and its `writing-good-tests`:
  naming the break a test catches, deriving the expected value by hand, change
  detectors, behaviour rather than text, your contract rather than the
  framework's, the four rules about a stand-in, the revert-the-fix proof, the
  list of warning signs, and the mutation classes.
- **Cursor pstack**, `tdd` and `principle-test-behavior-not-implementation`:
  the five shapes that observe no behaviour and the fix for each, "prefer no
  new test over a bad test", the honest exit when a test is impractical, and
  the report that names the failing-before and passing-after runs.
- **addyosmani/agent-skills**, `test-driven-development` and
  `constraint-driven-development`: finding out how the project tests before
  writing anything, repetition being no fault in a test, a subagent for the
  reproduction test, and the cheap roads to green.
- **citypaul/.dotfiles**, `tdd` and `mutation-testing`: the mutation loop and
  the order to break things in, survivor triage into killed, equivalent or
  named and deferred, the equivalence question, keeping the harness out of the
  inner loop, triangulating after a fake, and refusing to manufacture a red.
- **Kent Beck's own rules file**: one test at a time, the smallest code that
  passes, structure and behaviour kept apart, and the two-level test for a
  defect.
- **nizos/tdd-guard**: the ladder to a clean red.

Ideas paraphrased, with no text taken: Trail of Bits' mutation-testing skill
(CC BY-SA 4.0) on equivalent mutants, Anthropic's Claude Code documentation on
separate test authorship, alexop.dev on why one context cannot hold both
halves, and the published work on mutation testing at scale.
