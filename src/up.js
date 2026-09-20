// `obk up`: make the bots real in Orca, and put back whatever is missing.
//
// It only ever adds. It never closes a tab: closing one throws away the user's
// conversation and Orca's resume record with it. Run it twice and the second
// run does nothing.

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readBook, sessionIdsIn, tabIdsIn, updateBook } from './book.js';
import { botDir, botNames, displayName, readBot } from './bot.js';
import { conversationsIn } from './conversations.js';
import { installHook } from './hooks.js';
import { harnessOf, isShortPrompt, launchCommand, sessionTrouble, startPrompt, workDirOf } from './launch.js';
import { asFolderProject, findProject, makeProject, openTab, retitleTab, tabs, tuiInTab, typeIntoTab } from './orca.js';

/** The one bot with a tab beside its sessions: the ops tab (PRD 6.2). */
export const BOT_FATHER = 'bot-father';

/** How long a harness is given to draw its first screen before the kit gives up on it. */
const STARTUP_MS = 10000;

/**
 * And how long the second look takes. A harness can draw its first screen and
 * then die on something it was handed — a context window it cannot read, an
 * extra argument it does not know — and the first look would have called it
 * started. A tab whose TUI is still there answers this at once; only one that
 * has fallen back to a shell waits it out.
 */
const SECOND_LOOK_MS = 2000;

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

  // Every bot that is coming up is read and judged before Orca is asked for
  // anything at all: a fleet with one session the kit cannot start is a fleet
  // the user fixes in one edit, not one they find half opened.
  const chosen = (onlyBot === undefined ? names : [onlyBot]).map((name) => {
    const home = realpathSync(botDir(bots, name));
    return { home, bot: readBot(home, name) };
  });
  for (const { bot, home } of chosen) refuseWhatCannotStart(bot, home, onlySession);

  // And the kit's hook goes into every bot folder before Orca is asked for
  // anything, for the same reason: a harness reads its hooks when it comes up,
  // so one written later would miss the session it was written for (ADR 0010),
  // and a bot folder the kit cannot write it into stops the run with nothing
  // opened anywhere. Only the harnesses a bot actually runs on; a bot with no
  // sessions gets none.
  for (const { bot, home } of chosen) {
    for (const harness of new Set(sessionsOf(bot, onlySession).map((session) => harnessOf(session, bot.harness)))) {
      installHook(home, harness, { bots, bot: bot.name });
    }
  }

  const report = chosen.flatMap(({ bot, home }) => bringUpBot(bots, home, bot, onlySession));

  // A session whose conversation the kit cannot name is not brought up as a new
  // one, and the run says so rather than reporting a fleet that is all there.
  // It comes last: everything that could come up has, and nothing was guessed.
  const lost = report.filter((one) => one.conversationUnknown !== undefined);
  if (lost.length > 0) throw new Error(cannotPlace(bots, lost));

  return report;
}

/**
 * What to say about a session whose conversation the kit cannot name: which
 * session it is, why it is not up, what the harness has that might be it, and
 * the two ways out. Which conversation is which is the user's to say — the kit
 * guessing is how one session ends up with another's (round 2, finding 3).
 */
const cannotPlace = (bots, lost) => lost.map(({ bot, name, conversationUnknown }) => [
  `${bot} ${name}: the kit cannot say which conversation this session is, so it is not up.`,
  `  The book holds no session id for it, and ${bot}'s harness has more than one conversation`,
  '  for this bot\'s folder that no session claims:',
  ...conversationUnknown.map((id) => `    ${id}`),
  `  Write the right one into ${path.join(bots, 'bots', bot, 'sessions.yaml')} under ${name} as`,
  '  session: <id>, or bring it back in the tab yourself. Then run obk up again.',
].join('\n')).join('\n\n');

function refuseWhatCannotStart(bot, home, onlySession) {
  for (const session of sessionsOf(bot, onlySession)) {
    const trouble = sessionTrouble(session, harnessOf(session, bot.harness), home);
    if (trouble !== undefined) throw new Error(`${bot.name}: ${trouble}`);
  }
}

/** The sessions a run is bringing up: all of the bot's, or the one it named. */
function sessionsOf(bot, onlySession) {
  if (onlySession === undefined) return bot.sessions;

  const named = bot.sessions.filter((session) => session.name === onlySession);
  if (named.length === 0) {
    throw new Error(`${bot.name} has no session called ${onlySession}. Add it with obk session add, or name one it has.`);
  }
  return named;
}

