// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0012) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

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
# \`retired\` holds what the book knew about each session \`obk retire\` took off
# the bot, with when, so the conversations it had are still accounted for.
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
 * the book. The book is what it usually guards, and `obk groom` takes it too,
 * for the one thing Orca will not do for us: look for an automation and make one
 * if it is missing, without a second run doing the same between the two.
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
export function takeLock(home) {
  const file = lockFile(home);
  mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  try {
    // A writer that arrives while another is working waits for it rather than
    // failing at once, and gives up saying so rather than waiting for ever.
    db.exec(`PRAGMA busy_timeout = ${WAIT_MS}`);
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    db.close();
    throw waitedTooLong(home, error);
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
 * take each other's turn.
 */
const lockFile = (home) => path.join(
  `${path.dirname(path.dirname(home))}.locks`,
  `${encodeURIComponent(path.basename(home))}.lock`,
);

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
