// `obk up`: make the bots real in Orca, and put back whatever is missing.
//
// It only ever adds. It never closes a tab: closing one throws away the user's
// conversation and Orca's resume record with it. Run it twice and the second
// run does nothing.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { forgetClaimed, forgetSession, readBook, sessionIdsIn, tabIdsIn, updateBook, withUnclaimed } from './book.js';
import { botDir, botNames, displayName, readBot } from './bot.js';
import { conversationsIn, hasConversation, heldAsUserTurn, transcriptsIn } from './conversations.js';
import { installHook } from './hooks.js';
import { addressOf, harnessOf, isAddressOf, isShortPrompt, launchCommand, mailboxStep, reachesMail, sessionTrouble, startPrompt, workDirOf } from './launch.js';
import { asFolderProject, coordinatorOf, findProject, harnessInTab, makeMailbox, makeProject, openTab, QUESTION_ON_SCREEN, retitleTab, tabs, TERMINAL_ENV, TIMED_OUT, tellWindow, typeIntoTab, useMailbox } from './orca.js';
import { TAB_ENV } from './record.js';
import { buildAgents, rulesStamp } from './rules.js';
import { linkSkills } from './skills.js';

/** The one bot with a tab beside its sessions: the ops tab (PRD 6.2). */
export const BOT_FATHER = 'bot-father';

/** How long a harness is given to draw its first screen before the kit gives up on it. */
const STARTUP_MS = 10000;

/**
 * And how long the second look takes. A harness can draw its first screen and
 * then die on something it was handed — a context window it cannot read, an
 * extra argument it does not know — and the first look would have called it
 * started. An idle harness answers this at once; a busy one and a shell both
 * wait it out, and it is the tab's foreground that tells them apart (#232).
 */
const SECOND_LOOK_MS = 2000;

/**
 * Bring bots up in Orca. Returns `{ tabs, rules }`: one tab entry per tab it
 * looked at — the sessions the book knows, and, for Bot Father, whatever else
 * is open in its project — and one rules entry and one skills entry per bot.
 * `projects` has one entry per Orca project this run made or renamed.
 *
 * With no name it is every bot in the folder, in name order. `bot` brings up
 * one bot and `session` one of its sessions, for a caller that wants one thing
 * back rather than the fleet.
 */
export async function bringUp(bots, { bot: onlyBot, session: onlySession } = {}) {
  const named = botsNamed(bots, onlyBot);
  if (onlySession !== undefined && onlyBot === undefined) {
    throw new Error('--session needs --bot: say which bot the session belongs to.');
  }

  // A paused bot is left closed, rules, skills, tabs and all, and said to be:
  // it was paused on purpose, and `obk unpause` is what brings it back.
  const paused = [];
  const names = named.filter((name) => {
    if (readBot(botDir(bots, name), name).paused !== true) return true;
    paused.push({ bot: name });
    return false;
  });

  const { running, rules, skills } = prepareBots(bots, names, onlySession);

  const report = [];
  const projects = [];
  for (const { bot, home } of running) {
    for (const session of sessionsOf(bot, onlySession)) {
      if (session.paused === true) paused.push({ bot: bot.name, session: session.name });
    }
    const up = await bringUpBot(bots, home, bot, onlySession);
    report.push(...up.tabs);
    if (up.project !== undefined) projects.push(up.project);
  }

  // A bot whose rules would not build is reported here rather than in the
  // preparation, because "its sessions were not started" is this command's
  // answer and not a fact about the bot: a restart prepares the same way and
  // has its own thing to say about it.
  const started = new Set(running.map(({ bot }) => bot.name));
  return {
    tabs: report,
    rules: rules.map((entry) => (started.has(entry.bot) ? entry : {
      ...entry,
      trouble: `${entry.trouble} Its sessions were not started: a bot comes up with its rules or not at all.`,
    })),
    skills,
    paused,
    projects,
  };
}

