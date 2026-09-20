// The book: `sessions.yaml` in a bot's home. It is the authority for what the
// kit knows about a bot's sessions (ADR 0002) — Orca forgets a tab's resume
// record the moment the tab is closed, so the kit keeps its own record.
//
// It is an ordinary file of the user's bots repo: committed, readable, and
// theirs. Beside each session's tab it holds the harness session id that
// session is running under, and every id it ran under before.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

export function writeBook(home, book) {
  writeFileSync(bookFile(home), `${HEADER}${stringify(book)}`);
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
