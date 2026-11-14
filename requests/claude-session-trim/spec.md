<!-- SP-1 note -->

# Change spec: the kit trims what a Claude Code session is sent

<!-- SP-2 note -->

The design is ADR 0055. This change spec holds the promises that go into sections 6.4 and 6.6 of the PRD.

<!-- SP-3 note -->

## The trim

<!-- SP-4 rule serves:R1 serves:R2 builds-on:KIT-26 -->

- A Claude Code bot's sessions get no text for the tools, built-in skills and units of the main text that its cut lists name. The kit's default list holds the tools `Artifact`, `ArtifactComments`, `ArtifactData` and `DesignSync`; the skills `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `update-config`, `fewer-permission-prompts`, `init`, `keybindings-help` and `plugin-authoring`; and the units `text:ultrareview`, `text:product-channels`, `text:fast-mode`, `text:no-planning-documents` and `text:drop-old-cautions`. A user adds names in a `claude_cut` list, in `defaults.yaml` for every bot and in `bot.yaml` for one bot; a unit of the main text is named with the prefix `text:`. A name in the bot's `claude_keep` list in `bot.yaml` wins over every cut list. The tool `Workflow` and the skill `workflow-authoring` go together or stay together: a cut or a keep of either one applies to both. `obk health` names each name in a cut or keep list that the installed Claude Code or the recipe does not know. [decided by the owner, #751]

<!-- SP-5 approach builds-on:SP-4 -->

The kit writes a tool's cut as a `permissions.deny` entry with the tool's name, and a skill's cut as `"off"` under `skillOverrides`, in the bot's `.claude/settings.json`, where it already writes its hook and keeps every other entry. Orca's bare resume reads the same file, so it keeps the cuts. Claude Code then leaves the tool's text, and a paragraph that the tool adds to the main text, out of the request (ADR 0055, section 2).

<!-- SP-6 note -->

## The role after a compaction

<!-- SP-7 rule serves:R3 builds-on:KIT-26 -->

- After a compaction of a Claude Code session, the kit gives the session its start prompt again, as after a `/clear`. The start prompt is in the session's context once. [decided by the owner, #751]

<!-- SP-8 approach builds-on:SP-7 -->

The kit's SessionStart hook answers the source `compact` as it answers `clear`. After a compaction the first message is gone from the context, so the hook's text is the only copy (ADR 0055, section 3).

<!-- SP-9 note -->

## The main text that the kit builds

<!-- SP-10 rule serves:R5 builds-on:KIT-26 -->

- A Claude Code session runs on a main system text that the kit builds from Claude Code's own text, as the harness recorded it in the bot's own transcripts, for the session's Claude Code version, model and memory folder. The kit's recipe names each unit that it cuts by a hash and a `text:` name, and holds no word of Claude Code's text; it never names a unit that guards safety. The kit cuts each named unit that it finds and leaves every other unit. With no fitting record, or no recipe, the session runs on Claude Code's own main text, and `obk health` says why; it also names a recipe unit that it did not find. [decided by the owner, #751]

<!-- SP-11 approach builds-on:SP-10 -->

The kit reads the newest `prompt_snapshot` record that fits, drops the record's boundary marker, which no request carries, cuts the named units, and writes the text to a file in its prompts folder beside the bots repo. The session gets it by `--system-prompt-file`. The snapshot stays on, so the text holds through Orca's bare resume until a compaction (ADR 0055, section 4).

<!-- SP-12 note -->

## Where a rule unit goes

<!-- SP-13 rule serves:R6 builds-on:SP-16 -->

- A rule unit may name its placement in its front matter: `all` (the default, and the value of a unit that names none), `main` or `both`. An `all` unit is in the instruction file only. A `main` unit is in the session's system text and not in its instruction file. A `both` unit is in both, from one source. Any other value is refused, and the kit builds nothing for that bot. On Claude Code the kit appends the `main` and `both` units to the system text, whether or not the main text is the kit's, so that no session loses a `main` unit. `AGENTS.md` holds every unit whatever its placement, and a Codex or Pi session gets every unit there until their own system text is built. A session whose harness changes gets every unit at its next start. When a session runs without the kit's appended text after a compaction, the kit gives it its `main` units again, and `obk health` names it; `obk rules build` and `obk health` name each session whose system text is older than its bot's units. The kit's `talk` and `profiles` units are `main`, its `limits` unit is `both`, and every other kit unit is `all`. [decided by the owner, #751]

<!-- SP-14 approach builds-on:SP-13 -->

The kit appends the placed units with `--append-system-prompt-file`, which Claude Code adds after its own main text or after the kit's (checked). At a compaction, the kit's SessionStart hook reads its parent process's launch line, which is the Claude Code process (checked), and gives the `main` units as context when the line has no appended text (ADR 0055, section 5).

<!-- SP-15 note -->

## Section 6.6, with `CLAUDE.md` built for a bot with a `main` unit

<!-- SP-16 rule serves:R6 changes:KIT-30 -->

- Each bot has one `AGENTS.md`, shared by all its sessions. It is per bot — the bot's identity — not a universal file. [decided]
- It is built from the bot's charter plus rule units: the kit's common rules, the user's rules, and the bot's own choices, with defaults that every bot gets. What the user wrote by hand is kept, and a conflict with the build is shown, never silently overwritten. [decided] → ADR 0013
- `CLAUDE.md` in the bot folder is a symlink to `AGENTS.md`, except in a Claude Code bot with a rule unit placed `main`: there it is a file that the kit builds with every unit but the `main` ones, in the same step as `AGENTS.md`, and `AGENTS.md` still holds every unit. [decided; the exception decided by the owner, #751]
- A Pi session starts from its bot's `AGENTS.md` too: Pi reads it in the bot folder, where the session's tab starts. Pi has no permission rules and no hooks, so the kit writes neither for Pi, and `rules build` and `up` say so for each bot with a Pi session: a Pi session runs as `dangerously-skip`, and the bot's allow list does not limit it. [decided by the owner, 2026-10-10, #547; slice 4 is #659]
- The kit imports the good rules from the owner's global rules file and carries them itself. It does not rely on any user-level rules file, and it does not depend on the owner's `agent-infra` repo, which goes away in the long run. The owner intends to remove his own user-level rules; to him only repo-level and bot-level rules make sense now. [decided]
- A short set of always-on rules lives in `AGENTS.md`; the depth lives in skills. No separate principles skill. [decided]
- A bot's charter says what it owns, what good looks like, and what it must ask about first. A bot acts alone only inside that written boundary. [decided in principle; charter fields proposed]
- Two plain defaults in the kit's rules: no silent fallback (when the model a session asks for is not available, the bot says so and asks; it never quietly switches), and role limits such as "read-only, does not modify" are a normal part of a charter. [decided]
