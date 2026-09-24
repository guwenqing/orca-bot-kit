<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The permission notices these licences require are in
[LICENSES.md](LICENSES.md), beside this file.

The skill `obk-decision-memo` was consolidated for this kit from these, with
thanks. Each licence below was read from the file named beside it.

- **`citypaul/.dotfiles`, `claude/.claude/skills/evaluate-existing-solutions`**:
  MIT, `citypaul_.dotfiles/LICENSE`, "Copyright (c) 2024 Paul Hammond", which
  governs this skill's directory since it carries no nested licence of its own.
  The strongest source here, and the spine of this skill. It is shaped for
  choosing whether to adopt something, and nearly all of its machinery is
  decision-memo machinery: establishing the job and the hard constraints before
  shopping, and separating solution-neutral needs from an attractive
  candidate's vocabulary so that one option cannot redefine the requirements
  after the search has begun; keeping a genuine baseline in the comparison
  rather than a straw one; eliminating on a hard constraint or naming a
  credible mitigation, and then comparing the survivors qualitatively rather
  than disguising judgement as a weighted numeric score; avoiding false breadth,
  since two or three representative finalists plus the baseline are usually
  enough and a long popularity list is not breadth; comparing total ownership
  rather than the effort to start, and comparing the exact version and tier
  rather than a brand's reputation; calibrating how much research to do to the
  impact and the reversibility, and stopping once further search is unlikely to
  change the answer; preferring the least irreversible option where credible
  ones otherwise tie; treating current versions, maintenance, security,
  pricing and licences as volatile and verifying them rather than relying on
  memory; using primary technical evidence, since popularity can identify a
  candidate but cannot select one; recording the specific finding rather than
  only a link, with the date it was observed; proposing the smallest proof that
  could change the decision, with its question, its pass and fail boundary and
  its timebox, and the caution that such a proof reduces named uncertainties
  and erases no ongoing obligation; the outcomes it defines, including defer,
  which preserves optionality and names the next trigger, and do nothing, where
  the current state already satisfies the job; saying when to revisit a durable
  decision and what should trigger it; recording uncertainty, confidence,
  evidence dates and what would change the recommendation; the instruction this
  skill takes whole, to state the strongest reason against the recommendation;
  and the ownership rule, that every agent-produced result starts as proposed
  and only the named owner can accept it, with the accepter and the date
  recorded. Its completion check contributes the question of whether the
  baseline is genuine rather than a straw candidate and whether every rejected
  alternative has a reason.
- **`addyosmani/agent-skills`, `skills/documentation-and-adrs`**: MIT,
  `addyosmani_agent-skills/LICENSE`, "Copyright (c) 2025 Addy Osmani". Writing
  a decision down when it would be expensive to reverse. Matching the
  convention a project already has: the place, the naming, the numbering and
  the headings it already uses, continuing a sequence rather than starting a
  second one, and surfacing the conflict where two conventions are already in
  use rather than quietly picking. Every alternative carrying an explicit line
  giving the reason it was rejected. And the lifecycle: do not delete or edit
  an old decision when things change, write the next one and say which one it
  replaces, because the historical context is the part worth keeping.
- **`addyosmani/agent-skills`, `skills/idea-refine`**: same licence. The
  machinery for alternatives that are actually different: the lenses for
  generating them, which this skill carries as asking what the opposite would
  look like, what the far simpler version would be, what it would look like
  with the tightest constraint lifted, and what someone who works in the field
  would find obvious; and its point that a few real variations beat many
  shallow ones, carried as two or three candidates and the baseline. Its
  assumption audit in three tiers is
  this skill's uncertainty section: what must be true or the thing fails
  entirely, and is therefore checked before committing; what would hurt but is
  survivable; and what does not matter yet. Its pre-mortem is the
  counter-example technique: stand a year ahead, say it went badly, list the
  ways, then say which are preventable, which are accepted, and which would be
  fatal. Its instruction to be honest rather than supportive is carried in
  those words. Its "not doing, and
  why" is the reason this skill treats the dropped options as a part of the
  memo rather than an appendix to it.
- **`addyosmani/agent-skills`, `skills/doubt-driven-development`**: same
  licence. Checking your own conclusion: name the decision in two or three
  lines, because if you cannot get it that small you have a subject rather than
  a decision; hand a reviewer the artifact and the contract and strip your
  reasoning, since handing over conclusions gets conclusions validated; frame
  the request adversarially, because the framing decides the answer; and treat
  what comes back as data rather than a verdict, re-reading the thing against
  each finding, since rubber-stamping a reviewer is the same failure as
  ignoring one.
