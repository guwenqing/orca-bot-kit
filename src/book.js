// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0002) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import lockfile from 'proper-lockfile';
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

/**
 * How a writer waits for another one, and when a lock counts as nobody's.
 *
 * `stale` is not a deadline for the writer that holds the lock: proper-lockfile
 * keeps a live owner's lock fresh while it works, so only a lock nobody is
 * refreshing any more — a writer that died — is taken over. That is the
 * difference the review found: the kit's own lock had a fixed thirty seconds,
 * and a writer merely delayed past it could still write over what the next one
 * had committed.
 */
const LOCK = {
  stale: 10_000,
  realpath: false,
  retries: { retries: 40, factor: 1, minTimeout: 50, maxTimeout: 250 },
};

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
 * written. `change` may return a book or change the one it was handed, and may
 * be asynchronous — it is awaited under the lock.
 *
 * Nothing slow belongs inside it. Orca calls, tabs and prompts are the caller's
 * work; this holds the lock for one read and one write.
 */
export async function updateBook(home, change) {
  // The file has to be there for the lock to be about it; a bot whose book has
  // not been written yet is the ordinary case on a first run.
  if (!existsSync(bookFile(home))) writeBook(home, readBook(home));

  let lost;
  const release = await lockfile.lock(bookFile(home), {
    ...LOCK,
    // Told to us if the lock is ever not ours any more. Whatever happens after
    // that, this writer does not write: the next one has read the book and its
    // change would go under ours (the review's finding 2).
    onCompromised: (error) => { lost = error; },
  }).catch((error) => { throw waitedTooLong(home, error); });

  try {
    const book = readBook(home);
    const before = structuredClone(book);
    // Awaited, because a change that takes time must keep the lock while it
    // does: an unawaited one would hand the lock back at once and then write
    // over whoever took it next.
    const next = (await change(book)) ?? book;
    if (lost !== undefined) throw lostTheLock(home, lost);
    // A run that changes nothing writes nothing: the file keeps its bytes and
    // its time, and nothing else waiting on the lock has to read it again.
    if (!isDeepStrictEqual(before, next)) writeBook(home, next);
    return next;
  } finally {
    // A lock that was already taken from us is not ours to release, and saying
    // so must not hide what went wrong above.
    if (lost === undefined) await release().catch(() => {});
  }
}

/**
 * Something else has been writing the book for longer than this run is prepared
 * to wait. Every writer holds it for one read and one write, so this is a writer
 * that is stuck rather than busy — said in the kit's own words, with the file in
 * them, because the library's own message names neither.
 */
const waitedTooLong = (home, why) => new Error(
  why.code === 'ELOCKED'
    ? `waited for something else to finish writing ${bookFile(home)} and it did not. Nothing was written. Try again; if nothing is running, remove ${bookFile(home)}.lock.`
    : `could not take the lock on ${bookFile(home)}: ${why.message}. Nothing was written.`,
);

const lostTheLock = (home, why) => new Error(
  `gave up writing ${bookFile(home)}: this run held the lock on it and lost it (${why.message}), so something else has written since it was read. Nothing was written. Try again.`,
);

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
