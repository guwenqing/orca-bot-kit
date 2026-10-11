// `obk message`: one session writing to another (PRD 6.9, ADR 0042).
//
// Two roads, and the bot never picks. Claude to Claude in the same approval
// class is the harness's own messaging, which no command line can send for it —
// so the kit answers with the address and says to use it. Everything else goes
// through the Orca mailbox, which the kit does carry.
//
// What the mailbox is, and why it is not the tab: Orca calls a terminal a live
// terminal-only mailbox, warns that delivery does not outlive the tab, and
// refuses a send once the pane is gone. A Run survives the tab, the relaunch
// and the restart, so a session's address is its Run (tech notes, section 1).
//
// One road and one signal (#555, ADR 0042): the letter goes into the
// receiver's mailbox, and Orca's own notice tells the receiver to look once it
// is idle. The kit types nothing into the receiver's tab, except the one
// Escape a sender asks for with --interrupt.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MAILBOX_WAIT_MS, readBook, takeLineTurn, takeMailboxTurn, TYPING_HELD, TYPING_WAIT_MS } from './book.js';
import { botDir, botNames, readBot } from './bot.js';
import { harnessOf, isAddressOf, kitFolders, ownCli, reachesMail, SHELL_ENV, shellWord } from './launch.js';
import { ackMailbox, coordinatorOf, postMessage, pressEscape, readMailbox, tabs, tabToTypeInto, TERMINAL_ENV, TIMED_OUT, useMailbox } from './orca.js';

/**
 * How much of a message travels as itself. Above this it is written to a file
 * beside the bots folder and the message names the file, which is PRD 6.9's one
 * rule with no judgement in it.
 *
 * The number is the receiver's, not Orca's: 200 KB goes through the mailbox
 * whole, but it lands in a session's context, and a command line dies near a
 * megabyte anyway. Four kilobytes is a message; more than that is a document,
 * and a document has a name.
 */
export const INLINE_LIMIT = 4 * 1024;

/** How long Orca is given to say whether a tab has a busy harness in it to interrupt. */
const LOOK_MS = 2000;

/**
 * Everything the kit knows about one session as somebody to write to: which
 * harness it runs on, which approval class it is in, its mailbox, its name on
 * Claude Code, and the tab it is in. `trouble` is the one sentence that says
 * why it cannot be written to, when it cannot.
 */
export function findSession(bots, target) {
  const { bot: botName, session: sessionName } = splitTarget(target);

  const names = botNames(bots);
  if (!names.includes(botName)) {
    throw new Error(`there is no bot called ${botName} in ${bots}. The bots there are: ${names.join(', ')}.`);
  }

  // Resolved, because Orca is asked about this folder by path and does not
  // follow a link to it (tech notes, section 1).
  const home = realpathSync(botDir(bots, botName));
  const bot = readBot(home, botName);
  const session = pickSession(bot, sessionName, target);
  const harness = harnessOf(session, bot.harness);
  const held = readBook(home).sessions[session.name] ?? {};

  return {
    bots,
    home,
    bot: bot.name,
    session: session.name,
    harness,
    approval: classOf(session),
    // Only a name the kit gave this session is an address. A bare
    // `<bot>.<session>`, from before #286, is shared with other fleets'
    // sessions, and Claude Code refuses a send to it.
    address: isAddressOf(bot.name, session.name, held.address) ? held.address : undefined,
    mailbox: typeof held.mailbox === 'string' ? held.mailbox : undefined,
    tab: typeof held.tab === 'string' ? held.tab : undefined,
    trouble: whyNotReachable(bot.name, session, harness, held),
  };
}

/**
 * Which road a message between these two takes, and the address it goes to.
 *
 * Native is the harness's own cross-session messaging: Claude Code to Claude
 * Code, and only where both sit in the same approval class, because a message
 * across classes is held for somebody to approve and the kit chooses a road in
 * advance rather than working around a hold (PRD 6.9).
 */
