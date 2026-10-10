// A bot: a folder in the user's bots repo with a `bot.yaml` in it, and the two
// commands that write one — `obk bot create` and `obk session add`.
//
// Neither of them touches Orca. They write the user's files and stop; `obk up`
// is what makes a bot real in Orca, and it can be run whenever.
//
// The files are the user's. A command that cannot do what was asked refuses and
// writes nothing, rather than leave a bot half made or a bot.yaml half edited.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isSeq, parse, parseDocument, stringify } from 'yaml';

import { DEFAULT_APPROVAL, HARNESSES, harnessOf, sessionTrouble } from './launch.js';

/** Where the bots live inside the user's bots folder. */
export const botsDir = (bots) => path.join(bots, 'bots');

/** Where one bot lives. */
export const botDir = (bots, name) => path.join(botsDir(bots), name);

/** A bot's name: the folder it lives in, and safe to be one. */
export const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
 * What Orca is asked to call a bot's project. A fleet whose bots folder is under
 * the system's temp folder, as a system test's or a live check's is, gets a mark
 * and the name of the first folder under the temp folder, so its Bot Father is
 * never taken for the owner's in Orca's sidebar (#401). Every other fleet's
 * project is called what it always was. Tab titles keep `displayName` either way.
 */
export function projectName(bots, name) {
  let under;
  try {
    under = path.relative(realpathSync(os.tmpdir()), realpathSync(bots));
  } catch {
    return displayName(name);
  }
  // The temp folder itself, or anywhere outside it, is not a throwaway fleet's.
  if (under === '' || under === '..' || under.startsWith(`..${path.sep}`) || path.isAbsolute(under)) return displayName(name);
  return `${displayName(name)} · temp fleet ${under.split(path.sep)[0]}`;
}

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
    // The permission rules the user said yes to, judged where they are written
    // (src/permissions.js), as `rules` is judged by the build.
    allow: bot.allow,
    // The roles its temporary sessions can be made in, judged by tempRoles.
    ...(bot.temp_roles === undefined ? {} : { temp_roles: bot.temp_roles }),
    // The widest approval its temporary sessions may be made at, the user's yes
    // kept by `permission approval --temps` (ADR 0037).
    ...(bot.temp_approval === undefined ? {} : { temp_approval: bot.temp_approval }),
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
 * The bot's `allow` list as it is, after refusing what `allowRules` or
 * `disallowRules` would refuse: an empty rule, or a list already there that is
 * not a list of rules. Asked before anything is written, so a refused
 * `permission allow` or `permission disallow` changes nothing.
 */
export function allowedNow(bots, bot, rules, flag = '--rule') {
  if (rules.some((rule) => rule.trim() === '')) {
    throw new Error(`${flag} is empty. Give it the exact permission rule the user said yes to, such as Bash(git add:*).`);
  }
  const home = existingBot(bots, bot);
  const was = readBot(home, bot).allow ?? [];
  if (!Array.isArray(was) || was.some((rule) => typeof rule !== 'string' || rule.trim() === '')) {
    throw new Error(`the allow entry in ${path.join(home, BOT_YAML)} is not a list of permission rules, so nothing was written. Fix it, then run the command again.`);
  }
  return { home, was };
}

/**
 * Add the permission rules the user said yes to, `rules`, to the bot's `allow`,
 * after the ones already there and never twice. Returns { bot, home, allow,
 * added }: the whole list now, and what this call put in it.
 *
 * Only the list: the rules are written into the harness's settings by the
 * caller, as the rules build is run by the caller of `changeBot`. With `write`
 * false it only refuses what the edit would refuse, and writes nothing.
 */
export function allowRules(bots, bot, rules, { write = true } = {}) {
  const { home, was } = allowedNow(bots, bot, rules);
  const added = [...new Set(rules)].filter((rule) => !was.includes(rule));
  const allow = [...was, ...added];
  if (added.length > 0) {
    editBot(bots, bot, `allow ${added.join(', ')} for ${bot}`, (doc) => doc.set('allow', allow), (before) => ({ ...before, allow }), write);
  }
  return { bot, home, allow, added };
}

/**
 * Take the permission rules the user said yes to taking back, `rules`, out of
 * the bot's `allow` (#360). Returns { bot, home, allow, disallowed }: the whole
 * list now, and what this call took out. The caller has refused a rule `allow`
 * does not hold, and takes them out of the harness's files first. With `write`
 * false it only refuses what the edit would refuse, and writes nothing.
 */
export function disallowRules(bots, bot, rules, { write = true } = {}) {
  const { home, was } = allowedNow(bots, bot, rules);
  const disallowed = [...new Set(rules)];
  const allow = was.filter((rule) => !disallowed.includes(rule));
  editBot(bots, bot, `take back ${disallowed.join(', ')} for ${bot}`, (doc) => doc.set('allow', allow), (before) => ({ ...before, allow }), write);
  return { bot, home, allow, disallowed };
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
 * Record the widest approval the bot's temporary sessions may be made at,
 * `level`, as `temp_approval` (ADR 0037). Returns { bot, home, level }.
 */
export function setTempApproval(bots, bot, level) {
  editBot(bots, bot, `let ${bot}'s temporary sessions be made at ${level}`, (doc) => doc.set('temp_approval', level), (was) => ({ ...was, temp_approval: level }));
  return { bot, home: botDir(bots, bot), level };
}

/**
 * Set the caps of roles in the bot's `temp_roles`: `caps` is a list of
 * `[role, cap]`, a cap of undefined taking it off. A role written as a list of
 * options becomes a mapping that holds that list as `options` beside its cap.
 * A role the bot does not have is refused before anything is written. Returns
 * { bot, home, caps }. With `write` false it only refuses what the edit would
 * refuse, and writes nothing.
 */
export function setRoleCaps(bots, bot, caps, { write = true } = {}) {
  const home = existingBot(bots, bot);
  const roles = readBot(home, bot).temp_roles;
  const file = path.join(home, BOT_YAML);
  for (const [role] of caps) {
    if (roles === null || typeof roles !== 'object' || Array.isArray(roles) || !Object.hasOwn(roles, role)) {
      const has = roles !== null && typeof roles === 'object' && !Array.isArray(roles) ? Object.keys(roles) : [];
      throw new Error(`${bot} has no temporary-session role called ${role} in ${file}${has.length === 0 ? ', and no temp_roles at all' : `. It has: ${has.join(', ')}`}. Nothing was changed.`);
    }
  }
  const capped = (written, cap) => {
    const { cap: was, ...rest } = Array.isArray(written) ? { options: written } : written;
    return cap === undefined ? rest : { ...rest, cap };
  };
  editBot(bots, bot, `set the caps of ${caps.map(([role]) => role).join(', ')}`, (doc) => {
    for (const [role, cap] of caps) {
      const node = doc.getIn(['temp_roles', role], true);
      if (isSeq(node)) {
        doc.setIn(['temp_roles', role], doc.createNode(capped(node.toJSON(), cap)));
      } else if (cap === undefined) {
        doc.deleteIn(['temp_roles', role, 'cap']);
      } else {
        doc.setIn(['temp_roles', role, 'cap'], cap);
      }
    }
  }, (was) => ({
    ...was,
    temp_roles: Object.fromEntries(Object.entries(was.temp_roles).map(([role, written]) => {
      const asked = caps.findLast(([one]) => one === role);
      return [role, asked === undefined ? written : capped(written, asked[1])];
    })),
  }), write);
  return { bot, home, caps };
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
 * only if exactly the change `expected` describes is what came out, and
 * `write` is not false.
 */
function editBot(bots, bot, what, edit, expected, write = true) {
  const file = path.join(existingBot(bots, bot), BOT_YAML);
  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);
  edit(doc);
  const refusal = new Error(`${file} cannot be changed to ${what} without changing something else in it, so nothing was written. Make the change by hand.`);
  let text;
  try {
    // An edit that leaves an alias with no anchor cannot be written at all.
    text = doc.toString(YAML_OUT);
  } catch {
    throw refusal;
  }
  if (!changesExactly(source, text, expected)) throw refusal;
  if (write && text !== source) writeFileSync(file, text);
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
const BOT_FIELDS = ['name', 'harness', 'charter', 'rules', 'skills', 'allow', 'sessions', 'paused', 'temp_roles', 'temp_approval'];

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

/** What a role's option can set, and what a role written as a mapping can hold (#465). */
const OPTION_FIELDS = ['name', 'for', 'harness', 'model', 'effort', 'context'];
const ROLE_FIELDS = ['options', 'cap', 'prompt_file'];

/**
 * The roles a bot's temporary sessions can be made in, from `temp_roles` in its
 * file (#465), each read into one form: `{ name, options, cap, prompt_file,
 * trouble }`. A role is written as a list of options, the first its default,
 * or as a mapping that holds that list as `options` beside a `cap` and a
 * `prompt_file`. `trouble` is each thing wrong with the role, as a sentence;
 * a role with any is not one to make a session in. A `temp_roles` that is not
 * a mapping at all is thrown. The file is the user's, so nothing here is put
 * right: `obk health` says it, and `obk temp make` refuses the role.
 */
export function tempRoles(home, bot) {
  const file = path.join(home, BOT_YAML);
  const given = bot.temp_roles;
  if (given === undefined || given === null) return [];
  if (typeof given !== 'object' || Array.isArray(given)) {
    throw new Error(`${file} has a temp_roles that is not a mapping of role names to roles, so the bot has no roles to make a temporary session in.`);
  }
  return Object.entries(given).map(([name, written]) => readRole(home, file, name, written));
}

function readRole(home, file, name, written) {
  const trouble = [];
  const say = (what) => trouble.push(`${file}: the temporary-session role ${name} ${what}`);
  const role = Array.isArray(written) ? { options: written } : written;
  if (!NAME.test(name)) say('cannot be a role\'s name: a name is lower-case letters, digits and single hyphens, and it begins the name of each session made in it.');
  if (role === null || typeof role !== 'object') {
    say('is neither a list of options nor a mapping with options in it.');
    return { name, options: [], trouble };
  }
  for (const key of Object.keys(role).filter((one) => !ROLE_FIELDS.includes(one))) {
    say(`has a key the kit does not know, ${key}, so nothing reads it. A role written as a mapping can have ${ROLE_FIELDS.join(', ')}.`);
  }
  const options = Array.isArray(role.options) ? role.options : [];
  if (options.length === 0) say('has no options. Give it a list of them, the first being its default.');
  const seen = new Set();
  options.forEach((option, at) => {
    if (option === null || typeof option !== 'object' || Array.isArray(option) || option.name === undefined || option.name === null || option.name === '') {
      say(`has an option with no name, number ${at + 1} of its options.`);
      return;
    }
    const called = `${name}:${option.name}`;
    if (typeof option.name !== 'string' || !NAME.test(option.name)) say(`has an option ${option.name} whose name is not a word of lower-case letters, digits and single hyphens, so ${called} cannot be asked for. Write the name in quotes if YAML reads it as something else.`);
    if (seen.has(option.name)) say(`has two options called ${option.name}, and ${called} would name either.`);
    seen.add(option.name);
    for (const key of Object.keys(option).filter((one) => !OPTION_FIELDS.includes(one))) {
      say(`has an option ${option.name} with a setting the kit does not know, ${key}, so nothing reads it and a session made in ${called} would not get it. An option can set ${OPTION_FIELDS.join(', ')}.`);
    }
    if (option.harness !== undefined && option.harness !== null && !HARNESSES.includes(option.harness)) {
      say(`has an option ${option.name} that runs on ${option.harness}, and the harnesses are ${HARNESSES.join(' and ')}.`);
    }
  });
  if (role.cap !== undefined && !(Number.isInteger(role.cap) && role.cap > 0)) {
    say(`has a cap of ${JSON.stringify(role.cap)}, and a cap is a whole number of open sessions, 1 or more.`);
  }
  if (role.prompt_file !== undefined) {
    const prompt = path.resolve(home, String(role.prompt_file));
    try {
      readFileSync(prompt, 'utf8');
    } catch (error) {
      say(`has its prompt in ${role.prompt_file}, and that file cannot be read (${error.code}): ${prompt}. Write it, or point the role at the file you meant.`);
    }
  }
  return {
    name,
    options,
    ...(role.cap === undefined ? {} : { cap: role.cap }),
    ...(role.prompt_file === undefined ? {} : { prompt_file: role.prompt_file }),
    trouble,
  };
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