function bringUpBot(bots, home, bot, onlySession) {
  const name = bot.name;
  const title = displayName(name);
  const sessions = sessionsOf(bot, onlySession);

  // Orca is asked first and the book is written after: nothing that takes time
  // happens while the book is held, because a session's own hook may be writing
  // its id into that same file at any moment.
  const orca = orcaProject(home, title);
  updateBook(home, (book) => { book.orca = orca; });

  const live = new Map(tabs(home).map((tab) => [tab.tabId, tab]));
  const report = sessions.map((session) => bringUpSession(bots, home, live, session, bot, title));

  // The ops tab, and the whole of what the kit knows about it: Bot Father's
  // project needs one tab that is not a session, for work across the fleet. Any
  // tab outside the book is that tab — the kit does not ask who made it, does
  // not write it down and does not touch it again. No other bot has one, and a
  // run asked for one session is not the run to go looking.
  if (name === BOT_FATHER && onlySession === undefined) {
    const sessionTabs = tabIdsIn(readBook(home));
    const spare = [...live.values()].filter((tab) => !sessionTabs.has(tab.tabId));
    report.push(...(spare.length === 0
      ? [entry(openTab(home, `${title} ops`), { bot: name, name: null, created: true })]
      : spare.map((tab) => entry(tab, { bot: name, name: null, created: false }))));
  }

  return report;
}

function bringUpSession(bots, home, live, session, bot, title) {
  const book = readBook(home);
  const was = book.sessions[session.name];
  const known = live.get(was?.tab);
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
  const harness = harnessOf(session, bot.harness);

  // Which conversation this session is. A session the kit can name is picked up
  // where it left off, with the conversation it had: the tab is gone, but the
  // harness still has the session. Its duty was given to it once and is not
  // given again (PRD 6.4) — after a clear it is, and that is the hook's work.
  const which = whichConversation(book, home, bot, session, was, harness);
  // And a session whose conversation the kit cannot name is not brought up as a
  // new one. It is left alone and said plainly, and the fleet still comes up.
  if (which.unknown !== undefined) return unknown(bot.name, session.name, which.unknown);

  const resume = which.resume;
  const prompt = resume === undefined ? startPrompt(session, { home, workDir }) : undefined;
  // Anything longer than a line goes to the harness out of a file, rather than
  // through the tab's shell a character at a time.
  const promptFile = prompt === undefined || isShortPrompt(prompt) ? undefined : promptPath(bots, bot.name, session.name);
  const command = launchCommand(session, { harness, home, workDir, prompt, promptFile, resume });

  // A work dir is a plain folder, made for the session before it is told about
  // it (PRD 6.4). Nothing here is a git worktree.
  if (workDir !== undefined) mkdirSync(workDir, { recursive: true });

  // The prompt is written where the launch line can read it from, before that
  // line is typed. It is the kit's own file, not the user's: theirs stays where
  // they put it, in the bot home.
  if (promptFile !== undefined) {
    mkdirSync(path.dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, prompt);
  }

  const made = openTab(home, tabTitle);

  // Written down the moment it exists, before anything that can fail. A tab
  // whose id never reached the book is a tab nobody owns: the next run would
  // start a second harness beside it and take this one for the spare. What the
  // book already knew about the session stays — including an id written by a
  // hook while this run was busy with Orca; only the tab, the time this run
  // started a harness in it, and a conversation taken over from the harness's
  // own record are new.
  const launched = new Date().toISOString();
  updateBook(home, (current) => {
    current.sessions[session.name] = {
      ...current.sessions[session.name],
      tab: made.tabId,
      launched,
      ...(which.adopted === true ? { session: resume } : {}),
    };
  });

  // Typing it in is the way: for a project the kit has just made, giving Orca
  // the harness as the tab's own command times out and leaves a dead tab.
  typeIntoTab(made.handle, command);

  // And then asking whether a TUI came up, rather than assuming one did. The
  // text goes into the tab's own shell, which may have been busy with a
  // question of its own and swallowed the first characters of it.
  //
  // Twice, because coming up and staying up are different things: a harness
  // that refuses what it was handed draws a screen, prints its complaint and
  // leaves a shell behind, and a run that looked once would report it as
  // started. A tab that still has a TUI answers the second look at once,
  // whatever the agent in it is busy with.
  const tui = tuiInTab(made.handle, STARTUP_MS).running ? tuiInTab(made.handle, SECOND_LOOK_MS) : { running: false };

  // The start prompt went in with that line, as the harness's own prompt
  // argument, so it is the harness that holds it until it is ready — through
  // its folder-trust question and its update offer. What is still worth saying
  // is whether the line took at all: a shell that swallowed it swallowed the
  // duty with it, and nobody has been told anything.
  const promptSent = prompt === undefined ? undefined : tui.running === true;

  return entry(made, {
    bot: bot.name,
    name: session.name,
    created: true,
    ...tui,
    promptSent,
    promptFile,
    resumed: resume !== undefined,
    adopted: which.adopted,
    conversationLost: which.lost,
  });
}

