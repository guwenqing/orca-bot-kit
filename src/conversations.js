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

import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  const from = since === undefined ? 0 : Date.parse(since);
  const found = harness === 'claude' ? claudeConversations(home) : codexConversations(home, from);
  return found
    .filter((one) => Number.isNaN(from) || one.at >= from)
    .sort((left, right) => left.at - right.at)
    .map((one) => ({ id: one.id, at: new Date(one.at).toISOString() }));
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
      return at === undefined ? [] : [{ id: name.slice(0, -'.jsonl'.length), at }];
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
        ? [{ id: meta.id, at: Date.parse(meta.timestamp ?? '') || startedAt(file) || 0 }]
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