export function roadBetween(from, to) {
  const pair = from.harness === 'claude' && to.harness === 'claude' && from.approval === to.approval;
  if (pair && to.address !== undefined) return { transport: 'native', address: to.address };

  return {
    transport: 'orca',
    address: to.mailbox === undefined ? undefined : `run:${to.mailbox}`,
    // A Claude pair that the native road cannot carry, because the receiver is
    // running under no name the kit gave it: it was started before the kit
    // named sessions, or before it gave them names of their own (#286), and
    // nothing renames a live harness. The mailbox is the
    // road that exists, and the caller is told why it is the one being used
    // rather than left to wonder (review of PR #132, finding 1).
    unnamed: pair ? true : undefined,
  };
}

/** What `obk message to` answers: the road, the address, and who is at each end. */
export function lookUp(bots, { to: target, from: sender, tab }) {
  const from = whoIsWriting(bots, sender, tab);
  const to = findSession(bots, target);
  const road = roadBetween(from, to);

  return {
    bots,
    from: { bot: from.bot, session: from.session, harness: from.harness },
    to: { bot: to.bot, session: to.session, harness: to.harness },
    ...road,
    trouble: to.trouble ?? (road.address === undefined ? notUpYet(to) : undefined),
  };
}

/**
 * Send one message down the Orca road; with `interrupt`, end a busy
 * receiver's turn first.
 *
 * A native pair is not carried here: no command line can send a Claude session's
 * own message. The kit says which address to write to instead, and sends
 * nothing, which is the whole of "the bot never picks the transport".
 */
export async function sendMessage(bots, { to: target, from: sender, tab, subject, text, textFile, thread, interrupt = false }) {
  const from = whoIsWriting(bots, sender, tab);
  const to = findSession(bots, target);
  const road = roadBetween(from, to);

  const answer = {
    bots,
    from: { bot: from.bot, session: from.session },
    to: { bot: to.bot, session: to.session, harness: to.harness },
    subject,
    ...road,
  };

  if (road.transport === 'native') {
    return {
      ...answer,
      sent: false,
      trouble: `${to.bot}/${to.session} is a Claude session in your own approval class, so it is written to with your own harness's messaging, not through Orca. Its address is ${to.address}.`,
    };
  }

  if (to.trouble !== undefined) return { ...answer, sent: false, trouble: to.trouble };
  if (road.address === undefined) return { ...answer, sent: false, trouble: notUpYet(to) };
  if (from.mailbox === undefined) {
    return {
      ...answer,
      sent: false,
      trouble: from.tab === undefined
        ? `${from.bot}/${from.session} has no mailbox of its own yet, so a reply would have nowhere to go. Bring it up first:  ${upCommand(from)}`
        : `${from.bot}/${from.session} has no mailbox of its own, so a reply would have nowhere to go: ${noMailboxYet(from)}`,
    };
  }

  const written = bodyOf(bots, { from, to, subject, text, textFile });
  // The Escape goes first, so the turn has ended when the letter is in.
  const interrupted = interrupt ? interruptBusy(to) : {};
  const message = postMessage({
    to: road.address,
    from: `run:${from.mailbox}`,
    subject,
    body: written.body,
    thread,
  });

  return {
    ...answer,
    sent: true,
    id: message.id,
    thread: message.thread_id ?? thread,
    file: written.file,
    ...interrupted,
  };
}

/**
 * What is waiting for a session, and the reading of it.
 *
 * Orca fences a Run to one reader, its coordinator. A session whose tab is live
 * is bound to that tab and read as it; one whose tab is down is read as its
 * Run's coordinator, and nothing is bound (issue #249). A read that
 * is not a peek acknowledges every batch waiting, one after another, so one
 * check hands over all of it (issue #299).
 */
