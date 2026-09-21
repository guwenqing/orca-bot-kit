<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The permission notices these licences require are in
[LICENSES.md](LICENSES.md), beside this file.

The skill `obk-writing` was consolidated for this kit from these, with thanks.
Each licence below was read from the file named beside it.

- **Cursor `plugins`, `pstack/skills/technical-writing`** — MIT,
  `cursor_plugins/pstack/LICENSE`, "Copyright (c) 2026 Lauren Tan". The
  sentence-level core of this skill. Its three rules above the layers: cut
  every word that does no work, use the short everyday word, and when a rule
  makes a sentence worse fix it another way or leave it alone, because a
  sentence that follows every rule and sounds machine-written has failed. Its
  four layers, generalised here from documentation to writing in general:
  choosing what kind of piece this is and not mixing kinds in one piece;
  addressing the reader directly, in the present tense, saying who does what,
  writing instructions as instructions with the condition in front, common case
  before exceptions; loading one instruction or one thought per sentence and
  splitting the one that carries two; and leaving no sentence open to two
  readings, which brings "only" beside the word it changes, every "it" pointing
  at one thing, broken-up noun stacks, the small words that make a sentence
  parse one way, saying which parts an "and" joins, preferring a full stop, and
  skipping idioms and metaphors for the sake of whoever reads in a second
  language. Also its rhythm section, that a piece can obey every rule and still
  read machine-written when every sentence is clipped to the same length; its
  heading rule, that a heading carries the point rather than the topic; its
  list rules; and the instruction to call each thing by one name everywhere.
- **Cursor `plugins`, `pstack/skills/unslop`** — same licence. Two of its rules
  are load-bearing here. Say what it does rather than how it feels, with its
  test: ask what the sentence tells the reader to do or know, restate it as a
  fact, a number or an instruction, and cut it if you cannot; and if the
  sentence could appear unchanged in something about a different subject, it
  says nothing about this one. And name the source or delete, against "experts
  believe" and "studies show". Its active-voice, adverb and synonym-cycling
  rules are here too, and its over-compression rule is why this skill says to
  shorten by cutting rather than by squeezing prose into shorthand. Its
  catalogue of banned words is deliberately not carried: the research pack
  records that a ban-list pulls the banned thing into context, so the positive
  form of each rule is kept and the word list is left where it is, as something
  to review against rather than to load.
- **`citypaul/.dotfiles`, `claude/.claude/skills/technical-writing`** — MIT,
  that skill's own nested `LICENSE`, "Copyright (c) 2025 Adam Bulmer", which
  governs its directory rather than the repository root's MIT licence in
  Paul Hammond's name. This is the page-level and claim-level half. Reader
  first, leading with the payoff and organising around the reader's next action
  rather than the system's internal structure. Scannable, with headings that
  summarise a section's payoff. Selective rather than compressed: the way to
  keep something short is to cut what does not change the reader's next step.
  Its material-claims rule, which is where this skill's fact-checking comes
  from: no capability claim without something a reader can check, counts and
  versions rot so date them or generate them, honest limits are content rather
  than confession and belong where the reader makes the decision, an empty
  state must not read like success, and a document that describes a system is a
  claim about that system, so verify against the source rather than memory and
  update the description in the same change. Its exact-strings rule, since
  people copy what you wrote. Its document shapes, including the proposal that
  leads with the decision requested. And from `resources/formatting.md`, bold
  for the one phrase a skimmer must not miss, and a numbered list claiming that
  order matters.
- **`mattpocock/skills`, `skills/in-progress/writing-shape`** — MIT,
  `mattpocock_skills/LICENSE`, "Copyright (c) 2026 Matt Pocock". The grounding
  idea, which nothing else in the sources has: every concept a block leans on
  was either something the reader walked in with or something an earlier block
  introduced, the unit is the concept rather than the word for it, and the
  lever is what you make a prerequisite against what you ground inside the
  piece, since demanding too much shuts readers out and grounding too much
  drowns the opening. Its format arguments are also taken: prose carries an
  argument and lists carry parallel items, a table where the same shape repeats
  three times or more, and quoting where the original wording is the point.
