// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0002) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

  for (let attempt = 1; ; attempt += 1) {
    const done = await tryUpdate(home, change);
    if (done.wrote) return done.book;
    // Somebody committed between this run's read and its write, so this run's
    // answer was about a book that no longer exists. Nothing was written; the
    // change is applied again to what is there now. That is the only honest
    // thing to do with it, and it is why no committed change is ever lost.
    if (attempt >= TRIES) throw keptLosingTheRace(home);
  }
}

/** How many times a writer will re-read and re-apply before it gives up. */
const TRIES = 20;

/**
 * One attempt: take the lock, read the book, apply the change, and write it only
 * if the book is still the file that was read.
 *
 * The lock keeps writers out of each other's way, but it cannot be what makes
 * this safe. A writer whose process is paused refreshes no lease and hears no
 * notification, so its lock can be taken over while it is stopped and it would
 * wake with an answer about a book somebody else has since replaced — which is
 * how a committed change was lost twice under review. So the file itself is the
 * authority: the identity the file system gives it when it is read must be the
 * identity it still has when it is replaced.
 */
async function tryUpdate(home, change) {
  const release = await lockfile.lock(bookFile(home), LOCK)
    .catch((error) => { throw waitedTooLong(home, error); });

  try {
    const read = identityOf(bookFile(home));
    const book = readBook(home);
    const before = structuredClone(book);
    // Awaited, because a change that takes time must keep the lock while it
    // does: an unawaited one would hand the lock back at once and then write
    // over whoever took it next.
    const next = (await change(book)) ?? book;

    // A run that changes nothing writes nothing: the file keeps its bytes and
    // its time, and nothing else waiting on the lock has to read it again.
    if (isDeepStrictEqual(before, next)) return { wrote: true, book: next };
    // The last thing before the write, so that as little as possible can happen
    // in between: the file this answer is about must still be the file there is.
    if (!isDeepStrictEqual(read, identityOf(bookFile(home)))) return { wrote: false };

    writeBook(home, next);
    return { wrote: true, book: next };
  } finally {
    await release().catch(() => {});
  }
}

/**
 * Which file this is, as the file system says: the same path written by two
 * different runs is two different files, because every write is a new file moved
 * into place. So a changed inode, size or time all say the same thing — somebody
 * else has written since.
 */
function identityOf(file) {
  try {
    const stat = statSync(file);
    return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    // No file at all is an identity too, and not the same as any file.
    return undefined;
  }
}

const keptLosingTheRace = (home) => new Error(
  `gave up writing ${bookFile(home)}: something else committed a change every time this run tried, ${TRIES} times over. Nothing was written. Try again.`,
);

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