export function checkMail(bots, { bot: botName, session: sessionName, tab, peek = false }) {
  const asked = sessionName === undefined && botName === undefined
    ? whoIsWriting(bots, undefined, tab, '--bot <bot> [--session <name>]: whose mail to read')
    : findSession(bots, sessionName === undefined ? botName : `${botName}/${sessionName}`);

  // The session's turn at its mailbox, so the book does not move to another tab
  // between the bind and the last ack, and the book read again once it is had:
  // a check that waited while `up` wrote a new tab reads nothing from the old
  // one (#321).
  const turn = takeMailboxTurn(asked.home, asked.session);
  if (turn === undefined) {
    return {
      bots,
      bot: asked.bot,
      session: asked.session,
      mailbox: asked.mailbox,
      messages: [],
      trouble: `waited ${MAILBOX_WAIT_MS / 1000} seconds for ${asked.bot}/${asked.session}'s mailbox while another obk was making, binding or reading it, and it did not finish. Nothing was read, and its mail is still waiting.`,
    };
  }
  try {
    const who = findSession(bots, `${asked.bot}/${asked.session}`);
    return mailOf(bots, who, peek, Date.now() + HOLD_MS);
  } finally {
    turn.release();
  }
}

/**
 * What `checkMail` does once it has the session's turn, with `who` as the book
 * says now, asking Orca nothing after `until`.
 */
function mailOf(bots, who, peek, until) {
  if (who.mailbox === undefined) {
    return {
      bots,
      bot: who.bot,
      session: who.session,
      messages: [],
      trouble: who.trouble ?? notUpYet(who),
    };
  }

  // Read as the session's own tab, wherever this check was typed. Binding the
  // tab that asked would hand it the session's mailbox, and Orca's notice for
  // every message after (issue #228). A session with no live tab is read as
  // whatever its mailbox is bound to, a closed tab included, and nothing is
  // bound: the session's tab is bound again when it is back up (issue #249).
  const live = who.tab === undefined ? undefined : tabs(who.home, timeLeft(until)).find((tab) => tab.tabId === who.tab)?.handle;
  // Orca 1.4.210 lets a process in a tab bind and read as that tab and no
  // other, and refuses the rest with nothing done (#317). So from inside any
  // other tab, the kit asks nothing and says where the mail can be read.
  const caller = process.env[TERMINAL_ENV];
  if (caller !== undefined && caller !== live) {
    return {
      bots,
      bot: who.bot,
      session: who.session,
      mailbox: who.mailbox,
      messages: [],
      trouble: `${who.bot}/${who.session}'s mail can be read only in its own tab: Orca lets a tab bind and read its own mailbox and no other. Nothing was read, and its mail is still waiting.`,
    };
  }
  if (live !== undefined) useMailbox(who.mailbox, live, timeLeft(until));
  const handle = live ?? coordinatorOf(who.mailbox, timeLeft(until));
  if (handle === undefined) {
    return {
      bots,
      bot: who.bot,
      session: who.session,
      mailbox: who.mailbox,
      messages: [],
      trouble: `${who.bot}/${who.session} is not up, and its mailbox is bound to no tab, so there is nothing to read it as. Its mail waits until its tab is back: \`up\` brings it back, or \`unpause\` when it is paused.`,
    };
  }
  // Orca hands mail over a batch at a time and replays the oldest until it is
  // acknowledged; the acknowledgement answers with the next batch. So a read
  // takes every batch in turn, or newer mail waits behind an older one (#299).
  //
  // A batch is given back once it is acknowledged, and not before: one this
  // check stops short of acknowledging is handed over again to the next.
  const messages = [];
  const read = { bots, bot: who.bot, session: who.session, mailbox: who.mailbox, read: !peek, messages };
  let found = readMailbox(who.mailbox, { peek, handle }, timeLeft(until));
  for (;;) {
    const batch = (found.messages ?? []).map((message) => asMessage(bots, message));
    if (peek || !found.deliveryId || batch.length === 0) {
      messages.push(...batch);
      return read;
    }
    const wait = timeLeft(until, false);
    if (wait === undefined) {
      return { ...read, trouble: `${who.bot}/${who.session} has more mail than one check reads in ${HOLD_MS / 1000} seconds, so it stopped there. The rest is still waiting: check again.` };
    }
    try {
      found = ackMailbox(who.mailbox, found.deliveryId, handle, wait);
    } catch (error) {
      // An ack Orca did not answer about may have been taken all the same, and
      // then this batch is never handed over again: it is shown, said to be
      // uncertain, rather than lost (review of PR #368). One Orca refused was
      // not taken, and waits for the next check.
      if (error.code === TIMED_OUT) {
        messages.push(...batch);
        return { ...read, trouble: `${error.message} Orca did not answer whether it took the last ${batch.length === 1 ? 'message' : `${batch.length} messages`} shown above as read, so the next check may show ${batch.length === 1 ? 'it' : 'them'} again. The rest waits for the next check.` };
      }
      // What was acknowledged before this is gone from Orca, and would be lost
      // to everyone if the failure took it down with it.
      if (messages.length === 0) throw error;
      return { ...read, trouble: `${error.message} The mail shown above is read, and the rest waits for the next check.` };
    }
    messages.push(...batch);
  }
}