- **`anthropics/skills`, `skills/internal-comms`** — Apache 2.0, that skill's
  own `LICENSE.txt`, "Copyright 2026 Anthropic, PBC." The only source here that
  is explicitly about audience, platform and register for non-engineering
  writing. Its opening protocol is this skill's first section: ask about the
  audience, understand the purpose, clarify the tone, confirm the format, then
  be clear and concise, use active voice and put the most important information
  first. Its update format contributes the point that the place a piece will be
  read is a constraint on the writing rather than a detail: something meant to
  be read in under a minute by people with some but not much context is a
  different piece from the same facts written to be landed on.
- **`garrytan/gstack`, `document-generate/SKILL.md`** — MIT,
  `garrytan_gstack/LICENSE`, "Copyright (c) 2026 Garry Tan". Its voice section:
  lead with the point, be concrete, name the real thing and the real number,
  and sound like someone talking to the person rather than presenting to them.
  Its rule to gloss a piece of jargon on first use even where the user
  introduced the term.
- **`addyosmani/agent-skills`, `skills/doubt-driven-development`** and
  **`citypaul/.dotfiles`, `claude/.claude/skills/double-check`** — MIT,
  `addyosmani_agent-skills/LICENSE` ("Copyright (c) 2025 Addy Osmani") and
  `citypaul_.dotfiles/LICENSE` ("Copyright (c) 2024 Paul Hammond"). The reader
  test at the end comes from these two rather than from any writing skill: hand
  over the artifact without your reasoning, because handing over your
  conclusion gets you agreement with your conclusion; start the reader cold,
  with no transcript and no signal of what you want; and stop when a fresh pass
  stops finding anything rather than after a set number of rounds.

**Left out on a licence.** `anthropics/skills`' `doc-coauthoring` is the
closest thing in the sources to an end-to-end collaborative writing workflow,
and its reader-testing stage is the best statement of this technique anywhere
in the corpus. Its directory holds no licence file and its frontmatter names
none, and `anthropics/skills` has no repository-root licence either, so
nothing is taken from it. What this skill says about testing on a fresh reader
is reached from the two MIT sources above instead, and is narrower for it: the
predicted-questions mechanic and its exit condition are that skill's, and are
not reproduced here.

Also left out on purpose: the specific documentation framework the pstack
skill and the citypaul skill both build on, named and cited in both. Its four
kinds of document are useful and are carried here in ordinary words, with a
fifth for a piece written to be decided on, but the kit does not adopt a named
framework or its file layout, because PRD 7.1 leaves the user free in how they
keep documents. The reference lists, style-linting tooling and README-specific
material in the citypaul resources are also out: they are for a documentation
site rather than for writing in general.

PRD 7.1 decides what this skill is for, and the owner agreed to it in those
words on 2026-09-20 at 19:45:42: "Write for an audience, a platform and a tone,
and check the key facts", following the same rules as the other skills,
"techniques only, no process, deeply written".

One note on this skill's own prose. It carries the rule that a sentence
carrying a second clause on a dash is usually two sentences, so it is written
without em dashes throughout. A skill that broke its own punctuation rule in
its own text would be teaching by counter-example, which happened once already
in this kit and was caught in review.

## What an acceptance run changed

The skill was run by a bot that had not seen it written, on a real piece of
internal communication: a change of expenses system for two hundred mostly
non-technical staff, many part-time, plus a second version for team leads.
Seven things in it come from what that found.

- One heading was actively steering the writing wrong. "Say what it does, not
  how it feels" is about empty sentences, but it reads as a rule against
  addressing how a reader feels, and it pushed the run away from the brief's
  sharpest constraint. The heading now says what the section is about, and the
  section says that naming what a reader feels is a fact about them.
- Nothing covered the facts a writer does not have and must not invent. Marking
  the hole where it belongs and collecting the questions is now in the skill,
  along with the point that a piece with its holes marked is a legitimate thing
  to hand back.
- Checking assumed the writer could reach the thing being described. Where the
  only source is the person who asked, that is now said, with what can still be
  checked: the dates, the arithmetic, and whether the piece contradicts itself.
- The fresh-reader test had no stopping rule that terminates while facts are
  still missing, and did not say who counts as a fresh reader.
- Nothing covered two versions of one thing for two audiences, or the
  asymmetry between them, which is where that run found its sharpest problem.
- "Keep the small words" and "keep it short" were in tension with nothing
  saying which wins.
- Ordering by importance put three dates on the page out of sequence. A piece
  that turns on dates or steps needs both orders.

The part of the skill that run rated highest was the fresh-reader test, which
found that for a large share of the staff the deadline in the first draft fell
on a day they do not work.
