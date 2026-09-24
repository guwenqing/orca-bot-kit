// `obk pause` and `obk unpause`: stop a bot, or one of its sessions, for now,
// and bring it back as it was.
//
// A pause is a mark in the bot's `bot.yaml` and the bot's tabs closed. The
// mark is what `up` reads to leave it closed, and the book keeps the
// conversation each session was in, so an unpause is the mark taken off and
// the ordinary `up`, which resumes it (ADR 0012).
//
// The closing is restart's, with restart's rules: only the tabs the book names,
// one at a time by their own handles, and none at all when one of them holds a
// conversation the book could not name again.

import { realpathSync } from 'node:fs';

import { botDir, markPaused, readBot } from './bot.js';
import { DAILY_SESSION } from './init.js';
import { closeTabs, tabsToClose } from './restart.js';
import { BOT_FATHER, botsNamed, bringUp, sessionsOf } from './up.js';

/**
 * Pause the bot `bot`, or its session `session`. Returns
 * `{ bot, session, changed, closed }`: whether the mark was new, and one entry
 * per tab it closed.
 */
export async function pauseSessions(bots, { bot, session }) {
  const home = fleetMember(bots, bot, 'pause', session);
  const sessions = sessionsOf(readBot(home, bot), session);

  // Judged before anything is written or closed, so a refusal leaves both as
  // they were.
  const going = tabsToClose(bots, bot, home, sessions);
  const changed = markPaused(bots, bot, session, true);
  const closed = await closeTabs(home, going, bots, bot);
  return { bot, session, changed, closed };
}

/**
 * Take the pause off the bot `bot`, or its session `session`, and bring it up.
 * Returns `{ bot, session, changed, ...what up answered }`.
 */
export async function unpauseSessions(bots, { bot, session }) {
  const home = fleetMember(bots, bot, 'unpause', session);
  sessionsOf(readBot(home, bot), session);

  const changed = markPaused(bots, bot, session, false);
  return { bot, session, changed, ...(await bringUp(bots, { bot, session })) };
}

/**
 * The bot's home, once it is certain the bot is there and is not Bot Father,
 * or its management session: that is where the user asks to bring anything
 * back. Bot Father's other sessions are like any bot's (#230).
 */
export function fleetMember(bots, bot, verb, session) {
  if (bot === BOT_FATHER && session === undefined) {
    throw new Error(`${BOT_FATHER} runs the fleet, and the kit does not ${verb} it: it is where you ask for everything else.`);
  }
  if (bot === BOT_FATHER && session === DAILY_SESSION) {
    throw new Error(`${DAILY_SESSION} is ${BOT_FATHER}'s management session, and the kit does not ${verb} it: it is where you ask for everything else.`);
  }
  botsNamed(bots, bot);
  return realpathSync(botDir(bots, bot));
}
