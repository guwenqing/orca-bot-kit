// `obk message`: one session writing to another (PRD 6.9, ADR 0035).
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
// Nothing in a mailbox wakes the session it belongs to — a message addressed to
// a tab leaves the harness in it untouched, proved live — so each message gets
// one signal that tells the receiver to look: Orca's own notice first, and the
// kit's typed line only where that did not come (#509, ADR 0035). A busy
// Claude session gets nothing typed, since Claude Code holds a line typed into
// it until its turn ends; its own turn-end hook tells it instead.

import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { MAILBOX_WAIT_MS, readBook, takeLineTurn, takeMailboxTurn, TYPING_HELD, TYPING_WAIT_MS } from './book.js';
import { botDir, botNames, readBot } from './bot.js';
import { recordMark, userTurnSince } from './conversations.js';
import { harnessOf, isAddressOf, kitFolders, ownCli, reachesMail, SHELL_ENV, shellWord } from './launch.js';
import { ackMailbox, coordinatorOf, idleNow, postMessage, readMailbox, tabs, tabToTypeInto, TERMINAL_ENV, TIMED_OUT, typeIntoTab, useMailbox } from './orca.js';
import { forgetUnread, markTold, noteUnread, unreadOf } from './unread.js';

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

/** How long Orca is given to say whether a tab has a TUI in it to nudge. */
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
    // The conversation the book holds for it, whose record says whether Orca's
    // notice reached it (#509).
    conversation: typeof held.session === 'string' ? held.session : undefined,
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
 * Send one message down the Orca road, and tell the receiver's tab to look.
 *
 * A native pair is not carried here: no command line can send a Claude session's
 * own message. The kit says which address to write to instead, and sends
 * nothing, which is the whole of "the bot never picks the transport".
 */
