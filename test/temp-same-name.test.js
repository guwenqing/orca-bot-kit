// Two `obk temp make` calls with the same name, at the same time (#572). Both
// pass their first checks before the name is taken; one is made and the other
// is refused under the book's lock. Seen with the code as it was: each wrote
// the one start-prompt file that name has, and the refused one, cleaning up
// after itself, took away the file of the session that was made.
//
// What is held here:
//
//   S1  Two makes from one maker, with the same name and different long
//       prompts, at once: one is made and one is refused, saying the name is
//       taken. The one made is in bot.yaml and in the book as temporary, and
//       its start-prompt file is still there once both have ended, holding its
//       own task and not the other's.
//
// The order that lost the file is forced, as the issue's own repro forced it.
// Another writer holds the bot's book lock while both makes start. The test
// stops the second make (by the pid it spawned, SIGSTOP), lets the lock go,
// lets the first make finish, and only then lets the second go on (SIGCONT).
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertRefused,
  bookLockFile,
  botHomeOf,
  createSandbox,
  kitLaunchMark,
  promptFileOf,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

const BOT = 'temp-bot';
const NAME = 'checker';

/** Two tasks, each long enough that its start prompt goes to the harness from a file, and neither inside the other. */
const WINNER_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();
const LOSER_TASK = 'Write the release notes for the next version of the kit. '.repeat(10).trim();

const readBotYaml = async (bots, bot) => parse(await readFile(path.join(botHomeOf(bots, bot), 'bot.yaml'), 'utf8'));

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** Bot Father, and temp-bot (claude) with one long-lived session, planner, brought up. Returns planner's tab. */
async function fleet(box) {
  for (const args of [
    ['init', '--bots', 'bots', '--harness', 'claude'],
    ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'],
    ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner', '--prompt', 'You plan the work on the API and hand it out.'],
    ['up', '--bots', 'bots', '--bot', BOT],
  ]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  }
  const bots = box.path('bots');
  const entry = await sessionIn(bots, BOT, 'planner');
  const planner = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry?.tab);
  assert.ok(planner, `planner should have a tab in Orca, the book has: ${JSON.stringify(entry)}`);
  return { bots, planner };
}

/**
 * `obk temp make`, started in `terminal` and not waited for. Returns the child
 * (its pid is the one it was spawned with), whether it has exited, and `done`,
 * which resolves to `{ code, stdout, stderr }` when it has.
 */
function startMake(box, terminal, args) {
  const child = spawn('obk', ['temp', 'make', '--bots', 'bots', ...args], {
    cwd: box.cwd,
    env: inTab(box, terminal),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run = { child, exited: false };
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  run.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      run.exited = true;
      resolve({ code, signal, stdout, stderr });
    });
  });
  return run;
}

/**
 * How long the lock is held while both makes start: long enough for both to
 * reach it on a loaded machine, short of the 10 s a writer waits for it
 * (src/book.js). A make cannot finish while the lock is held, so both must
 * still be running when it is let go; one that has already exited means the
 * race was not tried, and the test says so rather than pass.
 */
const HOLD_MS = 8000;

/**
 * Hold a bot's book lock, the way another writer of the book does, until
 * `release` is called: the file SQLite locks, beside the bots folder (#534),
 * taken with `BEGIN IMMEDIATE` and let go with `ROLLBACK`, as src/book.js
 * does. A make stopped while it tries for the lock can still hold SQLite's
 * shared lock on the file; COMMIT would then fail at once, and ROLLBACK does
 * not (#611).
 */
async function holdBookLock(bots, bot) {
  const file = bookLockFile(bots, bot);
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN IMMEDIATE');
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    },
  };
}

test('S1 two makes with the same name at once: one is made, the other is refused, and the one made keeps its own start-prompt file', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  const lock = await holdBookLock(bots, BOT);
  const first = startMake(box, planner, ['--name', NAME, '--prompt', WINNER_TASK]);
  const second = startMake(box, planner, ['--name', NAME, '--prompt', LOSER_TASK]);
  let stopped = false;
  let won;
  let lost;
  try {
    await sleep(HOLD_MS);
    const early = [first, second].filter((run) => run.exited);
    if (early.length > 0) {
      lock.release();
      const said = await Promise.all([first.done, second.done]);
      assert.fail(`the race was not tried: a make exited while the book's lock was still held, so it did not wait on it:\n${said.map((one) => `${one.stdout}${one.stderr}`).join('\n----\n')}`);
    }
    // The second make waits, stopped, while the first takes the lock and finishes.
    stopped = second.child.kill('SIGSTOP');
    assert.ok(stopped, 'the second make could not be stopped');
    lock.release();
    won = await first.done;
    assert.equal(second.exited, false, 'the second make should still be waiting, stopped, when the first has finished');
  } finally {
    lock.release();
    if (stopped && !second.exited) second.child.kill('SIGCONT');
    lost = await second.done;
    won ??= await first.done;
  }

  const said = [won, lost].map((one) => `${one.stdout}${one.stderr}`);
  assert.deepEqual([won.code, lost.code], [0, 1], `the first make works and the second is refused, got exit codes ${won.code} and ${lost.code}:\n${said.join('\n----\n')}`);
  assertRefused(lost, NAME);
  assert.match(said[1], /\balready\b|\btaken\b|\bin use\b|\bexists\b/i, `the refusal says the name is taken, got:\n${said[1]}`);

  const entries = ((await readBotYaml(bots, BOT)).sessions ?? []).filter((one) => one?.name === NAME);
  assert.equal(entries.length, 1, `${NAME} is in bot.yaml once, got: ${JSON.stringify(entries)}`);
  assert.equal((await sessionIn(bots, BOT, NAME))?.temporary?.maker, 'planner', 'and in the book as planner\'s temporary session');

  const file = promptFileOf(bots, BOT, NAME);
  let kept;
  try {
    kept = await readFile(file, 'utf8');
  } catch (error) {
    assert.fail(`the start-prompt file of the session that was made should still be there after both makes ended, got: ${error.code} at ${file}`);
  }
  assert.ok(kept.includes(WINNER_TASK), `the start-prompt file holds the made session's own task, got:\n${kept}`);
  assert.ok(!kept.includes(LOSER_TASK), `and not the refused make's task, got:\n${kept}`);
});
