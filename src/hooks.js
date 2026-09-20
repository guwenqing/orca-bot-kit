// The kit's own hook, in the bot's folder and nowhere else (ADR 0010).
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

import { shellWord } from './launch.js';

/** Where each harness reads a project's hooks, inside the bot home. */
const HOOK_FILE = { claude: '.claude/settings.json', codex: '.codex/hooks.json' };

/**
 * The one thing the kit asks to be told: a session beginning. Both harnesses
 * report it whenever a session starts, resumes or is begun again by the user —
 * Claude Code's `/clear` and Codex's `/new` — and hand over the id it is
 * running as, which is all the book needs.
 */
const EVENT = 'SessionStart';

/** How long the harness gives the hook before it goes on without it. */
const TIMEOUT = 10;

/** The kit's own hook among whatever else the user keeps in the file. */
const KIT_COMMAND = 'obk session record';

/**
 * What the hook runs. `|| true` and a quiet stderr because a hook must never
 * disturb the session it fires in (ADR 0010): a kit that is not installed, or a
 * book that cannot be written, leaves the session alone and the health check
 * finds the stale book later.
 */
export const hookCommand = (bots, bot) =>
  `${KIT_COMMAND} --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`;

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
  const settings = readSettings(file);

  const mine = { hooks: [{ type: 'command', command: hookCommand(bots, bot), timeout: TIMEOUT }] };
  // Every entry of the kit's comes out first, wherever in the file it sits, and
  // one goes back in: a second run adds nothing, a changed bots path is
  // corrected rather than doubled, and an event the kit once asked about and no
  // longer does is left behind in nobody's file.
  const theirs = withoutKitHooks(settings.hooks, file);
  const wanted = {
    ...settings,
    hooks: { ...theirs, [EVENT]: [...(theirs[EVENT] ?? []), mine] },
  };

  // Compared as documents, not as text: how the user laid their file out is
  // theirs, and a run that changes nothing writes nothing.
  if (isDeepStrictEqual(settings, wanted)) return undefined;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(wanted, null, 2)}\n`);
  return HOOK_FILE[harness];
}

/**
 * The user's own hooks: what is in the file with the kit's entries taken out.
 * An event left with nothing in it goes too — an empty list says nothing — and
 * anything under `hooks` that is not a list of entries is theirs, untouched.
 */
function withoutKitHooks(hooks, file) {
  if (hooks === undefined) return {};
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    // Whatever this is, it is theirs, and writing the kit's hook here would
    // write over it. Better to say so than to take it away.
    throw new Error(`${file} has a hooks entry that is not a mapping of events, and the kit's session hook goes in there. Fix it or move it aside, then run the command again.`);
  }

  return Object.fromEntries(Object.entries(hooks).flatMap(([event, groups]) => {
    if (!Array.isArray(groups)) return [[event, groups]];
    const kept = groups.filter((group) => !isKitGroup(group));
    return kept.length === 0 ? [] : [[event, kept]];
  }));
}

const isKitGroup = (group) => Array.isArray(group?.hooks)
  && group.hooks.some((hook) => typeof hook?.command === 'string' && hook.command.includes(KIT_COMMAND));

/**
 * What the file says, or nothing when there is no file yet. A file the kit
 * cannot read as JSON is the user's, and guessing at it would lose what they
 * wrote, so the command says so and writes nothing.
 */
function readSettings(file) {
  if (!existsSync(file)) return {};

  const parsed = parse(readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not readable as JSON, and the kit's session hook goes in it. Fix it or move it aside, then run the command again.`);
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
