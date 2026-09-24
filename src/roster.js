// The fleet as facts (PRD 6.8): what each bot is, what each of its sessions is
// set to, and what the book records about them.
//
// This is what Bot Father reads before it says anything about the fleet, and it
// reads files and only files. It does not ask Orca, it changes nothing, and it
// judges nothing: whether a bot is the right bot, what its charter comes to in
// two lines, and which of its limits is the hard one are the reader's to say
// (ADR 0016). What is wrong with the setup is a different question, and
// `obk health` is the command that answers it.
//
// So a list here is the list as the user wrote it, unchecked. A skill named in
// it that is nowhere on disk is still reported, because the fact is that the
// bot's list names it.

import path from 'node:path';

import { botDir, botNames, readBot } from './bot.js';
import { readBook } from './book.js';
import { harnessOf } from './launch.js';
import { listIn } from './rules.js';

/** The bot's own file, which is where everything but the book comes from. */
const BOT_YAML = 'bot.yaml';

/**
 * The fleet, or the one bot named, in the order `botNames` gives: one entry per
 * bot, each holding what its `bot.yaml` says and what its book holds.
 */
export function readRoster(bots, { bot: only } = {}) {
  const names = botNames(bots);
  if (only !== undefined && !names.includes(only)) {
    throw new Error(`there is no bot called ${only} in ${bots}. The bots there are: ${names.join(', ') || 'none'}.`);
  }
  return (only === undefined ? names : [only]).map((name) => card(bots, name));
}

/**
 * One bot's entry. The settings come back as the session carries them, so a
 * setting it does not carry is absent rather than guessed: the kit never
 * invents a model or an effort, and not set means the harness's own.
 *
 * The one thing worked out rather than copied is the harness, because a session
 * either names its own or runs on its bot's, and which of the two it is is not
 * a fact about the fleet that anybody should have to derive twice.
 */
function card(bots, name) {
  const home = botDir(bots, name);
  const file = path.join(home, BOT_YAML);
  const bot = readBot(home, name);
  const book = readBook(home);

  return {
    bot: name,
    home,
    harness: bot.harness,
    charter: bot.charter,
    ...(bot.paused === true ? { paused: true } : {}),
    rules: listIn(file, 'rules'),
    skills: listIn(file, 'skills'),
    orca: book.orca,
    sessions: bot.sessions.map((session) => ({
      ...session,
      harness: harnessOf(session, bot.harness),
      // What the kit knows about this session as a running thing, kept apart
      // from what the user set: the tab it is in, the conversation it is
      // having, the ones it had before, and anything in its folder that no
      // session claims. Empty until it has been brought up.
      book: book.sessions[session.name] ?? {},
    })),
  };
}
