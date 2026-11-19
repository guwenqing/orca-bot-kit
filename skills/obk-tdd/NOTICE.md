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
  Revision: mattpocock/skills@c55ee46073ed923f86ce59a5eb3b6d895095d1b7
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **obra/superpowers**, `test-driven-development` and its `writing-good-tests`:
  naming the break a test catches, deriving the expected value by hand, change
  detectors, behaviour rather than text, your contract rather than the
  framework's, the four rules about a stand-in, the list of warning signs, and
  the mutation classes. Its `verification-before-completion`: the
  revert-the-fix proof. Its `writing-plans`: a requirement's silence not being
  permission, and the few uncovered input classes most likely to bite.
  Revision: obra/superpowers@5bf4e78011075bcfc0dc295f0724994cd123ee71
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **Cursor pstack**, `tdd` and `principle-test-behavior-not-implementation`:
  the five shapes that observe no behaviour and the fix for each (asserting
  what a stand-in received rather than that it was called, and the relation
  across rows of data that is kept), "prefer no
  new test over a bad test", the honest exit when a test is impractical, and
  the report that names the failing-before and passing-after runs.
  Revision: cursor/plugins@6ed0f7a9504f577d7529064103cecce9be7dfc5e
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **addyosmani/agent-skills**, `test-driven-development` and
  `constraint-driven-development`: finding out how the project tests before
  writing anything, repetition being no fault in a test, a subagent for the
  reproduction test, and the cheap roads to green.
  Revision: addyosmani/agent-skills@dc27a9c2e13721158157632de61b4106c6c2a2a1
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **citypaul/.dotfiles**, `tdd` and `mutation-testing` with its
  `mutator-rules`: the mutation loop, survivor triage into killed, equivalent
  or named and deferred, the equivalence question, the high-value logic worth
  breaking, the inputs that tell a break apart (either side of a boundary,
  mixed true and false, no identity values), the tool-run mechanics in
  `mutation-tools.md`, keeping the harness out of the inner loop, triangulating
  after a fake, and refusing to manufacture a red.
  Revision: citypaul/.dotfiles@a109f9972bb46671c624fc05752031523e1cf6fc
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **Kent Beck's own rules file**: one test at a time, the smallest code that
  passes, structure and behaviour kept apart, and the two-level test for a
  defect.
  Revision: KentBeck/BPlusTree3@ca80e4d85a99cd0af2effe717f709d43e80403bc
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **mattpocock/skills**, `engineering/diagnosing-bugs` further to the above:
  a forced red confirmed with a diff against a clean copy before it is trusted,
  here also for each planted break of the mutation check.
  Revision: mattpocock/skills@f3fc5632f401156837ee3872f14fe33ccf1024ea (read
  2026-11-19)
- **Waza**, `hunt`: proving a regression test against the unfixed code in a
  disposable copy, never by reverting or stashing the shared working tree.
  Revision: tw93/Waza@6dc218838878401ccdcde8101a64b9db3df548d8 (read
  2026-11-19)
- **nizos/tdd-guard**: the ladder to a clean red.
  Revision: nizos/tdd-guard@2579ec1823fac5f4afb73be678d9c500b19885ac (as
  recorded in the research pack's source-book-2.md, read 2026-09-19)

Ideas paraphrased, with no text taken:

- **Trail of Bits' mutation-testing skill**, in `trailofbits/skills` (CC BY-SA
  4.0), on equivalent mutants.
  Revision: trailofbits/skills@123037ec8aed26f0d86327cc39137ee5043e5deb (as
  recorded in the research pack's source-book-2.md, read 2026-09-19)
- **Trail of Bits' `prove-patch` skill**, in `trailofbits/skills` (CC BY-SA
  4.0), on proving a patch in clean trees, with the reverted tree checked to be
  the baseline tree.
  Revision: trailofbits/skills@a3131740a39291e42fd15b9eac07e0b393ad71b1 (read
  2026-11-19)
- **Anthropic's Claude Code documentation**, "Claude Code: Best practices", on
  separate test authorship.
  Read: 2026-09-19 (read for the research pack's source-book-1.md, of that date)
- **alexop.dev**, "A Claude Code TDD Skill: Forcing Red-Green-Refactor", on why
  one context cannot hold both halves.
  Read: 2026-09-19 (read for the research pack's source-book-1.md, of that date)
- **The published work on mutation testing at scale**, Petrović and others,
  "Practical Mutation Testing at Scale" (arXiv 2102.11378).
  Read: 2026-09-19 (read for the research pack's source-book-1.md, of that date)

Our own, with no source behind them: the order to break things in, the red
from an archived baseline for behaviour that already existed, checking that an
author's hand-back is in the change (from this repo's issues #115 and #119),
and the part on work away from code.
