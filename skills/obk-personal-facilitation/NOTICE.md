<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

This skill is not a port of any one source, because no source has a skill for
this. Most of it comes from two places of our own, and two MIT skills
contribute a piece each; all four are credited below.

- **This repository's own earlier `personal-facilitation` skill**, written for
  the Codex desktop kit and removed when the tree was cleaned (`git show
  51a42a3:skills/personal-facilitation/SKILL.md`). Almost everything here is
  from it: reading the list the user already selected before creating another,
  a simple editable file where the bot keeps its work when there is none,
  asking about the location only when several existing lists make the choice
  unclear, capturing the user's wording with a concrete next action and only
  the deadline they actually gave, not inventing dates or priorities, offering
  a small practical ordering while separating the suggestion from the user's
  decision, updating the file while preserving unrelated entries and notes,
  modifying an existing entry rather than duplicating it when the user revises
  it, marking an item complete only when the user says so or the requested
  outcome has been verified, reading back the edited content, returning
  something the user can open along with the next actionable item, using the
  host's own scheduling for a reminder and verifying the task and cadence that
  was actually set, the rule that a line in a to-do file is not a scheduled
  reminder, and reporting a missing host capability instead of claiming
  something will run later.
- **The research pack's `grok-bot-lessons.md`**, our own read of the owner's
  knowledge base on how people run a personal helper bot. Two things come from
  there. "36 drafts queued, 0 sent" — finish every reversible step, stage the
  irreversible one, and stop at the line — recorded there from a community
  tutorial (BNK-2920 §09); the wording here is ours. And "do not automate an
  unclear process faster": save a routine only once a manual run has come out
  right (BNK-2921, and the official routine guidance summarised in the same
  file).

Three things are written differently from the old skill, on purpose:

- **No fixed path.** The old one named `work/todo.md`. PRD 7.1 assumes no way
  of working, so this says a plain text file a person can read and edit, where
  this bot keeps its own work, and leaves the rest to the project.
- **The vague item stays on the list.** The old skill said not to invent
  details and stopped there, which leaves it open whether an item nobody can
  act on gets dropped. Keeping it with a line saying what is missing is the
  only reading that does not lose something the person said.
- **Out of scope here.** The old skill's paragraph on local memory and
  contacting other bots is about how a bot is wired up, not a technique for
  keeping someone's list, and the kit decides that elsewhere. What is kept of
  it is the part that belongs to the list: a personal list is personal.

## Two more sources, and what the rest of them had

- **`mattpocock/skills`, `skills/in-progress/loop-me`** (MIT) — the only skill
  in the research pack's sources that is about a person's own life rather than
  their code. It designs workflows rather than keeping a list, so most of it is
  a different job, but two of its ideas are here. **Push right:** defer the
  point where you involve the person as far as it will go, and do the maximal
  work before it, so they are asked once, late, with everything prepared. And
  its **brief:** what a checkpoint hands back is decision-ready and points down
  to the thing itself, never the raw output. Its own framing of that — the user
  reads a brief, not a draft — is why this skill points at a draft instead of
  reproducing it. Also kept in spirit: "mandate nothing structural", which is
  PRD 7.1 in someone else's words.
- **Cursor `plugins`, `third_party/x/skills/x-chat`** — MIT, checked at
  `third_party/x/LICENSE`, "Copyright (c) 2026 Cursor", which is the licence
  for the vendored third-party directory rather than the repository root. A
  connector skill
  for someone's private messages, and the one place in the sources that draws
  the line this skill needs: the owner must approve outbound text unless they
  already told you to send or reply ("reply that I'll be there", "send them
  X"), and a vague "check my inbox" is not that. The specific-instruction
  against vague-instruction distinction is taken; nothing else from it is,
  since the rest is about one vendor's encrypted chat.

The rest of the corpus has no personal-assistant or to-do skill in it. Swept
for a list, reminders, scheduling, errands, capturing an intention, personal
memory or any non-engineering assistant behaviour: the rest of
`mattpocock/skills`, Cursor `pstack` and the other `cursor_plugins`,
`obra/superpowers` (all fifteen skills read), `anthropics/skills`,
`openai/skills`, `addyosmani/agent-skills`, `citypaul/.dotfiles` (fifty skills,
forty-eight of them about software), `forrestchang/andrej-karpathy-skills`,
`garrytan/gstack`, Cloudflare's security-audit skill, and Kent Beck's
repository. Four things came close enough that it is worth saying why they are
not here:

- `anthropics/skills`' `discernment-nudge` (Apache 2.0) is the nearest thing in
  any source to a general non-engineering assistant skill, and it is about
  something else: what to append after an answer the person will act on. Taking
  it would have made this a second skill wearing this one's name.
- `garrytan/gstack`'s `review/TODOS-format.md` is the only prescribed task-file
  format in the corpus: an H3 per item with five required fields and a P0 to P4
  scale. It is an engineering backlog, and PRD 7.1 leaves the user free in how
  they keep their own documents, so this skill asks for a file a person can
  edit by hand and prescribes nothing inside it.
- `garrytan/gstack`'s privacy gate strips sensitive personal entries before
  anything is rendered into a working context, and reports the count without
  the content. That is a design for a memory store, not a technique for keeping
  a list.
- Cloudflare's "trace derived copies" makes the point that data removed from
  one place survives in the copies made from it. It is a rule for auditing a
  product, and turning it into advice about a to-do list would be our inference
  rather than their rule.

## What an acceptance run changed

The skill was run against a realistic piece of personal admin — a list with
entries and notes already in it, a booking made by phone, a vague item with no
date, a request for a reminder and an email to draft — by a bot that had not
seen it written. Seven things come from what that found. They are kept to a
line each: they are our own observations rather than material from a source,
and the skill is meant to be very light, so they earn a sentence where a source
point earns its full substance.

- Its only outlet for missing information was a line written into the file,
  which the person may never open. Asking belongs in the reply.
- Marking a booking done hid the appointment date that had not arrived yet.
  The date is kept on the item; what counts as done is still the outcome they
  asked for, which is the old skill's rule.
- "Do not reorder their list quietly" read as forbidding action on an urgency
  the person had just stated out loud.
- In a list divided up by when things are due, a new undated item had nowhere
  to go that did not invent a timeframe. The skill asks about that case and
  only that case: on a flat list the end of it invents nothing.
- Setting a reminder and the person actually being reminded were treated as the
  same thing, and the third case — a scheduler exists and you may not reach it
  — had no answer.
- A task whose whole content is irreversible produced nothing but an annotated
  line.
- "Read back what the file says" cannot catch a line dropped by accident,
  because you read what you meant to write. Comparing against the old file can.

The owner's word on this skill is one line, at 2026-09-19T19:44:54 in the
research pack's session dialogue: "personal faccilitation a VERY LIGHT ONE."
The PRD carries it as decided, "very light to-do and daily help" (7.2). He said
nothing about what it should contain, so the content is the old skill's, the
two borrowed pieces, and what an acceptance run showed was missing. Light is
taken as his instruction about size, read against his standing one that light
is not fluffy.
