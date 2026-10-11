// `obk session name`: the kit names a Codex session's thread `<bot>.<session>`
// (#480), so the tab, which Codex titles with the thread's name after every
// turn, says which bot and session it is. A Claude session has its name from
// the kit's `-n` already.
//
// Codex 0.160.0 has no launch-time way to name a thread, so this types Codex's
// own `/rename` (the architect's ruling on #480). It runs from the kit's async
// Stop hook (src/hooks.js) at each turn end, never inside a turn: a fresh
// start's first turn is its start prompt, which nothing may cut off. It types
// only through the path `obk session clear` takes (src/clear.js, #391), and
// what is not safe to type now waits for the next turn end.

import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { readBook, takeNameTurn, takeTypingTurn } from './book.js';
import { botDir, readBot } from './bot.js';
import { sessionToType, typeCommand } from './clear.js';
import { harnessOf } from './launch.js';
import { sessionsOf } from './up.js';

/**
 * Where Codex keeps its threads' names: a line `{ id, thread_name, updated_at }`
 * a name, the file only growing and the newest line for an id winning
 * (codex-rs/rollout/src/session_index.rs, rust-v0.160.0).
 */
const sessionIndex = () => path.join(homedir(), '.codex', 'session_index.jsonl');

/**
 * When a naming stops typing, counted from its start: well inside the hook's
 * 300 s (src/hooks.js), at which Codex kills the hook's whole process group
 * (codex-rs/hooks/src/engine/command_runner.rs), so that what was typed is
 * taken back first.
 */
const DEADLINE_MS = 240_000;

/** How long Codex is given to write the name down after the return. */
const CONFIRM_MS = 10_000;
const ASK_MS = 500;

/**
 * Name the thread that just ended a turn in the tab `tabId`, as Codex's Stop
 * hook `said` it, when that tab is a Codex session of `bot` and its thread does
 * not have the name yet. Returns whether Codex's record names it afterwards,
 * or undefined when there was nothing to do. Throws when it could not type.
 */
export async function nameSession(bots, bot, said, tabId) {
  const deadline = Date.now() + DEADLINE_MS;
  if (said?.hook_event_name !== 'Stop') return undefined;
  if (typeof tabId !== 'string' || tabId === '') return undefined;

  const home = realpathSync(botDir(bots, bot));
  const [session, entry] = Object.entries(readBook(home).sessions).find(([, one]) => one?.tab === tabId) ?? [];
  if (session === undefined) return undefined;
  const known = readBot(home, bot);
  const [settings] = sessionsOf(known, session);
  if (harnessOf(settings, known.harness) !== 'codex') return undefined;
  // Only the thread the book says this tab is running. A Codex that Orca
  // brought back by itself runs its hooks in Codex's shared background server,
  // under another session's tab (#408), and that tab shows another thread.
  const thread = said.session_id;
  if (typeof thread !== 'string' || thread !== entry.session) return undefined;

  const name = `${bot}.${session}`;
  if (nameOf(thread) === name) return undefined;

  const turn = takeNameTurn(home, session);
  if (turn === undefined) return undefined;
  let typing;
  try {
    // Another naming may have finished while this one waited for its turn.
    if (nameOf(thread) === name) return undefined;
    // Only into the tab the hook ran in: one whose Codex was killed hard can
    // leave its hook running (Codex starts each hook in a session of its own,
    // codex-rs/hooks/src/engine/command_runner.rs), and the tab the book holds
    // now shows another process.
    const it = { ...sessionToType(bots, bot, session), conversation: thread };
    if (it.tabId !== tabId) return undefined;
    // The session's typing turn, taken once it is idle and not before, so a
    // mail interrupt waits seconds for it and not the whole wait for idle. Held by
    // anything else: nothing is typed, and the next turn end tries again.
    const before = () => {
      typing = takeTypingTurn(home, session, 0);
      if (typing === undefined) throw new Error(`${it.name}: nothing was typed, because the kit is typing into its tab already.`);
    };
    try {
      await typeCommand(it, `/rename ${name}`, { check: renameWrong, deadline, before });
    } finally {
      typing?.release();
    }
    const until = Date.now() + CONFIRM_MS;
    while (nameOf(thread) !== name && Date.now() < until) await pause(ASK_MS);
    return nameOf(thread) === name;
  } finally {
    turn.release();
  }
}

/** The name Codex's record gives `thread` now, or undefined. */
function nameOf(thread) {
  let text;
  try {
    text = readFileSync(sessionIndex(), 'utf8');
  } catch {
    return undefined;
  }
  let name;
  for (const line of text.split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.id === thread && typeof entry.thread_name === 'string') name = entry.thread_name;
  }
  return name;
}

/**
 * Why the screen does not show `command` typed and ready, or undefined when it
 * does: the input line, the lowest row Codex's pointer starts, reads the
 * pointer and the command exactly, and no row of its slash menu stands above
 * it. With words after the command Codex has closed its menu (chat_composer.rs
 * `sync_command_popup`, rust-v0.160.0), so a menu still open means the line is
 * not what it seems. Where Orca gives a draft, the draft is the line's text:
 * Codex 0.162.0's line on the screen then reads its pointer alone (#516).
 */
function renameWrong(rows, _harness, command, _version, draft) {
  const at = rows.findLastIndex((row) => /^ *›/.test(row));
  if (at < 0) return { why: 'its screen shows no input line' };
  const line = draft === undefined ? rows[at].replaceAll(' ', ' ').trim() : `› ${draft}`;
  if (line !== `› ${command}`) return { why: `its input line reads "${line}"` };
  const above = rows.slice(0, at).findLast((row) => row.trim() !== '');
  if (above !== undefined && /^ *(?:› +)?\/\S/.test(above)) return { why: `a menu of commands stands above its input line: "${above.trim()}"` };
  return undefined;
}
