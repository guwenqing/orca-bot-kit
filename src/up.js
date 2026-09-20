// `obk up`: make the bots real in Orca, and put back whatever is missing.
//
// It only ever adds. It never closes a tab: closing one throws away the user's
// conversation and Orca's resume record with it. Run it twice and the second
// run does nothing.

import { mkdirSync, realpathSync } from 'node:fs';

import { readBook, tabIdsIn, writeBook } from './book.js';
import { botDir, botNames, displayName, readBot } from './bot.js';
import { harnessOf, launchCommand, startPrompt, workDirOf } from './launch.js';
import { asFolderProject, findProject, makeProject, openTab, retitleTab, tabs, tuiInTab, typeIntoTab } from './orca.js';

/** The one bot with a tab beside its sessions: the ops tab (PRD 6.2). */
export const BOT_FATHER = 'bot-father';

/** How long a harness is given to draw its first screen before the kit gives up on it. */
const STARTUP_MS = 10000;

/**
 * Bring bots up in Orca. Returns one entry per tab it looked at: the sessions
 * the book knows, and, for Bot Father, whatever else is open in its project.
 *
 * With no name it is every bot in the folder, in name order. `bot` brings up
 * one bot and `session` one of its sessions, for a caller that wants one thing
 * back rather than the fleet.
 */
export function bringUp(bots, { bot: onlyBot, session: onlySession } = {}) {
  const names = botNames(bots);
  if (names.length === 0) {
    throw new Error(`there are no bots in ${bots} yet: make one with obk bot create --bots <path> --name <name> --harness claude|codex.`);
  }
  if (onlyBot !== undefined && !names.includes(onlyBot)) {
    throw new Error(`there is no bot called ${onlyBot} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }
  if (onlySession !== undefined && onlyBot === undefined) {
    throw new Error('--session needs --bot: say which bot the session belongs to.');
  }

  const chosen = onlyBot === undefined ? names : [onlyBot];
  return chosen.flatMap((name) => bringUpBot(bots, name, onlySession));
}

function bringUpBot(bots, name, onlySession) {
  // Orca is given the real path: it does not follow links, and the same folder
  // reached through one would become a second Orca project.
  const home = realpathSync(botDir(bots, name));
  const bot = readBot(home, name);
  const title = displayName(name);

  const sessions = onlySession === undefined
    ? bot.sessions
    : bot.sessions.filter((session) => session.name === onlySession);
  if (sessions.length === 0 && onlySession !== undefined) {
    throw new Error(`${name} has no session called ${onlySession}. Add it with obk session add, or name one it has.`);
  }

  const book = readBook(home);
  book.orca = orcaProject(home, title);

  const live = new Map(tabs(home).map((tab) => [tab.tabId, tab]));
  const report = sessions.map((session) => bringUpSession(home, book, live, session, bot, title));

  // The ops tab, and the whole of what the kit knows about it: Bot Father's
  // project needs one tab that is not a session, for work across the fleet. Any
  // tab outside the book is that tab — the kit does not ask who made it, does
  // not write it down and does not touch it again. No other bot has one, and a
  // run asked for one session is not the run to go looking.
  if (name === BOT_FATHER && onlySession === undefined) {
    const sessionTabs = tabIdsIn(book);
    const spare = [...live.values()].filter((tab) => !sessionTabs.has(tab.tabId));
    report.push(...(spare.length === 0
      ? [entry(openTab(home, `${title} ops`), { bot: name, name: null, created: true })]
      : spare.map((tab) => entry(tab, { bot: name, name: null, created: false }))));
  }

  writeBook(home, book);
  return report;
}

function bringUpSession(home, book, live, session, bot, title) {
  const known = live.get(book.sessions[session.name]?.tab);
  const tabTitle = `${title} ${session.name}`;

  if (known) {
    // Whatever runs in the tab may have rewritten its title. The kit writes its
    // own back, and reports that one rather than the name Orca last saw: the id
    // is the session, and a title is only ever set. Nothing is typed into a tab
    // that is already there — the session is in the middle of its work.
    retitleTab(known.handle, tabTitle);
    return entry({ ...known, title: tabTitle }, { bot: bot.name, name: session.name, created: false });
  }

  // Everything that can be refused is settled before Orca is asked for
  // anything, so a session the kit cannot start leaves no tab behind.
  const workDir = workDirOf(session, home);
  const prompt = startPrompt(session, workDir);
  const command = launchCommand(session, { harness: harnessOf(session, bot.harness), home, workDir, prompt });

  // A work dir is a plain folder, made for the session before it is told about
  // it (PRD 6.4). Nothing here is a git worktree.
  if (workDir !== undefined) mkdirSync(workDir, { recursive: true });

  const made = openTab(home, tabTitle);

  // Written down the moment it exists, before anything that can fail. A tab
  // whose id never reached the book is a tab nobody owns: the next run would
  // start a second harness beside it and take this one for the spare.
  book.sessions[session.name] = { tab: made.tabId };
  writeBook(home, book);

  // Typing it in is the way: for a project the kit has just made, giving Orca
  // the harness as the tab's own command times out and leaves a dead tab.
  typeIntoTab(made.handle, command);

  // And then asking whether a TUI came up, rather than assuming one did. The
  // text goes into the tab's own shell, which may have been busy with a
  // question of its own and swallowed the first characters of it.
  const tui = tuiInTab(made.handle, STARTUP_MS);

  // The start prompt went in with that line, as the harness's own prompt
  // argument, so it is the harness that holds it until it is ready — through
  // its folder-trust question and its update offer. What is still worth saying
  // is whether the line took at all: a shell that swallowed it swallowed the
  // duty with it, and nobody has been told anything.
  const promptSent = prompt === undefined ? undefined : tui.running === true;

  return entry(made, { bot: bot.name, name: session.name, created: true, ...tui, promptSent });
}

/**
 * A bot's Orca project, made if it is not there yet.
 *
 * It has to be a folder workspace. Registering a folder that sits inside the
 * bots repo gets it recorded as a git one, which Orca gives no workspace at
 * all, so no tab can be opened in it.
 */
function orcaProject(home, title) {
  const found = findProject(home);
  const setup = found === undefined
    ? makeProject(home, title)
    : (found.kind === 'folder' ? found : asFolderProject(found.id, title));
  return { project: setup.projectId, setup: setup.id };
}

function entry(tab, { bot, name, created, running = false, blockedReason, promptSent }) {
  const made = { bot, name, title: tab.title, tabId: tab.tabId, terminal: tab.handle, created, harnessStarted: running };
  // Orca's own words for what is on screen waiting to be answered, when it
  // gave any: the caller acts on it, the kit only passes it on.
  if (blockedReason !== undefined) made.blockedReason = blockedReason;
  // Only for a session this run started that had something to be told.
  if (promptSent !== undefined) made.promptSent = promptSent;
  return made;
}
