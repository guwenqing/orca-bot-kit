# The kit trims what a Claude Code session is sent
Tier: 2 · Status: open

## Owner's words and dialog

- 2026-11-14 the owner's words, snapshot origin/2026-11-14-owner-words.md

The origin is the text of issue #751 (https://github.com/guwenqing/orca-bot-kit/issues/751), as it stood on 2026-11-14.

## Organized requirement

Shape Y of ADR 0055: the kit trims the tools and the built-in skills of a Claude Code session, keeps the rules and the charter in `AGENTS.md`, and gives the role again after a compaction. Part 1, a main text that the kit builds, is out of this request; the owner decides it later.

<!-- R1 from:2026-11-14-owner-words.md -->

### R1 The kit's default cut list

The kit MUST keep these tools and built-in skills of Claude Code out of every Claude Code session of a fleet, from the kit upgrade that ships this:

- the tools `Artifact`, `ArtifactComments`, `ArtifactData` and `DesignSync`;
- the skills `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `update-config`, `fewer-permission-prompts`, `init`, `keybindings-help` and `plugin-authoring`.

A user MAY keep any of them for one bot, by its name in that bot's `claude_keep` list in `bot.yaml`. `obk up` MUST say, once, what the upgrade cuts and how to keep one.

<!-- R2 from:2026-11-14-owner-words.md -->

### R2 The user's cut lists

A user MAY cut more Claude Code tools and built-in skills, by name: for every bot in a `claude_cut` list in `defaults.yaml`, and for one bot in a `claude_cut` list in its `bot.yaml`. A name in the bot's `claude_keep` list MUST win over every cut list. The tool `Workflow` and the skill `workflow-authoring` MUST go together or stay together: a cut or a keep of either one MUST apply to both, because without the skill Claude Code puts the skill's text into the tool's description. The kit MUST keep every other entry of the files it writes the cuts into. `obk health` MUST name each cut name that the installed Claude Code does not have.

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

Out: Part 1; the cuts of R1 and R2 and the role of R3 for Codex and Pi sessions, which these Claude Code switches and hooks do not reach (the R4 lines are in rule units that every session reads, Codex and Pi included, so they apply to all); the fleet's own rule lines and its own cut and keep lists, which Bot Father writes in the bots repo after this ships.
Assumed: Claude Code leaves a denied tool's text, and a skill that is off, out of the request it sends (checked on 2.1.325; ADR 0055).
