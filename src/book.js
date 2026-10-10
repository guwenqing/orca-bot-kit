// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0012) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import { kitFolders } from './launch.js';

const HEADER = `# What Orca calls this bot on this machine, and where each of its sessions
# lives. \`obk up\` writes this file; it is committed with the rest of the repo.
#
# A session is its Orca tab id. Titles are set, never read, so renaming a tab
# in Orca changes nothing here.
#
# Each session also carries the harness session it runs as, and the ones it ran
# as before it: a clear makes a new one, and the old ones are kept.
#
# \`mailbox\` is where fleet mail for the session is left — an Orca Run, made once
# and kept, because an address that is a tab dies with the tab. \`address\` is what
# a Claude session is called, which is what another Claude session writes to.
#
# \`rules\` is a stamp of the bot's AGENTS.md as the session last read it, so a
# change to it after the session started can be told apart.
#
# \`launched_with\` is the extra arguments the kit typed on the session's last
# launch line, as bot.yaml's extra_args gave them then.
#
# \`retired\` holds what the book knew about each session \`obk retire\` took off
# the bot, with when, so the conversations it had are still accounted for.
#
# \`temporary\` marks a session another session of this bot made with
# \`obk temp make\`: which session made it, and when, and the role and option
# of bot.yaml's temp_roles it was made in, if any. Its maker retires it.
`;

export const bookFile = (home) => path.join(home, 'sessions.yaml');

/** How long a writer waits for the one before it to finish. */
const WAIT_MS = 10_000;

/** What the book says, or an empty book when there is none yet. */
export function readBook(home) {
  const file = bookFile(home);
  if (!existsSync(file)) return { orca: {}, sessions: {} };

  const parsed = parse(readFileSync(file, 'utf8'));
  // A book someone emptied, or filled with something else, is treated as one
  // that says nothing: `up` then makes what is missing, which is its job.
  const book = parsed !== null && typeof parsed === 'object' ? parsed : {};
  return {
    ...book,
    orca: asRecord(book.orca),
    sessions: Object.fromEntries(Object.entries(asRecord(book.sessions)).map(([name, entry]) => [name, withHistoryListed(entry)])),
    // A retired session's entry is the same entry, and its history is read the same way.
    ...(Array.isArray(book.retired) ? { retired: book.retired.map(withHistoryListed) } : {}),
  };
}

/**
 * A session entry whose history a person typed as one id, `history: <id>`,
 * rather than as the list the kit writes, read as that one earlier
 * conversation. The book is theirs to edit by hand (README), and one id where a
 * list goes is the edit a person makes.
 */
function withHistoryListed(entry) {
  const history = entry?.history;
  if (history === undefined || history === null || Array.isArray(history)) return entry;
  // One entry written without the list around it.
  if (typeof history === 'object') return { ...entry, history: [history] };
  // One id, which YAML reads as a number when it is all digits.
  const id = String(history).trim();
  return { ...entry, history: id === '' ? [] : [{ session: id }] };
}

/**
 * Write the book in one step. A reader either sees the book as it was or as it
 * is, never half of it, and a writer that dies leaves the old file in place:
 * the new text goes to a file of this process's own and is moved over the book,
 * which is one operation the file system either did or did not do.
 */
export function writeBook(home, book) {
  const file = bookFile(home);
  const half = `${file}.${process.pid}.part`;
  writeFileSync(half, `${HEADER}${stringify(book)}`);
  renameSync(half, file);
}

/**
 * Change the book with nothing else changing it at the same time: `up` writing
 * a tab down and a session's own hook writing its id are two programs on one
 * file, and either one holding a copy from before would undo the other.
 *
 * So every change is made here, and made on what the file says now: the lock is
 * taken, the book is read, `change` is given it, and what comes back is
 * written. `change` may return a book or change the one it was handed, and may
 * be asynchronous — it is awaited under the lock.
 *
 * Nothing slow belongs inside it. Orca calls, tabs and prompts are the caller's
 * work; this holds the lock for one read and one write.
 */
export async function updateBook(home, change) {
  const lock = takeLock(home);
  try {
    // Nothing writes the book outside this lock, the first write included. A
    // missing book used to be written before the lock was taken: two first
    // writers could both find no book, one take the lock and record its id, and
    // the other then put the empty book it had read in its place (#161,
    // reproduced with a real second process).
    const book = readBook(home);
    const before = structuredClone(book);
    // Awaited, because a change that takes time must hold the lock while it
    // does: an unawaited one would let the next writer in and then write over it.
    const next = (await change(book)) ?? book;
    // A run that changes nothing writes nothing: the file keeps its bytes and
    // its time, and nothing else waiting on the lock has to read it again.
    if (!isDeepStrictEqual(before, next)) writeBook(home, next);
    return next;
  } finally {
    lock.release();
  }
}

