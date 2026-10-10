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
// the kit made in its folder. A prompt file that cannot be removed, as under a
// harness's sandbox that may not write beside the bots folder, does not stop a
// retire halfway: nothing reads it once its session is gone, so the retire
// finishes and names it, with how to remove it (#393). A tab the book does not name is the user's, so a
// bot whose project holds one is not retired until they have dealt with it.
//
// Closing a tab here ends the conversation in it on purpose, so unlike a
// restart or a pause it does not wait for the book to know which one it was.
// The mailbox Runs stay: Orca has no way to remove one (ADR 0035). What the
// kit knows of mail sent to a session and not read with `obk message check`
// is said, with who sent it, so it is not lost without a word (#509).
//
// What a session started in its work dir and left running is stopped once its
// tab is closed, and named (#537): see processes.js.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readBook, tabIdsIn, updateBook } from './book.js';
import { botDir, dropSession, readBot } from './bot.js';
import { deleteProject, findProject, projects, reloadWindow, tabs } from './orca.js';
import { shellWord, workDirOf } from './launch.js';
import { fleetMember } from './pause.js';
import { stopProcesses } from './processes.js';
import { closeTabs, commandLine, tabsToClose } from './restart.js';
import { unlinkSkills } from './skills.js';
import { takeUnread } from './unread.js';
import { promptPath, sessionsOf } from './up.js';

/** Where retired bots go: beside `bots/`, where nothing the kit runs looks. */
export const retiredDir = (bots) => path.join(bots, 'retired');

/**
 * Retire the session `session` of the bot `bot`, and first the temporary
 * sessions it made, and theirs (#464, ADR 0033). Returns `{ bot, session,
 * closed, retiredWith }`, and `promptsLeft` when its prompt file could not be
 * removed, and `unread: { count, from }` when the kit knows of mail sent to it
 * that it did not read with `obk message check` (#509), and `processes` when
 * it has a work dir: what `stopProcesses` stopped and left of what it started
 * there (#537). `retiredWith` holds one `{ bot, session, maker, closed }` for each
 * session that went with it, deepest first, with its own `promptsLeft`,
 * `unread` and `processes`.
 */
export async function retireSession(bots, { bot, session }) {
  const home = fleetMember(bots, bot, 'retire', session);
  const known = readBot(home, bot);
  const sessions = sessionsOf(known, session);

  const retiredWith = [];
  const book = readBook(home);
  const made = known.sessions.filter((one) => book.sessions[one.name]?.temporary?.maker === session);
  let closed;
  let processes;
  try {
    for (const { name } of made) {
      const { retiredWith: theirs, ...gone } = await retireSession(bots, { bot, session: name });
      retiredWith.push(...theirs, { ...gone, maker: session });
    }

    closed = await closeTabs(home, tabsToClose(bots, bot, home, sessions, { keepless: true }), bots, bot, commandLine('retire', bots, bot, session));
    // Only once its tab is closed: its harness starts nothing more.
    const dir = workDirOf(sessions[0], home);
    if (dir !== undefined) processes = await stopProcesses([{ session, dir }]);
    dropSession(bots, bot, session);

    const at = new Date().toISOString();
    await updateBook(home, (book) => {
      const entry = book.sessions[session];
      if (entry === undefined) return;
      delete book.sessions[session];
      // Its work dir, so that `obk health` can look there for what still runs (#537).
      book.retired = [...(Array.isArray(book.retired) ? book.retired : []), { name: session, ...entry, ...(dir === undefined ? {} : { work_dir: sessions[0].work_dir }), retired: at }];
    });
  } catch (error) {
    // What already went stays gone, and is named: a retire run again finds
    // nothing of it left to name (#464).
    if (retiredWith.length > 0) error.message = `${error.message} ${goneBefore(session, retiredWith)}`;
    throw error;
  }
  const left = removePrompts([promptPath(bots, bot, session)]);
  const unread = takeUnread(home, session);

  return { bot, session, closed, retiredWith, ...left, ...(unread === undefined ? {} : { unread }), ...(processes === undefined ? {} : { processes }) };
}

/**
 * The sessions retired along with `session` before its own retire failed, in
 * words, with any prompt file of theirs left and how to remove it.
 */