/**
 * How long a check holds the session's turn, all its Orca calls together. Well
 * inside the minute `up` waits for the turn before it writes a new tab, so a
 * check in the old tab is done before the book moves, however slow Orca is,
 * and however much mail there is (review of PR #368).
 */
const HOLD_MS = 40_000;

/**
 * What one Orca call is given: twenty seconds, as the step gives its own, or
 * what is left of the check's hold, in whole seconds. With none left, the
 * call is refused here, or, when `refuse` is false, undefined is answered.
 */
function timeLeft(until, refuse = true) {
  const left = Math.min(20_000, Math.floor((until - Date.now()) / 1000) * 1000);
  if (left >= 1000) return { timeoutMs: left };
  if (refuse) throw new Error(`the kit gives a mail check ${HOLD_MS / 1000} seconds of Orca's time, and Orca took them all. Nothing more was asked of it, and the mail is still waiting.`);
  return undefined;
}

/** One message, in the kit's words rather than Orca's. */
const asMessage = (bots, message) => ({
  id: message.id,
  // The mailbox it came from, said as the session it belongs to where the
  // fleet knows it: a reply is written to a session, not to a run id.
  from: whoOwns(bots, message.from_handle) ?? message.from_handle,
  fromMailbox: message.from_handle,
  subject: message.subject,
  body: message.body,
  thread: message.thread_id ?? undefined,
  at: message.created_at,
});

/** Whose mailbox `run:<id>` is, as `<bot>/<session>`, when it is one of the fleet's. */
function whoOwns(bots, handle) {
  if (typeof handle !== 'string' || !handle.startsWith('run:')) return undefined;
  const mailbox = handle.slice('run:'.length);

  for (const name of botNames(bots)) {
    const book = readBook(botDir(bots, name));
    for (const [session, entry] of Object.entries(book.sessions)) {
      if (entry?.mailbox === mailbox) return `${name}/${session}`;
    }
  }
  return undefined;
}

/**
 * The session that is writing: the one named, or the one whose Orca tab this
 * command is running in. A caller that is in neither is asked to say, rather
 * than being given somebody else's name.
 */
function whoIsWriting(bots, sender, tab, asked = '--from <bot>/<session>: which session is writing') {
  if (sender !== undefined) return findSession(bots, sender);

  const found = tab === undefined ? undefined : sessionInTab(bots, tab);
  if (found === undefined) {
    throw new Error(`${asked}. The kit reads it from the tab when it runs in one, and this is not one of the fleet's tabs.`);
  }
  return found;
}

/**
 * The session the book says is in this Orca tab, wherever in the fleet it is,
 * when the caller is that session.
 *
 * A Codex session is the caller only when the kit's launch line started the
 * Codex it runs under: `shell` is the mark that line leaves, and everything the
 * harness runs inherits it. A Codex that Orca brought back by itself has no
 * mark and no `--no-daemon`, so it runs its commands in Codex's shared
 * background server, whose every process carries the tab of whichever session
 * started it (#408). Its tab then says nothing about who is asking. Inside
 * Codex's sandbox `ps` does not run, so the environment is all there is to go
 * on. A Claude session has no such server, and one Orca brought back is still
 * the session in its tab.
 */
export function sessionInTab(bots, tab, shell = process.env[SHELL_ENV]) {
  for (const name of botNames(bots)) {
    const book = readBook(botDir(bots, name));
    for (const [session, entry] of Object.entries(book.sessions)) {
      if (entry?.tab !== tab) continue;
      const found = findSession(bots, `${name}/${session}`);
      if (found.harness === 'codex' && (shell === undefined || shell === '')) throw new Error(notTheCodexInTab(found, tab));
      return found;
    }
  }
  return undefined;
}

