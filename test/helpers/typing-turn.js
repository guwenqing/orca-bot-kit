// A session's typing turn (#480, the architect's ruling of 2026-10-04): one
// lock per session that every kit path typing into the session's tab takes, so
// two kit lines never land in one input line at once. It sits beside the
// session's mailbox turn: `<bots>.locks/<bot>/<bot>.<session>.typing.lock` (#534), a SQLite
// write transaction, as test/mailbox-turns.test.js holds the mailbox turn.
// Beside it, the session's line turn, `<bot>.<session>.lines.lock`: a nudge
// holds it shared while its line goes into the tab, so nudges do not wait on
// each other, and the naming takes it exclusive before it types, so a line
// already on its way goes first (developer-480's design, after test A4 of
// nudge-left-for-hook.test.js).

import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { turnLockFile } from './cli.js';

/** The file a session's typing turn is taken on. */
export const typingTurnFile = (bots, bot, session) => turnLockFile(bots, bot, session, 'typing');

/**
 * Take one session's typing turn from this test process, run `body`, and let
 * the turn go when `body` ends, or earlier when it calls the `release` it is
 * given. Let go inside the test itself, because the sandbox is removed before
 * a `t.after` of the test's own would run.
 */
export async function withTypingTurnHeld(bots, bot, session, body) {
  const file = typingTurnFile(bots, bot, session);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN IMMEDIATE');
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    db.exec('COMMIT');
    db.close();
  };
  try {
    return await body(release);
  } finally {
    release();
  }
}

/**
 * Whether something holds the session's typing turn right now: a write
 * transaction tried without waiting is refused as busy. When nothing holds it,
 * the try takes it for a moment and lets it go at once.
 */
export function typingTurnHeld(bots, bot, session) {
  const file = typingTurnFile(bots, bot, session);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 0 });
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return false;
  } catch (error) {
    if (error?.errcode === 5 || /\b(locked|busy)\b/i.test(String(error?.message))) return true;
    throw error;
  } finally {
    db.close();
  }
}

/** The file a session's line turn is taken on: a nudge holds it shared while its line goes in, and the naming exclusive. */
export const linesTurnFile = (bots, bot, session) => turnLockFile(bots, bot, session, 'lines');

/**
 * Hold one session's line turn shared from this test process, as a nudge holds
 * it while its line is on its way into the tab: a SQLite read transaction on
 * the turn's file. Runs `body`, and lets go when `body` ends, or earlier when
 * it calls the `release` it is given.
 */
export async function withLinesTurnHeld(bots, bot, session, body) {
  const file = linesTurnFile(bots, bot, session);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN');
  db.prepare('SELECT count(*) FROM sqlite_master').get();
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    db.exec('COMMIT');
    db.close();
  };
  try {
    return await body(release);
  } finally {
    release();
  }
}

/**
 * Whether a new line would be refused the session's line turn right now: a
 * read tried without waiting is refused as busy while something holds the turn
 * exclusive or waits to, as the naming does once it holds the typing turn. The
 * try never touches the typing turn, so it cannot make the naming find that
 * turn held. It runs in a process of its own, because SQLite lets a second
 * connection of a process that already holds the turn shared (as
 * `withLinesTurnHeld` does) share it without asking the system.
 */
export function linesTurnWanted(bots, bot, session) {
  const file = linesTurnFile(bots, bot, session);
  const tryRead = [
    "const { DatabaseSync } = require('node:sqlite');",
    'const db = new DatabaseSync(process.argv[1], { timeout: 0 });',
    "try { db.exec('BEGIN'); db.prepare('SELECT count(*) FROM sqlite_master').get(); db.exec('ROLLBACK'); }",
    "catch (error) { if (error?.errcode === 5 || /\\b(locked|busy)\\b/i.test(String(error?.message))) process.exit(3); throw error; }",
    'finally { db.close(); }',
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', tryRead, file], (error) => {
      if (error === null) resolve(false);
      else if (error.code === 3) resolve(true);
      else reject(error);
    });
  });
}
