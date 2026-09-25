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

import { bookFile, readBook, sessionIdsIn, tabIdsIn } from './book.js';
import { botDir, botNames, botsDir, readBot, unknownKeys } from './bot.js';
import { transcriptsIn } from './conversations.js';
import { hookTrouble } from './hooks.js';
import { bypassFlags, harnessOf, HARNESSES, ownCli, sessionTrouble, shellWord } from './launch.js';
import { frontOfTab, orcaDefaultArgs, projects, tabs } from './orca.js';
import { agentsTrouble, rulesStamp } from './rules.js';
import { settingsInUse } from './settings.js';
import { skillsTrouble } from './skills.js';
import { readSources, sourcesDir } from './sources.js';
import { BOT_FATHER, botsNamed, promptPath } from './up.js';

/**
 * Everything wrong with the setup at `bots`, in one list: what Orca's own
 * settings do to every session, what is lying about that no book owns, and then
 * each bot in name order. `bot` narrows the per-bot checks to one; what the
 * whole fleet lives under is reported whichever bot was named.
 *
 * Beside the list, `sessions`: each running session the book knows, with what
 * it runs on against what its bot asks for now, good news included.
 */
export function checkHealth(bots, { bot: onlyBot } = {}) {
  const names = botsNamed(bots, onlyBot);
  const setups = projects();

  const found = [...orcaSettingFindings(), ...leftInOrca(bots, setups), ...leftBeside(bots)];
  const sessions = [];
  for (const name of names) found.push(...aboutBot(bots, name, setups, sessions));
  return { found, sessions };
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

/** Everything wrong with one bot. Its running sessions are added to `sessions`. */
function aboutBot(bots, name, setups, sessions) {
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
    ...unknownKeys(home, name).map(said('config')),
    ...sessionSettings(home, bot).map(said('config')),
    ...agentsTrouble(bots, home, bot).map(said('config')),
    ...hooksOf(bots, home, bot).map(said('config')),
    ...skillsTrouble(bots, home, bot).map(said('skill')),
    ...inOrca(bots, home, bot, setups, sessions),
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
 * Each session of this bot running in a tab Orca has, with what it runs on set
 * beside what the bot asks for now, added to `sessions`; a finding for each
 * one that runs on something else (#271, #272); and a finding for each one
 * whose tab is open with its harness gone from it (#300).
 *
 * Two questions, each answered from where the answer is written. The settings
 * from the harness's own record of the conversation the session is in now,
 * which is what the harness really used. The rules from the stamp the kit noted
 * in the book when the session last read them, against `AGENTS.md` now: nothing
 * the harness writes says which instructions it read.
 *
 * Only a mismatch and older rules are findings. What cannot be read is said as
 * unknown in `sessions`, and never taken for agreement.
 */
function runningOn(bots, home, bot, book, handles, sessions) {
  const real = realpathOf(home) ?? home;
  const records = new Map();
  const recordOf = (harness, id) => {
    if (!HARNESSES.includes(harness) || id === null) return undefined;
    if (!records.has(harness)) records.set(harness, new Map(transcriptsIn(harness, real).map((one) => [one.id, one.file])));
    return records.get(harness).get(id);
  };

  const stamp = rulesStamp(home);
  const found = [];
  for (const session of bot.sessions) {
    const entry = book.sessions[session.name];
    // Running is a tab Orca still has, with the session's harness in front of
    // it. A session whose tab is gone is not running whatever its record says,
    // and the missing tab is said already.
    if (bot.paused === true || session.paused === true || entry === null || typeof entry !== 'object') continue;
    const handle = handles.get(entry.tab);
    if (handle === undefined) continue;

    // A harness can quit to the tab's shell and leave the tab open (#232), so
    // the tab alone is not the answer: who holds its terminal is, asked the way
    // the kit asks before it types into a tab. The shell in front is a session
    // that is not running, and a finding: `up` finds the tab open and types
    // nothing into it, so only a restart brings it back (#300). Anything else
    // that is not its own harness, or a front that cannot be read, leaves it
    // unsaid, and nothing unsaid is a finding.
    const restart = `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${bot.name} --session ${session.name}`;
    const front = frontOfTab(handle);
    if (front.front === 'shell') {
      // Restart refuses a live tab whose conversation the book cannot name, and
      // there may be none to name: the harness can quit before it has one. Its
      // harness is gone, so closing the tab ends nothing, and `up` then starts
      // the session again as it does any closed tab with no conversation.
      const up = `${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${bot.name} --session ${session.name}`;
      const back = typeof entry.session === 'string'
        ? `${restart} does`
        : `nor does obk restart, which refuses to close a tab whose conversation the book does not name, and the book names none for it. Its harness has already quit, so close the tab in Orca yourself; then ${up} starts it again, with a new conversation and its duty. Any conversation it left in this bot's folder is noted in the book as unclaimed, for health to list`;
      found.push(finding('session', entry.tab, `${bot.name}'s session ${session.name} is not running: its tab ${entry.tab} is open with only the tab's shell in front, so its harness quit or crashed. obk up finds the tab open and types nothing into it, so it does not bring the session back; ${back}.`, bot.name));
      continue;
    }
    const harness = harnessOf(session, bot.harness);
    const running = front.front === 'program' && front.command === harness ? 'yes' : 'unknown';
    const conversation = typeof entry.session === 'string' ? entry.session : null;
    const file = recordOf(harness, conversation);
    const settings = settingsInUse(harness, session, file, typeof entry.launched === 'string' ? entry.launched : undefined);
    const rules = { state: typeof entry.rules !== 'string' ? 'unknown' : entry.rules === stamp ? 'current' : 'older' };
    sessions.push({ bot: bot.name, session: session.name, harness, running, conversation, settings, rules });
    if (running !== 'yes') continue;

    const off = Object.entries(settings).filter(([, one]) => one.state === 'mismatch');
    if (off.length > 0) {
      const parts = off.map(([name, one]) => `${name}: bot.yaml asks for ${one.configured}, and it runs on ${one.observed}`).join('; ');
      found.push(finding('session', file, `${bot.name}'s session ${session.name} does not run on what ${path.join(home, 'bot.yaml')} asks for. ${parts}. That is what the harness's own record of its conversation ${conversation} says. A session takes these when it starts, so if bot.yaml changed after it started, ${restart} starts it on them; if not, something else set them, such as a default of the harness's own or a change made inside the session.`, bot.name));
    }

    if (rules.state === 'older') {
      const agents = path.join(home, 'AGENTS.md');
      // A clear on Claude Code reads the instructions again, as a start does
      // (tech notes, section 2); whether a new conversation on Codex does is
      // not established, so a start is all that is offered there.
      const how = harness === 'claude'
        ? `A Claude Code session reads it again at a /clear in its tab, or when it starts: ${restart}`
        : `A Codex session reads it when it starts: ${restart}`;
      found.push(finding('session', agents, `${bot.name}'s session ${session.name} is running on older rules: ${agents} has changed since the kit noted which version this session read. ${how}`, bot.name));
    }
  }
  return found;
}

/**
 * What Orca has of this bot against what the book says it should have: a
 * session whose tab is gone, a conversation nobody claims, and a tab in the
 * bot's project that the book does not name.
 */
function inOrca(bots, home, bot, setups, sessions) {
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
  const live = project === undefined ? [] : tabs(project.path);
  const there = new Set(live.map((tab) => tab.tabId));

  // A paused bot or session was closed on purpose, and its tab being gone is
  // what paused means rather than something lost.
  const closed = new Set(bot.sessions.filter((session) => bot.paused === true || session.paused === true).map((session) => session.name));

  // What the harness has on record in this bot's folder, read once: it is a walk
  // through every conversation on the machine.
  const onRecord = recordIn(real ?? home, bot);
  // A conversation the harness marks as a subagent's was never a session's, so a
  // note that holds one is not a loose end for it (#287). The note stays as it is.
  const helpers = new Set(onRecord.filter((one) => one.subagent).map((one) => one.id));

  const found = [];
  for (const [name, entry] of Object.entries(book.sessions)) {
    if (typeof entry?.tab === 'string' && !there.has(entry.tab) && !closed.has(name)) {
      found.push(finding('session', entry.tab, `${bot.name}'s session ${name} is in the book with tab ${entry.tab}, and Orca has no tab of that id: the tab was closed, or the machine was restarted. The conversation is in the book, and obk up opens a tab and brings it back.`, bot.name));
    }

    const unclaimed = (Array.isArray(entry?.unclaimed) ? entry.unclaimed : []).filter((id) => !helpers.has(id));
    if (unclaimed.length > 0) {
      found.push(finding('leftover', bookFile(home), `The book notes conversations under ${bot.name}'s session ${name} that no session of this bot claims: ${unclaimed.join(', ')}. They ran in this bot's folder, and the kit will not say whose they were. To give one back, write it into ${bookFile(home)} under ${name} as  session: <id>  and run obk up again.`, bot.name));
    }
  }

  found.push(...offTheBook(real ?? home, bot, book, onRecord));

  // A tab outside the book is somebody else's, and in Bot Father's project it
  // is the ops tab: the one tab the kit deliberately keeps no record of, so it
  // cannot be a leftover (PRD 6.2).
  if (bot.name !== BOT_FATHER) {
    const known = tabIdsIn(book);
    for (const tab of live.filter((one) => !known.has(one.tabId))) {
      found.push(finding('leftover', tab.tabId, `Orca has a tab in ${bot.name}'s Orca project, ${tab.tabId}, that the book does not name, so it is none of this bot's sessions. The kit did not open it and does not touch it.`, bot.name));
    }
  }

  found.push(...runningOn(bots, home, bot, book, new Map(live.map((tab) => [tab.tabId, tab.handle])), sessions));
  return found;
}

/**
 * The conversations a harness has on record in this bot's folder that the book
 * does not name anywhere. The hook is how an id reaches the book, and when it
 * fails it fails quietly (ADR 0020), so this is where a stale book shows: the
 * harness's own record set beside it (ADR 0012).
 */
function offTheBook(home, bot, book, onRecord) {
  // A retired session's conversations are in the book too, under `retired`.
  const named = sessionIdsIn(book);
  for (const entry of Object.values(book.sessions)) {
    for (const id of Array.isArray(entry?.unclaimed) ? entry.unclaimed : []) named.add(id);
  }

  // A subagent's conversation is no session's, so the book has no reason to name it.
  const stray = onRecord.filter((one) => !one.subagent && !named.has(one.id));
  if (stray.length === 0) return [];

  const listed = stray.map((one) => `${one.id} (begun ${one.at})`).join(', ');
  return [finding('session', bookFile(home), `The harness has conversations on record in ${bot.name}'s folder that the book does not name: ${listed}. The kit's hook may have missed them: a clear it did not record, or a Codex hooks file trusted late. To give one to a session, write it into ${bookFile(home)} under that session as  session: <id>  and run obk up again.`, bot.name)];
}

/** Every conversation on record in the bot's folder, from every harness any of its sessions runs on, as `obk usage` reads them. */
function recordIn(home, bot) {
  const harnesses = new Set(bot.sessions.map((session) => harnessOf(session, bot.harness)));
  if (harnesses.size === 0) harnesses.add(bot.harness);
  return [...harnesses]
    .filter((harness) => HARNESSES.includes(harness))
    .flatMap((harness) => transcriptsIn(harness, home));
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
