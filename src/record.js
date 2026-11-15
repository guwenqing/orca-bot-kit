// What a harness says when a session starts, and what the kit does with it.
//
// Both harnesses run the kit's hook (src/hooks.js) and hand it the session id
// they are running under. That is how the book stays the authority for session
// ids (ADR 0012) without the kit guessing from transcripts.
//
// Which session it is comes from the tab: Orca puts the tab id in the
// environment of everything running in it, and the book says which session owns
// which tab. Sessions of one bot share a folder, so the folder alone could not
// tell them apart — the tab can.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { forgetClaimed, readBook, rememberSession, sessionIdsIn, updateBook, withUnclaimed } from './book.js';
import { botDir, readBot } from './bot.js';
import { conversationsIn } from './conversations.js';
import { harnessOf, SHELL_ENV, startPrompt, workDirOf } from './launch.js';
import { guardText, isClaudeBot, rulesStamp } from './rules.js';

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
 * What Claude Code calls a session it compacted. A compaction keeps the
 * conversation and its id, but the first message, which carried the start
 * prompt, is gone from the context, and the summary holds only the model's own
 * account of it (tech notes, section 2). The hook fires once for it, so the
 * prompt handed back is in the context once (claude-session-trim R3, ADR 0055).
 * It counts for a Claude Code session only: Codex says it too, and R3 does not
 * cover Codex.
 */
const COMPACTED = 'compact';

/**
 * Write down the session a harness reports, and answer with what the harness is
 * to read back, or undefined when there is nothing to say to it.
 *
 * A cleared session is told its duty again, because the start prompt is the
 * only thing that tells one session of a bot from another (PRD 6.4). So is a
 * compacted one, which keeps its id but no longer holds the prompt. A session
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
export async function recordSession(bots, name, said, tabId, shellPid) {
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
  // Asking the harness what it has on record reads a folder of files, so it is
  // done before the lock is taken and never while it is held. It answers about
  // this bot's folder, which every session of the bot shares — so it can say
  // that a conversation nobody claims exists, and never whose it is.
  const unclaimed = unclaimedFor(readBook(home), home, bot, tabId, id);
  // A clear reads the bot's instructions again, as a start does, so the book
  // notes which ones it read: Claude Code's `/clear` (tech notes, section 2),
  // and Codex's `/new`, seen here as a new id (#391).
  const stamp = rulesStamp(home);
  // What the Claude Code process above this hook was launched with: whether it
  // appends the bot's system text, and which file (R6). Read before the book
  // is held, as the rest of what goes into it.
  const launched = isClaudeBot(bot) ? appendedText(process.pid, bot.name) : undefined;

  let cleared = false;
  let told;
  let onClaude = false;

  await updateBook(home, (book) => {
    const found = sessionAt(book, tabId);
    // The book is read again under the lock, so a session that went away while
    // this waited is a session this no longer has anything to say about.
    if (found === undefined) return book;

    const [session, was] = found;
    // The harness's own word for it, or — for the harness that has no word — an
    // id that is not the one this tab had, which is the same thing said twice.
    const settings = bot.sessions.find((entry) => entry.name === session);
    const compacted = said.source === COMPACTED && settings !== undefined && harnessOf(settings, bot.harness) === 'claude';
    cleared = said.source === CLEARED || compacted || (was.session !== undefined && was.session !== id);
    // A first report with something unclaimed beside it is the third case: the
    // kit cannot tell whether this conversation is the one the launch line spoke
    // to or a later one, and a session left without its duty is the failure this
    // slice exists to prevent, so it is told again.
    const uncertain = was.session === undefined && unclaimed.length > 0;
    told = session;

    const rules = cleared ? stamp : undefined;
    const now = rememberSession(was, id, said.source);
    onClaude = settings !== undefined && harnessOf(settings, bot.harness) === 'claude';
    const system = onClaude ? systemNote(was, launched, said.source) : {};
    book.sessions[session] = withUnclaimed({ ...withoutSystem(rules === undefined ? now : { ...now, rules }), ...system }, unclaimed);
    forgetClaimed(book);
    if (uncertain) cleared = true;
    return book;
  });

  if (told === undefined) return undefined;

  const settings = bot.sessions.find((entry) => entry.name === told);
  if (settings === undefined) return undefined;

  const duty = cleared ? startPrompt(settings, { home, workDir: workDirOf(settings, home) }) : undefined;
  // The guard (R6): a Claude Code session whose launch line appends nothing,
  // as after Orca's own resume of a tab or a launch by an older kit, would load
  // a CLAUDE.md without its main units. A line read through ps cannot prove
  // that it appends, so every Claude Code session is given them here, on every
  // source, whatever its line says: twice is better than none.
  const main = onClaude ? guardText(bots, bot) : undefined;
  const context = [duty, main].filter((part) => part !== undefined && part !== '');
  if (context.length === 0) return undefined;

  // The harness's own way of putting text into a session, answered on the event
  // it asked about: what it reads back is added to what the session knows.
  return { hookSpecificOutput: { hookEventName: said.hook_event_name, additionalContext: context.join('\n\n') } };
}

/** The appended-text flag of a launch line. */
const APPEND_FLAG = '--append-system-prompt-file';

/**
 * What the Claude Code process above the hook appends: `{ file: true, name }`
 * when its launch line has the appended-text flag with this bot's own system
 * file as its value, `{}` when it has not, and undefined when the line cannot
 * be read.
 *
 * `ps` joins the words of the line with spaces, so a word cannot be told from
 * the words inside another option's value. Only the flag followed by a path
 * to `<bots>.prompts/<bot>/system-<sum>.md` counts. Anything else is no
 * appended text. The reading feeds only the book's note and obk health: the
 * hook gives the main units whatever it says, since it cannot prove a flag.
 *
 * The hook runs through a shell or straight from the harness, so the harness
 * is the parent, or the parent's parent when the parent is a shell.
 */
