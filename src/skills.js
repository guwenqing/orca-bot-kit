// The skills a bot has: links in the bot's own folder, into both harnesses
// (PRD 6.7, ADR 0004, ADR 0009).
//
// Linked, never copied, in both directions. Inwards: what lands in the bot home
// is a symlink to the skill's own directory, so a kit skill is read where the
// package installed it and an edit to a skill is what a running session reads —
// both harnesses follow a symlinked skill folder and pick a change up without a
// restart (tech notes, sections 2 and 3). Outwards: the kit takes away only the
// links it put there, and never the skill one was pointing at.
//
// An entry names one of three shelves: the kit's own, the user's common folder,
// or a path to anywhere on disk. Online sources are issue #36 and are not read
// here.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { botDir, botNames, readBot, YAML_OUT } from './bot.js';
import { listIn } from './rules.js';
import { cloneDir, isCloned, readSources, skillsIn } from './sources.js';

/** The kit's own skills, inside the installed package. */
const KIT_SKILLS = fileURLToPath(new URL('../skills', import.meta.url));

/** What an entry carries to mean one of the kit's rather than one of the user's. */
const KIT = 'kit:';

/** Where each harness reads a project's skills, inside the folder a session starts in. */
const SKILL_DIRS = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.agents', 'skills'),
};

/**
 * What a skill may be called: the Agent Skills name, which is also the name of
 * the directory it lives in and of the link the kit makes (tech notes, section
 * 4, and ADR 0009).
 */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where the kit writes down what it linked, inside the bot folder. */
const RECORD = '.obk-skills.yaml';

/** What that file says about itself, for whoever opens it. */
const HEADER = '# Written by obk: the skill links it made, by harness and name. It changes or\n'
  + '# takes away only an entry that still says this, so anything you link yourself\n'
  + '# is left alone. Delete a line and the kit forgets it made that one.\n\n';

/** The file that makes a directory a skill. A directory without one is not one. */
const MANIFEST = 'SKILL.md';

/**
 * Give one bot the skills its lists name. Returns what there is to report:
 * `{ bot, skills, removed }` for a bot whose links are in place, and
 * `{ bot, skills, trouble }` for one whose list the kit could not follow.
 *
 * A list with one entry the kit cannot follow links nothing at all: half a
 * bot's skills is not a bot anybody asked for, and the user fixes one line.
 */
export function linkSkills(bots, home, bot) {
  const record = readRecord(home);
  const held = new Map();

  let wanted;
  try {
    wanted = skillsFor(bots, home, bot);
  } catch (error) {
    for (const harness of Object.keys(SKILL_DIRS)) {
      held.set(harness, heldIn(path.join(home, SKILL_DIRS[harness]), record[harness] ?? {}));
    }
    return { bot: bot.name, skills: heldBy(home, [], held), trouble: error.message };
  }

  const removed = [];
  for (const harness of Object.keys(SKILL_DIRS)) {
    record[harness] ??= {};
    const done = link(path.join(home, SKILL_DIRS[harness]), wanted, record[harness]);
    removed.push(...done.removed);
    held.set(harness, done.held);
  }
  writeRecord(home, record);

  const skills = heldBy(home, wanted, held);
  const clash = skills.filter((skill) => !skill.managed && wanted.some((one) => one.name === skill.name));
  return {
    bot: bot.name,
    skills,
    removed: [...new Set(removed)].sort(),
    // A name the lists ask for that the bot has something else under. The user's
    // own is never written over, so what they have to know is that the list did
    // not take effect, and under which harness.
    ...(clash.length === 0 ? {} : {
      trouble: `${clash.map((skill) => skill.name).join(', ')}: the lists name ${clash.length === 1 ? 'this skill' : 'these skills'}, and what is in the bot's skills directories under ${clash.length === 1 ? 'that name' : 'those names'} is not the kit's to replace. Move yours aside if you want the listed one, or take the name out of the list.`,
    }),
  };
}

/**
 * What the kit last linked into this bot, by harness and name. The kit acts
 * only where what is on disk is still what this says it wrote, so a link the
 * user made, or one of the kit's that they have since repointed, is theirs.
 *
 * It is the kit's own file and lives beside the hook files it already keeps in
 * the bot folder (ADR 0010). A record that cannot be read is treated as an
 * empty one: the worst that follows is that the kit leaves alone something it
 * would otherwise have tidied up, which is the safe way round.
 */
