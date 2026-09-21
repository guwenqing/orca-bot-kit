<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-reviewing` was consolidated for this kit from these, all MIT unless
noted, with thanks:

- **Cursor pstack**, `interrogate` with its rubric and `lead-judgment` — the
  intent paragraph and not re-arguing the goal, the correctness, root-cause,
  structure and complexity questions, following the call chain and the types
  out of the diff to answer them, tracing before flagging, security only
  where it can be followed, severity with evidence, an empty review being
  valid, and the whole of the filtering: nitpick gravity, the hypothetical that
  has no caller, premature abstraction, "I would have done it differently",
  about five items, and showing what was set aside. Its `poteto-mode`
  bugbot-triage reference gave fix, dismiss or ask, and "when in doubt, ask".
- **obra/superpowers**, `requesting-code-review` and `receiving-code-review` —
  the reviewer gets context built for it and never the author's session, the
  author's report as unverified claims, missing against extra against
  misunderstood, bounded reading with the risk named, "declined to judge", the
  read-only rule, not dispatching a second reviewer, and the whole receiving
  pattern: read, restate, verify, evaluate, respond, implement, with the stop
  on an unclear item, the check for who calls it, the order of fixes, and
  correcting your own pushback without a speech.
- **mattpocock/skills**, `code-review` — the smell baseline in full, with its
  own guards: every entry a labelled judgement call, the repo's documented
  standard overriding it, and anything tooling enforces skipped. Also pinning
  the range and checking it resolves before starting, the requirement read as
  missing, unasked-for and misunderstood, quoting the rule for a standards
  breach, and the two axes staying separate so neither hides the other. The
  smells are Fowler's, from *Refactoring* chapter 3.
- **Cursor thermos** — scope held to what the change touches, not wasting the
  author's time on a risk the change intends, what over-reporting costs you,
  reading the change before the discussion, and never presenting a finding with
  the research unfinished when the answer was there to be read.
- **addyosmani/agent-skills** — passing the artefact and the contract without
  the conclusion, the one structural problem outranking ten small ones, and
  sorting findings into misread, valid, trade-off and noise.
- **Anthropic's built-in review**, as behaviour observed rather than text
  taken — the angles worth separating, naming the behaviour a deleted line held
  up, following a change out to its callers, confirmed against plausible
  against refuted with the line quoted, not collapsing finding into judging,
  correctness outranking cleanup, and saying when a review was less than it was
  meant to be.
- **ECC's reviewer prompt**, through the research pack — the four questions
  before a finding, proof for anything urgent, zero findings being expected,
  consolidating repeats, and the list of findings that are usually wrong.