/**
 * Everything the bots need in place before a session starts, and which of them
 * can be started at all: `{ running, rules, skills }`.
 *
 * Separate from the tabs because the order matters twice over. A session reads
 * its rules, its skills and its hooks as it comes up, so all three have to be
 * there before the tab is (PRD 6.6, ADR 0022) — and a restart closes a tab in
 * between, so everything that can refuse must have refused before that. It
 * refuses by throwing, exactly as `up` always has; a bot it leaves out of
 * `running` is one whose sessions must not be started.
 */
export function prepareBots(bots, names, onlySession) {
  // Every bot that is coming up is read and judged before Orca is asked for
  // anything at all: a fleet with one session the kit cannot start is a fleet
  // the user fixes in one edit, not one they find half opened.
  const chosen = names.map((name) => {
    const home = realpathSync(botDir(bots, name));
    return { home, bot: readBot(home, name) };
  });
  for (const { bot, home } of chosen) refuseWhatCannotStart(bot, home, onlySession);

  // Every bot's AGENTS.md is built before Orca is asked for anything, because a
  // session reads that file as it starts: a build landing after the tab was
  // opened would reach nobody until the next restart (PRD 6.6). It is built at
  // the path the user spelled rather than the resolved one, which is Orca's,
  // so a folder reached through a link is not reported as a road out of the
  // bots folder and back in.
  //
  // A bot the build left with no instructions file at all does not come up:
  // its charter is the boundary it acts inside, and a session started without
  // one has no boundary, which is worse than a session that is not running. A
  // file the user edited themselves is another matter — that bot has its
  // instructions, they are simply theirs, and it comes up like any other.
  //
  // Its skills are linked first, and for the same reason: both harnesses read a
  // project's skills out of the folder the session starts in, so a session that
  // came up before the links were made would be a bot missing the techniques it
  // was given. A skills list the kit cannot follow is reported and does not hold
  // the bot down — skills are what a bot is good at, not the boundary it works
  // inside.
  const skills = chosen.map(({ bot }) => linkSkills(bots, botDir(bots, bot.name), bot));

  const rules = [];
  const running = [];
  for (const chose of chosen) {
    const built = buildAgents(bots, botDir(bots, chose.bot.name), chose.bot);
    rules.push(built);
    if (existsSync(built.file)) running.push(chose);
  }

  // And the kit's hook goes into every bot folder before Orca is asked for
  // anything, for the same reason: a harness reads its hooks when it comes up,
  // so one written later would miss the session it was written for (ADR 0022),
  // and a bot folder the kit cannot write it into stops the run with nothing
  // opened anywhere. Only the harnesses a bot actually runs on; a bot with no
  // sessions gets none.
  for (const { bot, home } of running) {
    for (const harness of new Set(awake(sessionsOf(bot, onlySession)).map((session) => harnessOf(session, bot.harness)))) {
      installHook(home, harness, { bots, bot: bot.name });
    }
  }

  return { running, rules, skills };
}

/**
 * The bots a command is about: every one in the folder, or the one it named.
 *
 * Here because every command that acts on Orca asks the same two questions
 * first, and a user who mistypes a bot's name is owed the same sentence
 * whichever of them they ran.
 */
