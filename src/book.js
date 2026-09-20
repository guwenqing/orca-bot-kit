// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0002) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { existsSync, openSync, closeSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
`;

export const bookFile = (home) => path.join(home, 'sessions.yaml');

/** Where a writer says it is writing, so no two do it at once. */
const lockFile = (home) => `${bookFile(home)}.lock`;

/** How long a writer waits for another one, and when it calls a lock abandoned. */
const WAIT_MS = 10_000;
const ABANDONED_MS = 30_000;

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
    sessions: asRecord(book.sessions),
  };
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
 * written. `change` may return a book or change the one it was handed.
 *
 * Nothing slow belongs inside it. Orca calls, tabs and prompts are the caller's
 * work; this holds the lock for one read and one write.
 */
export function updateBook(home, change) {
  const lock = takeLock(home);
  try {
    const book = readBook(home);
    const before = structuredClone(book);
    const next = change(book) ?? book;
    // A run that changes nothing writes nothing: the file keeps its bytes and
    // its time, and nothing else waiting on the lock has to read it again.
    if (!isDeepStrictEqual(before, next)) writeBook(home, next);
    return next;
  } finally {
    closeSync(lock.fd);
    rmSync(lock.file, { force: true });
  }
}

/**
 * The lock, or a refusal to write without it. Creating a file that must not
 * exist yet is one operation, so two writers cannot both think they have it.
 *
 * A writer that was killed holding the lock would otherwise stop every later
 * one for good, so a lock nobody has touched for a while is taken over. The
 * wait is generous next to what a write costs, and short next to a person.
 */
function takeLock(home) {
  const file = lockFile(home);
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      return { file, fd: openSync(file, 'wx') };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (abandoned(file)) {
        rmSync(file, { force: true });
        continue;
      }
      if (Date.now() >= until) {
        throw new Error(`something else is writing ${bookFile(home)} and has not finished. Try again; if nothing is running, remove ${file}.`);
      }
      pause(50);
    }
  }
}

/** Whether a lock has sat untouched long enough to have been left by the dead. */
function abandoned(file) {
  try {
    return Date.now() - statSync(file).mtimeMs > ABANDONED_MS;
  } catch {
    // It went away while we looked: there is nothing to take over.
    return false;
  }
}

/** Wait, without a turn of the event loop: everything here is synchronous. */
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Every harness session the book accounts for, the ones running now and the ones
 * that ran before. A conversation in here belongs to a session already.
 */
export function sessionIdsIn(book) {
  const ids = Object.values(book.sessions).flatMap((entry) => [
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
 * held goes into the history with the reason it was replaced (ADR 0002): old
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
