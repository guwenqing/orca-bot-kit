# ADR 0026: The kit writes a bot's permission rules, and only after the user's yes

Date: 2026-09-26.
Status: superseded by [ADR 0036](0036-the-kit-writes-every-bots-default-permission-rules.md).
Decided by: the owner, on 2026-09-26, for a default set every bot gets, the user's yes before anything is written, and the kit's code as the only writer (#344); the architect, on 2026-09-26, for leaving an entry the kit did not write where it is and naming it in health, which the owner may overrule; the architect, on 2026-09-26, for the rules build writing the kit's path and the bots folder's path into a bot's rules, which changes #220's choice and which the owner may overrule. The default set's exact rules and where the yes is kept are developer-1's, for #344.

## Context

A bot in auto mode was stopped by the harness's own check for what the kit's
rules tell every bot to do. On kit-dev (Claude Code 2.1.283, 2026-09-26),
every `obk message check` and every read of a long message's body asked the
owner Yes/No, and the owner added allow rules to the bot's
`.claude/settings.json` by hand. Claude Code settles a matching allow rule
before its auto-mode check, and keeps narrow rules in auto mode while it
suspends broad ones such as `Bash(*)` (its permissions and auto-mode docs).

The owner, 2026-09-26: "the kit should init some default rules for the bot, so
that it can work more smoothly with auto mode"; "charter decides what are
needed, for safety you should ask user to allow it"; "I want the kit script
does the change, not llm runs the modification of file directly … to be
precise and to be likely to work".

The kit already writes `.claude/settings.json` in every bot folder for its hook
([ADR 0022](0022-kit-hooks-live-in-the-bot-folder.md)), and knows its own CLI
path and the bots folder, so it can spell exact rules.

## Decision

Every bot that runs on Claude Code is offered a default set of six rules,
spelled with the kit's real CLI and bots folder: its mail through the kit
(`message check`, `message send` and `message to`, each for this bots folder),
reading the long-message files beside the bots folder (`<bots>.messages/`),
and `git add` and `git commit`.

Nothing is written without the user's yes. `bot create`, `init`, `rules build`
and `up` list each default rule the bot has not been allowed, word for word,
with one command that allows them. The yes is kept in the bot's `bot.yaml`,
under `allow`, as the exact rule text, and only `obk bot change --allow` puts
it there. `rules build`, `up` and `bot change --allow` write what `allow` holds
into `permissions.allow` of the bot's `.claude/settings.json`, and nothing
else. A later change to the default set shows up as rules waiting again.

So that a bot runs its mail commands in exactly the form the rules allow, the
rules build writes the kit's own path, as a shell word, where a rule unit says
`"${OBK_CLI:-obk}"`, and the bots folder's path where it says `<bots>`. A bot's
`AGENTS.md` therefore names the CLI that built it and the folder it was built
in, and the next `up` or `rules build` from another CLI or another folder
rebuilds it. Skills are linked files, the same on every machine, and keep their
own wording (the architect, 2026-09-26).

The kit owns only the entries `allow` holds. Any other entry stays where it
is; `obk health` names it, and names an allowed rule the file lacks. The kit's
rules tell every bot, Bot Father included, not to write permission rules into
a settings file itself.

Codex's form of the same rules (#354) and rules for a charter's grants (#353)
are decided in their own issues.

## Alternatives considered

- **Writing the default set with no question.** Not chosen: the owner asked
  for the user's yes on every rule, the small default included.
- **Bot Father editing the settings file after the user's yes.** Not chosen:
  the owner wants the kit's code to write the exact text, not a model.
- **Keeping the yes in the settings file only.** Not chosen: the file is the
  harness's, holds the user's own entries too, and could not tell the kit's
  from theirs.
- **A harness-neutral form in `allow`.** Not chosen for now: Claude Code's rule
  text is exact and documented, and it is what the user is shown. The Codex
  slice decides how its form is made from it.
- **The kit taking out an entry it did not write.** Not chosen: the file is the
  user's as much as the kit's (PRD 6.3), as with the hook.
- **Keeping `"${OBK_CLI:-obk}"` in the rules and allowing that text as a
  seventh rule.** Not chosen: whether Claude Code approves a command whose
  program is a variable is not established, and the variable is the bot's to
  change in its own shell.
- **Leaving the mail lookup to the auto-mode check.** Not chosen: the bot would
  still be stopped, or not, by the check for what the kit's rules tell it to do.
- **The owner's broader `Bash(<cli> message:*)`.** Narrowed to the three
  commands and this bots folder, which is what the kit prints for a bot to run.

## Consequences

- Good: a bot reads and sends its mail and commits without the check stopping
  it, once the user has said yes, and the rules are exact.
- Good: the user sees every rule before it is written, and again when the kit's
  default set changes.
- A bot's rules are narrow on purpose. A command spelled differently from what
  the kit prints and its rules say, such as a relative bots folder or a mail
  command a skill spells its own way, does not match, and goes to the harness's
  check as before.
- This changes #220's choice, which was in the PRD and the tech notes and in no
  record: a bot's rules used to name the kit through `OBK_CLI`, so that
  `AGENTS.md` carried no install path. It now carries two machine paths, like
  the kit's hook beside it.
- The kit-dev bot's hand-added entries are named by health until they are
  allowed through `obk`.
- `git add` and `git commit` are allowed wherever the bot runs them, not only
  in the bots repo: Claude Code's docs give no way to scope a Bash rule to a
  folder.

## History

- 2026-09-26: recorded for #344 (slice A: Claude Code).
