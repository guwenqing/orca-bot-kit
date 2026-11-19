<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-reviewing` was consolidated for this kit from these, all MIT unless
noted, with thanks:

- **Cursor pstack**, `interrogate` with its rubric and `lead-judgment`: the
  intent paragraph and not re-arguing the goal, the correctness, root-cause,
  structure and complexity questions, following the call chain and the types
  out of the diff to answer them, tracing before flagging, security only
  where it can be followed, severity with evidence, an empty review being
  valid, and the whole of the filtering: nitpick gravity, the hypothetical that
  has no caller, premature abstraction, "I would have done it differently",
  about five items, and showing what was set aside. Its `poteto-mode`
  bugbot-triage reference gave fix, dismiss or ask, and "when in doubt, ask".
  Revision: cursor/plugins@6ed0f7a9504f577d7529064103cecce9be7dfc5e
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
  Seen 2026-11-19: pstack deleted the four `interrogate` references, the
  rubric and `lead-judgment` among them, in ab1f702 (2026-10-27), and cut
  `interrogate` itself to about half. All of it can still be read at 6ed0f7a.
- **obra/superpowers**, `requesting-code-review`, `receiving-code-review` and
  `subagent-driven-development/task-reviewer-prompt.md` (the last for bounded
  reading, "declined to judge", the read-only rule and one focused test only
  where a doubt calls for it):
  the reviewer gets context built for it and never the author's session, the
  author's report as unverified claims, missing against extra against
  misunderstood, bounded reading with the risk named, "declined to judge", the
  read-only rule, not dispatching a second reviewer, and the whole receiving
  pattern: read, restate, verify, evaluate, respond, implement, with the stop
  on an unclear item, the check for who calls it, the order of fixes, and
  correcting your own pushback without a speech.
  Revision: obra/superpowers@5bf4e78011075bcfc0dc295f0724994cd123ee71
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **mattpocock/skills**, `code-review`: the smell baseline in full, with its
  own guards: every entry a labelled judgement call, the repo's documented
  standard overriding it, and anything tooling enforces skipped. Also pinning
  the range and checking it resolves before starting, the requirement read as
  missing, unasked-for and misunderstood, quoting the rule for a standards
  breach, and the two axes staying separate so neither hides the other. The
  smells are Fowler's, from *Refactoring* chapter 3.
  Revision: mattpocock/skills@c55ee46073ed923f86ce59a5eb3b6d895095d1b7
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **Cursor thermos**, with `thermo-nuclear-review`: scope held to what the
  change touches, not spending the author's time on a breakage the change
  intends, what over-reporting costs you,
  reading the change before the discussion, and never presenting a finding with
  the research unfinished when the answer was there to be read.
  Revision: cursor/plugins@6ed0f7a9504f577d7529064103cecce9be7dfc5e
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **addyosmani/agent-skills**: passing the artefact and the contract without
  the conclusion, the one structural problem outranking ten small ones, and,
  from `doubt-driven-development`, sorting findings into misread, valid,
  trade-off and noise in that order, with the brief fixed first for a misread.
  Its `code-review-and-quality`: not softening a real issue, which pstack's
  `code-quality-review` says too.
  Revision: addyosmani/agent-skills@dc27a9c2e13721158157632de61b4106c6c2a2a1
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
  Seen 2026-11-19: pstack deleted `code-quality-review` in ab1f702
  (2026-10-27), with the other `interrogate` references. It can still be read
  at 6ed0f7a.
- **Anthropic's built-in review**, as behaviour observed rather than text
  taken: the angles worth separating, naming the behaviour a deleted line held
  up, following a change out to its callers, confirmed against plausible
  against refuted with the line quoted, the realistic states that stay
  plausible rather than refuted, a cleanup finding stating its cost where a
  bug states its trigger, not collapsing finding into judging,
  correctness outranking cleanup, and saying when a review was less than it was
  meant to be.
  Revision: none (Claude Code's built-in review, its behaviour observed rather
  than a text read)
- **ECC's reviewer prompt**, through the research pack: the four questions
  before a finding, a defensible severity, zero findings being expected,
  consolidating repeats, and the list of findings that are usually wrong.
  Revision: affaan-m/ECC@07756cee15788a54506031462794ad645719b028 (as recorded
  in the research pack's source-book-2.md, read 2026-09-19)
- **addyosmani/agent-skills**, `code-review-and-quality` further to the
  above: a copy that is clean and at the reviewed commit before a reviewer runs
  a test of its own, with that commit named in the review (added in 9249958),
  and a defect already on the base reported apart from what the change brings
  in (added in 353ae84).
  Revision: addyosmani/agent-skills@8c99fa36d90068c82d547f7c12a9d67a3e95f4ee
  (read 2026-11-19; the file last changed in 9249958)
- **Cursor `dyl-stack`**, `dyl-review`: a later round told what changed since
  the last one and which findings were set aside, with the reason, so that it
  judges them again rather than repeating them; and the base taken from the
  pull request, not assumed.
  Revision: cursor/plugins@e58dd043600587dbaf58ba315e7f2b38373eeb43 (read
  2026-11-19; the file last changed in fae2c6e)

Ideas paraphrased, with no text taken:

- **Anthropic's Claude Code documentation**, the Code Review pages
  (`code-review`, `code-review-customize` and `code-review-pull-requests`):
  the review rules read from the base and never from the change, a later
  review that looks at what changed since the last one, and a finding marked
  as older than the change.
  Read: 2026-11-19 (the three pages, from code.claude.com/docs/en/)
- **Trail of Bits' `regression-hunt` plugin**, in `trailofbits/skills` (CC
  BY-SA 4.0): a defect older than the change kept apart from one the change
  brings in, and from one it exposes.
  Revision: trailofbits/skills@149d7b21f4067765b82e67029730b42d228ef4b4 (read
  2026-11-19)
