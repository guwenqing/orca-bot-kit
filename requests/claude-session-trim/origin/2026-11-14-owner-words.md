Source: standard input
Fetched: 2026-11-14T18:33Z
SHA-256: c9e64cfdd77497560673eff868629cd22a9119473b6744528aefccdf41c4b5d3
---
[Snapshot of the text of issue #751 (https://github.com/guwenqing/orca-bot-kit/issues/751) as it stood on 2026-11-14. Three short quotations of Claude Code's own text are replaced by a description in square brackets, by the issue's own boundary: no Claude Code text in this repo.]

## What happens

A Claude Code session of the kit runs on Claude Code's own system prompt and on its full tool list. The kit puts its own text beside that: AGENTS.md, the start prompt and the permission rules. The kit's launch line passes none of Claude Code's flags for the system prompt or for the tool list (`src/launch.js`).

Four models reviewed the requests of two architect sessions of one fleet on 2026-11-14. Their findings, which I did not measure myself:

- Size. Claude Code's own text is about 155k to 230k characters in each request: about 18k of system text, about 106k of tool text, and the context. The kit's AGENTS.md is 27k. The reviews judged that 50k to 118k characters do nothing for the session.
- Text that pulls against the kit's rules. Examples:
  - a tool text that lets the session publish without being asked, where the rules ask for a yes first;
  - the harness's feedback tool, which the rules forbid;
  - built-in skills that edit `settings.json` by hand, where permission rules are the kit's to write;
  - built-in review routes through a subagent, where the rules ask for a review by another company's model;
  - [a sentence of SendMessage's text on how messages arrive; quotation left out] for SendMessage, where the kit has a mailbox and `obk message check`;
  - [a sentence of the Bash tool's text on git branches; quotation left out], where a bots repo is shared on main;
  - after a compaction, [the harness's own instruction for the next turn; quotation left out], and the role prompt is not given again.
- Text for tools that the session does not have, for example a browser section in a session with no browser tool.

What I checked: Claude Code 2.1.325 has `--system-prompt`, `--append-system-prompt`, `--tools`, `--disallowedTools`, `--strict-mcp-config`, `--disable-slash-commands`, `--exclude-dynamic-system-prompt-sections` and `--system-prompt-snapshot` (`claude --help`). Not checked: what each of them does to an interactive session in a tab.

## Intent

The system prompt of a session becomes one text that the kit builds: the trimmed text of the harness, and the common rules of the kit. Claude Code comes first. Codex and Pi come after it, in later issues.

The shape to try (decided on 2026-11-14): the charter of the bot and the role of the session go into that text too. The order is: the trimmed text of the harness, the common rules, the charter, the role. The design still shows what this shape costs against a text with no charter and no role in it, and the owner reads the whole text before any build.

Three principles hold for the text:

1. Take out the parts of Claude Code's text that are not relevant to a fleet session. This trim is important. It covers the tool texts and the built-in skills too: one that a fleet session does not use is a candidate for the trim.
2. Keep, largely, what Claude Code says about how to develop, as long as it works for a fleet session. Much of it is well made. This is not a new text from nothing.
3. Where Claude Code's text and the kit's rules disagree, flag the disagreement. Do not settle it quietly in either direction. The owner decides each one.

The rules that the kit adds on top need great care. Each rule unit that goes into the text is a decision: keep only what earns its place, and keep dated words of a user exact.

## What this issue delivers

A design, and no change to the kit's core. It delivers:

1. A judgment of Claude Code's own text, part by part: the system text, each tool, each built-in skill and command. For each part: keep, replace or cut, and the reason.
2. The list of disagreements between Claude Code's text and the kit's rules, each with both texts and the options. Nothing in this list is decided in the design.
3. The same judgment for the kit's own rule units: which earn their place in the text.
4. The shape, from more than one candidate: how the kit builds the text, where the text lives, how it reaches the session, what a user sets, and the order of its parts.
5. One whole text for one session, as the design would build it. The owner reads it before the kit builds a text for any session.
6. The checks that show that a session on the new text still works, and the cut into build issues.

## What the design must settle

- Whose text ships. Claude Code's text is Anthropic's, and this repo and the npm package are public. Say whether a candidate needs any of that text in the repo or in the package. Give at least one candidate that ships none of it and builds the text on the user's machine from the harness that is installed there.
- What a session loses when `--system-prompt` replaces the default text: the environment part, the memory part, how CLAUDE.md and skills load, hooks, auto mode, the text after a compaction, the prompts of subagents. Say which behaviours of the harness depend on words in its prompt.
- Which switch takes a tool's text out of the request, and which only blocks the call: `--tools`, `--disallowedTools`, a deny rule, `--disable-slash-commands`, `--strict-mcp-config`.
- A new harness version changes its text. Say how the kit's text follows it. Say what a session gets when the kit does not know the version. It must fail towards the harness's own text, not towards a text with a hole.
- `--system-prompt-snapshot` keeps the first text for every later request and resume. Say how a changed rule, charter or role reaches a running conversation, and what `obk rules build` and `obk restart` then do.
- The role and the charter after a compaction: they stay in force with no second send, and nothing loads twice (not through CLAUDE.md or AGENTS.md, and not through the start prompt).
- What a subagent gets. Say whether a subagent of the session still gets the rules when they move into the system prompt.
- The safety and security text of the harness stays in.
- One clear rule on when a session asks its user and when it decides for itself, for a standard development fleet. Give candidate texts. The owner chooses. The rule of a bot that runs today does not change through this design.
- The size of a request before and after, for one architect session and one developer session.

## Boundary

- Design only. No change under `src/`, `rules/`, `skills/`, `README.md` or `SETUP.md`. The PR holds the decision record and what the PRD needs.
- A GPT model reviews the design before anything is built. Then kit-dev/architect rules on it, and the owner signs it. I expect tier 1. The build issues come after that.
- Do not commit Claude Code's own text to this repo before the owner rules on it: not in a doc, a test or a fixture. Name a part by its heading or its tool name. Keep the part-by-part judgment with the quoted text in your work dir, and give its path to kit-dev/architect.
- A one-shot `claude -p` probe may run in the day, in your own work dir, so that it adds no project to a config file. A probe that opens a tab in Orca is a live run: at night, with a notice and the architect's go word.
- Core is core and test is test: no command, option or environment variable in the core only for tests.
- Codex and Pi are not in this issue. Do not choose a shape that cannot hold for them. Say what you know about how each takes its base instructions, and what you did not check.
- #752 (the memory folder) and the start prompt after a compaction touch the same launch line. Name what the design needs from them.

Filed by kit-dev/architect.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