/**
 * The right to change what belongs to one bot, held from before it is read until
 * after it is written — a SQLite write transaction on a file of its own beside
 * the book.
 *
 * SQLite is in Node itself and does this with the operating system's own file
 * locks. That matters for one reason: the lock belongs to the process, so it is
 * held while that process is stopped — swapped out, suspended, sitting in a
 * debugger — and it is let go when the process ends, whether it ended well or
 * not. Nothing has to be refreshed and nothing has to be declared abandoned.
 *
 * Three attempts at this have failed, each because the lock could be taken from a
 * writer that was still going to write: a lease with a fixed timeout, then a
 * lease kept alive by a timer (which a stopped process cannot run), then a check
 * of the file just before replacing it (which a pause between the check and the
 * replace defeats). A lock the kernel holds for the process has none of those
 * seams, so there is nothing left to enumerate.
 *
 * The lock file holds no data — it is opened, locked and closed — so it stays
 * empty and leaves no journal beside it.
 */
function takeLock(home) {
  try {
    return lockOn(lockFile(home), WAIT_MS);
  } catch (error) {
    throw error instanceof LockNotWritable ? error : waitedTooLong(home, error);
  }
}

/**
 * The lock on `file`, waited for `waitMs` at most: see `takeLock` for why it is
 * this one. `how` is SQLite's: `IMMEDIATE`, one holder at a time; `SHARED`,
 * any number at once, none while an `EXCLUSIVE` is held or waited for; and
 * `EXCLUSIVE`, alone, once every `SHARED` holder has let go.
 */
function lockOn(file, waitMs, how = 'IMMEDIATE') {
  // SQLite opens a file it cannot write read-only, without a word, and a
  // read-only connection's BEGIN passes while another process holds the lock:
  // seen in Codex's sandbox (#534). So the file is opened for writing first,
  // and a lock that cannot be held is an error, never a turn that is not one.
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    closeSync(openSync(file, 'a'));
  } catch (error) {
    throw new LockNotWritable(file, error);
  }

  const db = new DatabaseSync(file);
  try {
    // A writer that arrives while another is working waits for it rather than
    // failing at once, and gives up saying so rather than waiting for ever.
    db.exec(`PRAGMA busy_timeout = ${waitMs}`);
    if (how === 'SHARED') {
      // A reading transaction holds its shared lock from its first read.
      db.exec('BEGIN');
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } else {
      db.exec(`BEGIN ${how}`);
    }
  } catch (error) {
    db.close();
    throw error;
  }

  return {
    release() {
      try {
        db.exec('COMMIT');
      } finally {
        db.close();
      }
    },
  };
}

/**
 * Where a writer takes its turn: a folder of the kit's own beside the bots repo,
 * carrying that folder's own name, the way start-prompt files sit beside it
 * (PRD 6.3). SQLite keeps the file it locks, so this one stays, and the places it
 * cannot stay are: the bot home, which is the user's repo and gains nothing a
 * session did not ask for; and their home directory, where the kit writes
 * nothing.
 *
 * Not the machine's temporary directory either, though it looks like the natural
 * home for state that lasts as long as a write. A temporary directory is swept.
 * A lock swept away while a writer holds it does not cost that writer anything —
 * it costs the next one, which creates the file again and takes a turn on a
 * different file while the first is still writing. Two writers, two locks,
 * neither knowing: the failure four rounds of review have been about. A sibling
 * is nobody's to sweep, and the user can see it and delete it.
 *
 * One folder per bots folder, so two bots folders each holding an api-bot cannot
 * take each other's turn. Resolved first, as the mailbox's is: one writer reaches
 * the bots folder through a link and another by its real path, and two paths
 * would be two locks for one book (#375).
 */
const lockFile = (home) => path.join(botLocks(home), `${encodeURIComponent(path.basename(realpathSync(home)))}.lock`);

/**
 * The bot's own folder of locks, `<bots>.locks/<bot>/`: the one a Codex
 * session of the bot is given to write, beside its mail and its start prompts
 * (#534). One folder per bot, so a bot's sessions can take each other's turns
 * and no other bot's.
 */
const botLocks = (home) => {
  const real = realpathSync(home);
  return kitFolders(path.dirname(path.dirname(real)), path.basename(real)).locks;
};

