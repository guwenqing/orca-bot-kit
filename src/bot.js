// A bot: a folder in the user's bots repo with a `bot.yaml` in it, and the two
// commands that write one — `obk bot create` and `obk session add`.
//
// Neither of them touches Orca. They write the user's files and stop; `obk up`
// is what makes a bot real in Orca, and it can be run whenever.
//
// The files are the user's. A command that cannot do what was asked refuses and
// writes nothing, rather than leave a bot half made or a bot.yaml half edited.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, parseDocument, stringify } from 'yaml';

import { DEFAULT_APPROVAL, HARNESSES, harnessOf, sessionTrouble } from './launch.js';

/** Where the bots live inside the user's bots folder. */
export const botsDir = (bots) => path.join(bots, 'bots');

/** Where one bot lives. */
export const botDir = (bots, name) => path.join(botsDir(bots), name);

/** A bot's name: the folder it lives in, and safe to be one. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The file that says what a bot is. A folder without one is not a bot. */
const BOT_YAML = 'bot.yaml';

/**
 * How the kit writes YAML: a line as long as it needs to be, and flow
 * collections left as tight as the user writes them (`[a]`, not `[ a ]`).
 */
export const YAML_OUT = { lineWidth: 0, flowCollectionPadding: false };

/** What every new bot is given until its owner writes its own. */
const PLACEHOLDER_CHARTER = (name) =>
  `${name} has no charter yet. Write here what it owns, what good looks like,\n`
  + 'and what it must ask about before it acts.\n';

/**
 * The bots in a bots folder, in name order. A folder with no `bot.yaml` in it
 * is somebody's own folder, not a bot, and is left alone.
 */
export function botNames(bots) {
  const dir = requireBotsFolder(bots);
  // Sorted: the order bots come up in, and the order they are reported in, is
  // the user's, not whatever order the file system hands back.
  return readdirSync(dir).sort().filter((name) => existsSync(path.join(dir, name, BOT_YAML)));
}

/**
 * What Orca is asked to call a bot's project and its tabs: the bot's name with
 * the hyphens taken out, so `bot-father` shows up in Orca as `Bot Father`.
 */
export const displayName = (name) =>
  name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/**
 * A bot's own file: which harness its sessions run on unless they say
 * otherwise, and the sessions it keeps.
 *
 * A session written as a bare name is one with everything left to default.
 */
export function readBot(home, name = path.basename(home)) {
  const file = path.join(home, BOT_YAML);
  const bot = asMapping(parseYaml(file), file);

  const sessions = bot.sessions ?? [];
  if (!Array.isArray(sessions)) {
    throw new Error(`${file} has a sessions entry that is not a list. Fix it, then run the command again.`);
  }

  return {
    name,
    harness: bot.harness,
    // What the rules build reads. Neither is judged here: a charter is prose,
    // and a list the build cannot follow is that build's to report (PRD 6.6).
    charter: bot.charter,
    rules: bot.rules,
    sessions: sessions.map((session) => {
      const entry = typeof session === 'string' ? { name: session } : session;
      if (entry === null || typeof entry !== 'object' || !entry.name) {
        throw new Error(`${file} has a session with no name. Give it one, then run the command again.`);
      }
      return entry;
    }),
  };
}

/**
 * Create the bot `name` in the bots folder at `bots`.
 * Returns { bot, home, created } — `created` lists what was written, in order.
 *
 * The bot's own files, and no more: its `AGENTS.md` is built from this
 * `bot.yaml` and the rule units, which is the rules build's job and is reported
 * as one (PRD 6.6).
 */
export function createBot(bots, { name, harness, charter }) {
  if (!NAME.test(name)) {
    throw new Error(`${name} cannot be a bot's name: a name is lower-case letters, digits and single hyphens, such as api-bot.`);
  }
  if (!HARNESSES.includes(harness)) {
    throw new Error(`--harness is ${HARNESSES.join(' or ')}, and got: ${harness}`);
  }

  requireBotsFolder(bots);

  const home = botDir(bots, name);
  if (existsSync(home)) {
    throw new Error(`there is already something at ${home}, and bot create never writes over it. Pick another name, or move it aside.`);
  }

  const text = charter?.trim() ? `${charter.trim()}\n` : PLACEHOLDER_CHARTER(name);
  const files = [
    [BOT_YAML, botYaml(name, harness, text)],
    // work/ is the bot's own scratch space and is not the repo's business (PRD 6.3).
    ['.gitignore', 'work/\n'],
  ];

  mkdirSync(home, { recursive: true });
  for (const [entry, contents] of files) writeFileSync(path.join(home, entry), contents, { flag: 'wx' });

  return {
    bot: name,
    home,
    created: files.map(([entry]) => path.join('bots', name, entry)),
  };
}