export function appendedText(pid, botName) {
  const tree = processTree();
  const mine = tree?.get(pid);
  const parent = mine === undefined ? undefined : tree.get(mine.ppid);
  if (parent === undefined) return undefined;
  const line = argsOf(isShell(parent.command) ? parent.ppid : mine.ppid);
  if (line === undefined) return undefined;
  // The kit puts the start prompt after `--`, and a prompt may name the flag.
  const end = line.indexOf(' -- ');
  const options = end < 0 ? line : line.slice(0, end);
  const own = `\\.prompts/${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(system-[0-9a-f]{16}\\.md)`;
  const flag = new RegExp(`(?:^| )${APPEND_FLAG}[= ]/(?:[^\\n]*?)${own}(?= |$)`).exec(options);
  return flag === null ? {} : { file: true, name: flag[1] };
}

/** The launch line of the process `pid`, or undefined when ps cannot tell. */
function argsOf(pid) {
  if (!Number.isInteger(pid)) return undefined;
  const listed = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
  if (listed.error !== undefined || listed.status !== 0) return undefined;
  const line = listed.stdout.trim();
  return line === '' ? undefined : line;
}

/** A book entry without the notes of its system text. */
function withoutSystem(entry) {
  const { system, bare, ...rest } = entry;
  return rest;
}

/**
 * What the book notes of a Claude Code session's system text (R6): `bare`
 * when its launch line appends nothing, and the file its recorded text came
 * from. A start, a clear and a compaction record the process's text; a resume
 * keeps the conversation's older one, so its note stays as it was. A line that
 * cannot be read changes nothing.
 */
function systemNote(was, launched, source) {
  const before = typeof was.system === 'string' ? { system: was.system } : {};
  if (launched === undefined) return { ...before, ...(was.bare === true ? { bare: true } : {}) };
  if (launched.file !== true) return { ...before, bare: true };
  const recorded = source === 'resume' ? was.system : launched.name ?? was.system;
  return typeof recorded === 'string' ? { system: recorded } : {};
}

/** The session of this bot that owns `tabId`, with what the book holds for it. */
const sessionAt = (book, tabId) =>
  Object.entries(book.sessions).find(([, entry]) => entry?.tab === tabId);

/**
 * The conversations of this bot home that nobody claims, for the session that
 * owns `tabId`: started since the kit put a harness in that tab, not the one
 * reporting now, and not a conversation any session of the bot holds or has
 * held.
 *
 * It says that such a conversation exists. It never says whose it is, and the
 * kit never decides: a bot's sessions share one folder, and so does every
 * harness they start inside themselves, so the folder cannot tell them apart and
 * the time they started cannot either. The review proved both — a `codex exec`
 * child's conversation taken for its parent's, and two sessions reporting in
 * reverse order taking each other's.
 *
 * Nothing either harness writes down ties a conversation that has already ended
 * to the process that had it: Claude Code's registry maps a live pid to the
 * conversation it is having now and keeps no earlier one, and Codex records no
 * pid at all (tech notes, sections 2 and 3). So this is as far as evidence goes,
 * and the rest is for a person or Bot Father to settle.
 */
function unclaimedFor(book, home, bot, tabId, id) {
  const found = sessionAt(book, tabId);
  if (found === undefined) return [];

  const [session, was] = found;
  if (typeof was.launched !== 'string') return [];

  const settings = bot.sessions.find((entry) => entry.name === session);
  if (settings === undefined) return [];

  const claimed = sessionIdsIn(book);
  return conversationsIn(harnessOf(settings, bot.harness), home, was.launched)
    .filter((one) => one.id !== id && !claimed.has(one.id))
    .map((one) => one.id);
}

/**
 * Whether the harness that ran this hook is the session's own — the one the
 * tab's shell started — rather than a harness started inside the session.
 *
 * Proved live on both harnesses (tech notes, sections 2 and 3): a hook's process
 * is the harness's own child, or the child of the shell the harness ran the hook
 * command through. Either way the harness itself is the process just above, and
 * the session's harness is the child of the tab's shell. A harness started
 * inside the session sits further down a longer chain, under whatever shell the
 * agent ran it from, so it can never answer this.
 *
 * The launch line names the tab's shell. A tab Orca brought back by itself has
 * no launch line (#318), and there the tab's shell is the one `login` started
 * for the pane, which is where Orca's own resume puts the harness too (tech
 * notes, section 1).
 *
 * Anything it cannot establish is a no: a report that cannot be shown to be the
 * session's own is not written down.
 */
export function startedTheSession(shellPid, pid = process.pid) {
  if (shellPid !== undefined && !/^[0-9]+$/.test(String(shellPid))) return false;

  const tree = processTree();
  if (tree === undefined) return false;

  const mine = tree.get(pid);
  const parent = mine === undefined ? undefined : tree.get(mine.ppid);
  if (parent === undefined) return false;

  if (shellPid !== undefined) {
    const shell = Number(shellPid);
    if (parent.ppid === shell) return true;
    if (!isShell(parent.command)) return false;

    const above = tree.get(parent.ppid);
    return above !== undefined && above.ppid === shell;
  }

  // With no shell named, which process is the harness has to be settled first:
  // the one above the shell the hook ran through, or the hook's own parent.
  const harness = isShell(parent.command) ? tree.get(parent.ppid) : parent;
  const shell = harness === undefined ? undefined : tree.get(harness.ppid);
  const pane = shell === undefined ? undefined : tree.get(shell.ppid);
  return pane !== undefined && path.basename(pane.command) === 'login';
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
