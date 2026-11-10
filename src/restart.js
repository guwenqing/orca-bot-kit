// `obk restart`: the one command in the kit that closes a tab.
//
// Everything else only adds. Closing a tab takes the user's screen away and
// Orca's resume record with it, so `up` never does it (PRD 6.5: restarts are
// avoided, not banned, and one happens when the user asks for it).
//
// When they do ask, the session has to come back as itself. The book holds the
// conversation each session is running (ADR 0012), so a restart is: close the
// tab the book names, then let `up` open a new one and resume that
// conversation. Nothing else about it is new.
//
// Safe is the whole of it, and it is three rules:
//
//   1. Only a tab the book itself names. Bot Father's ops tab, and anything
//      else open in a bot's project, belongs to the user (PRD 6.2).
//   2. Never a tab whose conversation the kit could not name again. A live tab
//      with no session id in the book is refused before anything is touched:
//      the close would be the end of that conversation. Unless only its shell
//      is in front: its harness has quit, so the close ends nothing, and `up`
//      starts the session fresh as it does any closed tab with no id (#303).
//   3. One tab at a time, by its own handle. Orca's `--worktree <sel> --all`
//      ends every tab of a project and is never called from anywhere in the kit.
//
// And two things about timing, both of which cost a session when they are got
// wrong. Everything that can refuse has to refuse before the first close, which
// means making the preparations `up` makes rather than leaving them to it. And
// Orca answers a close before its own listing agrees, so the close has to be
// seen to have landed before `up` is handed the tabs — `up` finding a tab it
// was about to replace takes it for a session that is still running.

import { realpathSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

import { bookFile, readBook } from './book.js';
import { botDir, readBot } from './bot.js';
import { ownCli, shellWord } from './launch.js';
import { closeTab, closeTerminal, findProject, frontOfTab, livePtys, orcaCli, tabs } from './orca.js';
import { botsNamed, bringUp, prepareBots, sessionsOf } from './up.js';

/**
 * Close the tabs of the bot's sessions, or of the one named, and bring them
 * back. Returns `{ closed, ...what up answered }` — one entry per tab it
 * closed, and then the whole of the run that opened them again.
 */
export async function restartSessions(bots, { bot: name, session: onlySession } = {}) {
  // The same refusals `up` gives for a bot or a session that is not there, and
  // given before Orca is asked for anything.
  botsNamed(bots, name);
  const home = realpathSync(botDir(bots, name));
  const known = readBot(home, name);
  const sessions = sessionsOf(known, onlySession);
  // A paused bot or session has no tab to close and is not to be opened, so
  // there is nothing here to restart.
  if (known.paused === true) {
    throw new Error(`${name} is paused, so there is nothing of it to restart and nothing was closed. Bring it back with ${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${name}.`);
  }
  if (onlySession !== undefined && sessions[0].paused === true) {
    throw new Error(`${name} ${onlySession} is paused, so there is nothing of it to restart and nothing was closed. Bring it back with ${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${name} --session ${onlySession}.`);
  }

  // And the same preparations, made now rather than left to `up`, which makes
  // them after the tabs would already be gone. A session the kit could not
  // start again — a launch line it would refuse, rules that will not build, a
  // hooks file it cannot write — is a session that keeps the tab it is in.
  const prepared = prepareBots(bots, [name], onlySession);
  if (prepared.running.length === 0) {
    throw new Error(`${name} would not come up again as it is, so nothing was closed. ${prepared.rules[0].trouble}`);
  }

  const going = tabsToClose(bots, name, home, sessions.filter((session) => session.paused !== true), { quit: true });
  const closed = await closeTabs(home, going, bots, name, commandLine('restart', bots, name, onlySession));
  // The sessions whose tabs this closed are the ones the restart ended
  // something of, and the ones told so once they are back (#726).
  return { closed, ...(await bringUp(bots, { bot: name, session: onlySession, restarted: new Set(closed.map((tab) => tab.name)) })) };
}

/**
 * The live tabs of these sessions, as `{ name, tab }`, once every one of them
 * has been judged safe to close: a live tab whose conversation the book cannot
 * name refuses the lot, before anything is touched. With `keepless`, a tab is
 * closed whatever the book knows, for a caller that is ending the session on
 * purpose. With `quit`, a tab whose harness has quit to its shell is closed
 * too, for a caller that starts the session again: there is nothing in it to
 * lose. A program in front, or a front that cannot be read, still refuses.
 */
export function tabsToClose(bots, name, home, sessions, { keepless = false, quit = false } = {}) {
  const book = readBook(home);

  // Orca is asked what the project holds only when it has one: a folder Orca
  // knows nothing about is refused with `selector_not_found` rather than
  // answered with an empty list (tech notes, section 1). A bot that has never
  // been up has no tabs, which is the answer anyway.
  const live = findProject(home) === undefined
    ? new Map()
    : new Map(tabs(home).map((tab) => [tab.tabId, tab]));

  const going = [];
  const refusals = [];
  for (const session of sessions) {
    const was = book.sessions[session.name];
    const tab = typeof was?.tab === 'string' ? live.get(was.tab) : undefined;
    // Nothing of this session's is open: there is nothing to close, and `up`
    // brings it back the way it brings back a tab the user closed themselves.
    if (tab === undefined) continue;
    if (keepless || typeof was.session === 'string' || (quit && frontOfTab(tab.handle).front === 'shell')) going.push({ name: session.name, tab });
    else refusals.push(cannotComeBack(bots, name, session.name, was));
  }

  // Every session is judged before one tab is closed: a fleet of two where one
  // cannot come back is not a fleet to close the other half of.
  if (refusals.length > 0) throw new Error(refusals.join('\n'));
  return going;
}

/**
 * Close the tabs `tabsToClose` gave, one at a time by their own handles, and
 * wait until Orca's listing agrees they are gone. Returns one entry per tab.
 * `again` is the command that asked, as the user would run it again: what to do
 * once a tab Orca would not close has been closed by hand. With `retiring`, the
 * caller starts no harness in the tabs' place, so a tab Orca still lists after
 * the wait may count as gone once its process is shown to have ended (#733).
 */
export async function closeTabs(home, going, bots, name, again, { retiring = false } = {}) {
  const closed = [];
  for (const { name: session, tab } of going) {
    try {
      closeWhole(tab.handle, again);
    } catch (error) {
      // A tab that would not close still holds its session, so nothing is
      // opened after this: two harnesses on one conversation is worse than a
      // restart that did not happen.
      throw new Error(alsoClosed(error.message, closed, bots, name, retiring ? again : undefined));
    }
    closed.push({ bot: name, name: session, tabId: tab.tabId, terminal: tab.handle });
  }

  await gone(home, closed, bots, name, retiring ? { again, ptys: new Map(going.map(({ tab }) => [tab.tabId, tab.ptyId])) } : undefined);
  return closed;
}

/**
 * Close one session's tab. Orca finds a `--tab` close in a tab snapshot of its
 * own, which a tab it still lists can be missing from after a restart, and then
 * answers `tab_not_found` (#405, read in the 1.4.215 bundle). The same terminal
 * closed without `--tab` closes its one-pane tab by id, so that is done instead,
 * and `gone` checks the tab went as it does after any close. Every other
 * refusal stops the restart as it did.
 */
function closeWhole(handle, again) {
  try {
    closeTab(handle);
  } catch (error) {
    if (!notFound(error)) throw error;
    try {
      closeTerminal(handle);
    } catch (second) {
      // With the tab closed by hand there is nothing left for the command to
      // close, so running it again finishes it, whichever command it was.
      throw new Error(`${error.message}, and then ${second.message}. Close it by hand, then run the same command again: ${shellWord(orcaCli())} terminal close --terminal ${shellWord(handle)}  then  ${again}`);
    }
  }
}

/**
 * Whether Orca refused a `--tab` close for a tab it could not find: its code,
 * or its 1.4.215 form of code `runtime_error` with exactly that message. Orca's
 * own words, never the kit's wrapped text, and no other form (#405).
 */
const notFound = (error) =>
  error.code === 'tab_not_found' || (error.code === 'runtime_error' && error.reason === 'tab_not_found');

/** A command of the kit's as the user would type it, for a message to name. */
export const commandLine = (verb, bots, bot, session) =>
  `${shellWord(ownCli())} ${verb} --bots ${shellWord(bots)} --bot ${bot}${session === undefined ? '' : ` --session ${session}`}`;

/** How long Orca is given to stop listing a tab it has closed, and how often it is asked. */
const SETTLED_MS = 5000;
const ASK_MS = 100;

/**
 * Wait until Orca's own listing has caught up with the closes.
 *
 * `terminal close` answers before `terminal list` stops reporting the tab —
 * seen live on a busy machine, which is why both system tests poll for it. What
 * that costs here is the whole command: `up` lists the tabs, finds the one just
 * closed, takes it for a session that is still running and only retitles it, so
 * the run ends having reported a restart and ended a session.
 *
 * A listing that never catches up is not something the kit can put right, so it
 * stops and says which tab it is waiting on. The conversation is in the book,
 * which is the way back to it.
 *
 * A retire, given as `retire: { again, ptys }`, starts nothing in the tabs'
 * place, and what it must not leave behind is a live harness (#733). Orca
 * 1.4.255 can go on listing a closed tab for minutes, `connected: false`,
 * after its process has ended: a pane its window still holds (tech notes,
 * section 1). That row alone does not prove the process ended, since a pane
 * can say it is not connected while its pty is live, and so Orca's own list
 * of live ptys is read too. Once the wait is over, a tab of the retire's
 * counts as gone when every row Orca lists for it says `connected: false`
 * with the pty the kit closed, and Orca holds no process for that pty.
 * Anything the kit cannot read is "cannot tell", and the retire stops as
 * before, with the retire to run again: the user wants the session gone, not
 * back.
 */
async function gone(home, closed, bots, bot, retire) {
  // Nothing closed is nothing to wait for, and a bot that has never been up has
  // no Orca project to ask: Orca refuses the listing (tech notes, section 1).
  if (closed.length === 0) return;
  const until = Date.now() + SETTLED_MS;
  const ids = closed.map((tab) => tab.tabId);

  for (;;) {
    const listed = tabs(home);
    const there = new Set(listed.map((tab) => tab.tabId));
    let left = ids.filter((id) => there.has(id));
    if (left.length === 0) return;

    if (Date.now() >= until) {
      const one = left.length === 1;
      if (retire === undefined) {
        throw new Error(`Orca answered the close for ${one ? 'this tab' : 'these tabs'} and is still listing ${one ? 'it' : 'them'} ${SETTLED_MS / 1000} seconds later: ${left.join(', ')}. Nothing was opened in ${one ? 'its' : 'their'} place, because a tab that is on the way out is not a tab to start a harness in. The conversations are in the book: ${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${bot} brings them back once Orca has caught up.`);
      }
      left = stillRunning(listed, left, retire.ptys);
      if (left.length === 0) return;
      const few = left.length === 1;
      throw new Error(`Orca answered the close for ${few ? 'this tab' : 'these tabs'} and is still listing ${few ? 'it' : 'them'} ${SETTLED_MS / 1000} seconds later, and the kit cannot tell that ${few ? 'its harness has' : 'their harnesses have'} stopped: ${left.join(', ')}. The retire stopped there. Once Orca has caught up, run the same retire again: ${retire.again}`);
    }
    await pause(ASK_MS);
  }
}

/**
 * Of the tab ids `left`, the ones Orca's listing `listed` does not show to have
 * ended: a tab ended when each row for it says `connected: false` with the pty
 * `ptys` gives it, and `livePtys` reads and lacks that pty.
 */
function stillRunning(listed, left, ptys) {
  const live = livePtys();
  if (live === undefined) return left;
  return left.filter((id) => {
    const pty = ptys.get(id);
    const ended = (tab) => tab.connected === false && tab.ptyId === pty;
    return typeof pty !== 'string' || live.has(pty) || !listed.filter((tab) => tab.tabId === id).every(ended);
  });
}

/**
 * A session the kit will not close a tab on: it is live, and the book does not
 * say which conversation is in it — a Codex hooks file trusted too late is
 * enough to leave the book like that (tech notes, section 3).
 *
 * The kit will not pick one either, so the way out is the user's: the ids it
 * found and nobody claims are named, and the line to write is spelled out.
 */
function cannotComeBack(bots, bot, name, was) {
  const unclaimed = Array.isArray(was.unclaimed) ? was.unclaimed : [];
  return [
    `${bot} ${name} is running in tab ${was.tab} and the book does not say which conversation that is, so closing the tab would be the end of it. Nothing was closed.`,
    ...(unclaimed.length === 0
      ? []
      : [`These ran in this bot's folder and no session claims them: ${unclaimed.join(', ')}.`]),
    `To settle it, write the id into ${bookFile(botDir(bots, bot))} under ${name} as  session: <id>  and run the command again.`,
  ].join(' ');
}

/**
 * What a failed close owes whoever is reading: the tabs that went before it.
 * For a retire, given as the command to run again, the way on is that retire,
 * not `up`: the user wants those sessions gone, not back (#733).
 */
function alsoClosed(why, closed, bots, bot, retireAgain) {
  if (closed.length === 0) return why;

  const one = closed.length === 1;
  if (retireAgain !== undefined) {
    return `${why} ${closed.map((tab) => tab.name).join(', ')} ${one ? 'was' : 'were'} closed before it, and nothing more was retired. Once that tab can be closed, run the same retire again: ${retireAgain}`;
  }
  return `${why} ${closed.map((tab) => tab.name).join(', ')} ${one ? 'was' : 'were'} closed before it and nothing was opened in ${one ? 'its' : 'their'} place: ${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${bot} brings ${one ? 'it' : 'them'} back with ${one ? 'its' : 'their'} conversation.`;
}
