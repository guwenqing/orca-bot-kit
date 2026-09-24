// The skills a bot has: links in the bot's own folder, into both harnesses
// (PRD 6.7, ADR 0014, ADR 0019).
//
// Linked, never copied, in both directions. Inwards: what lands in the bot home
// is a symlink to the skill's own directory, so a kit skill is read where the
// package installed it, and both harnesses follow the link. A running session
// reads an edited skill the next time it loads it. A skill linked in or taken
// away reaches it without a restart. Claude Code takes it through its own
// `/reload-skills`, which `obk skills build` types into the session's tab.
// Codex has no such command and takes it at the start of its next turn (tech
// notes, sections 2 and 3). Outwards: the kit takes away only the links it put
// there, and never the skill one was pointing at.
//
// An entry names one of four shelves: the kit's own (`kit:<name>`), an online
// source `skills.yaml` lists (`<source>:<name>`, read from its clone beside the
// bots folder), the user's common folder (a bare name), or a path to anywhere
// on disk.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, parseDocument, stringify } from 'yaml';

import { bookFile, readBook } from './book.js';
import { botDir, botNames, changesExactly, leadsOutside, readBot, YAML_OUT } from './bot.js';
import { harnessOf, ownCli, shellWord } from './launch.js';
import { orcaCli, orcaTrouble, tabToTypeInto, typeIntoTab } from './orca.js';
import { listIn } from './rules.js';
import { cloneDir, isCloned, readSources, skillsIn, wrongClone } from './sources.js';

/** The kit's own skills, inside the installed package. */
const KIT_SKILLS = fileURLToPath(new URL('../skills', import.meta.url));

/** What an entry carries to mean one of the kit's rather than one of the user's. */
const KIT = 'kit:';

/** Where each harness reads a project's skills, inside the folder a session starts in. */
export const SKILL_DIRS = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.agents', 'skills'),
};

/**
 * What a skill may be called: the Agent Skills name, which is also the name of
 * the directory it lives in and of the link the kit makes (tech notes, section
 * 4, and ADR 0019).
 */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where the kit writes down what it linked, inside the bot folder. */
export const RECORD = '.obk-skills.yaml';

/** What that file says about itself, for whoever opens it. */
const HEADER = '# Written by obk: the skill links it made, by harness and name. It changes or\n'
  + '# takes away only an entry that still says this, so anything you link yourself\n'
  + '# is left alone. Delete a line and the kit forgets it made that one.\n\n';

/** The file that makes a directory a skill. A directory without one is not one. */
const MANIFEST = 'SKILL.md';

/** The bot's own file, which is where its skills list lives. */
const BOT_YAML = 'bot.yaml';

/**
 * Put one skill on a bot's list, in the user's own `bot.yaml`.
 * Returns `{ bot, home, skill, state }`, where the state is `added` or `there`.
 *
 * It writes the list and stops. Linking is `obk skills build`, and the two are
 * apart on purpose: a skill named from a source nobody has fetched yet cannot
 * be linked, and a bot whose list grew by one is not a bot that should lose the
 * links it already has to say so.
 *
 * An entry already on the list is left alone rather than written twice. That is
 * the command doing what was asked, not refusing it: the list already says what
 * the caller wanted it to say.
 */
export function addSkill(bots, bot, ref) {
  const known = botNames(bots);
  const home = botDir(bots, bot);
  const file = path.join(home, BOT_YAML);
  if (!known.includes(bot)) {
    throw new Error(`there is no bot called ${bot} in ${bots}: ${file} is not there. Create it with obk bot create.`);
  }

  if (listIn(file, 'skills').includes(ref)) return { bot, home, skill: ref, state: 'there' };

  const was = readFileSync(file, 'utf8');
  const doc = parseDocument(was);
  const listed = doc.get('skills', true);
  if (listed?.items === undefined) {
    // No list to add to: an empty `skills:`, or no skills key at all.
    doc.set('skills', [ref]);
  } else {
    listed.flow = false;
    doc.addIn(['skills'], ref);
  }

  const text = doc.toString(YAML_OUT);
  if (!changesExactly(was, text, (had) => ({ ...had, skills: [...(had.skills ?? []), ref] }))) {
    throw new Error(`${file} cannot have a skill added to it without changing something else in it, so nothing was written. Add ${ref} to its skills list by hand.`);
  }
  writeFileSync(file, text);
  return { bot, home, skill: ref, state: 'added' };
}

