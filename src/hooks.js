// The kit's own hook, in the bot's folder and nowhere else (ADR 0022).
//
// Both harnesses read a hooks file out of the folder a session starts in, and
// every session starts at its bot home, so the bot folder is where the kit's
// hook goes: versioned with the bot, and never in the user's own settings,
// which other tools already fight over.
//
// The two files hold the same JSON shape and the kit asks each for the same
// one event. Proved live on 2026-09-20 (Claude Code 2.1.278, Codex 0.155.1): a
// hook in each file runs, is handed the session id on stdin, and can answer
// with text the session then has (tech notes, sections 2 and 3).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { leadsOutside } from './bot.js';
import { ownCli, shellWord } from './launch.js';

/** Where each harness reads a project's hooks, inside the bot home. */
const HOOK_FILE = { claude: '.claude/settings.json', codex: '.codex/hooks.json' };

/** The hooks file `harness` reads in the bot at `home`. */
export const hooksFileOf = (home, harness) => path.join(home, HOOK_FILE[harness]);

/**
 * The one thing the kit asks to be told: a session beginning. Both harnesses
 * report it whenever a session starts, resumes or is begun again by the user —
 * Claude Code's `/clear` and Codex's `/new` — and hand over the id it is
 * running as, which is all the book needs.
 */
const EVENT = 'SessionStart';

/** How long the harness gives the hook before it goes on without it. */
const TIMEOUT = 10;

/**
 * What the hook runs: the CLI that wrote it, by its own path, so the session
 * reports to the kit that set it up and not to whatever `obk` PATH finds in the
 * harness's shell (#220). `|| true` and a quiet stderr because a hook must never
 * disturb the session it fires in (ADR 0022): a kit that is not there, or a book
 * that cannot be written, leaves the session alone and the health check finds
 * the stale book later.
 */
export const hookCommand = (bots, bot, cli = ownCli()) =>
  `${shellWord(cli)} session record --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/**
 * Claude Code's second kit hook: after a native `SendMessage`, a warning when
 * it went outside the bots folder (ADR 0032). Claude Code only, since Codex has
 * no native messaging.
 */
const SENT_EVENT = 'PostToolUse';
const SENT_MATCHER = 'SendMessage';

/** What the send hook runs, by the kit's own path, as `hookCommand` does. */
export const sentCommand = (bots, bot, cli = ownCli()) =>
  `${shellWord(cli)} session sent --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/**
 * Claude Code's third kit hook: at each turn end, it tells the session once
 * about fleet mail the kit sent it that is still unread (#509, ADR 0035).
 * Claude Code only: on Codex a new hook entry puts every session on "Hooks
 * need review", and that waits for #511. It asks Orca only when the kit's hint
 * holds mail for the session, and gives Orca at most ten seconds of its thirty.
 */
const MAIL_EVENT = 'Stop';
const MAIL_TIMEOUT = 30;

/** What the mail hook runs, by the kit's own path, as `hookCommand` does. */
export const mailCommand = (bots, bot, cli = ownCli()) =>
  `${shellWord(cli)} session mail --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/**
 * Codex's second kit hook: after each command its shell tool ran, outside
 * Codex's sandbox, it decides the mail nudges a send in that command could not
 * (#350, ADR 0034). Codex only, since only Codex runs its commands where `ps`
 * does not start. It types into another session's tab, which takes Orca a few
 * seconds a nudge, so it is given longer than the others.
 */
const NUDGE_EVENT = 'PostToolUse';
const NUDGE_MATCHER = 'Bash';
const NUDGE_TIMEOUT = 30;

/** What the nudge hook runs, by the kit's own path, as `hookCommand` does. */
export const nudgeCommand = (bots, bot, cli = ownCli()) =>
  `${shellWord(cli)} session nudge --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/**
 * Codex's third kit hook: at each turn end, the session's thread is named after
 * its bot and session, so its tab says which it is (#480). Async, so the turn
 * ends without waiting on it: it waits for the session to be idle, up to 30 s,
 * then types and confirms. A naming took 73 s live, each character waiting on
 * a look through Orca's gate, and a hook stopped partway would leave half the
 * command in the input line, so the timeout leaves room to spare.
 */