- **`citypaul/.dotfiles`, `claude/.claude/skills/double-check`**: MIT, the
  repository root licence above. How a finding is closed: push back with
  evidence and never by signalling which outcome you want, and treat an
  objection dropped only out of deference to confident pushback as still open.
  Its evidence tiers on a finding are this skill's three labels for how you
  know a thing: observed by running something, traced by reading something
  authoritative, or inferred. And its rule that severity is judged by the
  impact if it ships rather than by the effort to fix it or by the reviewer's
  own certainty.
- **`citypaul/.dotfiles`, `claude/.claude/skills/find-gaps`**: MIT, the
  repository root licence above. What a plan or a memo is missing rather than
  what it gets wrong: treating silence as a red flag rather than a green light,
  the cost of doing nothing as a thing the document must state, and the vague
  words that need a number or a concrete behaviour behind them before they mean
  anything. Its warning against inventing a gap to make the review look
  productive is why this skill says a memo may honestly conclude that none of
  the options is good.
- **`garrytan/gstack`, `office-hours/SKILL.md` and `plan-ceo-review/SKILL.md`**:
  MIT, `garrytan_gstack/LICENSE`, "Copyright (c) 2026 Garry Tan". The premise
  challenge, which this skill carries as asking whether the question is the
  right one before answering it: could a different framing make this much
  simpler, what happens if we do nothing, and is this the most direct path to
  the outcome or is it solving a proxy for it. And its practice of putting the
  premises where the reader can disagree with them rather than burying them in
  the reasoning.

Made generic, which is what the owner asked for. The strongest source is
build-against-buy shaped and comes with a fixed template, an evaluation table
of fourteen rows and a file layout; the ADR source comes with a numbering
scheme and a directory. This version keeps the content those shapes carry and
prescribes neither, because PRD 7.1 leaves the user free in how they keep
documents, and it says instead to match whatever the project already does.

Where this overlaps `obk-grilling` and `obk-why`, that is deliberate and
what ADR 0019 proposes: a skill carries what it needs rather than depending on
another being loaded. `obk-grilling` settles a decision by interviewing;
`obk-why` recovers one that was already taken; this one writes a decision up so
somebody else can take it.

PRD 7.1 decides what this skill is for. The words are the coordinator's
proposal of three light technique skills, "Give the conclusion, evidence,
alternatives, risks, counter-examples and uncertainty ... techniques only, no
process, deeply written", which the owner approved on 2026-09-20 at 19:45:42
("I agree to what you suggest").

## What an acceptance run changed

The skill was run by a bot that had not seen it written, on a real decision: a
small charity choosing between a paid platform, a bespoke build, an unnamed
open-source tool and its current spreadsheet, with a board date fixed and no
way to check any of the options. Seven things in it come from what that found.

- The evidence labels had no rung for a claim somebody reported to you, which
  was the entire evidence base in that run and is most of what a memo rests on.
  Who reported it is now part of the label, because a person describing their
  own week and a figure passed along twice are not the same thing.
- Nothing covered the case where the evidence cannot be gathered at all. The
  skill's most emphatic instructions point at a like-for-like comparison, and a
  comparison written from memory about things you cannot name reads exactly
  like one built on evidence. The skill now says the memo changes job and says
  so in its first paragraph.
- Calibration covered reversibility but not a date that will not move. What can
  honestly be settled by then is now the ask.
- A number the writer worked out themselves travels further than its caveat and
  arrives at the next meeting as a fact. Range, assumptions and a plain label
  are now required of an estimate.
- Nothing asked who else is in the decision and what they stand to gain. In
  that run a trustee's own company was one of the options, which is a
  governance question that outranks the comparison and which the skill never
  prompted for.
- A counterargument you write yourself is one that failed to persuade you, and
  is weaker by construction. That now gets said.
- Nine sections read as a template rather than as questions, and the memo grew
  to fit them against the skill's own instruction to keep it readable.

## What the review of the first version changed

The review on #129 corrected two things: the evidence labels now run upward
from the weakest support, with the advice to move a fact up the list as far as
is cheap; and terms that were supplied but not checked get a comparison on
those terms, said as unchecked, rather than none.

## What the re-validation changed (#155)

Where there is no convention for keeping it, the memo goes where the person
asked or back in the reply, never to an invented documentation path (citypaul
`evaluate-existing-solutions:131`). The nine-item list became one sentence of
questions, since the acceptance run found it read as a template. Added, each a
clause: whether the question is a stand-in for the real goal (gstack's premise
challenge), time to value and what else the time would have bought, preferring
the option easier to undo on a tie, an unchecked hard constraint not being a
pass, a choice resting on unchecked terms staying provisional, ranking risks by
cost rather than by ease of fixing, a trial not taking away the duties of
owning the choice, and stopping the search when more would not change the
answer (citypaul `evaluate-existing-solutions` and its `evaluation-dimensions`,
and `double-check`). Cut: a paragraph on the last reader with no source, and a
repeated line on length.