/**
 * Take one skill off a bot's list: `addSkill` the other way round, and apart
 * from linking for the same reason. Returns `{ bot, home, skill, state }`, where
 * the state is `removed`, or `absent` for a skill the list does not name.
 */
export function removeSkill(bots, bot, ref) {
  const known = botNames(bots);
  const home = botDir(bots, bot);
  const file = path.join(home, BOT_YAML);
  if (!known.includes(bot)) {
    throw new Error(`there is no bot called ${bot} in ${bots}: ${file} is not there.`);
  }

  const index = listIn(file, 'skills').indexOf(ref);
  if (index === -1) return { bot, home, skill: ref, state: 'absent' };

  const was = readFileSync(file, 'utf8');
  const doc = parseDocument(was);
  doc.deleteIn(['skills', index]);

  const text = doc.toString(YAML_OUT);
  if (!changesExactly(was, text, (had) => ({ ...had, skills: had.skills.filter((one, at) => at !== index) }))) {
    throw new Error(`${file} cannot have a skill taken off it without changing something else in it, so nothing was written. Take ${ref} off its skills list by hand.`);
  }
  writeFileSync(file, text);
  return { bot, home, skill: ref, state: 'removed' };
}

/**
 * Give one bot the skills its lists name. Returns what there is to report:
 * `{ bot, skills, linked, removed }` for a bot whose links are in place, and
 * `{ bot, skills, trouble }` for one whose list the kit could not follow.
 *
 * A list with one entry the kit cannot follow links nothing at all: half a
 * bot's skills is not a bot anybody asked for, and the user fixes one line.
 */
