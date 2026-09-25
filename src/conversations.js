// What the harness itself knows, for when the book's own record is incomplete.
//
// The kit's hook is the way a session's id reaches the book, and it can miss:
// on Codex a hooks file must be trusted before any hook runs, and trusting it
// does not replay the event it missed (tech notes, section 3). A conversation
// the kit never recorded must not be mistaken for a session that never had one,
// so when the book cannot say, the harness is asked instead.
//
// Both harnesses keep their own record of every conversation, per working
// directory, and every session starts at its bot home. Read only, never
// written: these are the harness's files (tech notes, sections 2 and 3).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Claude Code's transcripts: one folder per working directory, one file per session. */
const claudeDir = (home) => path.join(homedir(), '.claude', 'projects', slug(home));

/** The folder's name is the working directory with everything else turned into a dash. */
const slug = (home) => home.replaceAll(/[^A-Za-z0-9]/g, '-');

/** Codex's rollouts: a file per conversation, filed by the day it started. */
const codexDir = () => path.join(homedir(), '.codex', 'sessions');

/**
 * Every conversation the harness has on record for this bot home, oldest first,
 * and when each began. `since` leaves out anything older than the moment the kit
 * started a harness in the tab: what came before belongs to an earlier run.
 *
 * An unreadable record says nothing rather than throwing: the caller's answer is
 * then that it does not know, which is the honest one.
 */
export function conversationsIn(harness, home, since) {
  // A subagent's conversation ran in the folder too, but no session had it: the
  // harness says it is a helper's, so it is never offered to one to claim.
  return transcriptsIn(harness, home, since)
    .filter((one) => !one.subagent)
    .map((one) => ({ id: one.id, at: one.at }));
}

/**
 * Whether the harness has a record of the conversation `id` for this bot home,
 * which is what its own resume looks for. A session paused before its first
 * turn has an id the hook reported and nothing written behind it, and Claude
 * Code answers a resume of it with "No conversation found" (#295).
 *
 * Asked of the file names alone, which both harnesses make from the id: nothing
 * is opened, however many conversations the machine has.
 */
export function hasConversation(harness, home, id) {
  if (harness === 'claude') return existsSync(path.join(claudeDir(home), `${id}.jsonl`));
  return rollouts(codexDir()).some((file) => path.basename(file).endsWith(`-${id}.jsonl`));
}

/**
 * The same conversations, each with the file the harness keeps it in, for a
 * caller that has to read what is inside one rather than only know it is there,
 * and whether the harness marks it as a subagent's.
 */
export function transcriptsIn(harness, home, since) {
  const from = since === undefined ? 0 : Date.parse(since);
  const found = harness === 'claude' ? claudeConversations(home) : codexConversations(home, from);
  return found
    .filter((one) => Number.isNaN(from) || one.at >= from)
    .sort((left, right) => left.at - right.at)
    .map((one) => ({ id: one.id, at: new Date(one.at).toISOString(), file: one.file, subagent: one.subagent === true }));
}

/**
 * Whether a conversation's own record holds `text` as a turn of the user's:
 * what the harness itself wrote down as said to it, not a screen that was up.
 *
 * Only the user's turns count. Claude Code writes them as `user` lines, and its
 * own meta lines and tool results in that same shape are not the user's. Codex
 * writes each as a `user` message item; its `user_message` event is missing
 * from many rollouts, and the item is in every one (tech notes, section 3).
 * Its AGENTS.md goes in as a `user` item too, and cannot be the text asked about.
 */
export function heldAsUserTurn(harness, file, text) {
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    return false;
  }
  const wanted = text.trim();
  return lines.some((line) => userTexts(harness, line).some((said) => said.trim() === wanted));
}

/** The texts of one record line, when it is a turn of the user's. */
function userTexts(harness, line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (harness === 'claude') {
    if (parsed?.type !== 'user' || parsed.isMeta === true) return [];
    const content = parsed.message?.content;
    if (typeof content === 'string') return [content];
    return Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)) : [];
  }
  const item = parsed?.type === 'response_item' ? parsed.payload : undefined;
  if (item?.type !== 'message' || item.role !== 'user' || !Array.isArray(item.content)) return [];
  return item.content.filter((block) => block?.type === 'input_text').map((block) => String(block.text));
}

function claudeConversations(home) {
  return files(claudeDir(home))
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => {
      const file = path.join(claudeDir(home), name);
      // What the transcript says about itself first, and the file's own age only
      // where it says nothing: a line of its own is the harness talking, and a
      // file's times can be set by anything that touches it.
      const at = said(file) ?? startedAt(file);
      return at === undefined ? [] : [{ id: name.slice(0, -'.jsonl'.length), at, file }];
    });
}

/** When a transcript's first line says the conversation was, if it says at all. */
function said(file) {
  try {
    const first = readFileSync(file, 'utf8').split('\n', 1)[0];
    const when = Date.parse(JSON.parse(first)?.timestamp ?? '');
    return Number.isNaN(when) ? undefined : when;
  } catch {
    return undefined;
  }
}

/**
 * Codex files its rollouts by day, and each one says which folder it was in.
 * The folders are walked rather than guessed at: a conversation from today may
 * sit under yesterday's date in another time zone.
 */
function codexConversations(home, from) {
  return rollouts(codexDir())
    // A rollout is written while its conversation runs, so one last touched
    // before the kit started this harness cannot be its conversation. Asked of
    // the file system, which is cheap, before the file is opened, which is not:
    // a machine with years of conversations answers this in one walk.
    .filter((file) => Number.isNaN(from) || (startedAt(file) ?? 0) >= from || lastTouched(file) >= from)
    .flatMap((file) => {
      const meta = sessionMeta(file);
      return meta?.cwd === home && typeof meta.id === 'string'
        ? [{ id: meta.id, at: Date.parse(meta.timestamp ?? '') || startedAt(file) || 0, file, subagent: isSubagent(meta) }]
        : [];
    });
}

/** Every rollout file under Codex's sessions folder, however deep it files them. */
function rollouts(dir, depth = 0) {
  if (depth > 4) return [];
  return files(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name.endsWith('.jsonl')) return [full];
    return isDir(full) ? rollouts(full, depth + 1) : [];
  });
}

/** A rollout's first line says what the conversation is: its id, folder and time. */
function sessionMeta(file) {
  try {
    const first = readFileSync(file, 'utf8').split('\n', 1)[0];
    const parsed = JSON.parse(first);
    return parsed?.type === 'session_meta' ? parsed.payload : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Codex marks a conversation it ran as a subagent under `source`: its own
 * auto-review is `{ subagent: { other: 'guardian' } }`, and one a session spawned
 * is `{ subagent: { thread_spawn: … } }`. A session's own is a plain word, such as
 * `cli` or `exec` (tech notes, section 3).
 */
const isSubagent = (meta) =>
  meta.source !== null && typeof meta.source === 'object' && 'subagent' in meta.source;

/** When a file was last written, for leaving out what is plainly too old. */
function lastTouched(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** When a conversation's own file came into being, as the file system has it. */
function startedAt(file) {
  try {
    const stat = statSync(file);
    return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
  } catch {
    return undefined;
  }
}

function files(dir) {
  try {
    return readdirSync(dir);
  } catch {
    // No folder means no conversations on record, which is an answer.
    return [];
  }
}

const isDir = (full) => {
  try {
    return statSync(full).isDirectory();
  } catch {
    return false;
  }
};