const NAME_EVENT = 'Stop';
const NAME_TIMEOUT = 300;

/** What the naming hook runs, by the kit's own path, as `hookCommand` does. */
export const nameCommand = (bots, bot, cli = ownCli()) =>
  `${shellWord(cli)} session name --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

/**
 * Make sure the bot at `home` has the kit's SessionStart hook for `harness`.
 * Returns the file it wrote, relative to the bot home, or undefined when the
 * file already said this.
 *
 * The file is the user's as much as the kit's — it is where their own project
 * settings for that harness live — so everything else in it is kept, and only
 * the kit's own entry is written (PRD 6.3).
 */
export function installHook(home, harness, { bots, bot }) {
  const file = path.join(home, HOOK_FILE[harness]);
  const away = outside(home, file);
  if (away !== undefined) throw new Error(away);
  const settings = readSettings(file);

  const mine = { type: 'command', command: hookCommand(bots, bot), timeout: TIMEOUT };
  // The kit's own entry is put right where it already sits, and nothing else in
  // the file is the kit's to move: a second run adds nothing, a changed bots
  // path is corrected rather than doubled, an entry under an event the kit no
  // longer asks about is taken out, and a hook of the user's beside the kit's
  // stays where they put it.
  const started = withKitHook(settings.hooks, file, mine);
  const wanted = { ...settings, hooks: toolHooksOf(harness, bots, bot).reduce(withToolHook, started) };

  // Compared as documents, not as text: how the user laid their file out is
  // theirs, and a run that changes nothing writes nothing.
  if (isDeepStrictEqual(settings, wanted)) return undefined;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(wanted, null, 2)}\n`);
  return HOOK_FILE[harness];
}

/**
 * Whether the kit's hook is in place for one harness, and what to say when it
 * is not: `{ where, says }`, or nothing when the file already holds it.
 *
 * The same question `installHook` asks, without the writing. It matters more
 * than it looks: the hook is the whole of how the book learns which
 * conversation a session is running as (ADR 0012), and when it is not there
 * nothing else says so — the book simply stops being true.
 */
export function hookTrouble(home, harness, { bots, bot }) {
  const file = path.join(home, HOOK_FILE[harness]);
  const stale = `Until it is there, nothing tells the book which conversation this bot's ${harness} sessions are running as, and the book goes stale.`;

  const away = outside(home, file);
  if (away !== undefined) return { where: file, says: `${away} ${stale}` };

  let wanted;
  let settings;
  try {
    settings = readSettings(file);
    // The hook in the file is judged by what it runs, not by whether this is
    // the install that wrote it. A bot made before the kit named itself by path
    // runs the bare `obk`, and one another install wrote runs that install: both
    // still reach a kit, and the next `obk up` writes this one's. So the line is
    // checked against the program already in it, and only one that names a CLI
    // that is not there any more is wrong — `|| true` would keep that quiet, and
    // the book would stop being true with nothing to say why.
    const running = kitProgramIn(settings);
    if (running !== undefined && running !== BARE && !existsSync(running)) {
      return {
        where: file,
        says: `${file} holds the kit's session hook, but it runs ${running}, which is not there any more. ${stale} obk up puts back one that runs the kit you have.`,
      };
    }
    const program = running ?? ownCli();
    wanted = { ...settings, hooks: withKitHook(settings.hooks, file, { type: 'command', command: hookCommand(bots, bot, program), timeout: TIMEOUT }) };
    // The harness's other hooks are each judged on their own: the session hook
    // may be right while the warning after a native message (ADR 0032), the
    // nudge a Codex sender left (ADR 0034), or the naming of a Codex thread
    // (#480) is missing.
    if (isDeepStrictEqual(settings, wanted)) {
      for (const tool of toolHooksOf(harness, bots, bot)) {
        const toolRunning = programIn(settings, tool.pattern);
        const what = tool.matcher === undefined ? `${tool.event} hook` : `${tool.event} hook for ${tool.matcher}`;
        // One that runs a kit no longer there is as quiet as a missing one:
        // `|| true` hides it (#451 review).
        if (toolRunning !== undefined && toolRunning !== BARE && !existsSync(toolRunning)) {
          return {
            where: file,
            says: `${file} holds the kit's ${what}, but it runs ${toolRunning}, which is not there any more, so ${tool.missing}. obk up puts back one that runs the kit you have.`,
          };
        }
        const withTool = { ...settings, hooks: withToolHook(settings.hooks, toolHookOf(tool.kind, bots, bot, toolRunning ?? program)) };
        if (!isDeepStrictEqual(settings, withTool)) {
          return {
            where: file,
            says: `${file} does not hold the kit's ${what}, without which ${tool.missing}. obk up puts it back.`,
          };
        }
      }
    }
  } catch (error) {
    return { where: file, says: `${error.message} ${stale}` };
  }

  if (isDeepStrictEqual(settings, wanted)) return undefined;
  return {
    where: file,
    says: `${file} does not hold the kit's session hook, and ${harness} reads this bot's hooks from it. ${stale} obk up puts it back.`,
  };
}

