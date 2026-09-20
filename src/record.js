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
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

import { readBook, rememberSession, sessionIdsIn, updateBook } from './book.js';
import { botDir, readBot } from './bot.js';
import { conversationsIn } from './conversations.js';
import { harnessOf, SHELL_ENV, startPrompt, workDirOf } from './launch.js';

/** Where Orca says which tab a program is running in (tech notes, section 1). */
export const TAB_ENV = 'ORCA_TAB_ID';

/**
 * The launch line says which shell it ran in, and that is what tells a report
 * from the session itself from a report by something the session started: a tab
 * holds one session — the harness the kit typed in, the shell's own child — and
 * everything started inside the tab inherits the tab's id without being it.
 */
export { SHELL_ENV };

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
export function recordSession(bots, name, said, tabId, shellPid) {
  // Without the tab there is no telling which session this is, and a guess
  // would be the one thing this slice must never do.
  if (typeof tabId !== 'string' || tabId === '') return undefined;

  const id = said?.session_id;
  if (typeof id !== 'string' || id === '') return undefined;

  const home = realpathSync(botDir(bots, name));
  // A tab no session of this bot owns: Bot Father's ops tab, or somebody else's
  // work. The kit writes nothing down about tabs it does not keep.
  if (sessionAt(readBook(home), tabId) === undefined) return undefined;

  // And a report from something the session started rather than from the
  // session itself is not this session's news, whatever tab it ran in.
  if (!startedTheSession(shellPid)) return undefined;

  const bot = readBot(home, name);
  let cleared = false;
  let told;

  updateBook(home, (book) => {
    const found = sessionAt(book, tabId);
    // The book is read again under the lock, so a session that went away while
    // this waited is a session this no longer has anything to say about.
    if (found === undefined) return book;

    const [session, was] = found;
    // A conversation the kit never recorded is not the same thing as a session
    // that never had one: where the harness's own record shows one, the book
    // learns it now, and it is that one this report replaces.
    const missed = was.session === undefined ? missedConversation(book, home, bot, session, was, id) : undefined;
    const from = missed === undefined ? was : { ...was, session: missed };

    // The harness's own word for it, or — for the harness that has no word — an
    // id that is not the one this tab had, which is the same thing said twice.
    cleared = said.source === CLEARED || (from.session !== undefined && from.session !== id);
    told = session;

    book.sessions[session] = rememberSession(from, id, said.source);
    return book;
  });

  if (!cleared || told === undefined) return undefined;

  const settings = bot.sessions.find((entry) => entry.name === told);
  if (settings === undefined) return undefined;

  const duty = startPrompt(settings, { home, workDir: workDirOf(settings, home) });
  if (duty === undefined) return undefined;

  // The harness's own way of putting text into a session, answered on the event
  // it asked about: what it reads back is added to what the session knows.
  return { hookSpecificOutput: { hookEventName: said.hook_event_name, additionalContext: duty } };
}

/** The session of this bot that owns `tabId`, with what the book holds for it. */
const sessionAt = (book, tabId) =>
  Object.entries(book.sessions).find(([, entry]) => entry?.tab === tabId);

/**
 * The conversation this session was having and the kit never wrote down, when
 * the harness's own record shows one: a conversation of this bot home, started
 * since the kit put a harness in this tab, that no session of the bot claims,
 * and older than the one reporting now.
 *
 * That is the Codex case the review found: a hooks file is trusted only after
 * the first conversation is already running, nothing is ever reported for it,
 * and the next conversation would otherwise look like the first this session
 * ever had — leaving the bot with no duty and its first conversation in nobody's
 * history.
 *
 * Only for a tab whose launch this book recorded. Without that, every
 * conversation the folder ever held would be a candidate, and the kit would be
 * guessing again.
 */
function missedConversation(book, home, bot, session, was, id) {
  if (typeof was.launched !== 'string') return undefined;

  const settings = bot.sessions.find((entry) => entry.name === session);
  if (settings === undefined) return undefined;

  const known = conversationsIn(harnessOf(settings, bot.harness), home, was.launched);
  const reporting = known.find((one) => one.id === id);
  const claimed = sessionIdsIn(book);
  const before = known.filter((one) => one.id !== id
    && !claimed.has(one.id)
    && (reporting === undefined || one.at < reporting.at));

  // The last one before this: whatever came earlier than that was already over
  // when it started, and this session can only have been having one at a time.
  return before.length === 0 ? undefined : before[before.length - 1].id;
}

/**
 * Whether the harness that ran this hook is the session's own — the one the kit
 * typed into the tab — rather than a harness started inside the session.
 *
 * Proved live on both harnesses (tech notes, sections 2 and 3): a hook's process
 * is the harness's own child, or the child of the shell the harness ran the hook
 * command through. Either way the harness itself is the process just above, and
 * the session's harness is the child of the shell named in the launch line. A
 * harness started inside the session sits further down a longer chain, under
 * whatever shell the agent ran it from, so it can never answer this.
 *
 * Anything it cannot establish is a no: a report that cannot be shown to be the
 * session's own is not written down.
 */
export function startedTheSession(shellPid, pid = process.pid) {
  if (!/^[0-9]+$/.test(String(shellPid ?? ''))) return false;
  const shell = Number(shellPid);

  const tree = processTree();
  if (tree === undefined) return false;

  const mine = tree.get(pid);
  const parent = mine === undefined ? undefined : tree.get(mine.ppid);
  if (parent === undefined) return false;

  if (parent.ppid === shell) return true;
  if (!isShell(parent.command)) return false;

  const above = tree.get(parent.ppid);
  return above !== undefined && above.ppid === shell;
}

/** Every process on the machine, by pid: who its parent is and what it runs. */
function processTree() {
  const listed = spawnSync('ps', ['-Ao', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (listed.error !== undefined || listed.status !== 0) return undefined;

  const tree = new Map();
  for (const line of listed.stdout.split('\n')) {
    const said = line.trim().match(/^([0-9]+)\s+([0-9]+)\s+(.*)$/);
    if (said !== null) tree.set(Number(said[1]), { ppid: Number(said[2]), command: said[3] });
  }
  return tree.size === 0 ? undefined : tree;
}

/** The shells a harness may run a hook command through. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

const isShell = (command) => SHELLS.has(path.basename(command ?? ''));
