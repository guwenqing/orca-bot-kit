// What a harness says when a session starts, and what the kit does with it.
//
// Both harnesses run the kit's hook (src/hooks.js) and hand it the session id
// they are running under. That is how the book stays the authority for session
// ids (ADR 0002) without the kit guessing from transcripts.
//
// Which session it is comes from the tab: Orca puts the tab id in the
// environment of everything running in it, and the book says which session owns
// which tab. Sessions of one bot share a folder, so the folder alone could not
// tell them apart — the tab can.

import { realpathSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { readBook, rememberSession, writeBook } from './book.js';
import { botDir, readBot } from './bot.js';
import { startPrompt, workDirOf } from './launch.js';

/** Where Orca says which tab a program is running in (tech notes, section 1). */
export const TAB_ENV = 'ORCA_TAB_ID';

/** What a harness calls a session the user cleared, when it has a word for it. */
const CLEARED = 'clear';

/**
 * Write down the session a harness reports, and answer with what the harness is
 * to read back, or undefined when there is nothing to say to it.
 *
 * A cleared session is told its duty again, because the start prompt is the
 * only thing that tells one session of a bot from another (PRD 6.4). A session
 * that started or resumed has already been told, on the line that launched it.
 *
 * Two things say a session was cleared, and either is enough.
 *
 * The harness's own word, when it has one: Claude Code calls a `/clear` a clear.
 * Codex has none to give — it calls its `/new` a startup (proved live, tech
 * notes section 3) — so the second is the book: an id that is not the one this
 * tab had is a conversation the kit did not start, and the only thing that
 * starts one without the kit is the user beginning a new one.
 *
 * Neither can hand the duty over twice. `up` puts it on the launch line only
 * when the book holds no id for the session, so a session with an id in the
 * book was told nothing by the line that started it; and a launch is never a
 * clear.
 *
 * Nothing here knows about Orca beyond the tab id it is handed: the hook runs
 * inside the user's session, and a session is not a place to make calls from.
 */
export function recordSession(bots, name, said, tabId) {
  // Without the tab there is no telling which session this is, and a guess
  // would be the one thing this slice must never do.
  if (typeof tabId !== 'string' || tabId === '') return undefined;

  const id = said?.session_id;
  if (typeof id !== 'string' || id === '') return undefined;

  const home = realpathSync(botDir(bots, name));
  const book = readBook(home);
  const found = Object.entries(book.sessions).find(([, entry]) => entry?.tab === tabId);
  // A tab no session of this bot owns: Bot Father's ops tab, or somebody else's
  // work. The kit writes nothing down about tabs it does not keep.
  if (found === undefined) return undefined;

  const [session, was] = found;
  // The harness's own word for it, or — for the harness that has no word — an
  // id that is not the one this tab had, which is the same thing said twice.
  const cleared = said.source === CLEARED || (was.session !== undefined && was.session !== id);

  const now = rememberSession(was, id, said.source);
  if (!isDeepStrictEqual(was, now)) {
    book.sessions[session] = now;
    writeBook(home, book);
  }

  if (!cleared) return undefined;

  const settings = readBot(home, name).sessions.find((entry) => entry.name === session);
  if (settings === undefined) return undefined;

  const duty = startPrompt(settings, { home, workDir: workDirOf(settings, home) });
  if (duty === undefined) return undefined;

  // The harness's own way of putting text into a session, answered on the event
  // it asked about: what it reads back is added to what the session knows.
  return { hookSpecificOutput: { hookEventName: said.hook_event_name, additionalContext: duty } };
}