/** Why a caller in a Codex session's tab is not taken to be that session, and what puts it right. */
const notTheCodexInTab = (found, tab) =>
  `this command takes its caller from the Orca tab it runs in, ${tab}, which is ${found.bot}/${found.session}'s, a Codex session; but it did not come from a Codex the kit started there: nothing of the kit's launch line is in its environment. A Codex that Orca brought back by itself, after a restart or an update, runs its commands in Codex's shared background server, under the tab of whichever session started that server, so the kit cannot tell which session is asking. Nothing was done. \`${shellWord(ownCli())} restart --bots ${shellWord(found.bots)} --bot <bot> --session <name>\` starts each such session on the kit's line; \`${shellWord(ownCli())} health --bots ${shellWord(found.bots)}\` names them. If Codex then shows "This conversation is open in another app", Codex's shared background server still holds that conversation, and it can outlive the session that started it: once every such session is back on the kit's line, stop the server with Codex's own \`codex app-server daemon stop\`, then restart the stuck session again. That stops the server for everything using it, Codex sessions outside the kit included, so first check that nothing else needs it.`;

/**
 * The message as it will travel: the text itself when it is short enough, and
 * otherwise a file beside the bots folder with a body that names it.
 * The file is in the sender's bot's own folder there, the one a Codex session
 * of that bot may write from inside its sandbox (#534).
 *
 * The file is the kit's own, next to the bots repo the way start prompts are,
 * so a long message is not written into the user's git status and does not
 * depend on a file of theirs staying where it was when they sent it.
 */
function bodyOf(bots, { from, to, subject, text, textFile }) {
  const said = textFile === undefined ? text : readText(textFile);
  if (said === undefined || said.trim() === '') {
    throw new Error('message send needs something to say: --text <text> or --text-file <path>, with something in it.');
  }
  if (Buffer.byteLength(said, 'utf8') <= INLINE_LIMIT) return { body: said };

  const file = path.join(
    kitFolders(bots, from.bot).messages,
    `${encodeURIComponent(`${from.bot}.${from.session}`)}.${encodeURIComponent(`${to.bot}.${to.session}`)}.${stamp()}.md`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, said);
  return {
    body: `${subject} is longer than a message carries, so it is in this file, whole and as it was written:\n${file}`,
    file,
  };
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`--text-file names ${file}, and that file cannot be read (${error.code}). Write it, or name the one you meant.`);
  }
}

const stamp = () => new Date().toISOString().replaceAll(':', '-').replace('.', '-');

/**
 * Interrupt a busy receiver before an urgent letter (#555): one Escape into its
 * tab ends the turn it is having, and Orca's notice then comes at once rather
 * than when that turn ends. Never by default. Only where the gate every key
 * the kit types goes through finds the receiver's harness there and busy: an
 * idle one gets Orca's notice at once anyway, and an Escape into a question on
 * its screen would answer it. Codex keeps a command it was running as a
 * background terminal after an Escape.
 */
function interruptBusy(to) {
  if (to.tab === undefined) return { interrupted: false, interruptTrouble: 'it is not up' };
  // A key typed while the kit types a command one key at a time would land in
  // that command (#480), so the receiver's turn for a line first.
  let turn;
  try {
    turn = takeLineTurn(to.home, to.session, TYPING_WAIT_MS);
  } catch (error) {
    return { interrupted: false, interruptTrouble: error.message };
  }
  if (turn === undefined) return { interrupted: false, interruptTrouble: TYPING_HELD };
  try {
    const found = lookAt(to);
    if (found.blocked !== undefined) return { interrupted: false, interruptTrouble: `its tab has something waiting to be answered (${found.blocked}), so nothing was typed` };
    if (found.unsure !== undefined) return { interrupted: false, interruptTrouble: found.unsure };
    if (found.handle === undefined) return { interrupted: false, interruptTrouble: found.gone ? 'it is not up' : 'no harness is running in its tab' };
    if (found.idle) return { interrupted: false, idle: true };
    pressEscape(found.handle);
    return { interrupted: true };
  } catch (error) {
    return { interrupted: false, interruptTrouble: error.message };
  } finally {
    turn.release();
  }
}

