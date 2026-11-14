<!-- SP-1 note -->

# Change spec: the kit trims what a Claude Code session is sent

<!-- SP-2 note -->

The design is ADR 0055 (shape Y). This change spec holds the promises that go into section 6.4 of the PRD.

<!-- SP-3 note -->

## The trim

<!-- SP-4 rule serves:R1 serves:R2 builds-on:KIT-26 -->

- A Claude Code bot's sessions get no text for the tools and built-in skills that its cut lists name. The kit's default list holds the tools `Artifact`, `ArtifactComments`, `ArtifactData` and `DesignSync`, and the skills `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `update-config`, `fewer-permission-prompts`, `init`, `keybindings-help` and `plugin-authoring`. A user adds names in a `claude_cut` list, in `defaults.yaml` for every bot and in `bot.yaml` for one bot. A name in the bot's `claude_keep` list in `bot.yaml` wins over every cut list. `obk up` says once what an upgrade cuts and how to keep one, and `obk health` names each cut name that the installed Claude Code does not have. [decided by the owner, #751]

<!-- SP-5 approach builds-on:SP-4 -->

The kit writes a tool's cut as a `permissions.deny` entry with the tool's name, and a skill's cut as `"off"` under `skillOverrides`, in the bot's `.claude/settings.json`, where it already writes its hook and keeps every other entry. Orca's bare resume reads the same file, so it keeps the cuts. Claude Code then leaves the tool's text, and a paragraph that the tool adds to the main text, out of the request (ADR 0055, section 2).

<!-- SP-6 note -->

## The role after a compaction

<!-- SP-7 rule serves:R3 builds-on:KIT-26 -->

- After a compaction of a Claude Code session, the kit gives the session its start prompt again, as after a `/clear`. The start prompt is in the session's context once. [decided by the owner, #751]

<!-- SP-8 approach builds-on:SP-7 -->

The kit's SessionStart hook answers the source `compact` as it answers `clear`. After a compaction the first message is gone from the context, so the hook's text is the only copy (ADR 0055, section 3).
