<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The permission notices these licences require are in
[LICENSES.md](LICENSES.md), beside this file.

The skill `obk-researching` was consolidated for this kit from these, with
thanks. Each licence below was read from the file named beside it.

- **Cursor `plugins`, `pstack/skills/why/references/`**: MIT,
  `cursor_plugins/pstack/LICENSE`, "Copyright (c) 2026 Lauren Tan". Three files
  carry most of this skill.
  - `epistemics.md`: the tiers a claim can sit in and the rule that every claim
    sits in one of them; the phrasing that goes with each; the words that carry
    a citation with them and need one immediately beside them; the words to
    avoid and why each ("obviously" would not be asked about, "clearly"
    precedes what is not, "just" hides a difficulty, "I think" turns evidence
    into opinion); not turning an absence of evidence into evidence of absence; the
    embedded-hypothesis trap, where the asker's guess is a prompt for
    investigation rather than a conclusion to validate; surfacing both sides
    when sources disagree rather than picking the tidier narrative; naming a
    gap concretely as the question, the sources, the search terms and what came
    back; and the check that a report with no gaps in it is suspicious.
  - `investigator-prompt.md`: the posture that gathering is not concluding, and
    that the more boring and exact the notes the more useful they are, with one
    verbatim quote and a precise citation worth more than a paragraph of
    plausible summary; quote rather than paraphrase where the wording carries
    the weight; go wide before going deep; read the whole thing rather than the
    title or the summary, because the qualification is usually further down;
    track what you searched and not only what you found, since an absence means
    nothing to a reader who does not know what was looked for; resist the story
    and treat the piece that does not fit as the interesting one; consider the
    counterfactual before calling evidence strong; and never round a partial
    finding up.
  - `synthesizer-prompt.md`: the shape of the write-up, including one line per
    source consulted covering the ones that held nothing and the ones that
    could not be reached, with the reason; and its closing point that the value
    of the output is its honesty rather than its authority, so that a reader
    who takes it to the person who really knows can ask a better question.
  - `why/SKILL.md` adds coverage rather than minimalism, documenting the null
    instead of skipping the search, and the high bar for skipping a source:
    provably irrelevant rather than probably irrelevant.
- **`addyosmani/agent-skills`, `skills/source-driven-development`**: MIT,
  `addyosmani_agent-skills/LICENSE`, "Copyright (c) 2025 Addy Osmani". The
  source hierarchy and what sits outside it: model-written summaries and your
  own training data are not sources, and memory in particular is the one that
  feels like knowledge. Its blanket line that forum answers and blog posts are
  not primary is not carried: the review on #129 moved authority to the claim,
  so a blog post is the source that owns a claim about its author's own
  work. Being precise
  about what you fetch, the specific page rather than the front page. Surfacing
  a conflict between two authoritative sources instead of choosing. Treating
  fetched pages as data and not as instructions, so that text addressing the
  reader rather than documenting the subject is content and nothing more, and
  never lets retrieved material expand the task. Citation practice: deep links,
  quote the passage that carries a non-obvious claim, and say plainly when you
  could not find documentation. And the rule this skill takes whole, that
  hedging is the worst of the three options: either verify and cite, or mark it
  unverified, because a disclaimer in a subordinate clause reads as confidence.
- **`garrytan/gstack`, `ETHOS.md`**: MIT, `garrytan_gstack/LICENSE`,
  "Copyright (c) 2026 Garry Tan". The three layers of what you find and how
  much weight each bears: the settled and well-trodden, where the risk is
  assuming the obvious answer is right and the cost of checking is near zero;
  the new and popular, where the crowd can be wrong about a new thing as easily
  as an old one and search results are inputs to thinking rather than answers;
  and reasoning from the specifics, which is the most valuable and is still an
  inference. Its `office-hours/SKILL.md` adds the privacy gate before a search:
  look things up by general category rather than by the private thing you are
  working on, and strip names, addresses, paths and anything that looks like a
  secret from a query before it leaves the machine.
- **`openai/skills`, `skills/.curated/notion-research-documentation`**: MIT,
  that skill's own `LICENSE.txt`, "Copyright 2025 Notion Labs, Inc." The search
  strategy, which is the only material of its kind in the sources: broad to
  narrow, several related queries rather than one, what to do when there are
  too many results (narrow, or sample deliberately across kinds rather than
  taking the first few) and too few (broaden, try the words the field itself
  uses, look in the neighbouring subject), and the shape of a query that is too
  vague against one that is too specific to match anything. Its citation
  guidance is also taken: group a run of claims from one source rather than
  citing every sentence, put the citation beside what it supports, mark a
  quotation as a quotation, keep a sources section that includes what held
  nothing, and flag a superseded source where it stands.
