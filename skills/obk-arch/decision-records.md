# Decision records: the format, a change, and the checks

The detail of "Keep a record of a decision" in the obk-arch skill, for when you write a
record, change one or check one. Whether a decision earns a record at all is in the skill.

Contents: the default format and what each part is for; changing a decision; where records
live; before it is accepted; where records go wrong.

### The default format

Where the project already has a format for its records, use that one. Where
it does not, this is the default:

```markdown
# ADR NNNN: <the decision, as a short phrase>

Date: YYYY-MM-DD.
Status: proposed | accepted | rejected | deprecated | superseded by [ADR MMMM](MMMM-slug.md).
Decided by: <who>. Consulted: <who, if anyone>. A sentence marked (proposed) is not decided yet.
Supersedes: [ADR KKKK](KKKK-slug.md). <only when it does>

## Context
<The full context: the forces at play and the problem. Date any fact that will change.>

## Decision
<Full sentences: "We will…". All of what holds, including what is carried over
from a superseded record.>

## Alternatives considered
- <Alternative>: <what it is; why it was not chosen.>

## Consequences
- Good: …
- Bad: … <the cost accepted>
- Revisit if: … Confidence: <high or low, and why>.
- Checked by: <a test, a review point, a command; optional>

## History
- YYYY-MM-DD, [ADR KKKK](KKKK-slug.md): <what it decided or changed, and why>.
  <one line per earlier record, oldest first; "none" for a first decision>
```

What each part is for:

- **The title** names the decision, not the problem.
- **Status.** Proposed while it is being discussed; accepted once the people
  who decide agree; rejected when it was turned down, kept with the reason so
  the question is not reopened; deprecated when it no longer applies and
  nothing replaces it; superseded by the record that replaced it. **Decided
  by** names who made the call, so a reader knows whom to ask and whose call it
  was; **Consulted**, whose views were sought.
- **Context** describes the forces at play: technical, political, social and
  local to the project, usually in tension with each other, and says so. It is
  value-neutral: facts, not a case for any option. It is the full context, as
  a reader of this record alone would need it, not only what changed since the
  last one. Date a fact that will change (a price, a limit, a version, who is
  on the team).
- **Decision** is the response to those forces, in full sentences and the
  active voice: "We will…". It says all of what now holds, not a repeat of the
  title.
- **Alternatives considered** lists every alternative that was on the table,
  each with what it is and why it was not chosen. The reasons weigh the
  alternatives against the same forces the chosen one answers. Where the
  constraints left only one, say "the only viable option, because…"; without
  the reason that line is not allowed.
- **Consequences** lists all of them, not just the good ones: what gets
  easier, what gets harder, the cost accepted, and for everyone the decision
  touches (whoever runs it, tests it, calls it or pays for it), not only the
  code. Revisit if names the change in circumstances that should reopen it.
  The confidence tells a later reader how hard to push. Checked by, where
  there is one, is how anyone can tell the decision is being kept: a test, a
  point a reviewer looks for, a command.
- **History** is the whole story of the decision: one dated line for every
  earlier record this one replaces, directly or down the chain, oldest first,
  each with what it decided or changed and why. With the context, it lets the
  newest record alone tell the full story.

The headings are there to be answered, not filled in. Write in full sentences;
bullets are for layout, not an excuse for fragments. Keep it short, with what
matters most first, since a long record goes unread; but short never costs the
full context, an alternative or a line of the history. What usually makes a
record long is design detail, and that goes elsewhere, linked.

### Changing a decision

A change to any part of an accepted record is a new record, and the new record
replaces the old one whole. It carries everything that still holds from the
old one, restated rather than pointed at, alongside what changed; the full
context as it now stands; the alternatives, old and new, with why each lost;
and the history, with a line for the record it replaces. Where it replaces
more than one, it names each.

The old record keeps its text. Its status alone changes, to superseded by the
new record, with a link. It stays true to what it says: that this was the
decision, for that stretch of time, for those reasons.

So a reader never has to put a decision together from several records. The
newest says all of what holds and how it got there; the older ones say what
governed the work before.

Not a change: until a record is accepted it is a draft, and a draft is edited.
A spelling or a broken link fixed without changing what the record says is not
a change either.

### Where records live

Beside what they are about, in version control, in plain text: one file per
record, named after the decision, numbered in sequence, and never renumbered.
A number once used is not used again, even for a rejected record. Where the
project keeps its records somewhere else, use that. Either way, someone who
needs a record can find it.

### Before it is accepted

A record is ready to be accepted when:

- there is some evidence the choice will work: a spike, a measurement, the
  same thing done before, someone who has run it;
- the alternatives were compared on the forces named in the context: at least
  two real ones, or the reason there was only one;
- someone who did not write it has challenged it, and the people who decide
  agree with the outcome and the reasons;
- it is written and shared with the people it affects;
- it is known how to tell it is being kept and when to look at it again.

### Where records go wrong

- **Only upsides.** A reason that only restates the choice ("a queue, because
  queues are reliable"), and the costs left out or played down.
- **The straw man.** An alternative that could never have worked, listed to
  make the chosen one look good.
- **The sales tone.** Adjectives nobody could back with evidence. Take each
  one out and see whether the record loses anything.
- **One option and one time frame.** No real alternative looked for, and only
  the next few weeks' effects considered.
- **Criteria after the fact.** The forces chosen to fit the answer, or a
  record written afterwards to justify a decision already made.
- **Everything in one.** A record carrying a whole architecture, or a detailed
  design, instead of one decision.
- **Only the code's view.** The consequences for the people who run it, test
  it, call it or pay for it missing.
- **Edited in place.** An accepted record quietly changed, so nobody can tell
  what governed the work before, or when it changed.
