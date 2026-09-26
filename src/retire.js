// `obk retire`: end a session, or a whole bot, on the user's word.
//
// Nothing is deleted that the user might want back. A retired session comes off
// its bot's `bot.yaml`, and what the book knew about it moves to the book's
// `retired` list, so the conversations it had are still accounted for (ADR
// 0002). A retired bot moves, folder, book, charter and memory, out of `bots/`
// into `retired/` beside it, where the kit no longer looks.
//
// What goes is what the kit made for it: its tabs, closed one at a time by
// their own handles; its Orca project, after the tabs and never before; its
// start-prompt files beside the bots folder; and, for a bot, the skill links
// the kit made in its folder. A tab the book does not name is the user's, so a
// bot whose project holds one is not retired until they have dealt with it.
//
// Closing a tab here ends the conversation in it on purpose, so unlike a
// restart or a pause it does not wait for the book to know which one it was.
// The mailbox Runs stay: Orca has no way to remove one (ADR 0018).

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readBook, tabIdsIn, updateBook } from './book.js';
import { botDir, dropSession, readBot } from './bot.js';
import { deleteProject, findProject, projects, reloadWindow, tabs } from './orca.js';
import { fleetMember } from './pause.js';
import { closeTabs, tabsToClose } from './restart.js';
import { unlinkSkills } from './skills.js';
import { promptPath, sessionsOf } from './up.js';

/** Where retired bots go: beside `bots/`, where nothing the kit runs looks. */
export const retiredDir = (bots) => path.join(bots, 'retired');

/**
 * Retire the session `session` of the bot `bot`. Returns `{ bot, session, closed }`.
 */
export async function retireSession(bots, { bot, session }) {
  const home = fleetMember(bots, bot, 'retire', session);
  const sessions = sessionsOf(readBot(home, bot), session);

  const closed = await closeTabs(home, tabsToClose(bots, bot, home, sessions, { keepless: true }), bots, bot);
  dropSession(bots, bot, session);

  const at = new Date().toISOString();
  await updateBook(home, (book) => {
    const entry = book.sessions[session];
    if (entry === undefined) return;
    delete book.sessions[session];
    book.retired = [...(Array.isArray(book.retired) ? book.retired : []), { name: session, ...entry, retired: at }];
  });
  rmSync(promptPath(bots, bot, session), { force: true });

  return { bot, session, closed };
}

/**
 * Retire the bot `bot`. Returns `{ bot, closed, project, windowReloaded, moved }`:
 * the tabs it closed, the Orca project it took away (if it had one), whether
 * Orca's window was reloaded after that, and where the bot is now.
 * When Orca does not confirm the project gone, it returns `{ bot, closed,
 * project, trouble }` instead, and the bot is left where it was.
 */
export async function retireBot(bots, { bot }) {
  const home = fleetMember(bots, bot, 'retire');
  const moved = path.join(retiredDir(bots), bot);
  if (existsSync(moved)) {
    throw new Error(`there is already something at ${moved}, and retire never writes over it. Move it aside, then retire ${bot} again.`);
  }

  const known = readBot(home, bot);
  const project = findProject(home);
  if (project !== undefined) {
    const booked = tabIdsIn(readBook(home));
    const theirs = tabs(home).filter((tab) => !booked.has(tab.tabId));
    if (theirs.length > 0) {
      throw new Error(`${bot}'s Orca project holds ${theirs.length === 1 ? 'a tab' : 'tabs'} the book does not name, so ${theirs.length === 1 ? 'it is' : 'they are'} not the kit's to close: ${theirs.map((tab) => tab.tabId).join(', ')}. Close ${theirs.length === 1 ? 'it' : 'them'} yourself, then retire ${bot} again. Nothing was done.`);
    }
  }

  // Every session the book holds a tab for, whether or not bot.yaml still lists
  // it: the same set the check above calls the kit's, so the project is not
  // taken away with one of them still open. `closeTabs` waits until Orca agrees
  // they are gone.
  const booked = Object.keys(readBook(home).sessions).map((name) => ({ name }));
  const closed = await closeTabs(home, tabsToClose(bots, bot, home, booked, { keepless: true }), bots, bot);
  let windowReloaded;
  if (project !== undefined) {
    deleteProject(project.id);
    // Orca's answer to the delete is not the same as the project being gone
    // (#282): its list afterwards is. Until that list is read and no longer
    // has the project, the bot stays where it is, so that retiring it again
    // takes the project away and then finishes.
    let setups;
    try {
      setups = projects();
    } catch (error) {
      return { bot, closed, project: project.id, trouble: `Orca answered the delete of Orca project ${project.id}, and its project list could not be read afterwards, so the removal is not confirmed: ${error.message}. ${bot} was not moved. Once Orca is answering, retire ${bot} again with obk retire: it removes the project if it is still there, then finishes.` };
    }
    if (setups.some((setup) => setup.id === project.id || setup.path === home)) {
      return { bot, closed, project: project.id, trouble: `Orca answered the delete of Orca project ${project.id}, and still lists it. ${bot} was not moved. Retire ${bot} again with obk retire; if Orca still lists the project after that, remove it in Orca yourself, then retire ${bot} again.` };
    }
    // Only now: Orca's window keeps a removed project in its sidebar until
    // it is rebuilt (#343).
    windowReloaded = reloadWindow();
  }

  for (const name of new Set([...known.sessions, ...booked].map((session) => session.name))) {
    rmSync(promptPath(bots, bot, name), { force: true });
  }
  unlinkSkills(home);
  mkdirSync(retiredDir(bots), { recursive: true });
  renameSync(botDir(bots, bot), moved);

  return { bot, closed, ...(project === undefined ? {} : { project: project.id, windowReloaded }), moved };
}