/**
 * A lock the kit cannot write. Inside Codex's sandbox that is a session
 * started before the kit gave its bot a folder of locks, so it says what puts
 * it right.
 */
class LockNotWritable extends Error {
  constructor(file, why) {
    super(`the kit cannot write its lock ${file} (${why.code ?? why.message}), so it did not take the turn, and nothing was done. A Codex session started before this version of the kit cannot write its bot's folder of locks: restart this session with the kit. Elsewhere, make ${path.dirname(file)} writable.`);
    this.code = why.code;
  }
}

/**
 * One session's turn at its mailbox (#321): held by `session mailbox` for its
 * whole step, by `message check` in the session's own tab for its bind, read and
 * ack, and by `up` while it writes a new tab for the session into the book. So
 * the book never moves to another tab while a step or a check is at work, and a
 * step or check that waited reads the book again once it has its turn: two
 * starts of one session at once leave its mailbox bound to the tab the book
 * names, and nothing is read from the one it no longer does.
 *
 * A lock of its own, and not the book's: the book's is held for one read and one
 * write, and a session's hook must never wait behind Orca for it. Taken before
 * the book's and never while holding it, so neither waits on the other.
 *
 * Returns `{ release }`, or undefined when the turn did not come in
 * `MAILBOX_WAIT_MS`: the caller says what it left, and a launch line goes on
 * to its harness whatever happened here.
 */
export function takeMailboxTurn(home, session) {
  try {
    return lockOn(mailboxLockFile(home, session), MAILBOX_WAIT_MS);
  } catch (error) {
    if (error.errcode === SQLITE_BUSY) return undefined;
    throw error;
  }
}

/**
 * A session's turn to have its Codex thread named (#480), beside its mailbox
 * turn: `{ release }`, or undefined at once when another naming holds it, so
 * that two turn ends close together type the name once.
 */
export const takeNameTurn = (home, session) => turnOn(home, session, 'name', 0);

/**
 * A session's typing turn (#480, the architect's ruling), for what the kit
 * types into the session's tab one key at a time: no line of the kit's may
 * land in between and send what is there with its own return. Two locks
 * beside its mailbox turn: `typing`, the gate, held for the whole typing, and
 * `lines`, taken alone once the lines already on their way have gone in.
 * Returns `{ release }`, or undefined when it did not come within `waitMs`,
 * or the lines in flight did not finish within LINES_WAIT_MS.
 */
export function takeTypingTurn(home, session, waitMs) {
  const gate = turnOn(home, session, 'typing', waitMs);
  if (gate === undefined) return undefined;
  let lines;
  try {
    lines = turnOn(home, session, 'lines', LINES_WAIT_MS, 'EXCLUSIVE');
  } finally {
    if (lines === undefined) gate.release();
  }
  if (lines === undefined) return undefined;
  return {
    release() {
      try {
        lines.release();
      } finally {
        gate.release();
      }
    },
  };
}

/**
 * A session's turn for one whole line, sent with its return in one go, as the
 * mail nudge is: through the typing turn's gate, waited for `waitMs` at most,
 * and then held beside any other line, so whole lines never wait on each
 * other, only on typing one key at a time. Returns `{ release }`, or undefined
 * when the gate did not come within `waitMs`. Every whole line the kit types
 * takes it: the nudge, the list line, the skills reload and the grooming line (#482).
 */
export function takeLineTurn(home, session, waitMs) {
  const gate = turnOn(home, session, 'typing', waitMs);
  if (gate === undefined) return undefined;
  try {
    return turnOn(home, session, 'lines', 0, 'SHARED');
  } finally {
    gate.release();
  }
}

/**
 * How long a kit path waits for a session's typing turn before it types
 * nothing (#480, #482): a naming holds it for seconds.
 */
export const TYPING_WAIT_MS = 5000;

/** What a kit path reports when the session's typing turn did not come within TYPING_WAIT_MS. */
export const TYPING_HELD = `the kit is typing into it, and it was still at it after ${TYPING_WAIT_MS / 1000} s, so nothing was typed`;

/**
 * How long a typing turn waits for the lines already on their way: a nudge
 * holds its line's turn while Orca waits up to 5 s to see it start a turn.
 */
const LINES_WAIT_MS = 10_000;

/** A turn of the kit's own for one session, on a file beside its mailbox turn's. */
function turnOn(home, session, kind, waitMs, how) {
  try {
    return lockOn(mailboxLockFile(home, session).replace(/\.mailbox\.lock$/, `.${kind}.lock`), waitMs, how);
  } catch (error) {
    if (error.errcode === SQLITE_BUSY) return undefined;
    throw error;
  }
}

