# ADR 0055: The kit trims what a Claude Code session is sent

Date: 2026-11-14.
Status: proposed. Open until the owner signs the request `claude-session-trim` (requests/claude-session-trim: R1 to R4, and its change spec), which carries build steps 1 and 2 of this record. A GPT model reviews it, and the architect rules on it, before the owner signs (#751).
Decided by: nobody yet. #751 names the shape to try (X below). This record compares it with two others on checked facts and recommends Y (developer-751). The owner chooses the shape.

## Context

A Claude Code session of the kit runs on Claude Code's own system prompt and its full tool list. The kit adds its text beside that: the bot's `AGENTS.md` through the `CLAUDE.md` link, the start prompt as the first message, and the permission rules. A review of two architect sessions on 2026-11-14 found that much of Claude Code's text does nothing for a fleet session, that some of it pulls against the fleet's rules, and that some of it describes tools that the session does not have. #751 asks for one text that the kit builds, under three principles, as #751 states them: take out the parts of Claude Code's text that are not relevant to a fleet session, tool texts and built-in skills included; keep, largely, what Claude Code says about how to develop; and flag each disagreement between Claude Code's text and the kit's rules for the owner, settled in neither direction.

Probes of Claude Code 2.1.325 against a local stand-in for the API, with no call to Anthropic, gave the facts this record rests on. They are in the tech notes, section 2, "The system prompt and what each switch does". The part-by-part judgment of Claude Code's text quotes that text, so it stays out of this repo until the owner rules on it (#751, boundary).

## The candidates

- **X, the shape to try (#751).** One system text that the kit builds: the trimmed Claude Code text, then the common rules, then the charter, then the role. `AGENTS.md` is kept from loading, so nothing loads twice.
- **Y.** The kit's system text holds only the trimmed Claude Code text. The rules and the charter stay in `AGENTS.md`, which Claude Code loads through `CLAUDE.md`, as today. The role stays the first message. The kit's SessionStart hook, which sends it again after a `/clear` today, also sends it after a compaction.
- **Z.** The trimmed Claude Code text and the kit's own rule units in the system text; the user's fleet units and the charter in `AGENTS.md`.

In all three, the trim of tools and built-in skills is the same switches (section 2 of the decision).

| Checked fact or measure | X | Y | Z |
|---|---|---|---|
| Request size, architect (fence, characters; before: 124,821) | 74,026 | 73,418 | not measured; about Y |
| The saving, and where it comes from | 50,795: the switches, less the kit text that X adds | 51,403, all from the switches (the same tool list as X; no Part 1) | about Y |
| A changed rule reaches a running session | restart, then a compaction or a new conversation | at its next `/clear` or compaction, with no restart, as today | fleet units as Y; kit units as X |
| The role after a compaction | in the system text | sent again by the hook, once, after a build step (a probe hook, seen for `/compact` and for an automatic compaction) | as Y |
| Subagents get the rules and the charter | no (Claude Code's subagent text and the brief only) | yes, through `AGENTS.md` | the charter and the fleet units; not the kit units |
| The auto mode classifier sees the charter | the client-side classifier does not; the server-side check of the real API is not checked | yes, as today | yes |
| Orca's bare `claude --resume` | the kit's text, and `AGENTS.md` again (the exclusion is a launch flag) | each text once | the kit units twice |
| Needs the transcript record, a recipe and a version rule | yes | only for the Part 1 step | yes |
| Codex and Pi | `AGENTS.md` as today | `AGENTS.md` as today | a bot with sessions on two harnesses needs two forms of `AGENTS.md` |
| New mechanisms to get back what `AGENTS.md` gives today | four: exclusion, subagent text, classifier text, restart rule | none | three |

What X gives that Y does not: no checked difference. The rules in the system text, in place of the first user message, may be followed differently by the model; nothing here shows it either way, and Claude Code's own wrapper around `CLAUDE.md` already tells the model that those instructions override its defaults. The role in X needs no hook after a compaction; in Y the hook gives it once after a small build step (checked with a probe hook). The owner's whole read of one session's text is the same in both: Y's is built in reading order (Part 1, `AGENTS.md`, the role). No fact was found against Y.

## Decision (recommended: Y)

### 1. The order of the build

1. The trim of tools and built-in skills. In the fence it gives all of Y's saving, more than X's, and needs no record, no recipe of text and no restart rule.
2. The role after a compaction, through the kit's SessionStart hook.
3. The kit's new lines in its rule units, where the owner's answers to the disagreements add one (exact words signed by the owner). They need no Part 1.
4. The kit-built Part 1: decided as a question of its own, after the night probes and the first weeks of the trim (section 4).

### 2. The trim of tools and built-in skills

- A tool is cut by a `permissions.deny` entry with its name in the bot's `.claude/settings.json`. Claude Code then leaves the tool's text out of the request (checked). When the tool adds a paragraph of its own to the main text, the paragraph goes too (checked for Artifact). The entry is in the bot's file, not on the launch line, so Orca's bare resume keeps it. `--disallowedTools` does the same from the launch line, for a cut that is the session's own.
- A built-in skill is cut by `skillOverrides` with `"off"`, in the same file, as the kit already does for `auto-mode-setup` (#708).
- The Workflow tool and the `workflow-authoring` skill go together or stay together. Without the skill, Claude Code puts its text into the tool's description.
- `--disable-slash-commands` is not used: it also takes away the bot's own skills.
- An MCP server's tools: a deny of the server's name takes the tool names out; the server's own instructions stay. What removes the Chrome section and the claude.ai connectors is checked at night (section 9).

### 3. The role after a compaction

The kit's SessionStart hook already gives the start prompt again after a `/clear`. Today it does not do so after a compaction, so the role lives only in the summary, in the model's own words. The change: it sends the role on the source `compact` too. After a compaction the first message is gone from the context, and the hook fires once. So the role is in the context once (checked with a probe hook, for `/compact` and for an automatic compaction).

### 4. Part 1: the kit-built main text

Recommended: decide it after the night probes and the first weeks of the trim, not with them. No answer to a disagreement needs it: each disagreement has an option without it.

What it adds beyond the switches, on the architect's record: the Chrome section (4,107 characters, unless `--no-chrome` removes it), a model-tier paragraph of the Fable model (685), one bullet on a billed cloud review (498), and two bullets of the Environment section (326). That is about 1.5k, or 5.6k with the Chrome section, and about 14 sentences. More units come in only if the owner answers a disagreement by cutting one (the largest are two Fable-only sections of 1.6k and 1.7k).

Its machinery, if built:

- **Whose text ships: none.** Every Claude Code transcript records the system prompt that the conversation runs on, as a list of sections, with the version and the model. The kit reads the newest record of the harness's own text from the bot's own transcripts, for the same version, model and memory folder. The Memory section names the memory folder, so a record made before a change of that folder (#752) is not used.
- **The recipe names cuts by hash.** A unit is a whole section of the record or one bullet line in it. The recipe holds the sha256 of each unit it cuts, and no words. A unit that the recipe does not name stays. A test holds that no recipe holds a phrase, and that no safety unit is named.
- **The text reaches the session** by `--system-prompt-file`, from a file in the kit's prompts folder beside the bots repo, never in the bots repo. The snapshot stays on: it keeps the text through Orca's bare resume (checked). Part 1 changes only with a harness or kit upgrade; it reaches a running session after a restart and the next compaction. The fallback reaches a running session the same way: a launch with no text file gets the harness's own text, but a bare resume of a conversation keeps its recorded Part 1 until its next compaction (checked). So a session whose recipe stops applying runs on its old Part 1 until then; the restart and the compaction are one step, and `obk health` names a session that still waits for it.
- **The version rule.** Seen on this machine: four Claude Code versions in eight days. Candidates: (a) a recipe applies to its exact version only; cost: after each update the fleet runs on the harness's own main text until a kit release. (b) The newest recipe applies to its version and any newer one when every unit it names is found in the record; cost: a new unit of a new version stays in until a kit release, which is the safe direction. Chosen: (b). The main text differs by model (Fable 5.2 has sections that Opus 5.5 does not), so the recipe names its cuts for each model, and the rule counts only the cuts for the session's model. Any unit not found, no record for the version and model, or no recipe: the session gets the harness's own main text, and `obk health` says why.
- **Guards for the switches.** A tool name that the version does not have prints a warning, and the session starts (checked). A skill name that it does not have is ignored (checked). `obk health` compares the cut names with the tools of the record and names one that is gone, so a renamed tool is seen.

### 5. What a user sets

- **On at the upgrade, or a user turns it on.** (a) On for every user at the upgrade: smaller requests at once; cost: a tool that a user's bot relies on (a page through Artifact) is gone after an update, and the release notes and `obk up` must say so. (b) A user turns it on for a fleet: no surprise; cost: most users never turn it on. Recommended: (a) for the kit's own default cuts, and (b) for the rest, which is the user's list.
- **Two owners of the cut list.** A cut that rests on a kit unit, or on a thing that no session in a kit tab can use, is the kit's default: the Artifact tools, their skills `artifact-design`, `artifact-diagramming` and `artifact-capabilities`, and DesignSync (the kit's `limits`: publishing gets a yes), `update-config` and `fewer-permission-prompts` (the kit's `limits`: permission rules are the kit's to write), `init` (the kit builds `AGENTS.md`), `keybindings-help` and `plugin-authoring` (the terminal and the hooks are not the session's). A cut that rests on a fleet unit of this user's is the user's: SendFeedback (`mail-check`), the review skills and ReportFindings (`cross-review`; the kit's own `review` unit agrees with Claude Code there), PushNotification (`alert`), plan mode (`self-driven`), and the rest of the judgment's cuts.
- **One mechanism for the user's list and for each bot.** Candidates: (a) a list in `defaults.yaml` for every bot and in `bot.yaml` for one bot, as `rules` and `skills` are today, with a second list in `bot.yaml` that keeps one that the defaults cut; (b) a rule unit names the cuts that rest on it, in its front matter, so a bot that carries `mail-check` loses SendFeedback; (c) the session's `extra_args` with `--disallowedTools`, which exists today. (c) cannot keep what a default cuts and is written once per session. (b) ties each cut to its reason, but a cut that rests on no unit (a bot with no browser) has no home. Recommended: (a), as `claude_cut` in `defaults.yaml` and `bot.yaml`, and `claude_keep` in `bot.yaml` (the request's R1 and R2). It answers the per-bot verdicts (a research bot keeps the browser, kit-dev cuts `run`, `claude-code-guide` for some bots). AskUserQuestion follows the same lists: cut for every session by default, and kept by a bot that uses it. A cut per role would need the same list on a `temp_roles` option; it is left out until the owner asks for it.
- **Use before a cut.** A cut goes on a list only after each bot's calls of the tool or skill in the last 30 days are counted from its transcripts, by names and counts only. A bot that used it keeps it, and its list says so. The counts for this fleet are in the design work, not here.
- Each of these is a new setting a user can use, so each is the owner's to sign.

### 6. Codex and Pi

This decision is for Claude Code only. Y changes nothing in `AGENTS.md`, so Codex and Pi sessions keep reading it as today. Part 1's shape (the harness's own text from a record on the user's machine, a hash recipe of cuts) holds for a harness that lets a launch replace its base text and records the text it ran on. What Codex and Pi allow is studied separately (#751, boundary).

### 7. The memory folder (#752)

With Y the memory section of Claude Code's text stays as it is, so this decision needs nothing from #752. If Part 1 is built, it depends on #752: a record names the memory folder that its conversation ran with, and today every bot shares one folder. So the record is chosen by version, model and memory folder (section 4), and after #752 changes a bot's folder, the bot runs on the harness's own text until a conversation with the new folder is recorded.

### 8. The checks that a session still works

- Tests with fakes, no Claude Code text in any fixture: the settings the kit writes hold the cut names and keep every other entry; a recipe cuts only the units it names; an unknown unit stays; no recipe holds a phrase; no record, no recipe or a unit not found gives the harness's own text; the text file is outside the bots repo.
- A fenced probe for each Claude Code version the kit gets a recipe for: the request lacks the cut tools and skills; the role is in the context once after `/compact` and after an automatic compaction; a bare resume keeps the cuts.
- One live run at night, on the architect's go word, in a throwaway bots folder: a session reads its mail, commits, uses its skills, keeps its role after `obk session compact`, and auto mode lets it do a step that its charter allows. This is the only check of how the model acts.

### 9. Night probes (each a live run: night, backup, notice, the architect's go word)

A real throwaway session shows the parts that only the account has, in its own transcript record, with no fake API: what `--no-chrome` removes; what removes the claude.ai connectors and their instructions (`--strict-mcp-config`, a deny of the server's name); whether the Artifact skills go with the tool; and the `advisor` tool's text.

### 10. The build issues, after the owner signs

1. The tool and skill trim: the kit's default cuts, the user's list, the per-bot list, and what `obk up` and `obk health` say.
2. The role after a compaction, and the kit's new lines in its rule units.
3. Part 1, if the owner wants it after the trim: the record, the hash recipe, the version rule, the fallback.

## Alternatives considered

- **X, the shape to try.** Not recommended: on the checked facts it saves no more than Y, and it needs four new mechanisms to get back what `AGENTS.md` gives today. Its rule changes need a restart of each session, and this fleet's rules change several times a day.
- **Z.** Not recommended: it has X's costs for the kit's units, and a bot with sessions on two harnesses would need two forms of `AGENTS.md`.
- **Ship a trimmed copy of Claude Code's text in the package.** Not chosen: Anthropic's text in a public repo and package, stale with each harness version.
- **Capture the text by running the harness against a local stand-in for the API.** Not chosen: the transcript record gives the same text with no run.
- **Keep the harness's main text and append to it.** This is Y without Part 1; it is the result if the owner does not want Part 1.
- **Snapshot off.** Not chosen for Part 1: Orca's bare resume then falls back to the harness's own text.
- **`--disable-slash-commands`.** Not chosen: it takes away the bot's own skills.

## Consequences

- Good: each request is about 41% smaller (fence), and more on a real account. The text for tools a session does not use, and the tools that pull against the fleet's rules, are out.
- Good: rules, charter and role reach a session as they do today; subagents and auto mode see what they see today; no word of Claude Code's text is in the repo or the package.
- Bad: the cut list is a new setting with two owners. The owner decides each cut that rests on a disagreement.
- Bad: Claude Code's main text keeps the sentences that pull against the fleet's rules, unless the owner wants Part 1 and cuts their units.
- Revisit if: a live run shows that a session follows rules better from the system text; or Claude Code changes how it records the system text, loads `AGENTS.md`, or applies a deny to a tool's text.
  Confidence: high on what Claude Code sends, from the probes; not checked on how the model acts, which needs a real session.

## History

- 2026-11-14: proposed (#751).
- 2026-11-14: second draft after the architect's ruling: Y added and recommended; the build order changed; the version rule, the user's settings and the night probes added.
