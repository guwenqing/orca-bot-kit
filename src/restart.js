// `obk restart`: the one command in the kit that closes a tab.
//
// Everything else only adds. Closing a tab takes the user's screen away and
// Orca's resume record with it, so `up` never does it (PRD 6.5: restarts are
// avoided, not banned, and one happens when the user asks for it).
//
// When they do ask, the session has to come back as itself. The book holds the
// conversation each session is running (ADR 0002), so a restart is: close the
// tab the book names, then let `up` open a new one and resume that
// conversation. Nothing else about it is new.
//
// Safe is the whole of it, and it is three rules:
//
//   1. Only a tab the book itself names. Bot Father's ops tab, and anything
//      else open in a bot's project, belongs to the user (PRD 6.2).
//   2. Never a tab whose conversation the kit could not name again. A live tab
//      with no session id in the book is refused before anything is touched:
//      the close would be the end of that conversation.
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
import { closeTab, findProject, tabs } from './orca.js';
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
  const sessions = sessionsOf(readBot(home, name), onlySession);

  // And the same preparations, made now rather than left to `up`, which makes
  // them after the tabs would already be gone. A session the kit could not
  // start again — a launch line it would refuse, rules that will not build, a
  // hooks file it cannot write — is a session that keeps the tab it is in.
  const prepared = prepareBots(bots, [name], onlySession);
  if (prepared.running.length === 0) {
    throw new Error(`${name} would not come up again as it is, so nothing was closed. ${prepared.rules[0].trouble}`);
  }

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
    if (typeof was.session === 'string') going.push({ name: session.name, tab });
    else refusals.push(cannotComeBack(bots, name, session.name, was));
  }

  // Every session is judged before one tab is closed: a fleet of two where one
  // cannot come back is not a fleet to close the other half of.
  if (refusals.length > 0) throw new Error(refusals.join('\n'));

  const closed = [];
  for (const { name: session, tab } of going) {
    try {
      closeTab(tab.handle);
    } catch (error) {
      // A tab that would not close still holds its session, so nothing is
      // opened after this: two harnesses on one conversation is worse than a
      // restart that did not happen.
      throw new Error(alsoClosed(error.message, closed, bots, name));
    }
    closed.push({ bot: name, name: session, tabId: tab.tabId, terminal: tab.handle });
  }

  await gone(home, closed, bots, name);
  return { closed, ...(await bringUp(bots, { bot: name, session: onlySession })) };
}

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
 */
async function gone(home, closed, bots, bot) {
  const until = Date.now() + SETTLED_MS;
  const ids = closed.map((tab) => tab.tabId);

  for (;;) {
    const there = new Set(tabs(home).map((tab) => tab.tabId));
    const left = ids.filter((id) => there.has(id));
    if (left.length === 0) return;

    if (Date.now() >= until) {
      const one = left.length === 1;
      throw new Error(`Orca answered the close for ${one ? 'this tab' : 'these tabs'} and is still listing ${one ? 'it' : 'them'} ${SETTLED_MS / 1000} seconds later: ${left.join(', ')}. Nothing was opened in ${one ? 'its' : 'their'} place, because a tab that is on the way out is not a tab to start a harness in. The conversations are in the book: obk up --bots ${bots} --bot ${bot} brings them back once Orca has caught up.`);
    }
    await pause(ASK_MS);
  }
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

/** What a failed close owes whoever is reading: the tabs that went before it. */
function alsoClosed(why, closed, bots, bot) {
  if (closed.length === 0) return why;

  const one = closed.length === 1;
  return `${why} ${closed.map((tab) => tab.name).join(', ')} ${one ? 'was' : 'were'} closed before it and nothing was opened in ${one ? 'its' : 'their'} place: obk up --bots ${bots} --bot ${bot} brings ${one ? 'it' : 'them'} back with ${one ? 'its' : 'their'} conversation.`;
}