/**
 * How long a step, a check or an `up` waits for a session's turn. Longer than a
 * step can hold it — three Orca calls of twenty seconds each at most — and short
 * enough that a harness behind a stuck one still starts.
 */
export const MAILBOX_WAIT_MS = 60_000;

/** SQLite's own code for a lock another connection holds. */
const SQLITE_BUSY = 5;

/**
 * Beside the book's lock, one file per session. Names are lower-case letters,
 * digits and hyphens, so a dot between the bot's and the session's cannot be
 * read two ways. Resolved first, because the same bot is reached through a
 * link by one command and by its real path by another, and two paths would be
 * two turns.
 */
const mailboxLockFile = (home, session) =>
  path.join(botLocks(home), `${path.basename(realpathSync(home))}.${session}.mailbox.lock`);

/**
 * Something else has been writing the book for longer than this run is prepared
 * to wait. Every writer holds its turn for one read and one write, so this is a
 * writer that is stuck or stopped rather than busy — said in the kit's own words,
 * because the database's are about a database.
 */
const waitedTooLong = (home, why) => new Error(
  `waited ${WAIT_MS / 1000} seconds for something else to finish writing ${bookFile(home)} and it did not (${why.message}). Nothing was written. Try again; if nothing is running, remove ${lockFile(home)}, which is where writers take their turn.`,
);

/**
 * The note of conversations nobody claims, with what a scan has just found added
 * to it. It only ever grows: a scan can only see conversations since the kit last
 * started a harness in the tab, so anything found earlier would fall out of range
 * and be forgotten — which is exactly how an unresolved conversation went missing
 * across a relaunch (round 3 review, finding 1). Ids leave this note one way
 * only, in `forgetClaimed`, when a session claims them.
 */
export function withUnclaimed(entry, found) {
  const kept = [...new Set([...(Array.isArray(entry.unclaimed) ? entry.unclaimed : []), ...found])];
  if (kept.length === 0) {
    const { unclaimed: none, ...rest } = entry;
    return rest;
  }
  return { ...entry, unclaimed: kept };
}

/**
 * Take out of every session's note whatever some session now claims: a note is
 * only ever about a conversation nobody owns, so an id that has found its owner
 * has no business in one. This is the only way an id leaves a note.
 */
export function forgetClaimed(book) {
  const claimed = sessionIdsIn(book);
  for (const [name, entry] of Object.entries(book.sessions)) {
    if (!Array.isArray(entry?.unclaimed)) continue;
    const kept = entry.unclaimed.filter((one) => !claimed.has(one));
    book.sessions[name] = withUnclaimed({ ...entry, unclaimed: [] }, kept);
  }
  return book;
}

/**
 * Every harness session the book accounts for, the ones running now, the ones
 * that ran before, and the ones of sessions since retired. A conversation in
 * here belongs to a session already.
 */
export function sessionIdsIn(book) {
  const retired = Array.isArray(book.retired) ? book.retired : [];
  const ids = [...Object.values(book.sessions), ...retired].flatMap((entry) => [
    entry?.session,
    ...(Array.isArray(entry?.history) ? entry.history.map((old) => old?.session) : []),
  ]);
  return new Set(ids.filter((id) => typeof id === 'string'));
}

/** Every tab id the book holds. What is not in here is not the kit's session. */
export const tabIdsIn = (book) =>
  new Set(Object.values(book.sessions).map((session) => session?.tab).filter((tab) => typeof tab === 'string'));

const asRecord = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});

/**
 * The session entry to keep once a harness has named the session it is running
 * as. The id the harness gave replaces the one the book held, and the one it
 * held goes into the history with the reason it was replaced (ADR 0012): old
 * ids are what recall, auditing and finops read later.
 *
 * The same id come back is a session resumed, not a new one, so nothing moves.
 */
export function rememberSession(entry = {}, id, ended) {
  if (entry.session === id) return entry;
  if (entry.session === undefined) return { ...entry, session: id };

  const was = { session: entry.session, ended: ended ?? 'replaced', at: new Date().toISOString() };
  return { ...entry, session: id, history: [...(entry.history ?? []), was] };
}

/**
 * The session entry once the id it held has turned out to have no conversation
 * behind it: the id goes into the history with that reason, and the entry holds
 * none until the harness names the new one.
 */
export function forgetSession(entry, ended) {
  const { session, ...rest } = entry;
  return { ...rest, history: [...(entry.history ?? []), { session, ended, at: new Date().toISOString() }] };
}
