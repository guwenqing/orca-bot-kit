// A bot: a folder in the user's bots repo with a `bot.yaml` in it, and the two
// commands that write one — `obk bot create` and `obk session add`.
//
// Neither of them touches Orca. They write the user's files and stop; `obk up`
// is what makes a bot real in Orca, and it can be run whenever.
//
// The files are the user's. A command that cannot do what was asked refuses and
// writes nothing, rather than leave a bot half made or a bot.yaml half edited.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * What every bot keeps out of the bots repo: its `work/`, the scratch space it
 * clones into, which is not the repo's business (PRD 6.3).
 */
export const BOT_GITIGNORE = 'work/\n';

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
 * Where `target`, inside the bot folder at `home` by name, really leads when a
 * link the user made takes it out of that folder; undefined when it stays in.
 *
 * The kit writes only in the bot folder, never in user-level settings (PRD 6.3,
 * ADR 0022), and a link would make the one the other without a word. So the
 * answer is the file system's, not the spelling's: see `whereItLeads`.
 */
export function leadsOutside(home, target) {
  let real;
  try {
    real = whereItLeads(target);
  } catch {
    // Something in the way that is not a link at all — a file where a folder
    // should be, a folder the kit may not enter. Whatever writes there next
    // meets it and says so in its own words.
    return undefined;
  }
  // Links that never settle lead nowhere the kit can vouch for.
  if (real === undefined) return `${target}, through links that never settle`;
  const root = realpathSync(home);
  return real === root || real.startsWith(root + path.sep) ? undefined : real;
}

/** How many links deep a path is followed before it is taken to lead nowhere. */
const HOPS = 40;

/**
 * Where writing `target` would really land: the nearest part of it that exists,
 * resolved by the file system, with the rest of the path after it. A link that
 * leads to nothing yet is followed to what it names, and that is resolved the
 * same way in turn, since it can pass through further links on the way.
 * Undefined for links that never settle.
 */
function whereItLeads(target) {
  let next = target;
  for (let hop = 0; hop < HOPS; hop += 1) {
    let at = next;
    const rest = [];
    while (lstatSync(at, { throwIfNoEntry: false }) === undefined && path.dirname(at) !== at) {
      rest.unshift(path.basename(at));
      at = path.dirname(at);
    }
    try {
      return path.join(realpathSync(at), ...rest);
    } catch (error) {
      if (!lstatSync(at).isSymbolicLink()) throw error;
      next = path.join(path.resolve(path.dirname(at), readlinkSync(at)), ...rest);
    }
  }
  return undefined;
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
    // A paused bot is one `obk up` leaves closed; its sessions keep their book.
    ...(bot.paused === true ? { paused: true } : {}),
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
    ['.gitignore', BOT_GITIGNORE],
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
 * Give the bot `bot` a new charter. Returns { bot, home, charter }.
 *
 * The charter and nothing else: its `AGENTS.md` is rebuilt from it by the rules
 * build, which the caller runs, as `bot create` does.
 */
export function changeBot(bots, bot, { charter }) {
  if (charter === undefined) throw new Error('bot change needs --charter <text>: what to change.');
  if (charter.trim() === '') throw new Error('--charter is empty, and a bot with no charter has no boundary to act inside. Give it one.');

  const text = `${charter.trim()}\n`;
  editBot(bots, bot, `give ${bot} a new charter`, (doc) => doc.set('charter', text), (was) => ({ ...was, charter: text }));
  return { bot, home: botDir(bots, bot), charter: text };
}

/**
 * Change the settings of the session `name` of the bot `bot`. Returns
 * { bot, home, session } — the session as it now reads.
 *
 * A setting given replaces the one there, and one given empty is taken out,
 * which leaves it to the harness's own default. A start prompt is written one
 * way or the other, so giving one takes the other away. The result is held to
 * the rules `session add` holds a new session to.
 */
export function changeSession(bots, bot, name, settings) {
  const changes = { ...settings };
  if (Object.keys(changes).length === 0) {
    throw new Error(`session change needs a setting to change: say what ${bot}'s session ${name} is to be set to.`);
  }
  if (changes.prompt !== undefined && changes.prompt_file === undefined) changes.prompt_file = '';
  if (changes.prompt_file !== undefined && changes.prompt === undefined) changes.prompt = '';

  const { home, known, index } = sessionAt(bots, bot, name);
  const was = known.sessions[index];
  // Every key the entry had stays, a pause mark or one of the user's own among
  // them; only the settings given change.
  const session = Object.fromEntries(Object.entries({ ...was, ...changes })
    .filter(([, value]) => value !== '' && !(Array.isArray(value) && value.every((one) => one === ''))));
  const trouble = sessionTrouble(session, harnessOf(session, known.harness), home);
  if (trouble !== undefined) throw new Error(trouble);

  editSession(bots, bot, index, session, `change ${bot}'s session ${name}`);
  return { bot, home, session };
}

/**
 * Mark the bot `bot`, or its session `name`, paused or not. Returns whether
 * the file changed. A paused bot or session is one `obk up` leaves closed.
 */
export function markPaused(bots, bot, name, paused) {
  if (name === undefined) {
    const known = readBot(botDir(bots, bot), bot);
    if ((known.paused === true) === paused) return false;
    editBot(
      bots, bot, `${paused ? 'pause' : 'unpause'} ${bot}`,
      (doc) => (paused ? doc.set('paused', true) : doc.delete('paused')),
      ({ paused: none, ...was }) => (paused ? { ...was, paused: true } : was),
    );
    return true;
  }

  const { known, index } = sessionAt(bots, bot, name);
  const was = known.sessions[index];
  if ((was.paused === true) === paused) return false;
  const { paused: none, ...rest } = was;
  editSession(bots, bot, index, paused ? { ...rest, paused: true } : rest, `${paused ? 'pause' : 'unpause'} ${bot}'s session ${name}`);
  return true;
}

/** Take the session `name` off the bot `bot`'s list. */
export function dropSession(bots, bot, name) {
  const { index } = sessionAt(bots, bot, name);
  editBot(
    bots, bot, `take the session ${name} off ${bot}`,
    (doc) => doc.deleteIn(['sessions', index]),
    (was) => ({ ...was, sessions: was.sessions.filter((one, at) => at !== index) }),
  );
}

/** Where a session sits in its bot's list, refusing a bot or a session that is not there. */
function sessionAt(bots, bot, name) {
  const home = existingBot(bots, bot);
  const known = readBot(home, bot);
  const index = known.sessions.findIndex((session) => session.name === name);
  if (index === -1) {
    throw new Error(`${bot} has no session called ${name}. It has: ${known.sessions.map((session) => session.name).join(', ') || 'none'}.`);
  }
  return { home, known, index };
}

/**
 * Write the session at `index` as `session`, key by key where it is already a
 * mapping, so what the user wrote beside the keys it keeps stays with them.
 */
function editSession(bots, bot, index, session, what) {
  editBot(bots, bot, what, (doc) => {
    const node = doc.getIn(['sessions', index], true);
    if (node?.items === undefined) {
      doc.setIn(['sessions', index], session);
      return;
    }
    for (const pair of [...node.items]) {
      const key = String(pair.key?.value ?? pair.key);
      if (!(key in session)) doc.deleteIn(['sessions', index, key]);
    }
    for (const [key, value] of Object.entries(session)) {
      if (!isDeepStrictEqual(doc.getIn(['sessions', index, key]), value)) doc.setIn(['sessions', index, key], value);
    }
  }, (was) => ({ ...was, sessions: was.sessions.map((one, at) => (at === index ? session : one)) }));
}

/**
 * Make one edit to a bot's `bot.yaml` through the YAML library, and write it
 * only if exactly the change `expected` describes is what came out.
 */
function editBot(bots, bot, what, edit, expected) {
  const file = path.join(existingBot(bots, bot), BOT_YAML);
  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);
  edit(doc);
  const text = doc.toString(YAML_OUT);
  if (!changesExactly(source, text, expected)) {
    throw new Error(`${file} cannot be changed to ${what} without changing something else in it, so nothing was written. Make the change by hand.`);
  }
  if (text !== source) writeFileSync(file, text);
}