/**
 * What to say about a hooks file that a link takes out of the bot folder, or
 * undefined when it stays in. The kit writes its hook in the bot folder and
 * nowhere else (ADR 0022); through a link like that it would be writing the
 * user's own settings, so it does not, and says why.
 */
function outside(home, file) {
  const real = leadsOutside(home, file);
  if (real === undefined) return undefined;
  return `${file} leads outside the bot folder, to ${real}, through a link, and the kit writes its session hook only inside the bot folder. Replace the link with a file of the bot's own, then run the command again.`;
}

/**
 * The file's hooks with the kit's own entry where it belongs and everything else
 * as the user left it.
 *
 * The kit owns one entry, not the group it sits in. A group is the user's: it
 * carries their other hooks and its own settings, and the kit's entry is only
 * one of the things in it. So the kit's entry is written in place where one is
 * already there, taken out where the kit no longer asks about that event, and
 * added on its own only when the file has none. A group the kit empties goes,
 * and an event left with no groups goes with it; a group that still has the
 * user's hooks stays, whatever the kit took out of it.
 *
 * Anything under `hooks` that is not a mapping of events, or an event that is
 * not a list of groups, is theirs and is left alone.
 */
function withKitHook(hooks, file, mine) {
  if (hooks === undefined) return { [EVENT]: [{ hooks: [mine] }] };
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    // Whatever this is, it is theirs, and writing the kit's hook here would
    // write over it. Better to say so than to take it away.
    throw new Error(`${file} has a hooks entry that is not a mapping of events, and the kit's session hook goes in there. Fix it or move it aside, then run the command again.`);
  }

  // One entry of the kit's, and only one: a file that somehow holds two keeps
  // the first and loses the rest.
  let placed = false;
  const events = Object.fromEntries(Object.entries(hooks).flatMap(([event, groups]) => {
    if (!Array.isArray(groups)) return [[event, groups]];

    const kept = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];

      const entries = group.hooks.flatMap((hook) => {
        if (!isKitHook(hook)) return [hook];
        if (event !== EVENT || placed) return [];
        placed = true;
        return [mine];
      });
      return entries.length === 0 ? [] : [{ ...group, hooks: entries }];
    });
    return kept.length === 0 ? [] : [[event, kept]];
  }));

  if (placed) return events;
  return { ...events, [EVENT]: [...(events[EVENT] ?? []), { hooks: [mine] }] };
}

