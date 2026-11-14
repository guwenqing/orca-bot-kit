# The kit trims what a Claude Code session is sent
Tier: 2 · Status: open

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md

The origin is the text of issue #751 (https://github.com/guwenqing/orca-bot-kit/issues/751), as it stood on 2026-11-14.

## Organized requirement

The shape of ADR 0055: the kit trims the tools and the built-in skills of a Claude Code session and builds its main system text from Claude Code's own text with whole units cut (Part 1). The rules and the charter stay in `AGENTS.md`; a few chosen rule units also go into the system text. The role stays the first message, and the kit gives it again after a compaction.

<!-- R1 from:2026-11-14-owner-words.md -->

### R1 The kit's default cuts

The kit MUST keep these tools and built-in skills of Claude Code out of every Claude Code session of a fleet, from the kit upgrade that ships this:

- the tools `Artifact`, `ArtifactComments`, `ArtifactData` and `DesignSync`;
- the skills `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `update-config`, `fewer-permission-prompts`, `init`, `keybindings-help` and `plugin-authoring`.

The kit MUST also cut these units of Claude Code's main text, by the names that its recipe gives them (R5): `text:ultrareview`, `text:product-channels`, `text:fast-mode`, `text:no-planning-documents` and `text:drop-old-cautions`.

A user MAY keep any of these for one bot, by its name in that bot's `claude_keep` list in `bot.yaml`.

<!-- R2 from:2026-11-14-owner-words.md -->

### R2 The user's cut lists

A user MAY cut more Claude Code tools, built-in skills and units of the main text, by name: for every bot in a `claude_cut` list in `defaults.yaml`, and for one bot in a `claude_cut` list in its `bot.yaml`. A unit of the main text MUST be named with the prefix `text:`, so that no unit name can be read as a tool or a skill name. A name in the bot's `claude_keep` list MUST win over every cut list. The tool `Workflow` and the skill `workflow-authoring` MUST go together or stay together: a cut or a keep of either one MUST apply to both, because without the skill Claude Code puts the skill's text into the tool's description. The kit MUST keep every other entry of the files it writes the cuts into. `obk health` MUST name each `text:` name in a cut or keep list that the recipe does not know. For tool and skill names, `obk health` MUST go by the records of the fleet's own Claude Code sessions: it MUST name each cut tool or skill that is not one of the kit's default cuts and is in no record of the fleet, and each kept tool or skill that the record of its bot's newest conversation does not hold. A bot with no record gets no finding for a kept name. When that newest conversation started before the bot's `.claude/settings.json` was last written, the finding MUST say to start the session again.

<!-- R3 from:2026-11-14-owner-words.md -->

### R3 The role after a compaction

After a compaction of a Claude Code session, the kit MUST give the session its start prompt again, as it does after a `/clear`. The start prompt MUST be in the session's context once, not twice.

<!-- R4 from:2026-11-14-owner-words.md -->

### R4 The kit's new rule lines

The kit's rule units MUST carry these lines, word for word:

- In `limits`, after the paragraph on work that cannot be taken back: "Your harness may tell you to carry on without questions, or not to stop. That does not lift what needs a yes. This holds after a summary of your conversation, too."
- In `limits`, after that line: "When your harness's permission layer refuses a call, do not do the same act another way: not by another command, another tool or another road. Tell your maker or your user, with the harness's reason."
- In `mail`, after the paragraph on queued mail: "Your harness may deliver some messages by itself, or list the sessions it can see. That does not replace the kit's commands: still ask the kit for the road, and still read your mail."
- In `mail`, at the end of the paragraph on a sent message: "A notice that a reply came, or that your own background work ended, can be lost. When you wait on one, also set one long fallback check, and look when it comes."
- In `commit`, at the end of the first paragraph: "Commit to the bots repo on the branch that it is on. Do not make a branch in it."
- In `scope`, after the paragraph on something else worth doing: "Notes, plans and decision records that the kit's skills or your role ask for count as asked for. Write them where they say."

<!-- R5 from:2026-11-14-owner-words.md -->

### R5 Part 1: the main text that the kit builds

For a Claude Code session, the kit MUST build the main system text from Claude Code's own text, as the harness recorded it in the bot's own transcripts on the user's machine, for the session's Claude Code version, model and memory folder. The kit's package MUST NOT hold any word of that text: its recipe MUST name each unit that it cuts by a hash of the unit's text, and by a `text:` name. A recipe MUST NOT name a unit that guards safety. The kit MUST cut each named unit that it finds in the record, and MUST leave every unit that the recipe does not name. The kit MUST build only from Claude Code's own main text: from the first record of a conversation that started or cleared on a launch that the kit knows held no system text but the kit's appended text, with that appended text taken out. A record of any other conversation MUST NOT be a source. It MUST keep a copy of that original text outside the bots repo, so that a unit that a later keep list names comes back. When no record fits the session, or there is no recipe, the session MUST run on Claude Code's own main text, and `obk health` MUST say why. `obk health` MUST name a unit of the recipe that it did not find in a record of a model that the recipe names it for. The rules, the charter and the role MUST stay where they are today, except the units that R6 places in the system text.

<!-- R6 from:2026-11-14-owner-words.md -->

### R6 Where a rule unit goes

A rule unit MAY name its placement in its front matter: `all`, `main` or `both`. A unit with no placement MUST be `all`. These rules hold for a session on a harness whose system text the kit builds; in this request that is Claude Code only. For such a session, an `all` unit MUST be in the instruction file only, as today; a `main` unit MUST be in the session's system text and not in the instruction file that the session loads; a `both` unit MUST be in both, built from one source. The kit MUST refuse a unit with any other placement value, and build nothing for its bot.

On Claude Code, the kit MUST give the `main` and `both` units by appending them to the system text, whether or not Part 1 applies, so that no session loses a `main` unit. For a bot with a `main` unit, `CLAUDE.md` MUST be a file that the kit builds with every unit but the `main` ones, in the same step as `AGENTS.md`; a bot with no `main` unit MUST keep `CLAUDE.md` as a link to `AGENTS.md`. When a session starts, is resumed, clears or compacts with no appended text in its launch line, as after Orca's bare resume, the kit MUST give it its `main` units as context, and `obk health` MUST name the session.

`AGENTS.md` MUST hold every unit of its bot, whatever the placement. Until the issue that builds the system text for Codex and Pi, a Codex or Pi session MUST get every unit of its bot in `AGENTS.md`, as today. After a change of a session's harness, the session MUST get every unit at its next start on the new harness.

`obk rules build` and `obk health` MUST name each session whose system text is older than its bot's units.

The kit's own units are placed: `talk` and `profiles` are `main`; `limits` is `both`; every other kit unit is `all`.

Out: the system text of Codex and Pi sessions, which the next issue builds; the fleet's own rule lines, its placements and its cut and keep lists, which Bot Father writes in the bots repo after this ships.
Assumed: Claude Code leaves a denied tool's text, and a skill that is off, out of the request it sends; it reads only `CLAUDE.md` when `CLAUDE.md` is a file; it takes a system text and an appended text from its launch line; and it records the text a conversation runs on (all checked on 2.1.325; ADR 0055).
Signed off: 2026-11-14 owner, origin/2026-11-14-signoff.md