function goneBefore(session, retiredWith) {
  const names = retiredWith.map((gone) => `${gone.bot}/${gone.session}, a temporary session of ${gone.maker}'s`);
  const left = retiredWith.flatMap((gone) => gone.promptsLeft ?? [])
    .map(({ file, reason }) => ` ${file} could not be removed (${reason}), and nothing reads it. Remove it with  rm ${shellWord(file)}`);
  // Their hint of unread mail went with them, so this is the only place it is
  // said (#509 review).
  const unread = retiredWith.flatMap((gone) => (gone.unread === undefined ? [] : [` ${unreadWords(gone.unread, `${gone.bot}/${gone.session}`)}`]));
  // What they left running is said here too, as the answer would have (#537).
  const processes = retiredWith.flatMap((gone) => [
    ...(gone.processes?.stopped ?? []).map((one) => ` Stopped pid ${one.pid} of ${gone.bot}/${gone.session} with ${one.signal}: ${one.command}.`),
    ...(gone.processes?.left ?? []).map((one) => ` Not stopped, pid ${one.pid} in ${one.cwd ?? 'a folder lsof did not name'}: ${one.command} (${one.why}).`),
    ...(gone.processes?.unreadable === undefined ? [] : [` The kit cannot tell what ${gone.bot}/${gone.session} left running, and stopped nothing: ${gone.processes.unreadable}.`]),
  ]);
  return `Retired along with ${session} before that, and still retired: ${names.join('; ')}.${unread.join('')}${processes.join('')}${left.join('')}`;
}

/**
 * The mail a retired session did not read, as far as the kit knows (#509): the
 * kit cannot see a read made with Orca's own check, so it says only this.
 */
export const unreadWords = (unread, who) =>
  `${unread.count} ${unread.count === 1 ? 'message' : 'messages'} sent to ${who} ${unread.count === 1 ? 'was' : 'were'} not read with obk message check, from ${andList(unread.from)}.`;

/** `a`, `a and b`, `a, b and c`. */
const andList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Retire the bot `bot`. Returns `{ bot, closed, project, windowReloaded, moved }`:
 * the tabs it closed, the Orca project it took away (if it had one), whether
 * Orca's window was reloaded after that, and where the bot is now; and
 * `promptsLeft` when a prompt file could not be removed, and `unread: [{
 * session, count, from }]` for its sessions with mail the kit knows was not
 * read with `obk message check` (#509), and `processes` when one of its
 * sessions has a work dir: what `stopProcesses` stopped and left there (#537).
 * When Orca does not confirm the project gone, it returns `{ bot, closed,
 * project, processes, trouble }` instead, and the bot is left where it was.
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
  const closed = await closeTabs(home, tabsToClose(bots, bot, home, booked, { keepless: true }), bots, bot, commandLine('retire', bots, bot));
  // Once their tabs are closed, and before the folder moves (#537).
  const dirs = known.sessions.flatMap((session) => {
    const dir = workDirOf(session, home);
    return dir === undefined ? [] : [{ session: session.name, dir }];
  });
  const processes = dirs.length === 0 ? undefined : await stopProcesses(dirs);
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
      return { bot, closed, project: project.id, ...(processes === undefined ? {} : { processes }), trouble: `Orca answered the delete of Orca project ${project.id}, and its project list could not be read afterwards, so the removal is not confirmed: ${error.message}. ${bot} was not moved. Once Orca is answering, retire ${bot} again with obk retire: it removes the project if it is still there, then finishes.` };
    }
    if (setups.some((setup) => setup.id === project.id || setup.path === home)) {
      return { bot, closed, project: project.id, ...(processes === undefined ? {} : { processes }), trouble: `Orca answered the delete of Orca project ${project.id}, and still lists it. ${bot} was not moved. Retire ${bot} again with obk retire; if Orca still lists the project after that, remove it in Orca yourself, then retire ${bot} again.` };
    }
    // Only now: Orca's window keeps a removed project in its sidebar until
    // it is rebuilt (#343).
    windowReloaded = reloadWindow();
  }

  const names = new Set([...known.sessions, ...booked].map((session) => session.name));
  const left = removePrompts([...names].map((name) => promptPath(bots, bot, name)));
  // Before the folder moves: the hint is filed under the bot home's real path.
  const unread = [...names].flatMap((name) => {
    const taken = takeUnread(home, name);
    return taken === undefined ? [] : [{ session: name, ...taken }];
  });
  unlinkSkills(home);
  mkdirSync(retiredDir(bots), { recursive: true });
  renameSync(botDir(bots, bot), moved);

  return { bot, closed, ...(project === undefined ? {} : { project: project.id, windowReloaded }), moved, ...left, ...(unread.length === 0 ? {} : { unread }), ...(processes === undefined ? {} : { processes }) };
}

/**
 * Remove start-prompt files, and say which could not be: `{ promptsLeft: [{
 * file, reason }] }`, or nothing when every one went. One that is not there is
 * nothing to remove.
 */
function removePrompts(files) {
  const promptsLeft = files.flatMap((file) => {
    try {
      rmSync(file, { force: true });
      return [];
    } catch (error) {
      return [{ file, reason: error.message }];
    }
  });
  return promptsLeft.length === 0 ? {} : { promptsLeft };
}