/**
 * The look before the interrupt. Orca now and then refuses a handle it has just
 * listed as stale, and a fresh listing hands out one that works (tech notes,
 * section 1), so that refusal earns one more listing and one more look. Only
 * one: a second refusal is reported as it is (#294).
 */
function lookAt(to) {
  try {
    return tabToTypeInto(to.home, to.tab, LOOK_MS);
  } catch (error) {
    if (error.code !== 'terminal_handle_stale') throw error;
    return tabToTypeInto(to.home, to.tab, LOOK_MS);
  }
}

/** `<bot>/<session>`, or a bot on its own when it has only the one session. */
function splitTarget(target) {
  const parts = target.split('/');
  if (parts.length > 2 || parts.some((part) => part.trim() === '')) {
    throw new Error(`a session is written <bot>/<session>, and got: ${target}`);
  }
  return { bot: parts[0], session: parts[1] };
}

function pickSession(bot, sessionName, target) {
  if (sessionName === undefined) {
    if (bot.sessions.length === 1) return bot.sessions[0];
    if (bot.sessions.length === 0) {
      throw new Error(`${bot.name} has no sessions yet. Add one with obk session add --bots <path> --bot ${bot.name} --name <name>.`);
    }
    throw new Error(`${bot.name} has ${bot.sessions.length} sessions, so say which one: ${bot.sessions.map((session) => `${bot.name}/${session.name}`).join(', ')}.`);
  }

  const found = bot.sessions.find((session) => session.name === sessionName);
  if (found === undefined) {
    throw new Error(`${bot.name} has no session called ${sessionName}. It has: ${bot.sessions.map((session) => session.name).join(', ') || 'none'}.`);
  }
  return found;
}

/**
 * Claude Code delivers between two sessions of the same class without asking,
 * and holds a message that crosses classes for somebody to approve (tech notes,
 * section 2). The kit's levels map onto the harness's two: the bypassing one is
 * `dangerously-skip`, and everything else prompts.
 */
const classOf = (session) => (session.approval === 'dangerously-skip' ? 'bypassing' : 'prompting');

/** Why fleet mail cannot reach this session at all, when it cannot. */
function whyNotReachable(bot, session, harness, held) {
  if (reachesMail(session, harness)) return undefined;
  return `${bot}/${session.name} is a Codex session whose extra arguments turn sandbox_workspace_write.network_access off. Orca is out of reach from inside that sandbox, so it can neither be written to nor read its own mail. Take that argument out, or write to it another way.`;
}

const notUpYet = (who) => (who.tab === undefined
  ? `${who.bot}/${who.session} has no mailbox yet: it has never been brought up. Start it and it gets one:  ${upCommand(who)} --session ${shellWord(who.session)}`
  : `${who.bot}/${who.session} has no mailbox: ${noMailboxYet(who)}`);

/**
 * Why a session the kit has started has no mailbox, and what gets it one. Its
 * mailbox is made by the step at the head of its launch line, in its own tab
 * (#317), so `up` of a session that is running gives it none: starting it
 * again does, and `up` does when its tab is closed.
 */
export const noMailboxYet = (who) =>
  `its tab did not make one when it started, and the tab shows why. Start it again and its tab makes one:  ${restartCommand(who)}  (or, if its tab is closed:  ${upCommand(who)} --session ${shellWord(who.session)})`;

/** The command that starts one session again, in a new tab. */
const restartCommand = (who) =>
  `${shellWord(ownCli())} restart --bots ${shellWord(who.bots)} --bot ${shellWord(who.bot)} --session ${shellWord(who.session)}`;

/** The command that brings a bot's sessions up, for the caller to finish with a session or not. */
const upCommand = (who) => `${shellWord(ownCli())} up --bots ${shellWord(who.bots)} --bot ${shellWord(who.bot)}`;