/** A bot that is there, by its home, or the refusal a caller who named another is owed. */
export function existingBot(bots, bot) {
  requireBotsFolder(bots);
  const home = botDir(bots, bot);
  if (!existsSync(path.join(home, BOT_YAML))) {
    throw new Error(`there is no bot called ${bot} in ${bots}: ${path.join(home, BOT_YAML)} is not there.`);
  }
  return home;
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
  // Nothing but comments, or nothing at all, parses as nothing at all, and is
  // still a file an entry can be the first thing in.
  if (was === null) was = {};
  if (typeof was !== 'object' || Array.isArray(was)) return false;

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

/** Everything the top of a bot's own file can hold. */
const BOT_FIELDS = ['name', 'harness', 'charter', 'rules', 'skills', 'sessions', 'paused'];

/**
 * The keys in a bot's file that the kit does not know, and so that nothing
 * reads: a typo such as `efort` leaves its session on the harness's default
 * while the file says otherwise (#273). Said, and never refused or taken out,
 * because the file is the user's.
 */
export function unknownKeys(home, name = path.basename(home)) {
  const file = path.join(home, BOT_YAML);
  const unknown = (entry, known) => Object.keys(entry).filter((key) => !known.includes(key));
  const sessionKeys = [...SESSION_FIELDS, 'paused'];
  return [
    ...unknown(asMapping(parseYaml(file), file), BOT_FIELDS).map((key) => ({
      where: file,
      says: `${file} has a key the kit does not know, ${key}, so nothing reads it and ${name} runs as if it were not there. The keys a bot's file can have are ${BOT_FIELDS.join(', ')}.`,
    })),
    ...readBot(home, name).sessions.flatMap((session) => unknown(session, sessionKeys).map((key) => ({
      where: file,
      says: `${file}: ${name}'s session ${session.name} has a setting the kit does not know, ${key}, so nothing reads it and the session runs as if it were not there. The settings a session can have are ${sessionKeys.join(', ')}.`,
    }))),
  ];
}

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
export function requireBotsFolder(bots) {
  const dir = botsDir(bots);
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`${bots} is not a bots folder: run obk init --bots <path> --harness claude|codex first.`);
  }
  return dir;
}
