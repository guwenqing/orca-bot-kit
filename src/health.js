// `obk health`: what is wrong with the setup, said in facts.
//
// PRD 4.12 names what it has to find — configuration that will not work, a
// skill that is not where its list says, a session the book knows that Orca
// does not, and leftovers no book owns — and PRD 6.5 adds Orca's own default
// launch arguments on top of them.
//
// Two rules hold it together.
//
// It reports and never repairs. The kit's code reports facts; judging them and
// proposing a fix is the skill's job (PRD 6.8). So nothing here writes: no
// AGENTS.md built, no skill linked, no book touched, and of Orca it asks only
// the things that tell it something. Every check is the read-only half of a
// command that does the writing, and lives beside that command rather than
// here, so the two cannot drift apart.
//
// And a finding has to be worth reading. Each one says which kind of trouble it
// is, the one thing to go and look at, and a sentence naming it — so that
// somebody who cannot read code knows what was found and where.

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { asBooked, bookFile, readBook, tabIdsIn } from './book.js';
import { botDir, botNames, botsDir, readBot } from './bot.js';
import { hookTrouble } from './hooks.js';
import { bypassFlags, harnessOf, HARNESSES, sessionTrouble } from './launch.js';
import { orcaDefaultArgs, projects, tabs } from './orca.js';
import { agentsTrouble } from './rules.js';
import { skillsTrouble } from './skills.js';
import { readSources, sourcesDir } from './sources.js';
import { BOT_FATHER, botsNamed, promptPath } from './up.js';

/**
 * Everything wrong with the setup at `bots`, in one list: what Orca's own
 * settings do to every session, what is lying about that no book owns, and then
 * each bot in name order. `bot` narrows the per-bot checks to one; what the
 * whole fleet lives under is reported whichever bot was named.
 */
export function checkHealth(bots, { bot: onlyBot } = {}) {
  const names = botsNamed(bots, onlyBot);
  const setups = projects();

  const found = [...orcaSettingFindings(), ...leftInOrca(bots, setups), ...leftBeside(bots)];
  for (const name of names) found.push(...aboutBot(bots, name, setups));
  return found;
}

/** One finding, as the report and the `--json` answer carry it. */
const finding = (kind, where, says, bot) => ({ kind, ...(bot === undefined ? {} : { bot }), where, says });

/**
 * What Orca adds to an agent of its own accord, when it is a permission bypass.
 *
 * Every session Orca relaunches or resumes takes these, whatever the kit asked
 * for, so this is said every time it is true (PRD 6.5) — and a setting the kit
 * could not read is said too, because silence here would be read as a clean
 * bill of health.
 *
 * Exported because the PRD asks for it in two places: here, and in the setup
 * that makes a fleet, which is where the user is still standing when they can
 * put it right.
 */
export function orcaSettingFindings() {
  const { dir, profiles } = orcaDefaultArgs();
  if (profiles.length === 0) return [unreadableSettings(dir)];

  return profiles.flatMap(({ file, args }) => {
    if (args === undefined) return [unreadableSettings(file)];

    return HARNESSES.flatMap((harness) => {
      const flags = bypassFlags(harness);
      // A missing entry is Orca's own default, and Orca's own default is the
      // bypass (tech notes, section 1), so it is read as one.
      const recorded = typeof args[harness] === 'string' ? args[harness] : undefined;
      const effective = recorded ?? flags.join(' ');
      const bypass = flags.filter((flag) => carries(effective, flag));
      if (bypass.length === 0) return [];

      const how = recorded === undefined
        ? `${file} records no default launch arguments for ${harness}, and Orca's own default for it is ${bypass.join(' ')}.`
        : `${file} gives ${harness} the default launch arguments ${recorded.trim()}.`;
      return [finding('orca', file, `${how} Every ${harness} session Orca launches, relaunches or resumes runs with a permission bypass, whatever approval level the kit asked for, so a session meant to ask first will not. Change it to something safer in Orca's settings; the kit does not touch that setting itself.`)];
    });
  });
}

