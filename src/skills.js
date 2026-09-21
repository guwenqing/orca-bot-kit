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

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { botDir, botNames, readBot } from './bot.js';
import { listIn } from './rules.js';

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
  let wanted;
  try {
    wanted = skillsFor(bots, home, bot);
  } catch (error) {
    return { bot: bot.name, skills: heldBy(home), trouble: error.message };
  }

  const removed = [];
  for (const harness of Object.keys(SKILL_DIRS)) {
    removed.push(...link(bots, path.join(home, SKILL_DIRS[harness]), wanted));
  }

  return { bot: bot.name, skills: heldBy(home, wanted), removed: [...new Set(removed)].sort() };
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
  const named = [
    ...listIn(path.join(bots, 'defaults.yaml'), 'skills'),
    ...listIn(path.join(home, 'bot.yaml'), 'skills'),
  ];

  const skills = new Map();
  for (const ref of new Set(named)) {
    const skill = follow(bots, ref);
    // Two entries pointing at the same name is the user naming one skill twice;
    // the first is the one they get, as with a name written twice.
    if (!skills.has(skill.name)) skills.set(skill.name, skill);
  }
  return [...skills.values()];
}

/** Where an entry points, and what it has to be for a bot to be given it. */
function follow(bots, ref) {
  const from = ref.startsWith(KIT) ? 'kit' : (ref.includes('/') ? 'path' : 'common');
  const dir = {
    kit: () => path.join(KIT_SKILLS, ref.slice(KIT.length)),
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

  return { name, from, dir };
}

/**
 * Make one harness's skills directory say what `wanted` says, and give back the
 * names it took away.
 *
 * What the kit takes away is what it put there: a link into the kit's own
 * skills or into the user's common folder that no list names any more. Anything
 * else in that directory is the user's — a skill of their own, a link of their
 * own — and is left exactly as it is (PRD 6.7).
 */
function link(bots, dir, wanted) {
  // A bot with no skills is given no skills directories: an empty one is a
  // folder in the user's repo that says nothing.
  if (wanted.length === 0 && !existsSync(dir)) return [];
  mkdirSync(dir, { recursive: true });

  const removed = [];
  const keep = new Set(wanted.map((skill) => skill.name));
  for (const name of readdirSync(dir)) {
    if (keep.has(name)) continue;
    if (!isOurs(bots, path.join(dir, name))) continue;
    rmSync(path.join(dir, name));
    removed.push(name);
  }

  for (const skill of wanted) {
    const at = path.join(dir, skill.name);
    // A link that already says this is left alone, so a second run writes
    // nothing. Anything else of the kit's there is repointed; anything of the
    // user's stays, and the report says the kit does not manage it.
    if (sameLink(at, skill.dir)) continue;
    if (lstatSync(at, { throwIfNoEntry: false }) !== undefined) {
      if (!isOurs(bots, at)) continue;
      rmSync(at);
    }
    // Absolute: a kit skill lives in the installed package, outside the bots
    // repo, and the link has to reach out of the repo to find it (ADR 0004).
    symlinkSync(skill.dir, at);
  }

  return removed;
}

/**
 * Whether the kit is the one that put this here: a symlink into one of the two
 * shelves the kit links from. A path skill the user named is theirs to clear up
 * once they stop naming it, and a directory is never the kit's.
 */
function isOurs(bots, at) {
  if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return false;

  const points = realpathSync(at, { throwIfNoEntry: false }) ?? at;
  return [KIT_SKILLS, path.join(bots, 'skills')].some((shelf) => within(shelf, points));
}

/** Whether `target` is that directory or something inside it. */
function within(dir, target) {
  const root = realpathSync(dir, { throwIfNoEntry: false }) ?? dir;
  return target === root || target.startsWith(`${root}${path.sep}`);
}

/** Whether what is at `at` is already a link to `dir`. */
function sameLink(at, dir) {
  if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return false;

  const points = realpathSync(at, { throwIfNoEntry: false });
  return points !== undefined && points === (realpathSync(dir, { throwIfNoEntry: false }) ?? dir);
}

/**
 * What a bot has in its skills directories now, and where each came from. The
 * two harnesses hold the same names, so they are reported once.
 *
 * `managed` is whether this is one the kit keeps: a name the lists ask for.
 * Everything else is the user's, and is shown rather than touched.
 */
function heldBy(home, wanted = []) {
  const known = new Map(wanted.map((skill) => [skill.name, skill]));
  const names = new Set(wanted.map((skill) => skill.name));
  for (const harness of Object.keys(SKILL_DIRS)) {
    const dir = path.join(home, SKILL_DIRS[harness]);
    if (existsSync(dir)) for (const name of readdirSync(dir)) names.add(name);
  }

  // One with no shelf named is one the kit does not keep. It says nothing about
  // where it came from, because it cannot tell: a skill the user put there, a
  // link of their own, and a link the kit made from a path that no list names
  // any more all look the same from here. What it can say is that the kit will
  // not touch it, which is what the user has to know.
  return [...names].map((name) => (known.has(name)
    ? { name, from: known.get(name).from, managed: true }
    : { name, managed: false }));
}
