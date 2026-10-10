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
import { botDir, botNames, botsDir, readBot, tempRoles, unknownKeys } from './bot.js';
import { transcriptsIn } from './conversations.js';
import { hookTrouble } from './hooks.js';
import { APPROVALS, bypassFlags, harnessOf, HARNESSES, isAddressOf, ownCli, sessionTrouble, SHELL_ENV, shellWord, workDirOf } from './launch.js';
import { frontOfTab, orcaDefaultArgs, projects, runMissing, tabs, wordsOfProcess } from './orca.js';
import { permissionsTrouble } from './permissions.js';
import { processesIn } from './processes.js';
import { TAB_ENV } from './record.js';
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
  `The kit could not read Orca's own settings at ${where}, so it cannot say whether Orca adds default launch arguments of its own. It looks for them in profile-state.db in each Orca profile, or in orca-data.json for an older Orca. When those carry a permission bypass, every session Orca launches, relaunches or resumes runs in that mode whatever approval level the kit asked for.`,
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
    ...rolesTrouble(home, bot).map(said('config')),
    ...agentsTrouble(bots, home, bot).map(said('config')),
    ...hooksOf(bots, home, bot).map(said('config')),
    ...permissionsTrouble(home, bot).map(said('config')),
    ...skillsTrouble(bots, home, bot).map(said('skill')),
    ...inOrca(bots, home, bot, setups, sessions),
    ...leftRunning(home, bot),
  ];
}

/**
 * What still runs in the work dir of a retired session (#537): a retire stops
 * it, so this is one from before that, or one a retire could not stop. The
 * book keeps a retired session's work dir; a temporary session retired before
 * it did worked in `work/<name>`, where `obk temp make` puts it. A work dir a
 * session in bot.yaml still uses is that session's, and not looked at, by its
 * real path, so a link to it is not taken for a retired one (review of PR #543).
 */