const unreadableSettings = (where) => finding(
  'orca',
  where,
  `The kit could not read Orca's own settings at ${where}, so it cannot say whether Orca adds default launch arguments of its own. When those carry a permission bypass, every session Orca launches, relaunches or resumes runs in that mode whatever approval level the kit asked for.`,
);

/** Whether a line of arguments carries `flag` as a word of its own. */
const carries = (args, flag) =>
  new RegExp(`(^|\\s)${flag.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(args);

/**
 * Orca projects inside the bots folder that are no longer a bot: the bot was
 * moved or deleted and its Orca project stayed behind. Anything outside the
 * bots folder is the user's own work and is not looked at.
 */
function leftInOrca(bots, setups) {
  const dir = botsDir(bots);
  const dirs = [...new Set([dir, realpathOf(dir)].filter((one) => one !== undefined))];

  return setups.flatMap((setup) => {
    const under = dirs.find((one) => setup.path.startsWith(`${one}${path.sep}`));
    if (under === undefined) return [];

    const name = path.relative(under, setup.path);
    if (!name.includes(path.sep) && existsSync(path.join(dir, name, 'bot.yaml'))) return [];

    return [finding('leftover', setup.path, `Orca has a project for ${setup.path}, which is inside your bots folder, and there is no bot there. Its Orca project is ${setup.id}. Close its tabs before the project goes: a project taken away before its tabs leaves tabs that nothing can close from the command line.`)];
  });
}

/**
 * What the kit keeps beside the bots folder that nothing answers to any more:
 * a start prompt written for a session that has gone, and a clone of a skills
 * source `skills.yaml` no longer lists.
 */
function leftBeside(bots) {
  const found = [];

  // Every start-prompt file the sessions of every bot would be given. A bot the
  // kit cannot read has sessions it cannot name, and a file called a leftover
  // on that footing might be a live session's duty, so the check waits until
  // the bot.yaml beside it is settled.
  const owned = new Set();
  let known = true;
  for (const name of botNames(bots)) {
    try {
      for (const session of readBot(botDir(bots, name), name).sessions) {
        owned.add(promptPath(bots, name, session.name));
      }
    } catch {
      known = false;
    }
  }

  if (known) {
    for (const file of namesIn(`${bots}.prompts`)) {
      const at = path.join(`${bots}.prompts`, file);
      if (owned.has(at)) continue;
      found.push(finding('leftover', at, `${at} is a start prompt the kit wrote beside your bots folder, and no session of any bot answers to it now. Nothing reads it.`));
    }
  }

  const file = path.join(bots, 'skills.yaml');
  let listed;
  try {
    listed = new Set(readSources(file).map((source) => source.name));
  } catch (error) {
    return [...found, finding('config', file, error.message)];
  }

  for (const name of namesIn(sourcesDir(bots))) {
    if (listed.has(name)) continue;
    const at = path.join(sourcesDir(bots), name);
    found.push(finding('leftover', at, `${at} is a clone of a skills source, and ${file} lists no source called ${name}. Nothing links skills out of it now.`));
  }

  return found;
}

/** Everything wrong with one bot. */
function aboutBot(bots, name, setups) {
  const home = botDir(bots, name);

  let bot;
  try {
    bot = readBot(home, name);
  } catch (error) {
    // Nothing else about this bot can be asked: what it carries, what its
    // sessions are and which harness they run on are all in the file that
    // cannot be read. The other bots are reported as usual.
    return [finding('config', path.join(home, 'bot.yaml'), error.message, name)];
  }

  const said = (kind) => ({ where, says }) => finding(kind, where, says, name);
  return [
    ...sessionSettings(home, bot).map(said('config')),
    ...agentsTrouble(bots, home, bot).map(said('config')),
    ...hooksOf(bots, home, bot).map(said('config')),
    ...skillsTrouble(bots, home, bot).map(said('skill')),
    ...inOrca(home, bot, setups),
  ];
}

/** A session the kit would refuse to start, in the words `up` refuses it with. */
function sessionSettings(home, bot) {
  const file = path.join(home, 'bot.yaml');
  return bot.sessions.flatMap((session) => {
    const trouble = sessionTrouble(session, harnessOf(session, bot.harness), home);
    return trouble === undefined
      ? []
      : [{ where: file, says: `${file}: ${trouble} obk up will not start ${bot.name} until that is settled.` }];
  });
}

/** The kit's own hook, in the file of every harness this bot's sessions run on. */
const hooksOf = (bots, home, bot) => [...new Set(bot.sessions.map((session) => harnessOf(session, bot.harness)))]
  .filter((harness) => HARNESSES.includes(harness))
  .map((harness) => hookTrouble(home, harness, { bots, bot: bot.name }))
  .filter((trouble) => trouble !== undefined);

/**
 * What Orca has of this bot against what the book says it should have: a
 * session whose tab is gone, a conversation nobody claims, and a tab in the
 * bot's project that the book does not name.
 */
function inOrca(home, bot, setups) {
  // The book is read where it is read, and a book nothing can parse is a
  // finding like any other: it says which tab each session is in and which
  // conversation it is running, so without it nothing else here can be asked —
  // but the findings already made, and the bots still to come, are none of its
  // business.
  let book;
  try {
    book = readBook(home);
  } catch (error) {
    return [finding('config', bookFile(home), `${bookFile(home)} cannot be read (${error.message}), and it is where the kit keeps this bot's sessions: which Orca tab each one is in and which conversation it is running. Until it is readable the kit cannot say either. Fix it, or move it aside and let obk up write a new one.`, bot.name)];
  }

  const real = realpathOf(home);
  const project = setups.find((setup) => setup.path === real || setup.path === home);
  // Orca refuses to list the tabs of a folder it has no project for, rather
  // than answering with none (tech notes, section 1), so it is asked only when
  // there is one.
  const live = project === undefined ? [] : asBooked(tabs(project.path), book);
  const there = new Set(live.map((tab) => tab.tabId));

  const found = [];
  for (const [name, entry] of Object.entries(book.sessions)) {
    if (typeof entry?.tab === 'string' && !there.has(entry.tab)) {
      found.push(finding('session', entry.tab, `${bot.name}'s session ${name} is in the book with tab ${entry.tab}, and Orca has no tab of that id: the tab was closed, or the machine was restarted. The conversation is in the book, and obk up opens a tab and brings it back.`, bot.name));
    }

    const unclaimed = Array.isArray(entry?.unclaimed) ? entry.unclaimed : [];
    if (unclaimed.length > 0) {
      found.push(finding('leftover', bookFile(home), `The book notes conversations under ${bot.name}'s session ${name} that no session of this bot claims: ${unclaimed.join(', ')}. They ran in this bot's folder, and the kit will not say whose they were. To give one back, write it into ${bookFile(home)} under ${name} as  session: <id>  and run obk up again.`, bot.name));
    }
  }

  // A tab outside the book is somebody else's, and in Bot Father's project it
  // is the ops tab: the one tab the kit deliberately keeps no record of, so it
  // cannot be a leftover (PRD 6.2).
  if (bot.name !== BOT_FATHER) {
    const known = tabIdsIn(book);
    for (const tab of live.filter((one) => !known.has(one.tabId))) {
      found.push(finding('leftover', tab.tabId, `Orca has a tab in ${bot.name}'s Orca project, ${tab.tabId}, that the book does not name, so it is none of this bot's sessions. The kit did not open it and does not touch it.`, bot.name));
    }
  }

  return found;
}

/** What a directory holds, and nothing at all when there is no directory. */
function namesIn(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Where a path really leads, or undefined when it leads nowhere. */
function realpathOf(at) {
  try {
    return realpathSync(at);
  } catch {
    return undefined;
  }
}