export function linkSkills(bots, home, bot) {
  const record = readRecord(home);
  const held = new Map();

  // What each harness's directory holds now, for a report made before anything
  // was linked. This runs on the way out of a failure, so it must not fail in
  // turn: a directory that is not one, or one the kit may not read, holds
  // nothing it can report, and the bot's own trouble says why.
  const heldAsItIs = () => {
    for (const [harness, inside] of Object.entries(SKILL_DIRS)) {
      const dir = path.join(home, inside);
      let found = new Map();
      try {
        if (isDirectory(dir)) found = heldIn(dir, record[harness] ?? {});
      } catch {
        // Unreadable: reported as holding nothing, rather than thrown out of a
        // report whose whole job is to keep one bot's trouble to that bot.
      }
      held.set(harness, found);
    }
  };

  // Every bot has both directories, skills or none, and before its lists are
  // even read. Claude Code notices a skill added while a session runs only in a
  // skills directory that was there when the session started, and refuses one
  // made afterwards as unknown; Codex does register a directory made later, but
  // not dependably once it has (tech notes, section 3, with the evidence for
  // each). So a bot given its first skill mid-session could not use it without
  // a restart, which is what PRD 4.6 says a skill never needs — and that holds
  // for a bot whose list the kit cannot follow as much as for one with none,
  // since fixing the list is exactly when its first skill arrives. An empty
  // directory costs the user's repo nothing: git does not track one, and what
  // goes in it is gitignored (#136).
  //
  // Something of the user's in the way is reported, never thrown and never
  // moved. A skills problem does not hold a bot down, let alone the fleet
  // (`prepareBots` in up.js), so one bot's folder must not stop `obk up`.
  const blocked = [];
  // A skills directory a link of the user's takes out of the bot folder, to a
  // shelf of their own or their user-level `~/.claude`, is theirs: the kit reads
  // it and writes nothing into it (PRD 6.3), by harness.
  const away = new Map();
  for (const [harness, inside] of Object.entries(SKILL_DIRS)) {
    const dir = path.join(home, inside);
    const real = leadsOutside(home, dir);
    if (real !== undefined) {
      away.set(harness, real);
      continue;
    }
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      blocked.push(`${dir} cannot be made, because something of yours is in the way (${error.code ?? error.message}). Every bot needs it, so that a skill given to it later reaches a session that is already running. Move what is there aside, then build again.`);
    }
  }
  if (blocked.length > 0) {
    heldAsItIs();
    return { bot: bot.name, skills: heldBy(home, [], held), trouble: blocked.join(' ') };
  }

  let wanted;
  try {
    wanted = skillsFor(bots, home, bot);
  } catch (error) {
    heldAsItIs();
    return { bot: bot.name, skills: heldBy(home, [], held), trouble: error.message };
  }

  // Linking is where the rest of the file system gets its say: a directory the
  // kit could make but may not read or write into, a link that cannot be made.
  // Whatever it is, it is this bot's trouble, like the cases above, and not
  // something to throw through `prepareBots` and stop the fleet. What was
  // linked before it went wrong is still written down, so the next run knows it
  // for the kit's own.
  const linked = [];
  const removed = [];
  try {
    for (const harness of Object.keys(SKILL_DIRS)) {
      record[harness] ??= {};
      if (away.has(harness)) {
        held.set(harness, heldIn(path.join(home, SKILL_DIRS[harness]), record[harness]));
        continue;
      }
      // Filled as it goes, so what was changed before a failure is still known.
      const done = link(path.join(home, SKILL_DIRS[harness]), wanted, record[harness], linked, removed);
      held.set(harness, done.held);
    }
  } catch (error) {
    try {
      writeRecord(home, record);
    } catch {
      // The record could not be kept either; the trouble below is still true.
    }
    heldAsItIs();
    return {
      bot: bot.name,
      skills: heldBy(home, [], held),
      // What did change before it went wrong, so the sessions it reaches are told.
      linked: [...new Set(linked)].sort(),
      removed: [...new Set(removed)].sort(),
      trouble: `${bot.name}'s skills could not be linked: ${error.message}. Nothing of yours was changed; put right what is named there, then build again.`,
    };
  }
  writeRecord(home, record);

  const skills = heldBy(home, wanted, held);
  // The lists name skills, and the kit will not put them where that link leads.
  if (wanted.length > 0 && away.size > 0) {
    return {
      bot: bot.name,
      skills,
      linked: [...new Set(linked)].sort(),
      removed: [...new Set(removed)].sort(),
      trouble: [...away].map(([harness, real]) => `${path.join(home, SKILL_DIRS[harness])} leads outside the bot folder, to ${real}, through a link, and the kit links skills only inside the bot folder, so ${harness} does not get the skills the lists name. Replace the link with a directory of the bot's own, then build again.`).join(' '),
    };
  }
  const clash = skills.filter((skill) => !skill.managed && wanted.some((one) => one.name === skill.name));
  return {
    bot: bot.name,
    skills,
    linked: [...new Set(linked)].sort(),
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
 * Take back every skill link the kit made in this bot, and its record of them.
 * What the user put there is theirs and stays. Returns the names taken back.
 */
export function unlinkSkills(home) {
  const record = readRecord(home);
  const removed = [];
  for (const harness of Object.keys(SKILL_DIRS)) {
    removed.push(...link(path.join(home, SKILL_DIRS[harness]), [], record[harness] ?? {}).removed);
  }
  writeRecord(home, {});
  return [...new Set(removed)].sort();
}

/**
 * What the kit last linked into this bot, by harness and name. The kit acts
 * only where what is on disk is still what this says it wrote, so a link the
 * user made, or one of the kit's that they have since repointed, is theirs.
 *
 * It is the kit's own file and lives beside the hook files it already keeps in
 * the bot folder (ADR 0020). A record that cannot be read is treated as an
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
 * What is wrong with a bot's skills as they stand: `[{ where, says }]`, and
 * nothing when the bot has what its lists name. The health check's half of the
 * linking, and it links nothing: it reads the directories, the record and the
 * lists, and says what it finds (PRD 6.8).
 *
 * A link that leads nowhere is reported whoever made it. Whose it is changes
 * what may be done about it, not the fact that a session cannot read the skill
 * (ADR 0014).
 */
export function skillsTrouble(bots, home, bot) {
  const record = readRecord(home);
  const trouble = [];

  for (const [harness, inside] of Object.entries(SKILL_DIRS)) {
    const dir = path.join(home, inside);

    for (const name of namesIn(dir)) {
      const at = path.join(dir, name);
      const target = linkAt(at);
      // `existsSync` follows the link, so a link with nothing at the end of it
      // is exactly what answers false here.
      if (target !== undefined && !existsSync(at)) {
        trouble.push({
          where: at,
          says: `${at} is a link to ${target}, and there is nothing there any more, so a ${harness} session of this bot cannot read the skill it names.`,
        });
      }
    }
  }

  let wanted;
  try {
    wanted = skillsFor(bots, home, bot);
  } catch (error) {
    trouble.push({ where: path.join(home, 'bot.yaml'), says: error.message });
    return trouble;
  }

  // Every skill the lists name, against what is actually at the end of the link
  // — not against what the kit once wrote there. The record says whether the
  // kit may repoint a link; it says nothing about whether the link is still
  // where the list points, and a list that has moved on leaves both harnesses
  // reading the old skill with nothing to say so.
  for (const skill of wanted) {
    for (const [harness, inside] of Object.entries(SKILL_DIRS)) {
      const at = path.join(home, inside, skill.name);
      const target = linkAt(at);
      if (target === skill.dir) continue;
      // A link with nothing at the end of it is reported above, as the broken
      // link it is, and is not worth a second finding under another name.
      if (target !== undefined && !existsSync(at)) continue;

      trouble.push({ where: at, says: how(skill, bot, harness, at, target, record[harness]?.[skill.name]) });
    }
  }

  return trouble;
}

/**
 * Why one harness is not reading the skill its lists name: there is nothing
 * there, the kit's own link is pointing at what the lists used to name, or what
 * is there is the user's own and is never written over.
 */
function how(skill, bot, harness, at, target, wrote) {
  const mine = `${skill.name} is in ${bot.name}'s skills list as ${skill.dir}`;
  if (lstatSync(at, { throwIfNoEntry: false }) === undefined) {
    return `${mine}, and there is nothing at ${at}, so a ${harness} session of this bot does not have it. obk skills build puts the link there.`;
  }
  if (target !== undefined && target === wrote) {
    return `${mine}, and the link at ${at} points at ${target} instead, which is where an older list pointed, so a ${harness} session of this bot is reading that one. obk skills build points it where the list says now.`;
  }
  return `${mine}, and what is at ${at} is not the kit's link. What you put there is yours and the kit never writes over it, so a ${harness} session of this bot reads that instead of the skill the list names.`;
}

/** What a directory holds, and nothing when there is no directory. */
function namesIn(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Give every bot in the folder its skills, or the one named, in name order.
 * This is the whole of `obk skills build`: it writes links, and a bot whose
 * links changed has its running sessions told (`tellSessions`).
 */
export function buildSkills(bots, { bot: onlyBot } = {}) {
  const names = botNames(bots);
  if (onlyBot !== undefined && !names.includes(onlyBot)) {
    throw new Error(`there is no bot called ${onlyBot} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }

  return (onlyBot === undefined ? names : [onlyBot]).map((name) => {
    const home = botDir(bots, name);
    let bot;
    let entry;
    try {
      bot = readBot(home, name);
      entry = linkSkills(bots, home, bot);
    } catch (error) {
      return { bot: name, skills: [], trouble: error.message };
    }
    const changed = (entry.linked?.length ?? 0) + (entry.removed?.length ?? 0) > 0;
    return changed ? { ...entry, sessions: tellSessions(home, bot, entry.linked) } : entry;
  });
}

/** How long Orca is given to say what is in a session's tab. */
const LOOK_MS = 2000;

/**
 * Tell each session of a bot whose skill links just changed, through its
 * harness's own means (PRD 6.5: changes reach running sessions without a
 * restart, and the sessions a change affects are told). Returns one entry per
 * session, in the bot's order: `{ session, harness, state }`, where the state
 * is `reloaded`, `next-turn` (with `read`), `not-up`, `blocked` (with
 * `blocked`) or `unknown` (with `trouble`).
 *
 * Claude Code gets `/reload-skills` typed into its tab, through the same gate
 * as the mail nudge. A busy session queues it and runs it as a command when
 * its turn ends, so it never reaches the model as text. Codex has no reload
 * command and takes the change at the start of its next turn by itself, so
 * nothing is typed, and the caller is given the SKILL.md of each skill linked
 * in, for the session to read if the skill has not appeared (tech notes,
 * sections 2 and 3). Nothing is ever restarted.
 */
function tellSessions(home, bot, linked) {
  let book;
  try {
    book = readBook(home).sessions;
  } catch (error) {
    // The links are made; which tab is whose is what cannot be known.
    const trouble = `${bookFile(home)} cannot be read (${error.message}), so the kit could not tell which tab is this session's, and nothing was typed`;
    return bot.sessions.map((session) => ({ session: session.name, harness: harnessOf(session, bot.harness), state: 'unknown', trouble }));
  }
  // Resolved, because Orca is asked about this folder by path and does not
  // follow a link to it (tech notes, section 1).
  let real;
  try {
    real = realpathSync(home);
  } catch {
    real = home;
  }
  // An Orca whose runtime is not there still answers some commands from what
  // it last knew, so it is asked whether it is up before it is asked anything
  // about a tab.
  const down = bot.sessions.some((session) => typeof book[session.name]?.tab === 'string') ? orcaTrouble() : undefined;

  return bot.sessions.map((session) => {
    const harness = harnessOf(session, bot.harness);
    const told = { session: session.name, harness };
    const tab = typeof book[session.name]?.tab === 'string' ? book[session.name].tab : undefined;
    if (tab === undefined) return { ...told, state: 'not-up' };
    if (down !== undefined) return { ...told, state: 'unknown', trouble: `Orca is not answering at ${orcaCli()}, so the kit could not look at its tab, and nothing was typed` };
    try {
      const found = tabToTypeInto(real, tab, LOOK_MS);
      if (found.blocked !== undefined) return { ...told, state: 'blocked', blocked: found.blocked };
      if (found.unsure !== undefined) return { ...told, state: 'unknown', trouble: found.unsure };
      if (found.handle === undefined) return { ...told, state: 'not-up' };
      // The book's tab, now running the other harness: its reload is not this one's.
      if (found.agent !== harness) {
        return { ...told, state: 'unknown', trouble: `Orca names ${found.agent} in its tab, not ${harness}, so nothing was typed` };
      }

      if (harness === 'codex') {
        // Only what Codex can actually read: a link can fail for one harness
        // alone, and a skills directory that is the user's gets none.
        const read = linked.map((name) => path.join(home, SKILL_DIRS.codex, name, MANIFEST)).filter((file) => existsSync(file));
        return { ...told, state: 'next-turn', read };
      }
      typeIntoTab(found.handle, '/reload-skills');
      return { ...told, state: 'reloaded' };
    } catch (error) {
      // The links are made whatever Orca says, so this is reported, not
      // thrown: the build did what it was asked, and the session was not told.
      return { ...told, state: 'unknown', trouble: error.message };
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
        throw new Error(`${ref}: ${named} has not been fetched yet, so there is nothing to link. Run ${shellWord(ownCli())} skills fetch --bots ${shellWord(bots)} --source ${named}.`);
      }
      const wrong = wrongClone(bots, source);
      if (wrong !== undefined) throw new Error(`${ref}: ${wrong}`);
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
 * kit is allowed to. Returns `{ linked, removed, held }` — the names it linked
 * in or repointed, the names it took away (added to the lists given, as it
 * goes, so a caller whose run throws still has them), and
 * what is in the directory afterwards.
 *
 * The kit acts only where the entry on disk is still the link it wrote, which
 * `record` says. A destination cannot answer who made a link — the user may
 * link the very same skill by hand — so the kit remembers what it made rather
 * than guessing from where a link points (PRD 6.7).
 */
function link(dir, wanted, record, linked = [], removed = []) {
  // The directory is there: `linkSkills` makes both before it calls this.

  const keep = new Map(wanted.map((skill) => [skill.name, skill]));
  // What the lists no longer name. The kit takes back only its own, and only
  // while it is untouched; anything else it forgets about and leaves.
  for (const name of Object.keys(record)) {
    // A key is a skill's name, which is a plain name and never a path: one that
    // is not came from a hand edit, and is forgotten rather than followed out
    // of the skills directory.
    if (!NAME.test(name)) {
      delete record[name];
      continue;
    }
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
    // repo, and the link has to reach out of the repo to find it (ADR 0014).
    symlinkSync(skill.dir, at);
    record[skill.name] = skill.dir;
    linked.push(skill.name);
  }

  return { linked, removed, held: heldIn(dir, record) };
}

/**
 * Whether `at` is a directory, following a link to one, and false for anything
 * else, for nothing there, and for a path the kit is not allowed to look at.
 * `throwIfNoEntry: false` spares only a missing path; a denied one still
 * throws, and a question like this one must answer rather than throw.
 */
function isDirectory(at) {
  try {
    return statSync(at, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
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
