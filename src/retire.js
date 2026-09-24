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

import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readBook, tabIdsIn, updateBook } from './book.js';
import { botDir, dropSession, readBot } from './bot.js';
import { deleteProject, findProject, tabs, tellWindow } from './orca.js';
import { fleetMember } from './pause.js';
import { closeTabs, tabsToClose } from './restart.js';
import { unlinkSkills } from './skills.js';
import { BOT_FATHER, promptPath, sessionsOf } from './up.js';

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
 * Retire the bot `bot`. Returns `{ bot, closed, project, moved }`: the tabs it
 * closed, the Orca project it took away (if it had one) and where the bot is now.
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
  if (project !== undefined) {
    deleteProject(project.id);
    tellWindowOfRemoval(bots);
  }

  for (const name of new Set([...known.sessions, ...booked].map((session) => session.name))) {
    rmSync(promptPath(bots, bot, name), { force: true });
  }
  unlinkSkills(home);
  mkdirSync(retiredDir(bots), { recursive: true });
  renameSync(botDir(bots, bot), moved);

  return { bot, closed, ...(project === undefined ? {} : { project: project.id }), moved };
}

/**
 * Tell Orca's window a project went (#224). The call names a project that is
 * still there, and Bot Father's is the one that always is; when Orca has none
 * for it, there is nothing to call on. Finding it is part of the workaround,
 * so it fails as quietly as the call: the project is gone either way.
 */
function tellWindowOfRemoval(bots) {
  try {
    const home = botDir(bots, BOT_FATHER);
    const father = existsSync(home) ? findProject(realpathSync(home)) : undefined;
    if (father !== undefined) tellWindow(father.projectId);
  } catch {
    // Nothing: see above.
  }
}
