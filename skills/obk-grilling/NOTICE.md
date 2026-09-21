<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-grilling` was consolidated for this kit from these, both MIT,
with thanks:

- **mattpocock/skills**, `productivity/grilling` — the whole mechanism, which
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
  `CONTEXT-FORMAT` and `ADR-FORMAT` — challenging a term that conflicts with
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
  and the kinds of decision usually worth writing — a boundary and what is
  deliberately outside it, a deliberate departure from the obvious path, a
  constraint invisible in the code, and an alternative rejected for a
  non-obvious reason.

`grill-with-docs` and `grill-me` are one-line skills that load the two above.
This kit's skills do not depend on another skill being loaded (ADR 0009), so
the two are consolidated here into one. Issue #46 asks for a skill that works
on its own, and PRD 7.2 proposes this shape — one self-contained skill that
also sharpens terms and records the glossary and decisions — without deciding
it. What the owner decided is narrower: that grilling with docs ships with the
kit. The shape is the proposed one, adopted here.

The section on where an interview goes wrong is not from either source. It is
drawn from the record of this kit's own design session — the twelve
behavioural corrections its owner made while being interviewed with exactly
this mechanism, collected in the research pack's session audit. Observed in
that record: asking before teaching, offering a binary where the answer is a
balance, treating agreement as a decision, going too fast, saying too much,
answering a question that was not asked, handing back your own summary,
overselling, and grilling things that are not decisions.

One item in that section is derived rather than observed, and is marked here
because the difference matters: *do not re-ask whether you may proceed once
something is settled*. What the record actually shows is the interviewer
declaring things settled after a pause or a partial answer and asking again to
start building, while the owner had neither finished learning nor decided — the
audit places those at 18:31:56, 18:35:21, 18:36:06 and 18:36:11. The complaint
was being asked before he was ready, not being asked twice after agreeing. The
rule as written here follows from `rules/limits.md`, where inside your boundary
you act; it is a reasonable default, and it is ours rather than his.

Left behind on purpose: the fixed file layout and the context-map structure for
multi-context repositories, since PRD 7.1 leaves the user free in how they keep
documents; the emoji formatting of a round; and the two wrapper skills, which
exist only to load other skills.