/**
 * Which conversation this session is about to be, as far as anything can say:
 * the one the book holds, one the harness itself still has on record, or none.
 *
 * One tab holds one session, and the book is the authority for which
 * conversation that is (ADR 0002). But the book can be incomplete — on Codex a
 * hooks file must be trusted before any hook runs, and trusting it does not
 * replay the event it missed — and "the book does not say" must never be read as
 * "there was no conversation". So where the book is silent about a tab the kit
 * has already started a harness in, the harness's own record is asked.
 */
function whichConversation(book, home, bot, session, was, harness) {
  if (typeof was?.session === 'string') return { resume: was.session };
  // No tab: nothing has ever run for this session, so there is nothing to find.
  if (typeof was?.tab !== 'string') return {};

  const claimed = sessionIdsIn(book);
  const known = typeof was.launched === 'string'
    ? conversationsIn(harness, home, was.launched).filter((one) => !claimed.has(one.id))
    : [];

  // One conversation of this bot home that no session claims: this session's,
  // and the kit takes it over rather than leaving it behind.
  if (known.length === 1) return { resume: known[0].id, adopted: true };
  // None on record: the harness never got as far as a conversation here — an
  // unanswered trust question is enough for that. A new one is started, and the
  // report says so rather than passing it off as an ordinary first run.
  if (known.length === 0) return { lost: true };
  // Several, and nothing here can tell which is this session's. Guessing would
  // hand one session another's conversation, so the kit says what it found.
  return { unknown: known.map((one) => one.id) };
}

/** A session left alone because the kit cannot say which conversation it is. */
const unknown = (bot, name, conversations) => ({
  bot,
  name,
  title: null,
  tabId: null,
  terminal: null,
  created: false,
  harnessStarted: false,
  conversationUnknown: conversations,
});

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

/**
 * Where the kit leaves a prompt for the launch line to pick up: a folder of its
 * own beside the bots repo, the way skill-source clones sit beside it (PRD 6.3)
 * — kit-made, never inside the user's repo, so it stays out of their git status.
 *
 * Beside *this* bots folder, and not in a shared temp directory: two bots
 * folders may each hold an api-bot with a daily session, and one file for both
 * of them is one bot's duty handed to another's session.
 */
const promptPath = (bots, bot, session) =>
  path.join(`${bots}.prompts`, `${encodeURIComponent(bot)}.${encodeURIComponent(session)}.txt`);

function entry(tab, { bot, name, created, running = false, blockedReason, promptSent, promptFile, resumed, adopted, conversationLost }) {
  const made = { bot, name, title: tab.title, tabId: tab.tabId, terminal: tab.handle, created, harnessStarted: running };
  // Whether this run picked the session up where it was or started a new one.
  // Only for a tab this run opened: a tab that was already there was left alone.
  if (resumed !== undefined) made.resumed = resumed;
  // Orca's own words for what is on screen waiting to be answered, when it
  // gave any: the caller acts on it, the kit only passes it on.
  if (blockedReason !== undefined) made.blockedReason = blockedReason;
  // Where a resumed conversation came from the harness's own record rather than
  // from the book, and where the harness had no conversation on record at all:
  // both are things the caller is told rather than left to find out.
  if (adopted === true) made.adopted = true;
  if (conversationLost === true) made.conversationLost = true;
  // Only for a session this run started that had something to be told.
  if (promptSent !== undefined) made.promptSent = promptSent;
  // And the file it was told it out of, when it was too long for the line.
  if (promptFile !== undefined) made.promptFile = promptFile;
  return made;
}