function readRecord(home) {
  try {
    const record = parse(readFileSync(path.join(home, RECORD), 'utf8'));
    return record !== null && typeof record === 'object' && !Array.isArray(record) ? record : {};
  } catch {
    return {};
  }
}

function writeRecord(home, record) {
  const kept = Object.fromEntries(Object.entries(record).filter(([, links]) => Object.keys(links).length > 0));
  const file = path.join(home, RECORD);
  if (Object.keys(kept).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  writeFileSync(file, `${HEADER}${stringify(kept, YAML_OUT)}`);
}

/**
 * Give every bot in the folder its skills, or the one named, in name order.
 * This is the whole of `obk skills build`: it writes links and asks Orca nothing.
 */
export function buildSkills(bots, { bot: onlyBot } = {}) {
  const names = botNames(bots);
  if (onlyBot !== undefined && !names.includes(onlyBot)) {
    throw new Error(`there is no bot called ${onlyBot} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }

  return (onlyBot === undefined ? names : [onlyBot]).map((name) => {
    const home = botDir(bots, name);
    try {
      return linkSkills(bots, home, readBot(home, name));
    } catch (error) {
      return { bot: name, skills: [], trouble: error.message };
    }
  });
}

/**
 * The skills a bot should have, in the order its lists name them: what every
 * bot gets, then the bot's own, each one once however often it is named.
 *
 * Every entry is followed before any link is made, so a list the kit cannot
 * follow leaves the bot as it was.
 */
function skillsFor(bots, home, bot) {
  // Read once for the bot rather than once per entry: it is the user's file and
  // a list that names no source never opens it.
  let sources = [];
  const named = [
    ...listIn(path.join(bots, 'defaults.yaml'), 'skills'),
    ...listIn(path.join(home, 'bot.yaml'), 'skills'),
  ];

  if (named.some((ref) => ref.includes(':') && !ref.startsWith(KIT))) {
    sources = readSources(path.join(bots, 'skills.yaml'));
  }

  const skills = new Map();
  for (const ref of new Set(named)) {
    const skill = follow(bots, ref, sources);
    // Two entries pointing at the same name is the user naming one skill twice;
    // the first is the one they get, as with a name written twice.
    if (!skills.has(skill.name)) skills.set(skill.name, skill);
  }
  return [...skills.values()];
}

/**
 * Where an entry points, and what it has to be for a bot to be given it.
 *
 * Four shelves: the kit's own, one of the online sources the user listed, their
 * common folder, and any path on disk. A colon says which of the first two,
 * and a source has to be one `skills.yaml` names — an unknown prefix is a
 * misspelling, not a folder called `whatever:`.
 */
function follow(bots, ref, sources) {
  const named = ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : undefined;
  const from = named === undefined ? (ref.includes('/') ? 'path' : 'common')
    : (named === KIT.slice(0, -1) ? 'kit' : 'source');
  const after = named === undefined ? ref : ref.slice(named.length + 1);

  const dir = {
    kit: () => path.join(KIT_SKILLS, after),
    source: () => {
      const source = sources.find((one) => one.name === named);
      if (source === undefined) {
        throw new Error(`${ref} names the source ${named}, and skills.yaml lists no source called that.`);
      }
      if (!isCloned(bots, named)) {
        throw new Error(`${ref}: ${named} has not been fetched yet, so there is nothing to link. Run obk skills fetch --bots ${bots} --source ${named}.`);
      }
      return path.join(skillsIn(bots, source), after);
    },
    common: () => path.join(bots, 'skills', ref),
    // The user's own spelling: absolute, at their home, or read from the bots
    // folder, which is the folder the entry is written in.
    path: () => path.resolve(bots, ref.startsWith('~') ? path.join(os.homedir(), ref.slice(1)) : ref),
  }[from]();

  const name = path.basename(dir);
  if (!NAME.test(name)) {
    throw new Error(`${ref} points at ${name}, and a skill is named in lower-case letters, digits and single hyphens, such as obk-tdd. Rename the directory, or point at one that is named that way.`);
  }
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`${ref} names no skill: there is no directory at ${dir}.`);
  }
  if (!existsSync(path.join(dir, MANIFEST))) {
    throw new Error(`${ref} points at ${dir}, which is not a skill: a skill directory holds a ${MANIFEST}.`);
  }

  return { name, from: from === 'source' ? named : from, dir };
}

/**
 * Make one harness's skills directory hold what `wanted` says, as far as the
 * kit is allowed to. Returns `{ removed, held }` — the names it took away, and
 * what is in the directory afterwards.
 *
 * The kit acts only where the entry on disk is still the link it wrote, which
 * `record` says. A destination cannot answer who made a link — the user may
 * link the very same skill by hand — so the kit remembers what it made rather
 * than guessing from where a link points (PRD 6.7).
 */
function link(dir, wanted, record) {
  // A bot with no skills and no directory is given none: an empty one is a
  // folder in the user's repo that says nothing.
  if (wanted.length === 0 && !existsSync(dir)) return { removed: [], held: new Map() };
  mkdirSync(dir, { recursive: true });

  const keep = new Map(wanted.map((skill) => [skill.name, skill]));
  const removed = [];

  // What the lists no longer name. The kit takes back only its own, and only
  // while it is untouched; anything else it forgets about and leaves.
  for (const name of Object.keys(record)) {
    if (keep.has(name)) continue;
    if (linkAt(path.join(dir, name)) === record[name]) {
      rmSync(path.join(dir, name));
      removed.push(name);
    }
    delete record[name];
  }

  for (const skill of wanted) {
    const at = path.join(dir, skill.name);
    const there = linkAt(at);

    // Already the link the kit wrote, pointing where the list says: nothing to
    // do, so a second run writes nothing at all.
    if (there === skill.dir && record[skill.name] === skill.dir) continue;

    // Something is there that the kit did not write, or wrote and the user has
    // since changed. It is theirs, and the report says the bot did not get what
    // the list asked for.
    if (there !== undefined || existsSync(at) || lstatSync(at, { throwIfNoEntry: false }) !== undefined) {
      if (record[skill.name] === undefined || record[skill.name] !== there) continue;
      rmSync(at);
    }

    // Absolute: a kit skill lives in the installed package, outside the user's
    // repo, and the link has to reach out of the repo to find it (ADR 0004).
    symlinkSync(skill.dir, at);
    record[skill.name] = skill.dir;
  }

  return { removed, held: heldIn(dir, record) };
}

/**
 * What a link at `at` says, or undefined when there is no link there.
 *
 * Read with `readlink`, which asks the link itself rather than what it points
 * at: a link of the user's whose target has been deleted is a thing to report,
 * not a thing to fall over. (`realpathSync` has no `throwIfNoEntry` — that
 * option is `statSync`'s — so a dangling link throws there, which is how this
 * once took a whole `obk up` down with it.)
 */
function linkAt(at) {
  try {
    return readlinkSync(at);
  } catch {
    return undefined;
  }
}

/** What one harness's directory holds, and whether each entry is the kit's own. */
function heldIn(dir, record) {
  const held = new Map();
  if (!existsSync(dir)) return held;

  for (const name of readdirSync(dir)) {
    // A link the kit wrote and the record still vouches for. Both halves have
    // to be there: a directory of the user's has no link to read, and a name
    // the record never knew has nothing to vouch for it — and `undefined` on
    // both sides is not a match, it is two absences.
    const target = linkAt(path.join(dir, name));
    held.set(name, target !== undefined && target === record[name] ? 'linked' : 'yours');
  }
  return held;
}

/**
 * What a bot has in its skills directories now, harness by harness.
 *
 * A name is the kit's only where both harnesses hold the link the kit wrote to
 * the directory the lists name. Where they differ — the user keeps their own
 * skill in one of them — that is said rather than averaged away, because the
 * two harnesses are then reading different skills under one name.
 */
function heldBy(home, wanted, held) {
  const known = new Map(wanted.map((skill) => [skill.name, skill]));
  // The ones the lists name come first, in the order they name them, and
  // whatever else the directories hold follows in name order.
  const names = new Set([
    ...wanted.map((skill) => skill.name),
    ...[...held.values()].flatMap((one) => [...one.keys()]).sort(),
  ]);

  return [...names].map((name) => {
    // `missing` is the honest answer for a name no harness holds. No command
    // here can report one: each links as it reports, so a wanted name is either
    // linked in the same run or something of the user's is in its way. It is
    // the word a command that reports without linking — a health check — would
    // need.
    const at = Object.fromEntries(Object.keys(SKILL_DIRS)
      .map((harness) => [harness, held.get(harness)?.get(name) ?? 'missing']));
    const ours = Object.values(at).every((state) => state === 'linked');

    return known.has(name) && ours
      ? { name, from: known.get(name).from, managed: true, at }
      // Not the kit's: the user's own, or a name the list asks for that the bot
      // has something else under. It says nothing about where it came from,
      // because from here it cannot tell.
      : { name, managed: false, at };
  });
}