/** Each harness's kit hooks beside its session hook, as `toolHookOf` gives each. */
const toolHooksOf = (harness, bots, bot, cli = ownCli()) =>
  (harness === 'claude' ? ['sent', 'mail'] : ['nudge', 'name']).map((kind) => toolHookOf(kind, bots, bot, cli));

/**
 * One of the kit's hooks beside its session hook: Claude Code's after a native
 * `SendMessage` (`sent`, ADR 0032), Codex's after its shell tool (`nudge`,
 * ADR 0034), and Codex's at a turn end (`name`, #480). The entry, where it
 * goes, how the kit knows its own, and what is lost without it.
 */
function toolHookOf(kind, bots, bot, cli = ownCli()) {
  if (kind === 'mail') {
    return {
      kind,
      event: MAIL_EVENT,
      pattern: KIT_MAIL,
      mine: { type: 'command', command: mailCommand(bots, bot, cli), timeout: MAIL_TIMEOUT },
      missing: 'a Claude session busy when fleet mail came is never told about it at the end of its turn, and nothing is typed into its tab either (#509)',
    };
  }
  if (kind === 'name') {
    return {
      kind,
      event: NAME_EVENT,
      pattern: KIT_NAME,
      mine: { type: 'command', command: nameCommand(bots, bot, cli), timeout: NAME_TIMEOUT, async: true },
      missing: "a Codex session's thread is never named after its bot and session, and its tab shows a topic Codex made up instead (#480)",
    };
  }
  if (kind === 'sent') {
    return {
      kind,
      event: SENT_EVENT,
      matcher: SENT_MATCHER,
      pattern: KIT_SENT,
      mine: { type: 'command', command: sentCommand(bots, bot, cli), timeout: TIMEOUT },
      missing: 'a session is never warned when its native message goes outside this bots folder (ADR 0032)',
    };
  }
  return {
    kind,
    event: NUDGE_EVENT,
    matcher: NUDGE_MATCHER,
    pattern: KIT_NUDGE,
    mine: { type: 'command', command: nudgeCommand(bots, bot, cli), timeout: NUDGE_TIMEOUT },
    missing: "mail a session sends from inside Codex's sandbox never tells a receiver the kit could not see from there, such as a Claude session busy with a command (ADR 0034)",
  };
}

/**
 * The hooks with the kit's tool hook in a group of its event matched to its
 * tool (or with no matcher, for one that has none), and everything else as the
 * user left it, as `withKitHook` keeps the session hook: one entry of the
 * kit's, written in place where it already sits in such a group, taken out of
 * anywhere else, and added in a group of its own when there is none. A group
 * the kit empties goes.
 */
function withToolHook(hooks, { event: wantedEvent, matcher, pattern, mine }) {
  let placed = false;
  const events = Object.fromEntries(Object.entries(hooks).flatMap(([event, groups]) => {
    if (!Array.isArray(groups)) return [[event, groups]];
    const kept = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const entries = group.hooks.flatMap((hook) => {
        if (programOf(hook?.command, pattern) === undefined) return [hook];
        if (event !== wantedEvent || group.matcher !== matcher || placed) return [];
        placed = true;
        return [mine];
      });
      return entries.length === 0 ? [] : [{ ...group, hooks: entries }];
    });
    return kept.length === 0 ? [] : [[event, kept]];
  }));
  if (placed) return events;
  const group = matcher === undefined ? { hooks: [mine] } : { matcher, hooks: [mine] };
  return { ...events, [wantedEvent]: [...(events[wantedEvent] ?? []), group] };
}

/** The program a command of the kit's of this pattern runs, unquoted, or undefined for any other command. */
function programOf(command, pattern) {
  const found = typeof command === 'string' ? pattern.exec(command) : null;
  if (found === null) return undefined;
  const program = unquoted(found[1]);
  return isKitCli(program) ? program : undefined;
}

/** What the kit's hook of this pattern in these settings runs, or undefined when there is none. */
function programIn(settings, pattern) {
  for (const groups of Object.values(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const program = programOf(hook?.command, pattern);
        if (program !== undefined) return program;
      }
    }
  }
  return undefined;
}