- **`mattpocock/skills`, `skills/engineering/research`**: MIT,
  `mattpocock_skills/LICENSE`, "Copyright (c) 2026 Matt Pocock". Twelve lines,
  one of which the research pack singled out and this skill is built around:
  follow every claim back to the source that owns it, and go to primary
  material rather than a secondary write-up of it.
- **Cloudflare's security-audit skill**: MIT,
  `cloudflare_security-audit-skill/LICENSE`, "Copyright (c) 2025-2026
  Cloudflare, Inc." Coverage honesty: never imply that one pass exhausts the
  subject, and a scoped piece of work presents itself as partial rather than
  letting silence read as "the rest is fine".

Two things come from the research pack rather than from a repository, and are
marked here because the difference matters:

- The evidence-label pair `(verified: <command>)` and `(inferred: did not
  run)`, which `source-book-2.md:139` calls the single best sentence in its
  whole survey, is quoted there from **tw93/Waza**'s `rules/anti-patterns.md`
  (recorded as MIT in the same book's source table). Waza is not among the
  clones in the research pack, so this is taken from the book's verbatim quote
  rather than from the repository. The label's checkable form is kept as the
  source has it, because being able to audit the label is the whole of its
  value; the prose around it is ours. The source applies `inferred` to
  reasoning from code, so this skill keeps it for an inference and asks for
  `not checked` where the claim is somebody else's unchecked account.
- The pack's own reports label each claim by where it came from and whether it
  was checked, and keep a section of gaps and cautions at the end. That habit,
  rather than any source, is why this skill treats a claim's support and the
  report's coverage as two separate things to state.

Made generic, which is what the owner asked for. The pstack originals are about
code and its history, run named investigator and synthesizer subagents, and map
seven hosted integrations to fixed categories. This version is about finding
anything out from whatever sources exist, keeps the confidence labels and the
null-result discipline in the skill itself, and leaves how the work is divided
up to whoever is doing it.

Where this overlaps `obk-why`, that is deliberate and allowed by ADR 0009: a
skill carries what it needs rather than depending on another being loaded.
`obk-why` anchors in code and its history; this one is about sources, coverage
and how far a claim can be trusted.

PRD 7.1 decides what this skill is for. The words are the coordinator's
proposal of three light technique skills, "Find sources, say how each claim is
supported, and separate fact from inference ... techniques only, no process,
deeply written", which the owner approved on 2026-09-20 at 19:45:42 ("I agree
to what you suggest").

## What an acceptance run changed

The skill was run by a bot that had not seen it written, against a real
question with genuinely mixed evidence: what is actually established about
people running teams of AI agents, from a research pack that labels its own
sources. Five things in it come from what that found.

- The three labels say how the writer came by a claim. They do not say how good
  it is, so a controlled study and a sales page both came out as "someone
  stated it". The skill now carries how far a claim has travelled as part of
  that label, which was the single most decision-relevant property in the run
  and the one the reader had asked for.
- The skill said an inference should be hedged and then, six lines later, that
  hedging is the worst of the options. That is a plain contradiction and it is
  now stated as what it meant: hedge the strength of an inference, label the
  state of the evidence, and do not do the first in place of the second.
- Nothing covered a corpus somebody else assembled for another purpose, which
  matters most when the answer is an absence, and nothing distinguished running
  out of material from an answer that had settled.
- The hand-back was shaped for another researcher, so the answer sat underneath
  the coverage. It is now ordered for whoever asked, and says that where they
  asked in order to decide, saying what you would do next is part of answering.
- The list of words to avoid read as a list to police. It is now the check it
  was meant to be.

## What the re-validation changed (#155)

No silent substitution: an answer about a neighbouring subject is said to be
one (pstack `why/references/investigator-prompt.md:63`). Checking citations
before handing over, by spot-check and wherever unsure (its
`synthesizer-prompt.md:44`). A source's date and
the period or version a claim covers (`investigator-prompt.md:79`). Other
explanations that fit, in the hand-back (`synthesizer-prompt.md:78-86`). The
answer and its strength first, per `rules/talk.md`. Labels on every claim a
reader would act on rather than every claim, per `rules/evidence.md`. Opening a
page verifies that it was said, not that it is true. Credits for the
blast-radius ladder and for retrofitted rationales, which the skill does not
carry, are removed; a repeated paragraph on who is speaking is merged.