export function botsNamed(bots, onlyBot) {
  const names = botNames(bots);
  if (names.length === 0) {
    throw new Error(`there are no bots in ${bots} yet: make one with obk bot create --bots <path> --name <name> --harness claude|codex.`);
  }
  if (onlyBot !== undefined && !names.includes(onlyBot)) {
    throw new Error(`there is no bot called ${onlyBot} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }
  return onlyBot === undefined ? names : [onlyBot];
}

function refuseWhatCannotStart(bot, home, onlySession) {
  for (const session of awake(sessionsOf(bot, onlySession))) {
    const trouble = sessionTrouble(session, harnessOf(session, bot.harness), home);
    if (trouble !== undefined) throw new Error(`${bot.name}: ${trouble}`);
  }
}

/**
 * The sessions that are not paused. A paused session is left out of a run
 * altogether, so what it is set to asks nothing of the ones that will start;
 * it is judged again when it is unpaused.
 */
const awake = (sessions) => sessions.filter((session) => session.paused !== true);

/** The sessions a run is bringing up: all of the bot's, or the one it named. */
export function sessionsOf(bot, onlySession) {
  if (onlySession === undefined) return bot.sessions;

  const named = bot.sessions.filter((session) => session.name === onlySession);
  if (named.length === 0) {
    throw new Error(`${bot.name} has no session called ${onlySession}. Add it with obk session add, or name one it has.`);
  }
  return named;
}

async function bringUpBot(bots, home, bot, onlySession) {
  const name = bot.name;
  const title = displayName(name);
  const sessions = awake(sessionsOf(bot, onlySession));

  // Orca is asked first and the book is written after: nothing that takes time
  // happens while the book is held, because a session's own hook may be writing
  // its id into that same file at any moment.
  const { change, ...orca } = orcaProject(home, title);
  await updateBook(home, (book) => { book.orca = orca; });
  // Orca's window does not see a project made or renamed on the command line
  // until it is told (#224).
  if (change !== undefined) tellWindow(orca.project);

  const live = new Map(tabs(home).map((tab) => [tab.tabId, tab]));
  const report = [];
  for (const session of sessions) report.push(await bringUpSession(bots, home, live, session, bot, title));

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

  return { tabs: report, project: change === undefined ? undefined : { bot: name, project: orca.project, change } };
}

async function bringUpSession(bots, home, live, session, bot, title) {
  const harness = harnessOf(session, bot.harness);
  const book = readBook(home);
  const was = book.sessions[session.name];
  const known = live.get(was?.tab);
  const tabTitle = `${title} ${session.name}`;

  if (known) {
    // No name, and no mailbox from here. The name is the one thing the kit
    // cannot give a session that is already running: `-n` goes on the
    // launch line, this session was launched without one, and nothing renames a
    // live harness. Writing the name down here would advertise an address that
    // answers to nobody (review of PR #132, finding 1). It gets one the next
    // time it starts, which is the next time the kit types its launch line. So
    // does a mailbox, if its book has none: that is made from inside the tab
    // the session starts in, and nothing is typed into this one (#317).

    // Whatever runs in the tab may have rewritten its title. The kit writes its
    // own back, and reports that one rather than the name Orca last saw: the id
    // is the session, and a title is only ever set. Nothing is typed into a tab
    // that is already there — the session is in the middle of its work.
    retitleTab(known.handle, tabTitle);
    return entry({ ...known, title: tabTitle }, { bot: bot.name, name: session.name, created: false, noMailbox: lacksMailbox(home, session, harness) });
  }

  // Everything that can be refused is settled before Orca is asked for
  // anything, so a session the kit cannot start leaves no tab behind.
  const workDir = workDirOf(session, home);

  // Which conversation this session is. A session the kit can name is picked up
  // where it left off, with the conversation it had: the tab is gone, but the
  // harness still has the session. Its duty was given to it once and is not
  // given again (PRD 6.4) — after a clear it is, and that is the hook's work.
  // Asked before the book is held, because it reads a folder of the harness's
  // own files: nothing slow happens under the lock.
  let which = whichConversation(book, home, bot, session, was, harness);
  const launchOf = (chosen) => launchFor(bots, bot, session, harness, home, workDir, chosen.resume, was?.address);
  let launch = launchOf(which);

  // A work dir is a plain folder, made for the session before it is told about
  // it (PRD 6.4). Nothing here is a git worktree.
  if (workDir !== undefined) mkdirSync(workDir, { recursive: true });
  writePrompt(launch);

  const made = openTab(home, tabTitle);

  // Written down the moment it exists, before anything that can fail. A tab
  // whose id never reached the book is a tab nobody owns: the next run would
  // start a second harness beside it and take this one for the spare. What the
  // book already knew about the session stays — including an id written by a
  // hook while this run was busy with Orca; only the tab, the time this run
  // started a harness in it, and a conversation taken over from the harness's
  // own record are new.
  const launched = new Date().toISOString();
  // Which instructions it is about to read: the AGENTS.md this run has just
  // built, noted so that health can say when the file moves on and the session
  // does not (#272).
  const rules = rulesStamp(home);
  let held;
  await updateBook(home, (current) => {
    // What the harness has in this folder that nobody claims goes on the record,
    // for a person or Bot Father to settle — added to whatever was already noted,
    // because this run's scan cannot see what an earlier one found. The kit never
    // settles it itself.
    let entry = { ...current.sessions[session.name], tab: made.tabId, launched, rules };
    if (rules === undefined) delete entry.rules;
    held = entry.session;
    // Before the line is typed, so the hook finds no id here and takes the one
    // it reports for a start rather than a clear, which would tell the duty twice.
    if (which.noConversation !== undefined && held === which.noConversation) entry = forgetSession(entry, 'no conversation');
    current.sessions[session.name] = withUnclaimed(entry, which.unclaimed ?? []);
    forgetClaimed(current);
  });

  // The old tab's hook can name another conversation while the tab is being
  // opened. A fresh start chosen before that is chosen again from the id the
  // book holds now: resumed if the harness has it, and otherwise set aside the
  // same way (review of PR #310).
  if (which.noConversation !== undefined && typeof held === 'string' && held !== which.noConversation) {
    which = hasConversation(harness, home, held) ? { resume: held } : { noConversation: held };
    if (which.noConversation !== undefined) {
      await updateBook(home, (current) => {
        const entry = current.sessions[session.name];
        if (entry?.session === held) current.sessions[session.name] = forgetSession(entry, 'no conversation');
      });
    }
    launch = launchOf(which);
    writePrompt(launch);
  }

  // Typing it in is the way: for a project the kit has just made, giving Orca
  // the harness as the tab's own command times out and leaves a dead tab.
  typeIntoTab(made.handle, launch.command);

  // Now the session has an address, and not before: on Claude Code, the name
  // that line just gave it, which is the name another Claude session writes
  // to. Its mailbox comes from the line's own first step, in the tab, and a
  // mailbox Orca will not make there leaves a tab on the books all the same,
  // which the next launch finishes (#317; review of PR #132, finding 3).
  if (launch.address !== undefined) await writeAddress(home, session, launch.address);

  // And then asking whether a TUI came up, rather than assuming one did. The
  // text goes into the tab's own shell, which may have been busy with a
  // question of its own and swallowed the first characters of it.
  //
  // Twice, because coming up and staying up are different things: a harness
  // that refuses what it was handed draws a screen, prints its complaint and
  // leaves a shell behind, and a run that looked once would report it as
  // started.
  const first = lookFor(made.handle, STARTUP_MS);
  const tui = first.running ? lookFor(made.handle, SECOND_LOOK_MS) : first;

  // The start prompt went in with that line, as the harness's own prompt
  // argument, and a harness running in the tab is not yet a session told its
  // duty: one held on a first-run screen, or one that refused the argument, has
  // been told nothing. So it is received only when the session's own record
  // holds it as a user turn, and otherwise not confirmed (#274).
  const promptReceived = launch.prompt === undefined
    ? undefined
    : await heldInRecord(home, session.name, harness, launch.prompt, { launched, running: tui.running === true });

  return entry(made, {
    bot: bot.name,
    name: session.name,
    created: true,
    // Asked once the tab is up: the step at the head of the line has run by
    // then, and whatever it said is on the tab's screen, not in this report.
    noMailbox: lacksMailbox(home, session, harness),
    ...tui,
    promptReceived,
    promptFile: launch.promptFile,
    resumed: launch.resume !== undefined,
    noConversation: which.noConversation,
    unclaimed: which.unclaimed,
  });
}

/**
 * The line that starts this session: resuming `resume`, or, with none, a fresh
 * start carrying its duty. Returns `{ resume, prompt, promptFile, command, address }`.
 */
function launchFor(bots, bot, session, harness, home, workDir, resume, held) {
  const prompt = resume === undefined ? startPrompt(session, { home, workDir }) : undefined;
  // Anything longer than a line goes to the harness out of a file, rather than
  // through the tab's shell a character at a time.
  const promptFile = prompt === undefined || isShortPrompt(prompt) ? undefined : promptPath(bots, bot.name, session.name);
  // A new conversation is given a new name. A resume goes on under the one the
  // kit gave it, and gets a new one when the book `held` none of the kit's own:
  // `--resume <id> -n <name>` renames the conversation, proven live (#319), so
  // a session still under the shared `<bot>.<session>` moves to an address of
  // its own here.
  const address = harness !== 'claude' ? undefined
    : resume !== undefined && isAddressOf(bot.name, session.name, held) ? held
    : addressOf(bot.name, session.name);
  const line = launchCommand(session, {
    harness,
    home,
    workDir,
    prompt,
    promptFile,
    resume,
    address,
  });
  // The session's mailbox first, from inside its own tab (#317), and the
  // harness whatever became of it.
  const command = reachesMail(session, harness) ? `${mailboxStep(bots, bot.name, session.name)}; ${line}` : line;
  return { resume, prompt, promptFile, command, address };
}

/**
 * The prompt is written where the launch line can read it from, before that
 * line is typed. It is the kit's own file, not the user's: theirs stays where
 * they put it, in the bot home.
 */
function writePrompt({ prompt, promptFile }) {
  if (promptFile === undefined) return;
  mkdirSync(path.dirname(promptFile), { recursive: true });
  writeFileSync(promptFile, prompt);
}

/**
 * How long a running harness's own record is given to show the start prompt.
 * Seen live (Claude Code 2.1.282, a trusted folder): the hook's id and the
 * user turn landed about as the second look ended, so one read there comes a
 * moment too early. A harness held on a first-run screen costs the whole wait.
 */
const RECORD_MS = 5000;
const RECORD_ASK_MS = 250;

/**
 * Whether the conversation the book names for this session holds `prompt` as a
 * user turn in the harness's own record. The name comes from the session's own
 * hook, so a harness that has not reported one — held on a first-run screen,
 * say — has no record to be read, and the answer is that it is not confirmed.
 * Another conversation in the same folder is never asked: it may be a sister
 * session told the same words.
 */
async function heldInRecord(home, name, harness, prompt, { launched, running }) {
  const until = Date.now() + (running ? RECORD_MS : 0);
  for (;;) {
    const id = readBook(home).sessions[name]?.session;
    const record = typeof id === 'string' ? transcriptsIn(harness, home, launched).find((one) => one.id === id) : undefined;
    if (record !== undefined && heldAsUserTurn(harness, record.file, prompt)) return true;
    if (Date.now() >= until) return false;
    await pause(RECORD_ASK_MS);
  }
}

/**
 * One look at a tab the kit just typed a launch line into: whether a harness
 * is running there, and what it is waiting on if Orca or its screen says.
 *
 * The harness is up when something other than the shell holds the tab's
 * terminal, busy or not, or when Orca sees a question on its screen. Orca's
 * `agentIdentity` is not asked for: it can come seconds after the launch
 * (tech notes, section 1). When the tab's foreground cannot be read, Orca's own
 * answers stand in, for this report only: nothing more is typed here.
 */
function lookFor(handle, timeoutMs) {
  const seen = harnessInTab(handle, timeoutMs);
  const running = seen.blockedReason !== undefined
    || (seen.front === undefined ? seen.answered || seen.agent !== undefined : seen.front === 'program');
  // A question the kit sees on the screen of a harness that is running, where
  // Orca named none (#329).
  const question = running && seen.question === true ? QUESTION_ON_SCREEN : undefined;
  return { running, blockedReason: seen.blockedReason ?? question };
}

/**
 * Write down the name a session answers to, where this run has just launched it
 * under that name.
 *
 * The name is written by whoever typed the launch line that gave it, and by
 * nobody else. A session that was already running when the kit reached it was
 * started without `-n`, nothing renames a live harness, and a name in the book
 * that no harness answers to is worse than no name: the kit would send another
 * session to an address with nobody at it.
 *
 * The session's mailbox is not made here. The launch line this run typed
 * starts with `obk session mailbox`, which the new tab's shell runs before the
 * harness: Orca 1.4.210 lets a process in a tab bind a Run to that tab and to
 * no other, so the `obk` that opened the tab cannot (#317, `ownMailbox`).
 */
async function writeAddress(home, session, address) {
  if (readBook(home).sessions[session.name]?.address === address) return;

  await updateBook(home, (current) => {
    current.sessions[session.name] = { ...current.sessions[session.name], address };
  });
}

/**
 * `obk session mailbox`: give one session its mailbox, bound to the tab this
 * runs in, which is the session's own. The kit's launch line runs it in a new
 * tab before the harness, and nothing else is meant to.
 *
 * The mailbox is an Orca Run, made once and kept for ever. It has to be a Run
 * rather than the session's tab: Orca calls a terminal a live terminal-only
 * mailbox, says plainly that delivery does not outlive the tab, and refuses a
 * send once the pane is gone, while a Run survives a closed tab, a relaunch and
 * a restart (tech notes, section 1). Orca offers no way to delete one, so this
 * makes one for a session whose book names none, and otherwise binds the one
 * the book names to this tab: after a restart, or a closed tab brought back,
 * it would stay with the tab that is gone (review of PR #248, finding 1).
 *
 * Only inside an Orca tab. Asked from anywhere else, Orca picks a terminal
 * itself, and seen live that was not the asker's (tech notes, section 1), so
 * this refuses rather than bind somebody else's tab.
 *
 * A Codex session whose user turned the sandbox switch off gets none: it could
 * not read a mailbox if it had one, and an address nobody can read is worse
 * than none at all. `obk message` says so in those words.
 */
export async function ownMailbox(bots, botName, sessionName) {
  const home = botDir(bots, botName);
  const bot = readBot(home, botName);
  const session = (bot.sessions ?? []).find((entry) => entry.name === sessionName);
  if (session === undefined) throw new Error(`${botName} has no session called ${sessionName} in ${path.join(home, 'bot.yaml')}.`);
  const who = `${botName}/${sessionName}`;

  if (!reachesMail(session, harnessOf(session, bot.harness))) {
    return { bot: botName, session: sessionName, mailbox: null, change: 'none' };
  }
  if (process.env[TERMINAL_ENV] === undefined) {
    throw new Error(`session mailbox binds ${who}'s mailbox to the Orca tab it runs in, and this is not one: ${TERMINAL_ENV} is not set. The kit runs it in the session's own tab when it starts the session.`);
  }

  // Only in the tab the book names for the session. Two runs of `up` at once
  // can leave a session two tabs, and the book one of them: a mailbox made or
  // bound in the other would be bound to a tab no message is meant for.
  const entry = readBook(home).sessions[sessionName] ?? {};
  const here = process.env[TAB_ENV];
  if (entry.tab === undefined || entry.tab !== here) {
    throw new Error(`${who}'s mailbox is given in the tab the book names for it, ${entry.tab ?? 'none yet'}, and this is ${here ?? 'a tab that does not say which it is'}. Nothing was made or bound.`);
  }

  const held = entry.mailbox;
  if (typeof held === 'string') {
    try {
      useMailbox(held, undefined, STEP_WAIT);
    } catch (error) {
      // An Orca that did not answer may still have done it, and is not asked
      // a second time.
      if (error.code === TIMED_OUT) {
        throw new Error(`${error.message}\n${who}'s mailbox ${held} may now be bound to this tab, or may still be bound where it was: Orca did not say which.`);
      }
      throw new Error(`${error.message}\n${who}'s mailbox ${held} is unchanged: it is still bound to ${boundTo(held)}.`);
    }
    return { bot: botName, session: sessionName, mailbox: held, change: 'bound' };
  }

  // Made outside the book's lock, which is held for one read and one write
  // (book.js).
  let made;
  try {
    made = makeMailbox(who, STEP_WAIT);
  } catch (error) {
    const left = error.code === TIMED_OUT
      ? `None is written down for ${who}; a Run Orca made after the kit stopped waiting is left unused.`
      : `No mailbox was made for ${who}, and none is written down.`;
    throw new Error(`${error.message}\n${left} It gets one the next time the kit starts it.`);
  }

  let kept;
  let movedTo;
  try {
    await updateBook(home, (current) => {
      const now = { ...current.sessions[sessionName] };
      // The book may have moved to another tab while Orca was asked: a second
      // `up` of the same session. Then nothing is written here and nothing
      // bound, so the tab the book names keeps whatever it has.
      if (now.tab !== here) {
        movedTo = now.tab ?? 'none';
        return undefined;
      }
      // Under the lock, and only if the book still has none: two runs at once
      // would each have made one, and a session with two mailboxes is a session
      // half its mail never reaches. The loser's Run is left unused.
      if (typeof now.mailbox !== 'string') now.mailbox = made;
      kept = now.mailbox;
      current.sessions[sessionName] = now;
      return undefined;
    });
  } catch (error) {
    throw new Error(`${error.message}\nOrca made the mailbox ${made} for ${who}, bound to this tab, but it could not be written into the book, so it is left unused. The next time the kit starts ${who}, it makes another.`);
  }
  if (movedTo !== undefined) {
    throw new Error(`the book now names another tab for ${who}, ${movedTo}, so the mailbox ${made} made in this tab is left unused. It is bound to this tab, and nothing was written into the book: ${who}'s mailbox there is left where it is.`);
  }
  // One terminal holds one Run, so making the loser took this tab off the one
  // the book kept. It goes back.
  if (kept !== made) useMailbox(kept, undefined, STEP_WAIT);
  return { bot: botName, session: sessionName, mailbox: kept, change: kept === made ? 'made' : 'bound' };
}

/**
 * How long the step gives each Orca call. The step runs in front of the
 * harness on the launch line, so it has to end: an Orca that never answers
 * would otherwise leave the tab blank and the session never started. Generous,
 * because a busy machine is slow.
 */
const STEP_WAIT = { timeoutMs: 20_000 };

/** Whether a session that can have a mailbox has none in its book. */
const lacksMailbox = (home, session, harness) => reachesMail(session, harness)
  && typeof readBook(home).sessions[session.name]?.mailbox !== 'string';

/** Where a Run is bound, as a sentence can say it, or the plain truth when Orca will not say. */
function boundTo(id) {
  try {
    const handle = coordinatorOf(id, STEP_WAIT);
    return handle === undefined ? 'no tab' : `the terminal ${handle}`;
  } catch {
    return 'whatever it was bound to before';
  }
}

/**
 * Which conversation this session is about to be, as far as anything can say:
 * the one the book holds, one the harness itself still has on record, or none.
 *
 * One tab holds one session, and the book is the authority for which
 * conversation that is (ADR 0012). But the book can be incomplete — on Codex a
 * hooks file must be trusted before any hook runs, and trusting it does not
 * replay the event it missed — and "the book does not say" must never be read as
 * "there was no conversation". So where the book is silent about a tab the kit
 * has already started a harness in, the harness's own record is asked.
 */
function whichConversation(book, home, bot, session, was, harness) {
  if (typeof was?.session === 'string') {
    if (hasConversation(harness, home, was.session)) return { resume: was.session };
    // The hook reported an id and the harness never wrote a conversation behind
    // it: a session paused before its first turn is one. There is nothing to
    // resume, so it starts again with its duty, and the book keeps the id in the
    // history with the reason (#295).
    return { noConversation: was.session };
  }
  // No tab: nothing has ever run for this session, so there is nothing to find.
  if (typeof was?.tab !== 'string') return {};

  // A harness ran in this tab before and the kit never learned which
  // conversation it became — on Codex, a hooks file trusted too late is enough
  // to do that. What the harness still has in this folder is worth writing down,
  // but it is never this session's by the kit's say-so: the folder holds every
  // session of the bot and everything they started inside themselves, and the
  // review proved both ways that go wrong. So the session starts a new
  // conversation with its duty, and what nobody claims is left on the record for
  // a person or Bot Father to settle.
  const claimed = sessionIdsIn(book);
  const known = typeof was.launched === 'string'
    ? conversationsIn(harness, home, was.launched).filter((one) => !claimed.has(one.id))
    : [];
  return { unclaimed: known.map((one) => one.id) };
}

/**
 * A bot's Orca project, made if it is not there yet, with `change` saying
 * whether this run `made` it, `renamed` it or left it as it was (undefined).
 *
 * It has to be a folder workspace. Registering a folder that sits inside the
 * bots repo gets it recorded as a git one, which Orca gives no workspace at
 * all, so no tab can be opened in it.
 */
function orcaProject(home, title) {
  const found = findProject(home);
  if (found === undefined) return ids(makeProject(home, title), 'made');
  return found.kind === 'folder' ? ids(found) : ids(asFolderProject(found.id, title), 'renamed');
}

const ids = (setup, change) => ({ project: setup.projectId, setup: setup.id, change });

/**
 * Where the kit leaves a prompt for the launch line to pick up: a folder of its
 * own beside the bots repo, the way skill-source clones sit beside it (PRD 6.3)
 * — kit-made, never inside the user's repo, so it stays out of their git status.
 *
 * Beside *this* bots folder, and not in a shared temp directory: two bots
 * folders may each hold an api-bot with a daily session, and one file for both
 * of them is one bot's duty handed to another's session.
 */
export const promptPath = (bots, bot, session) =>
  path.join(`${bots}.prompts`, `${encodeURIComponent(bot)}.${encodeURIComponent(session)}.txt`);

function entry(tab, { bot, name, created, running = false, blockedReason, promptReceived, promptFile, resumed, noConversation, unclaimed, noMailbox = false }) {
  const made = { bot, name, title: tab.title, tabId: tab.tabId, terminal: tab.handle, created, harnessStarted: running };
  // Whether this run picked the session up where it was or started a new one.
  // Only for a tab this run opened: a tab that was already there was left alone.
  if (resumed !== undefined) made.resumed = resumed;
  // The id the book held that had no conversation behind it, now in the history.
  if (noConversation !== undefined) made.noConversation = noConversation;
  // Orca's own words for what is on screen waiting to be answered, when it
  // gave any: the caller acts on it, the kit only passes it on.
  if (blockedReason !== undefined) made.blockedReason = blockedReason;
  // A session that should have a mailbox and has none: the step in its tab
  // did not make one, and nothing in this run would (#317).
  if (noMailbox) made.noMailbox = true;
  // Conversations the harness still has in this bot's folder that no session
  // claims: the caller is told, because the kit will not pick one.
  if (unclaimed !== undefined && unclaimed.length > 0) made.unclaimed = unclaimed;
  // Only for a session this run started that had something to be told.
  if (promptReceived !== undefined) made.promptReceived = promptReceived;
  // And the file it was told it out of, when it was too long for the line.
  if (promptFile !== undefined) made.promptFile = promptFile;
  return made;
}
