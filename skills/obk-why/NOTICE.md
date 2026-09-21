<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-why` was consolidated for this kit from this, MIT, with thanks:

- **Cursor pstack**, `why` and its `references/epistemics.md` — investigating
  the motivation behind code as distinct from what it does; the opening
  observation that code does not carry its own motivation, so the why lives in
  commits, reviews, tickets, documents and conversations, all incomplete and
  sometimes missing, and that pretending otherwise produces confident-sounding
  guesses that mislead; parsing the target and the kind of question, and
  stating your reading when the target is vague rather than asking; anchoring
  in concrete code first — the paths and line ranges, the symbols, the recent
  commits, the review discussion attached to them — before looking anywhere
  else; the categories of place a reason lives and what each is uniquely good
  at, with source control always available and best for the rationale captured
  at review time, the tracker best when the reason is external to engineering,
  long-form documents where the thinking predates the code, real-time chat for
  deliberation that never reached a document and most valuable when the written
  trail is thin, and runtime records best for defensive code such as guards,
  retries and limits; running them in parallel, one per source; documenting the
  null rather than skipping the search, with an unavailable source flagged as a
  gap and a skip allowed only when provably rather than probably irrelevant;
  recency bias as the named failure, since the current shape is usually the
  accretion of earlier decisions; the five confidence tiers with their
  examples and their phrasing — written down, converging evidence, inferred
  with the chain made explicit, speculative with alternatives beside it, and
  unknown stated precisely as what was searched; the words that carry a
  citation with them, each needing its source immediately beside it, and the
  calibration check that the code is never evidence for its own intent; the
  embedded-hypothesis trap, where a question arrives with its answer attached
  and confirming it is the cheap and wrong move; surfacing both sides when two
  sources disagree rather than picking the tidier story; the output sections
  including one line per source consulted covering the empty and skipped ones;
  and turning the findings into a preserve, change, avoid and risk constraint
  set when the question precedes a change.
- The same skill's `references/sources/code-archaeology.md` — its pitfalls: the
  squash merge that flattens a branch's steps, the commit message that calls a
  behaviour change a small refactor so the diff has to be read instead, the
  pattern copied without its reason so the place it started is the one to
  investigate, and the automated change that carries no motivation at all.

One thing in the squash paragraph is ours rather than the source's. That a
squash merge loses the branch's commits is the source's pitfall; what is added
here is where the reason then is — the argument that moved a value is worth
more than the value it landed on — and the instruction to cite the change that
did the thing rather than the one that delivered it. That came out of an
acceptance run of this skill, which traced a constant's history correctly but
cited the squash merge for a value that the merge had never held.

Made generic, which is what the owner asked for. The original discovers hosted
integrations and maps them to seven fixed categories, spawns investigator and
synthesizer subagents on named models, and keeps four reference files of
prompts and per-source playbooks. This version names the kinds of place a
reason lives and says to use the ones the project actually has, keeps the
confidence tiers and the null-result discipline in the skill itself, and leaves
how the work is divided up to whoever is doing it.

One departure: the original keeps itself from being invoked on its own with
`disable-model-invocation: true`, which is not portable frontmatter (ADR 0009
and PRD 7.2: these run on purpose, never automatically). The description
carries that instead — the phrases that ask for it, and the note that it is not
something to start unasked before an ordinary change.
