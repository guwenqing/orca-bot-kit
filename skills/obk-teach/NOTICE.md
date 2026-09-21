<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

The skill `obk-teach` was consolidated for this kit from this, MIT, with
thanks:

- **Cursor pstack**, `teach` — explaining what a thing is, how it works and why
  it is built that way, at the person's pace, with understanding rather than
  any change as the goal; choosing the few things they should walk away with
  from why they are asking and what they already know, read from the
  conversation rather than quizzed, skipping what they plainly know and putting
  the depth where their question is; getting oriented by reading the thing
  before explaining it; keeping another source's confidence language intact
  because its hedges are findings rather than style; starting with a plain
  definition in general terms with the thing's common name, then tying it to
  the case in front of them, then building through how it works to the deeper
  reasons and the edge cases; explaining each part so the idea clicks — the
  problem it solves and how it actually works — with listing functions and
  constants called out as reference rather than teaching; walking through what
  happens as the person does the thing when that is what makes it land; the
  smallest complete answer first, a sentence or two rather than a dense
  paragraph, then stopping and adding layers when asked, and never a wall of
  text; keeping it a conversation rather than a lecture, with no quizzes, no
  asking them to say it back, no pacing theatre, and none of the framing labels
  — the key insight, at its core, the part worth slowing down on, the tricky
  part, where it gets interesting; stopping where you would pause and letting
  them respond, and delivering cleanly with the offer at the end when nobody is
  there; showing rather than only telling by opening the diff, the code or the
  debugger; building a picture up diagram by diagram, each redrawing the last
  and adding one part so the reader watches the system assemble, with the
  worked example of drawing A to B, then redrawing with C, then the return
  edge, and a single all-at-once diagram named as a reference rather than
  teaching; matching the medium to the idea, a diagram for a flow or structure
  where labels carry the meaning and a rough spatial sketch with few short
  labels for layout, overlap or a before and after; and the whole of its
  writing guidance — plain spoken English as to a colleague, tight rather than
  terse, the concrete mechanism rather than a metaphor or a framing, short
  sentences with one or two commas and clauses split rather than piled up, one
  name per concept kept throughout, no mirror sentences and no tidy closers,
  and the reply being the explanation itself rather than a report about it.

Made generic, which is what the owner asked for. The original is built on top
of two other skills it invokes by name, and a kit skill carries what it needs
rather than depending on another being loaded (ADR 0009); here getting
oriented is part of the work, and where the reasons are the point that is
named as its own kind of digging without requiring a particular skill. Its
named image-generation tool is likewise described by what it produces rather
than by the tool.

One departure: the original keeps itself from being invoked on its own with
`disable-model-invocation: true`, which is not portable frontmatter (ADR 0009
and PRD 7.2: these run on purpose, never automatically). The description
carries that instead — the phrases that ask for it, and the note that answering
a question in passing is not this.