/**
 * Add the session `name` to the bot `bot`, with the settings it was given.
 * Returns { bot, home, session } — the session as it was written.
 *
 * The file is edited through the YAML library, which keeps the user's comments
 * and their own values, and writes the new session wherever their sessions list
 * is. What the library reformats on the way — an indent, a quote, an inline
 * list that becomes a block one — is not worth a mechanism of the kit's own.
 */
export function addSession(bots, bot, settings) {
  requireBotsFolder(bots);

  const home = botDir(bots, bot);
  const file = path.join(home, BOT_YAML);
  if (!existsSync(file)) {
    throw new Error(`there is no bot called ${bot} in ${bots}: ${file} is not there. Create it with obk bot create.`);
  }

  const known = readBot(home, bot);
  if (known.sessions.some((session) => session.name === settings.name)) {
    throw new Error(`${bot} already has a session called ${settings.name}, and session add never writes over one.`);
  }

  const session = ordered({ ...settings, approval: settings.approval ?? DEFAULT_APPROVAL });
  const trouble = sessionTrouble(session, harnessOf(session, known.harness), home);
  if (trouble !== undefined) throw new Error(trouble);

  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);
  const sessions = doc.get('sessions', true);
  if (sessions?.items === undefined) {
    // No list to add to: an empty `sessions:`, or no sessions key at all.
    doc.set('sessions', [session]);
  } else {
    // A list written inline is written out as a block list from here on, which
    // is the one shape a session with a prompt in it reads well in.
    sessions.flow = false;
    doc.addIn(['sessions'], session);
  }

  const text = doc.toString(YAML_OUT);
  if (!changesExactly(source, text, (was) => ({ ...was, sessions: [...(was.sessions ?? []), session] }))) {
    throw new Error(`${file} cannot have a session added to it without changing something else in it, so nothing was written. Add ${settings.name} to its sessions list by hand.`);
  }
  writeFileSync(file, text);
  return { bot, home, session };
}

/**
 * Whether `text` is `source` with exactly the change `expected` describes and
 * nothing besides: the check in front of every write the kit makes to a file
 * the user also writes in.
 *
 * `expected` is given what the file said and answers with what it should say.
 * How the two texts are laid out is not compared — that is the library's — but
 * every value is.
 */
export function changesExactly(source, text, expected) {
  let was;
  let now;
  try {
    was = parse(source);
    now = parse(text);
  } catch {
    return false;
  }
  if (was === null || typeof was !== 'object' || Array.isArray(was)) return false;

  return isDeepStrictEqual(now, expected(was));
}

/** The bot.yaml of a bot nobody has edited yet. */
function botYaml(name, harness, charter) {
  const header = `# ${displayName(name)}. Ask Bot Father for changes rather than editing this file.\n\n`;
  return header + stringify({ name, harness, charter, rules: [], skills: [], sessions: [] }, YAML_OUT);
}

/**
 * Everything a session can set, in the order it is written down. One list, so
 * that a setting cannot reach `bot.yaml` through one place and be dropped by
 * another.
 */
export const SESSION_FIELDS = [
  'name', 'harness', 'model', 'effort', 'context', 'approval', 'prompt', 'prompt_file', 'work_dir', 'extra_args',
];

/** A session's settings, in that order, without the ones left out. */
function ordered(session) {
  const entry = {};
  for (const key of SESSION_FIELDS) {
    if (session[key] !== undefined) entry[key] = session[key];
  }
  return entry;
}

function parseYaml(file) {
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not readable as YAML: ${error.message}`);
  }
}

function asMapping(bot, file) {
  if (bot === null || typeof bot !== 'object' || Array.isArray(bot)) {
    throw new Error(`${file} is not a bot: it should be a YAML mapping with a name, a harness and a list of sessions.`);
  }
  return bot;
}

/**
 * Where the bots live, once it is certain they live there. A folder `init`
 * never made holds none of the kit's files, and the way out of that is `init`
 * and not the command the user reached for.
 */
function requireBotsFolder(bots) {
  const dir = botsDir(bots);
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`${bots} is not a bots folder: run obk init --bots <path> --harness claude|codex first.`);
  }
  return dir;
}