function leftRunning(home, bot) {
  let book;
  try {
    book = readBook(home);
  } catch {
    // A book that cannot be read is said where the book is read.
    return [];
  }
  const real = (dir) => (dir === undefined ? undefined : realpathOf(dir));
  const live = new Set(bot.sessions.map((session) => real(workDirOf(session, home))));
  const dirs = [];
  const seen = new Set();
  for (const entry of Array.isArray(book.retired) ? book.retired : []) {
    const named = typeof entry?.work_dir === 'string' && entry.work_dir !== '' ? entry.work_dir : undefined;
    const dir = workDirOf({ work_dir: named ?? (entry?.temporary === undefined ? undefined : `work/${entry.name}`) }, home);
    // One that is not there holds nothing.
    const at = real(dir);
    if (at === undefined || live.has(at) || seen.has(at)) continue;
    seen.add(at);
    dirs.push({ session: entry.name, dir });
  }
  if (dirs.length === 0) return [];

  const read = processesIn(dirs);
  if (read.unreadable !== undefined) {
    return [finding('process', bookFile(home), `The kit cannot tell whether anything still runs in the work dirs of ${bot.name}'s retired sessions: ${read.unreadable}.`, bot.name)];
  }
  return read.running.map((one) => finding('process', one.dir, `pid ${one.pid} still runs in the work dir of ${bot.name}/${one.session}, which was retired: ${one.command}. Nothing of the kit's stops it now. If it is not wanted, stop it yourself:  kill ${one.pid}`, bot.name));
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

/** What is wrong with the roles the bot's temporary sessions are made in (#465). */
function rolesTrouble(home, bot) {
  const where = path.join(home, 'bot.yaml');
  // The widest approval they may be made at, the user's yes (ADR 0041).
  const level = bot.temp_approval;
  const approval = level === undefined || APPROVALS.includes(level) ? [] : [{
    where,
    says: `${where} has a temp_approval of ${JSON.stringify(level)}, and the levels are ${APPROVALS.join(', ')}, so obk temp make holds the bot's temporary sessions to their maker's own approval. Set it with obk permission approval --temps.`,
  }];
  try {
    return [...tempRoles(home, bot).flatMap((role) => role.trouble.map((says) => ({ where, says }))), ...approval];
  } catch (error) {
    return [{ where, says: error.message }, ...approval];
  }
}

/** The kit's own hook, in the file of every harness this bot's sessions run on. */
const hooksOf = (bots, home, bot) => [...new Set(bot.sessions.map((session) => harnessOf(session, bot.harness)))]
  .filter((harness) => HARNESSES.includes(harness))
  .map((harness) => hookTrouble(home, harness, { bots, bot: bot.name }))
  .filter((trouble) => trouble !== undefined);

/**
 * Each session of this bot running in a tab Orca has, with what it runs on set
 * beside what the bot asks for now, added to `sessions`; a finding for each
 * one that runs on something else (#271, #272), or whose harness the kit's
 * launch line did not start (#318); and a finding for each one whose tab is
 * open with its harness gone from it (#300).
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
    // A Claude session is written to by its name, and Claude Code's own
    // messaging reaches every session on the machine. One under a name the kit
    // did not make, such as the bare <bot>.<session> every fleet had before
    // #286, can be written to by another fleet's session (#450). Its next start
    // through the kit gives it a name of its own; one that Orca brought back,
    // or that has run since, keeps the old one until then.
    const front = frontOfTab(handle);
    const address = entry.address;
    if (harnessOf(session, bot.harness) === 'claude' && typeof address === 'string' && address !== '' && !isAddressOf(bot.name, session.name, address)) {
      const shared = address === `${bot.name}.${session.name}`
        ? `the name every fleet's ${bot.name}/${session.name} was given before #286, so it is shared: a Claude session of another fleet with that bot and session can write to it, thinking it is its own`
        : `not one the kit made for it, so it may not be this session's alone: another session, in this fleet or another, can go by it too`;
      // A restart closes the tab, and with no conversation in the book it
      // refuses rather than end one that is running, so the fix starts there.
      // With only the shell in front there is nothing to end, and it goes.
      const fix = typeof entry.session === 'string' || front.front === 'shell'
        ? `${restart} starts it on an address of its own, <bot>.<session> and a token.`
        : `The book does not say which conversation it is running, and a restart refuses until it does: write the id into ${bookFile(home)} under ${session.name} as  session: <id>, then ${restart} starts it on an address of its own, <bot>.<session> and a token.`;
      found.push(finding('session', bookFile(home), `${bot.name}'s session ${session.name} goes by the address ${address}, ${shared}. ${fix}`, bot.name));
    }
    if (front.front === 'shell') {
      found.push(finding('session', entry.tab, `${bot.name}'s session ${session.name} is not running: its tab ${entry.tab} is open with only the tab's shell in front, so its harness quit or crashed. obk up finds the tab open and types nothing into it, so it does not bring the session back; ${restart} does.`, bot.name));
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
    const parts = off.map(([name, one]) => `${name}: bot.yaml asks for ${one.configured}, and it runs on ${one.observed}`).join('; ');
    if (startedByKit(front.pid, entry.tab) === false) {
      // Orca brings its tabs back by itself after a restart or an update, with
      // a bare resume and none of the kit's launch line (#318). What health can
      // see may still match, by the harness's own defaults; the rest of what
      // bot.yaml asks for is not on it either way.
      const drift = off.length === 0 ? '' : ` ${parts}, as the harness's own record of its conversation ${conversation} says.`;
      // A Codex brought back this way also runs its commands in Codex's shared
      // background server, under whichever tab started it (#408).
      const daemon = harness !== 'codex' ? '' : ` Without the kit's line it also runs without --no-daemon, so its commands run in Codex's shared background server, under the tab of whichever session started that server: another tab's identity, not its own. So the kit refuses its commands that take the caller from its tab, such as reading its mail.`;
      const held = harness !== 'codex' ? '' : ` If Codex then shows "This conversation is open in another app", Codex's shared background server still holds the conversation, and it can outlive the session that started it: once every such session is back on the kit's line, stop the server with Codex's own \`codex app-server daemon stop\`, then restart this session again. That stops the server for everything using it, Codex sessions outside the kit included, so first check that nothing else needs it.`;
      found.push(finding('session', entry.tab, `${bot.name}'s session ${session.name} was not started by the kit: the harness in its tab ${entry.tab} carries nothing of the kit's launch line, as when Orca brings its tabs back by itself after a restart or an update. So it runs on the harness's own defaults and whatever Orca added, not on what ${path.join(home, 'bot.yaml')} asks for.${drift}${daemon} ${restart} starts it on bot.yaml.${held}`, bot.name));
    } else if (off.length > 0) {
      found.push(finding('session', file, `${bot.name}'s session ${session.name} does not run on what ${path.join(home, 'bot.yaml')} asks for. ${parts}. That is what the harness's own record of its conversation ${conversation} says. A session takes these when it starts, so if bot.yaml changed after it started, ${restart} starts it on them; if not, something else set them, such as a default of the harness's own or a change made inside the session.`, bot.name));
    }

    if (rules.state === 'older') {
      const agents = path.join(home, 'AGENTS.md');
      // A clear reads the instructions again, as a start does, on both
      // harnesses (tech notes, sections 2 and 3; #391).
      const clear = `${shellWord(ownCli())} session clear --bots ${shellWord(bots)} --bot ${bot.name} --session ${session.name}`;
      found.push(finding('session', agents, `${bot.name}'s session ${session.name} is running on older rules: ${agents} has changed since the kit noted which version this session read. A session reads it again when it is cleared: ${clear}, or when it starts: ${restart}`, bot.name));
    }
  }
  return found;
}

/**
 * Whether the kit's launch line started the process `pid` in the tab `tab`:
 * true when it carries the marker the line puts there, false when it carries
 * that tab's id and no marker, and undefined when its environment cannot be
 * read (tech notes, section 1). Only a whole word counts: an argument, such as
 * a start prompt, can hold anything.
 */
function startedByKit(pid, tab) {
  const words = pid === undefined ? undefined : wordsOfProcess(pid);
  if (words === undefined || !words.includes(`${TAB_ENV}=${tab}`)) return undefined;
  return words.some((word) => new RegExp(`^${SHELL_ENV}=[0-9]+$`).test(word));
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

    // A Run Orca does not have, as when the book was written on another
    // machine: mail sent to it is refused. The session's next start makes it
    // a new one (#508).
    if (typeof entry?.mailbox === 'string' && runMissing(entry.mailbox)) {
      // The bot's unpause leaves a session paused on its own as it is, so a
      // session under both marks needs both commands.
      const unpause = `${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${bot.name}`;
      const steps = [
        ...(bot.paused === true ? [unpause] : []),
        ...(bot.sessions.some((session) => session.name === name && session.paused === true) ? [`${unpause} --session ${name}`] : []),
      ];
      const fix = steps.length > 0 ? steps.join(', then ') : `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${bot.name} --session ${name}`;
      found.push(finding('session', bookFile(home), `${bot.name}'s session ${name} has the mailbox ${entry.mailbox} in the book, and Orca has no Run of that id: it was made by another Orca, as on another machine, so mail sent to it is refused. The session's next start makes it a new one: ${fix}`, bot.name));
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
 * fails it fails quietly (ADR 0022), so this is where a stale book shows: the
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
