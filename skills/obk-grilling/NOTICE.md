<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-grilling` was consolidated for this kit from these, both MIT,
with thanks:

- **mattpocock/skills**, `productivity/grilling`. The whole mechanism, which
  is what `grill-with-docs` and `grill-me` reach for: interviewing until a
  shared understanding is reached, mapping the subject as a design tree where
  every decision branches into the ones hanging off it, the frontier as the
  decisions whose prerequisites are settled, working in rounds with each
  question numbered and carrying a recommended answer, a question that depends
  on one still open belonging to a later round, answers reshaping the tree and
  pushing the frontier outward, facts being the interviewer's job and never the
  user's with a lookup dispatched rather than a question asked, not blocking
  the rest of the round on one outstanding fact, the decisions being the user's
  to make, and being finished only when the frontier is empty with nothing
  silently assumed and the user confirming the shared understanding before
  anything is built.
- **mattpocock/skills**, `engineering/domain-modeling` with its
  `CONTEXT-FORMAT` and `ADR-FORMAT`. Challenging a term that conflicts with
  the agreed one and doing it immediately, proposing a precise term where one
  is overloaded, stress-testing a relationship with an invented concrete
  scenario, checking a claim about how something works against the code and
  surfacing the contradiction, writing a term down the moment it is resolved
  rather than batching it, keeping the glossary opinionated with one word
  chosen and the rest listed as ones to avoid, definitions of one or two
  sentences saying what a thing is rather than what it does, only terms
  specific to this project and not general programming vocabulary, the glossary
  being a glossary and not a spec or a scratchpad, creating files lazily when
  there is first something to write, the three conditions that must all hold
  before a decision is worth recording and what each one rules out, the
  decision note being a short paragraph whose value is in recording that a
  decision was made and why, optional parts included only when they earn it,
  and the kinds of decision usually worth writing: the architectural shape,
  how the parts are meant to communicate with each other, a technology choice
  that carries lock-in, a boundary and what is deliberately outside it, a
  deliberate departure from the obvious path, a constraint invisible in the
  code, and an alternative rejected for a non-obvious reason.

`grill-with-docs` is a one-line skill that loads the two above, and `grill-me`
one that loads `grilling` alone. ADR 0009 proposes that a kit skill carries
what it needs rather than relying on another being loaded, so the two are
consolidated here into one. Issue #46 asks for a skill that works
on its own, and PRD 7.2 proposes this shape (one self-contained skill that
also sharpens terms and records the glossary and decisions) without deciding
it. What the owner decided is narrower: that grilling with docs ships with the
kit. The shape is the proposed one, adopted here.

The section on where an interview goes wrong is not from either source. It is
drawn from the record of this kit's own design session: the behavioural
corrections its owner made while being interviewed with exactly this
mechanism, collected in the research pack's session audit (section 3), in his
words where they are quoted here:

- asking before he could answer: teach first and let him ask the deep
  questions (18:17:25, 18:38:59); explaining the one thing and stopping when
  he says he does not follow, from his answers in the question rounds;
- the binary: dig deeper and balance rather than offer two choices (18:06:55);
- agreement is not a decision (18:38:59), with the line drawn at what he was
  asked to decide rather than at the words used;
- deciding for him: the pattern the audit records at 18:31:56, 18:35:21,
  18:36:06 and 18:36:11, choices declared settled or made on the assistant's
  own judgment after a pause, which he later challenged; the handover case
  from his own answer in a question round leaving a choice to the assistant;
- too fast (18:36:47), saying too much (18:38:02), and empty summaries
  (17:26:21, said of summaries generally);
- answering the question asked (19:10:14), checking the reading (17:21:50),
  not grilling research (18:31:25), not overselling (19:11:39);
- his own summary: he asked for a subagent to review it and to check it
  against the session log (19:12:40, 19:15:38), which is the fix the skill
  gives.

Three deliberate departures from `grilling` and `domain-modeling`, so they are
not mistaken for consolidation:

- **A round is three questions, not the whole frontier.** `grilling` says to
  ask the entire frontier in one round. The owner asked for three at a time
  (13:24:19, recovered in the audit), and a round of nine reads as a form and gets
  filled in like one. The frontier still governs *which* questions are
  askable; it no longer governs how many go out at once.
- **Small settled things get recorded.** `domain-modeling` says to offer an ADR
  only when all three conditions hold and otherwise to skip it. That is the
  right gate for a decision note, and this skill keeps it, but it applies the
  gate to the note rather than to the record, because a reversible unsurprising
  choice is still what the next person needs in order to build the agreed
  thing. Everything settled goes down; a few earn the note.
- **What was not settled is recorded too.** Neither source asks for this. It
  comes from the audit of the owner's own design session, where what he had
  merely agreed with in passing, and what had been assumed on his behalf, were
  the things that later had to be untangled.

- **Questions are kept short.** `grilling` allows a question several
  paragraphs of setup; a long one here is taken as a sign it is two questions
  or that teaching should come first.

Left behind on purpose: the fixed file layout and the context-map structure for
multi-context repositories, since PRD 7.1 leaves the user free in how they keep
documents; the emoji formatting of a round; and the two wrapper skills, which
exist only to load other skills.