/**
 * The kit's own hook entry, wherever it sits and whatever sits beside it: a
 * command of exactly the shape `hookCommand` writes, for any bots folder and
 * bot, run by a kit — the bare `obk` a bot made before #220 still has, this
 * install, or another — so an entry written before the folder moved or the kit
 * changed is still the kit's, and is rewritten in place rather than joined by a
 * second. A line of the user's that only mentions the command, or runs it with
 * a program of their own, is theirs (PRD 6.5).
 */
const isKitHook = (hook) => kitProgramOf(hook?.command) !== undefined;

/** One word as `shellWord` writes it: bare, or single-quoted with `'\''` inside. */
const WORD = String.raw`(?:[A-Za-z0-9,._+:@%/=-]+|'(?:[^']|'\\'')*')`;
const KIT_HOOK = new RegExp(String.raw`^(${WORD}) session record --bots ${WORD} --bot ${WORD} 2>/dev/null \|\| true$`);
const KIT_SENT = new RegExp(String.raw`^(${WORD}) session sent --bots ${WORD} --bot ${WORD} 2>/dev/null \|\| true$`);
const KIT_NUDGE = new RegExp(String.raw`^(${WORD}) session nudge --bots ${WORD} --bot ${WORD} 2>/dev/null \|\| true$`);
const KIT_MAIL = new RegExp(String.raw`^(${WORD}) session mail --bots ${WORD} --bot ${WORD} 2>/dev/null \|\| true$`);
const KIT_NAME = new RegExp(String.raw`^(${WORD}) session name --bots ${WORD} --bot ${WORD} 2>/dev/null \|\| true$`);

/**
 * Whether a hook entry is one of the kit's own as this kit writes it: a
 * command of exactly a shape the kit writes, run by `cli`, the kit running now
 * (#506). One that runs some other program, even another `obk`, is not.
 */
export const runsThisKit = (hook, cli = ownCli()) =>
  hook?.type === 'command' && [KIT_HOOK, KIT_SENT, KIT_NUDGE, KIT_NAME].some((pattern) => programOf(hook.command, pattern) === cli);

/** The program a bot made before the kit named itself by path runs. */
const BARE = 'obk';

/**
 * Whether a program is a kit: the bare name, an install's `obk` wherever it
 * lives, or a checkout's `src/cli.js` — the only two ways `ownCli` is reached.
 */
const isKitCli = (program) => path.basename(program) === BARE || program.endsWith('/src/cli.js');

/** The program a hook command of the kit's runs, unquoted, or undefined for any other command. */
function kitProgramOf(command) {
  const found = typeof command === 'string' ? KIT_HOOK.exec(command) : null;
  if (found === null) return undefined;
  const program = unquoted(found[1]);
  return isKitCli(program) ? program : undefined;
}

/**
 * What the kit's hook in these settings runs, as a path or the bare name, or
 * undefined when there is none. Read back out of its shell quoting, so it can be
 * looked for on disk.
 */
function kitProgramIn(settings) {
  for (const groups of Object.values(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const program = kitProgramOf(hook?.command);
        if (program !== undefined) return program;
      }
    }
  }
  return undefined;
}

/** A word as `shellWord` wrote it, read back to what it stands for. */
const unquoted = (word) => (word.startsWith("'") ? word.slice(1, -1).replaceAll(`'\\''`, "'") : word);

/**
 * What the file says, or nothing when there is no file yet. A file the kit
 * cannot read as JSON is the user's, and guessing at it would lose what they
 * wrote, so the command says so and writes nothing.
 */
export function readSettings(file, what = "the kit's session hook") {
  if (!existsSync(file)) return {};

  const parsed = parse(readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not readable as JSON, and ${what} goes in it. Fix it or move it aside, then run the command again.`);
  }
  return parsed;
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
