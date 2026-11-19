<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

This skill is not a port of any one source, because no source has a skill for
this. Most of it comes from two places of our own, and two MIT skills
contribute a piece each.

- **This repository's own earlier `personal-facilitation` skill**, written for
  the Codex desktop kit and removed when the tree was cleaned (`git show
  51a42a3:skills/personal-facilitation/SKILL.md`). Almost everything here is
  from it: reading the list the user already keeps before creating another, a
  simple editable file where the bot keeps its work when there is none, asking
  about the location only when several lists make the choice unclear, the
  user's wording with a concrete next action and only the deadline they gave,
  no invented dates or priorities, a practical ordering kept apart from the
  user's decision, preserving unrelated entries and notes, modifying an entry
  rather than duplicating it, marking complete only on the user's word or a
  verified outcome, returning the next actionable item, using the host's own
  scheduling for a reminder and verifying what was set, a line in a to-do file
  or a saved skill not being a scheduled reminder, and reporting a missing host
  capability instead of claiming something will run later.
  Revision: guwenqing/orca-bot-kit@51a42a3e61711b0f33b00482657499de9afee16e (the
  commit the `git show` above names)
- **The research pack's `grok-bot-lessons.md`**, our own read of the owner's
  knowledge base on running a personal helper bot. "36 drafts queued, 0 sent":
  finish every reversible step and stop at the irreversible one (BNK-2920 §09,
  the wording ours). Save a routine only once a manual run has come out right
  (BNK-2921); here scoped to a routine that does work, since a plain reminder
  has nothing to run by hand. The time zone and the end date in a routine's
  checklist.
  Revision: none (the kit's own research pack, not a published source)
- **`mattpocock/skills`, `skills/in-progress/loop-me`** (MIT): do the most you
  can before involving the person, so they are asked once, late; and hand back
  something decision-ready that points at the thing rather than reproducing it.
  Revision: mattpocock/skills@c55ee46073ed923f86ce59a5eb3b6d895095d1b7
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **Cursor `plugins`, `third_party/x/skills/x-chat`** (MIT, `third_party/x/
  LICENSE`, "Copyright (c) 2026 Cursor"): outbound text needs the person's
  approval unless they already said to send it ("reply that I'll be there"),
  and a vague "check my inbox" is not that.
  Revision: cursor/plugins@6ed0f7a9504f577d7529064103cecce9be7dfc5e
  (reconstructed: the research pack's 2026-09-20 clone the skills were built
  from; the revision actually read was not recorded)
- **Cursor `plugins`, `third_party/x/skills/x-api-mcp-guide`** (MIT, the same
  `third_party/x/LICENSE`): a yes covers the exact text the person saw, and any
  change needs a new yes, even when they asked for the change and the send
  together.
  Revision: cursor/plugins@d31c571c32dc9b176ef55ad88f5482c0a0464498 (read
  2026-11-19)

Written differently from the old skill, on purpose: no fixed path (PRD 7.1
assumes no way of working); a vague item stays on the list and is asked about,
rather than dropped; the old paragraph on local memory and contacting other
bots is left out, as wiring rather than list-keeping; and "read back the
edited content" became comparing against what was there before, because
reading your own version back cannot catch a line dropped by accident.

The rest of the research pack's sources have no personal-assistant or to-do
skill in them. The nearest were `anthropics/skills`' `discernment-nudge` (a
different job), `garrytan/gstack`'s engineering TODO format (PRD 7.1 prescribes
no document format) and its privacy gate for a memory store; none is taken.

From an acceptance run of the first version, by a bot that had not seen it
written: ask in the reply, not in a file; keep a date on an item marked done;
act on an urgency the person states; ask where an undated item goes only when
the list is divided by due date; setting a reminder is not the same as it
reaching them; a task with no reversible half still hands back what to do.

The owner's word on this skill is one line: a very light one (research-pack
dialogue, 2026-09-19 19:44). The PRD carries it as decided (7.2). He said
nothing about what it should contain, so the content is the old skill's, the
borrowed pieces and what an acceptance run showed, and the reasons are left
out of the body so it stays light without losing a technique.
