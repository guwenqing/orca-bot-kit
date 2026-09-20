// `obk up`: make Bot Father real in Orca, and put back whatever is missing.
//
// It only ever adds. It never closes a tab: closing one throws away the user's
// conversation and Orca's resume record with it. Run it twice and the second
// run does nothing.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import { readBook, tabIdsIn, writeBook } from './book.js';
import { asFolderProject, findProject, makeProject, openTab, retitleTab, tabs, tuiInTab, typeIntoTab } from './orca.js';

/** Bot Father: the one bot this slice knows how to bring up. */
const BOT = 'bot-father';
const PROJECT_TITLE = 'Bot Father';

/** How long a harness is given to draw its first screen before the kit gives up on it. */
const STARTUP_MS = 10000;

const titleOf = (session) => `${PROJECT_TITLE} ${session}`;

/**
 * Where a bot lives. Orca is given the real path: it does not follow links, and
 * the same folder reached through one would become a second Orca project.
 *
 * A folder with no `bot.yaml` in it is not a bots folder, whatever else is
 * there, and saying so beats letting a missing-file error out.
 */
export function botHome(bots, bot = BOT) {
  const home = path.join(bots, 'bots', bot);
  if (!existsSync(path.join(home, 'bot.yaml'))) {
    throw new Error(`${bots} is not a bots folder: run obk init --bots <path> --harness claude|codex first.`);
  }
  return realpathSync(home);
}

/**
 * Bring Bot Father up in Orca. Returns one entry per tab of its Orca project:
 * the sessions the book knows, and whatever else is open there.
 */
export function bringUp(bots) {
  const home = botHome(bots);
  const bot = readBot(home);
  const book = readBook(home);

  book.orca = orcaProject(home);

  const live = new Map(tabs(home).map((tab) => [tab.tabId, tab]));
  const report = bot.sessions.map((session) => bringUpSession(home, book, live, session, bot.harness));

  // The ops tab, and the whole of what the kit knows about it: Bot Father's
  // project needs one tab that is not a session, for work across the fleet. Any
  // tab outside the book is that tab — the kit does not ask who made it, does
  // not write it down and does not touch it again.
  const sessionTabs = tabIdsIn(book);
  const spare = [...live.values()].filter((tab) => !sessionTabs.has(tab.tabId));
  if (spare.length === 0) {
    report.push(entry(openTab(home, titleOf('ops')), { name: null, created: true }));
  } else {
    report.push(...spare.map((tab) => entry(tab, { name: null, created: false })));
  }

  writeBook(home, book);
  return report;
}

function bringUpSession(home, book, live, session, harness) {
  const known = live.get(book.sessions[session]?.tab);
  const title = titleOf(session);

  if (known) {
    // Whatever runs in the tab may have rewritten its title. The kit writes its
    // own back, and reports that one rather than the name Orca last saw: the id
    // is the session, and a title is only ever set.
    retitleTab(known.handle, title);
    return entry({ ...known, title }, { name: session, created: false });
  }

  const made = openTab(home, title);

  // Written down the moment it exists, before anything that can fail. A tab
  // whose id never reached the book is a tab nobody owns: the next run would
  // start a second harness beside it and take this one for the spare.
  book.sessions[session] = { tab: made.tabId };
  writeBook(home, book);

  // Typing it in is the way: for a project the kit has just made, giving Orca
  // the harness as the tab's own command times out and leaves a dead tab.
  typeIntoTab(made.handle, harness);

  // And then asking whether a TUI came up, rather than assuming one did. The
  // text goes into the tab's own shell, which may have been busy with a
  // question of its own and swallowed the first characters of it.
  const tui = tuiInTab(made.handle, STARTUP_MS);
  return entry(made, { name: session, created: true, ...tui });
}

/**
 * Bot Father's Orca project, made if it is not there yet.
 *
 * It has to be a folder workspace. Registering a folder that sits inside the
 * bots repo gets it recorded as a git one, which Orca gives no workspace at
 * all, so no tab can be opened in it.
 */
function orcaProject(home) {
  const found = findProject(home);
  const setup = found === undefined
    ? makeProject(home, PROJECT_TITLE)
    : (found.kind === 'folder' ? found : asFolderProject(found.id, PROJECT_TITLE));
  return { project: setup.projectId, setup: setup.id };
}

function entry(tab, { name, created, running = false, blockedReason }) {
  const made = { bot: BOT, name, title: tab.title, tabId: tab.tabId, terminal: tab.handle, created, harnessStarted: running };
  // Orca's own words for what is on screen waiting to be answered, when it
  // gave any: the caller acts on it, the kit only passes it on.
  return blockedReason === undefined ? made : { ...made, blockedReason };
}

/** A bot's own file: which harness it runs on, and the sessions it keeps. */
function readBot(home) {
  const bot = parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'));
  return {
    harness: bot?.harness,
    sessions: (bot?.sessions ?? []).map((session) => (typeof session === 'string' ? session : session?.name)),
  };
}
