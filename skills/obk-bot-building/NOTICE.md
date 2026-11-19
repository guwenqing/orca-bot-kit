<!-- Attribution for the sources this skill was built from. Kept out of
     SKILL.md so it is not read into context on every use; it travels with
     the skill directory, which is what the licences require. -->

# Sources and licences

`obk-bot-building` reproduces no third-party text. What it took from outside
this kit, it took as an idea and wrote again in its own words, for the reason
given under "Ideas taken from material with no licence" below.

## The owner's own words

The charter is three questions because he settled it at three. His word on the
proposal that the interview happens once at a bot's creation and asks what the
bot owns, what good work looks like, and what it must ask about first, in the
research pack's session dialogue: "looks good for charter interview."

Two other lines of his shape this skill. On what a bot is allowed to do: he is
"building bot to allow agency by itself but in the boundary and contract we are
creating, not freely", which is why the limits section here reads as a boundary
to act inside rather than as a leash. His one-liner remark ("I expect to have
one liner the user can send to LLM, and then the rest is done by AI") was about
setup, not the interview, and is no longer used for it; the interview follows
his own grilling instruction instead (below).

On bringing in a session they already run: "yes the session history shall be
able to resume, i.e., resume an external session, the rest is best effort
migrated with llm capability", and, correcting a restatement of it, "as the
setup is done via llm, including future setup via the bot manager, the llm does
best effort to help user migrate". That is where "best effort, and say so
plainly" comes from.

## This kit's own design

The PRD and the ADRs carry the rest: the line-up suggestions and the
role-to-skills guidance (PRD 6.8, ADR 0019, which puts that table in the
management skill), a session's settings and the rule that the kit never
hardcodes a model id, the approval levels and that the widest one is used only
when the user asks for it in plain words, the two plain defaults that no
silent fallback happens and that a role limit such as "read-only, does not
modify" is a normal part of a charter (PRD 6.4 and 6.6), and pinning an online
skill source to a version with a word about what a source carrying scripts or
hooks means (PRD 6.7).

## Ideas taken from material with no licence

- **The Grok Bot pages**, docs.x.ai/grok-bot and x.ai/bot/marketplace, as the
  research pack's `grok-bot-lessons.md` gathers them.
  Read: 2026-09-19 (as recorded in grok-bot-lessons.md, which fetched them that
  day)

The research pack's `grok-bot-lessons.md` gathers how one hosted bot product is
run. Its material comes from a knowledge base and from that product's own
marketplace and documentation pages. No licence is attached to those pages, and
the pack's own caution records that the marketplace entries were summarised by
a fetch tool rather than read verbatim. So no text of theirs is reproduced
here, and none of it was read as text worth copying. What was taken is the
idea, restated:

- that a bot is a job somebody holds rather than a prompt that came out well,
  and is named after a job a person could hold;
- that the thing worth writing down is what it owns, what good looks like, and
  what it must not do without asking;
- that an interview at creation is what writes that down;
- that a bot an existing one could own the work of should not be created;
- that a role needing several unrelated verbs is more than one role, that the
  split goes by domain rather than by how much work there is, and that a
  specialist is worth adding only when a real bottleneck has shown up: a noisy
  shared context, a bot that cannot review its own work, or permissions that
  have diverged;
- that instructions have three lifetimes, the durable role, the one assignment
  and the reusable procedure, and that a one-off correction must not quietly
  become a rule.

## What was deliberately not taken

That source's creation interview fills a fixed list of about ten fields. This
skill asks three questions and stops. The owner settled the charter at three,
and the rest of what a bot needs is settings, which are not an interview.

Its bot-classification vocabulary is not here either; reviewing a fleet that
already exists is a different job and lives in `obk-fleet-review`.

## Where a skill is named, and the room of the listing (#823)

The two failures of a skill, and the section "Name each skill at the step
where it applies", come from issue #823 and from these, each read on
2026-11-18. What is taken is a fact or an idea, written again in our own
words; no text of theirs is reproduced.

- **Claude Code's documentation on skills**,
  https://code.claude.com/docs/en/skills: until a skill is used, only its name
  and description are in context; the listing gets 1% of the model's context
  window, drops the descriptions of the skills invoked least first, and caps
  each entry at 1,536 characters; and its part on a skill that does not
  trigger.
  Read: 2026-11-18 (the page as Markdown; it shows no date)
- **Claude Code's documentation on subagents**,
  https://code.claude.com/docs/en/sub-agents: a subagent starts fresh, without
  its maker's conversation or the skills its maker invoked, and an agent
  definition can preload a skill with its `skills` field.
  Read: 2026-11-18 (the page as Markdown; it shows no date)
- **Codex's documentation, "Build skills"**,
  https://learn.chatgpt.com/docs/build-skills, where
  developers.openai.com/codex/skills redirects: the list holds each skill's
  name, description and path, uses at most 2% of the context window, shortens
  descriptions first and can leave skills out; and Codex reads the whole
  `SKILL.md` when it picks a skill.
  Read: 2026-11-18 (the page shows no date)
- **earendil-works/pi**, `packages/coding-agent/docs/skills.md`: Pi puts each
  skill's name, description and path in the system prompt, the model reads
  `SKILL.md` when a task matches, and a model can fail to load a relevant
  skill. MIT.
  Revision: earendil-works/pi@5a14e69c067d40dfbff4f2fff7d3b34c897e2dc9
  (main, read 2026-11-18)
- **anthropics/skills**, `skills/skill-creator/SKILL.md`: Claude tends to
  "undertrigger" a skill, not using it where it would help, and consults a
  skill only for a task it cannot easily do by itself. Apache 2.0; the idea is
  taken, not the text.
  Revision: anthropics/skills@e4bb5d960d87126ff3b3a8af1a104b7db67560ba
  (main, read 2026-11-18)
- **Vercel, "AGENTS.md outperforms skills in our agent evals"**,
  https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals,
  published 2026-01-27: with no instruction the skill was never invoked in 56%
  of the cases, with an instruction in 95% or more, and an order to invoke the
  skill first did worse than one to look at the project first and then invoke
  it. That is why a skill is named at its step and not in a general order.
  Read: 2026-11-18 (the post is dated 2026-01-27)

## Sources that need no third-party notice

Everything above is either this kit's own design, the owner's own words, a
fact or an idea restated in our own words from a source's documentation, or an
idea restated in our own words from material that carries no licence. Nothing
in this skill reproduces a third party's text, so there is no permission notice
to pass on. See [LICENSES.md](LICENSES.md).

## What the re-validation changed (#156)

- The charter questions are asked together, each with a drafted answer, not
  one at a time: the owner asked to be asked three questions at a time with a
  recommended answer (research-pack dialogue, 2026-09-19 13:24, with matt's
  grilling loaded), and
  his usage review complains of one question per turn.
- The answer handed back is the roster card PRD 6.8 decides (name, harness,
  model and effort, a two-line charter, one hard limit).
- The skills for each role are named, since ADR 0019 puts that choice in the
  management skill.
- What the command line does and does not do, checked against `obk --help`:
  `obk skills fetch` was missing; a charter, settings or list change is an
  edit plus `obk rules build` or `obk skills build`; pausing or retiring has
  no command. Each management action is committed (PRD 6.10). Issue #158 later
  gave changing, pausing and retiring their commands, and the hand edit is
  left for the special case, said so.
- A change of model, effort or approval reaches a session only by `obk
  restart`, on the user's word, and a whole-fleet restart is done from the ops
  tab (PRD 6.5).
- Bringing in a session: the outside id goes into the book by hand, and a
  resume across folders is to be tried before it is promised.
- Cut: a paragraph restating the opening, and two sentences of framing.
- Memory per bot is the owner's decision of 2026-09-23 (issue #211): a bot may
  turn on its harness's memory for itself, since the owner's global setting is
  off. The three Claude Code keys, and that without `autoMemoryDirectory` every
  bot in the repo shares one memory, were measured live and are in the tech
  notes; Codex's memories are the user's and cannot be one bot's.