export async function sendMessage(bots, { to: target, from: sender, tab, subject, text, textFile, thread }) {
  const from = whoIsWriting(bots, sender, tab);
  const to = findSession(bots, target);
  const road = roadBetween(from, to);

  const answer = {
    bots,
    from: { bot: from.bot, session: from.session },
    to: { bot: to.bot, session: to.session },
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
  // The receiver's record as it stands before the mail: Orca can type its
  // notice the moment the mail is in.
  const mark = recordMark(to.harness, to.home, to.conversation);
  const message = postMessage({
    to: road.address,
    from: `run:${from.mailbox}`,
    subject,
    body: written.body,
    thread,
  });
  noteUnread(to.home, to.session, { id: message.id, from: `${from.bot}/${from.session}`, subject, at: message.created_at ?? new Date().toISOString() });

  return {
    ...answer,
    sent: true,
    id: message.id,
    thread: message.thread_id ?? thread,
    file: written.file,
    ...(await nudge(to, from, subject, tab, mark)),
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
    const read = mailOf(bots, who, peek, Date.now() + HOLD_MS);
    // What was read is out of the kit's hint of unread mail (#509); a peek reads nothing.
    if (!peek && read.messages.length > 0) forgetUnread(who.home, who.session, read.messages.map((message) => message.id));
    return read;
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
 * Tell the receiver that mail is waiting, with one signal (#509, ADR 0035).
 *
 * Orca's own notice is the first signal: it types it into the receiver's tab
 * once the tab is at rest. The kit's line is the fallback, for a receiver the
 * notice did not reach. So an idle receiver is watched for up to WATCH_MS, and
 * its own record of its turns says whether the notice came: a turn of the
 * user's, written after the send, that names its mailbox. Then nothing is
 * typed. When no turn started, the kit types its line, which an idle harness
 * takes at once. A Claude session busy with a turn, from the first look or
 * from a turn of other work in the watch, gets nothing typed: Claude Code
 * holds a line typed during a turn in its input box until the turn ends,
 * which can be after the mail was read, or never, and the session's own
 * turn-end hook tells it about mail still unread. A busy Codex session gets the
 * line: Codex takes it into the running turn at once, and it is what ends
 * Codex's sleep tool (#432). A record that cannot be found or read is a notice
 * not seen.
 *
 * Nothing is typed into a tab with no harness in it — there is nobody there to
 * read it, and the message waits in the mailbox until the session is up. Nor
 * into one the kit cannot tell about. A tab the book does not hold is never
 * typed into on any road.
 *
 * Nor into a tab with something on screen waiting to be answered. A line typed
 * into one of those is not a message: it is an answer to whatever question is
 * up. That is not a worry, it is a thing that happened — in slice 03 a second
 * line went into a tab on Claude Code's folder-trust list, confirmed its
 * default, `No, exit`, and the harness quit (tech notes, section 1). And in
 * #329 a return took Codex's "Update now". So where Orca says a tab is
 * blocked, or the kit sees a numbered choice list of the harness's own on its
 * screen, nothing is typed and the mail waits. The gate is passed again right
 * before the line, after the watch.
 *
 * That narrows the case rather than closing it: a question drawn any other way,
 * such as Claude Code's unnumbered trust list, is seen by neither. What closes
 * it is nobody sending to a session before its first screens are answered,
 * which is the caller's work either way.
 *
 * What is left open: a turn that starts between the gate's last look and the
 * line meets the line, which then waits for that turn to end.
 */
async function nudge(to, from, subject, tab, mark = recordMark(to.harness, to.home, to.conversation)) {
  if (to.tab === undefined) return { nudged: false };
  const notice = `orchestration check --run ${to.mailbox}`;

  const first = atTheGate(to, from, subject, tab, mark, (found) => (found.idle ? { watch: found.handle } : { busy: true }));
  if (first.busy) {
    // Busy at the first look may be Orca's notice, typed the moment the mail
    // was in: an idle Codex took it as a turn before the kit looked, live.
    if (await noticeShows(mark, notice)) return { nudged: false, signal: 'orca' };
    if (to.harness === 'claude') return { nudged: false, signal: 'hook', because: 'busy' };
    return atTheGate(to, from, subject, tab, mark, (found) => (userTurnSince(mark, notice)
      ? { nudged: false, signal: 'orca' }
      : line(found.handle, to, from, subject, 'busy')));
  }
  if (first.watch === undefined) return first;

  const watched = await watch(first.watch, mark, notice);
  const watchedMs = watched.ms;
  if (watched.notice) return { nudged: false, signal: 'orca', watchedMs };
  if (watched.turn && to.harness === 'claude') return { nudged: false, signal: 'hook', because: 'other-turn', watchedMs };

  const last = atTheGate(to, from, subject, tab, mark, (found) => {
    // What came while the gate looked, said as it was.
    if (userTurnSince(mark, notice)) return { nudged: false, signal: 'orca' };
    const because = watched.turn || !found.idle ? 'other-turn' : 'no-turn';
    if (!found.idle && to.harness === 'claude') return { nudged: false, signal: 'hook', because };
    return line(found.handle, to, from, subject, because);
  });
  return { ...last, watchedMs };
}

/**
 * How long an idle receiver is watched for Orca's notice before the kit types
 * its line, the architect's ruling for #509. The send returns as soon as the
 * notice shows, so only a notice that did not come costs the whole of it.
 */
export const WATCH_MS = 8000;

/** How long one look in the watch asks Orca to wait for an idle tab, and the pause after an idle one. */
const WATCH_LOOK_MS = 500;

/**
 * How long the record is read once a turn has started, for the notice that
 * started it: the harness writes the turn as it takes it, and a look can see
 * the turn a moment before the record does.
 */
const RECORD_GRACE_MS = 1500;

/** How often the record is read in that time. */
const RECORD_ASK_MS = 250;

/**
 * Whether the receiver's record shows Orca's notice within RECORD_GRACE_MS, for
 * a tab seen busy: the most a send to a receiver busy with other work waits.
 */
async function noticeShows(mark, notice) {
  for (const end = Date.now() + RECORD_GRACE_MS; ; await pause(RECORD_ASK_MS)) {
    if (userTurnSince(mark, notice)) return true;
    if (Date.now() >= end) return false;
  }
}

/**
 * Watch an idle receiver for up to WATCH_MS: `{ notice: true }` once its record
 * shows Orca's notice, `{ turn: true }` once a turn started that the record
 * does not show as the notice, or `{}` when it stayed at rest; with `ms`, how
 * long it watched. A look Orca does not answer says nothing, and the watch
 * goes on to its end.
 */
async function watch(handle, mark, notice) {
  const started = Date.now();
  const until = started + WATCH_MS;
  const ms = () => Date.now() - started;
  for (;;) {
    if (userTurnSince(mark, notice)) return { notice: true, ms: ms() };
    const left = until - Date.now();
    if (left <= 0) return { ms: ms() };
    const seen = idleNow(handle, Math.min(WATCH_LOOK_MS, left));
    if (seen === 'busy') return (await noticeShows(mark, notice)) ? { notice: true, ms: ms() } : { turn: true, ms: ms() };
    if (seen === 'idle') await pause(Math.min(WATCH_LOOK_MS, Math.max(until - Date.now(), 0)));
  }
}

/**
 * Look at the receiver's tab through the gate every typed line goes through,
 * holding its turn for a line, and answer what `then` makes of a tab that
 * passed; a tab that did not pass is answered as it was before #509.
 */
function atTheGate(to, from, subject, tab, mark, then) {
  // A line typed while the kit types a command one key at a time would land
  // in it and send it with its own return (#480): so the receiver's turn for
  // a line first, for a bounded time, and the mail waits in its mailbox if not.
  let turn;
  try {
    turn = takeLineTurn(to.home, to.session, TYPING_WAIT_MS);
  } catch (error) {
    // A Codex sender's sandbox cannot write another bot's turns (#534); its
    // hook, which runs outside the sandbox, can.
    return { nudged: false, nudgeTrouble: error.message, ...leftForHook(to, from, subject, tab, mark) };
  }
  if (turn === undefined) {
    return { nudged: false, nudgeTrouble: TYPING_HELD };
  }
  try {
    const found = lookAt(to);
    if (found.blocked !== undefined) return { nudged: false, blocked: found.blocked };
    // A line that lands in a shell is run there, with the sender's subject in it.
    if (found.unsure !== undefined) return { nudged: false, nudgeTrouble: found.unsure, ...(found.psUnread ? leftForHook(to, from, subject, tab, mark) : {}) };
    if (found.handle === undefined) return { nudged: false };
    return then(found);
  } catch (error) {
    // The message is already queued, and it is waiting whatever Orca says
    // about the tab. So this is reported rather than thrown: a send that ends
    // in an error the caller reads as "it did not go" would be a lie, and a
    // silent `false` would read as "the session is not up", which is a
    // different thing from "Orca would not say".
    return { nudged: false, nudgeTrouble: error.message };
  } finally {
    turn.release();
  }
}

/** Type the kit's line into the receiver's tab, and say what Orca saw of it. */
function line(handle, to, from, subject, because) {
  const sent = typeIntoTab(
    handle,
    `Fleet mail from ${from.bot}/${from.session}: ${subject}. Read it with  ${shellWord(ownCli())} message check --bots ${shellWord(to.bots)} --bot ${shellWord(to.bot)} --session ${shellWord(to.session)}`,
    { watch: true },
  );
  const said = { nudged: true, signal: 'line', because };
  // Typed is not taken. A harness busy with a turn queues the line and gives
  // it no turn of its own, and a line can be lost, and Orca's receipt looks
  // the same for both: only a turn start it saw says the line landed (#394).
  if (sent?.send?.prompt?.stages?.includes('turn_started')) return said;
  // Where Orca did not watch the line at all, as when its own notice has
  // just started a turn in the tab, it saw nothing either way, and says so.
  if (sent?.send?.prompt?.observation === 'unsupported') return { ...said, nudgeUnseen: unseen(sent), nudgeWatched: false };
  return { ...said, nudgeUnseen: unseen(sent) };
}

/**
 * The nudge a Codex sender could not decide, left for its own hook (#350, ADR
 * 0034): `{ nudgeLeft: true }`, or nothing when it is not left.
 *
 * Inside Codex's sandbox `ps` does not start, and for a Claude receiver busy
 * with a command Orca's runtime cannot see past it either. Codex runs its
 * hooks outside the sandbox, and the kit's `PostToolUse` hook runs right after
 * the command that made this send, in the same tab, where `ps` runs. So the
 * send leaves the nudge where that hook looks, the system temp folder under the
 * tab's id, which the sandbox lets it write and the hook reads. Only for a
 * Codex session sending from its own tab, and only where `ps` could not read
 * the receiver's tab, or where the sandbox would not let it take the
 * receiver's turn for a line, which is another bot's to write (#534):
 * anywhere else no hook would see it, or would see no more than the send did.
 */
function leftForHook(to, from, subject, tab, mark) {
  if (tab === undefined || from.tab !== tab || from.harness !== 'codex') return {};
  try {
    const dir = leftDir(tab);
    mkdirSync(dir, { recursive: true });
    // The receiver's record as it stood before the post, so the hook reads
    // what came after the post and not after itself (#509 review): Orca's
    // notice can land before the hook runs. None stays none.
    const left = { bots: to.bots, to: `${to.bot}/${to.session}`, from: `${from.bot}/${from.session}`, subject, mark: mark ?? null };
    // Written under a name the hook does not take, then put in place whole: a
    // hook running beside this send never takes a file still being written.
    const name = path.join(dir, `${stamp()}.${process.pid}`);
    writeFileSync(`${name}.writing`, `${JSON.stringify(left)}\n`);
    renameSync(`${name}.writing`, `${name}.json`);
    return { nudgeLeft: true };
  } catch {
    return {};
  }
}

/** Where the nudges left from one tab wait for its hook. */
const leftDir = (tab) => path.join(os.tmpdir(), 'obk-nudges', encodeURIComponent(tab));

/**
 * What the kit's Codex hook does after each shell command (#350): decide every
 * nudge a send in this tab left, oldest first, with the gate the send uses, and
 * type it or not. Each is taken out before it is looked at, so it is decided
 * once, by one hook. Returns `{ to, subject, ...what the nudge came to }` for
 * each, as the send's own answer says it.
 */
export async function decideLeftNudges(tab) {
  if (tab === undefined) return [];
  const dir = leftDir(tab);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const decided = [];
  for (const name of names) {
    const taking = path.join(dir, `${name}.taking`);
    // Another hook took it first: it is that hook's to decide, and to remove.
    try {
      renameSync(path.join(dir, name), taking);
    } catch {
      continue;
    }
    let left;
    try {
      left = JSON.parse(readFileSync(taking, 'utf8'));
    } catch {
      continue;
    } finally {
      rmSync(taking, { force: true });
    }
    try {
      const to = findSession(left.bots, left.to);
      const from = findSession(left.bots, left.from);
      decided.push({ to: left.to, subject: left.subject, ...(await nudge(to, from, left.subject, undefined, left.mark ?? null)) });
    } catch (error) {
      decided.push({ to: left.to, subject: left.subject, nudged: false, nudgeTrouble: error.message });
    }
  }
  return decided;
}

/**
 * What the kit's Claude Code hook says at the end of a session's turn (#509,
 * ADR 0035): the reason the turn goes on with, naming each message the kit sent
 * this session that Orca still lists as unread, once for each; or undefined,
 * and the turn ends as it would have.
 *
 * It must never hold a session. So it says nothing when Claude Code says a stop
 * hook is already active, when the kit's hint holds nothing new for the
 * session (and then it asks Orca nothing), when it cannot ask Orca or read the
 * hint, and when it cannot first mark what it tells as told: a message is told
 * once, or not at all. It reads the mailbox only by a peek, as the session's
 * own tab, so nothing is taken as read.
 */
export function stillUnread(bots, bot, said, tab, handle) {
  if (said?.hook_event_name !== 'Stop' || said.stop_hook_active === true) return undefined;
  if (tab === undefined || handle === undefined) return undefined;
  const who = sessionInTab(bots, tab);
  if (who === undefined || who.bot !== bot || who.mailbox === undefined) return undefined;
  // Only the conversation the book holds for this tab: a harness started
  // inside the session runs the same hook in the same tab, and would take the
  // session's one telling (#509 review), as the naming hook guards (#480).
  if (typeof said.session_id !== 'string' || said.session_id !== who.conversation) return undefined;
  const untold = unreadOf(who.home, who.session).filter((entry) => !entry.told);
  if (untold.length === 0) return undefined;

  const found = readMailbox(who.mailbox, { peek: true, handle }, { timeoutMs: HOOK_ASK_MS });
  const waiting = new Map((found.messages ?? []).map((message) => [message.id, message]));
  const tell = untold.filter((entry) => waiting.has(entry.id));
  if (tell.length === 0) return undefined;
  markTold(who.home, who.session, tell.map((entry) => entry.id));

  const lines = tell.map((entry) => `- from ${entry.from}: "${entry.subject}", which came at ${clockOf(waiting.get(entry.id).created_at ?? entry.at)}`);
  return [
    `${tell.length === 1 ? 'A fleet mail sent to you is' : `${tell.length} fleet mails sent to you are`} still unread. This is not new mail; it is told once:`,
    ...lines,
    `Read it with  ${shellWord(ownCli())} message check --bots ${shellWord(who.bots)} --bot ${shellWord(who.bot)} --session ${shellWord(who.session)}`,
  ].join('\n');
}

/** How long the turn-end hook gives Orca, well inside the 30 s the harness gives the hook. */
const HOOK_ASK_MS = 10_000;

/** A time as a clock reads it, in UTC; what cannot be read is said as it is. */
function clockOf(at) {
  const when = new Date(typeof at === 'string' && /^\d{4}-\d\d-\d\d \d/.test(at) ? `${at.replace(' ', 'T')}Z` : at);
  return Number.isNaN(when.getTime()) ? String(at) : `${when.toISOString().slice(11, 16)} UTC`;
}

/** Orca's words about a line it did not see start a turn, or what its receipt says when it gives none. */
function unseen(sent) {
  const warnings = Array.isArray(sent?.warnings) ? sent.warnings.filter((warning) => typeof warning === 'string') : [];
  if (warnings.length > 0) return warnings.join(' ');
  const stages = sent?.send?.prompt?.stages;
  return `Orca's receipt shows ${Array.isArray(stages) ? stages.join(', ') : 'no stages'} and no turn start`;
}

/**
 * The look before the nudge. Orca now and then refuses a handle it has just
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
