// A kit lock never opens or makes a file through a link planted at its name in
// the bot's folder of locks (#605).
//
// The kit takes its locks on SQLite files in `<bots>.locks/<bot>/`. A Codex
// session of the bot can write in that folder (every Codex launch line names it
// with `--add-dir`, #534), so a session can put a link there before the next
// kit command comes for the lock. The issue names two locks, and both are held
// here: the book's lock, `<bot>.lock`, taken by `updateBook`; and the bot lock,
// `<bot>.bot.lock`, taken by `takeBotTurn` and by every command that changes
// the bot's bot.yaml (#595).
//
// What is pinned, for each lock:
//
// L1  A link at the lock's name to a name outside the bot's folder of locks,
//     with nothing at it: no file is made there, nor anything beside it (a
//     SQLite journal), the operation refuses, and the file the lock guards is
//     as it was. This is the reviewer's repro on PR #603.
// L2  A link at the lock's name to a file outside: that file keeps its bytes,
//     the operation refuses, and the file the lock guards is as it was. Two
//     files: one with text in it, and an empty one, which SQLite would take as
//     an empty database and use.
// L3  At the lock's name something that is not a plain file and not a link: a
//     FIFO, or a directory. The operation refuses, does not hang, and the file
//     the lock guards is as it was.
// L4  The other side, so the refusals above cannot pass on a kit that refuses
//     everything: with nothing at the lock's name, or an empty plain file there
//     (as the kit leaves one), the same operation goes through and its change
//     is there afterwards.
//
// The file the lock guards: the book, `sessions.yaml`, for the book's lock;
// `bot.yaml` for the bot lock. "As it was" is its bytes, compared whole.
//
// What is left out, on purpose: a hard link at the name (a hard link is a plain
// file, and the issue speaks of anything other than one); a link swapped in
// while the lock is being opened (a race with no clean seam); the session turn
// locks (`mailbox`, `typing`, `lines`, `name`), which the issue does not name;
// whether the planted thing is still there after a refusal; and the words of
// any error.
//
// Seams. `updateBook` and `takeBotTurn`, in this process, for the links, as in
// test/book-write-link.test.js. A FIFO or a directory could stop a lock open
// for good, and a stop in this process would stop the whole file, so those run
// in a child process of their own, given a hard time limit by spawn. And the
// CLI, `obk session add`, which takes the bot lock while it changes bot.yaml:
// the reviewer's repro as a user meets it, given the same time limit. The bots
// folder is made by `init` and `bot create` in the sandbox (helpers/cli.js):
// its own HOME, a fake Orca and fake harnesses.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { readBook, takeBotTurn, takeLineTurn, updateBook } from '../src/book.js';
import { bookLockFile, botHomeOf, botLockFile, createSandbox, node, repoRoot, turnLockFile } from './helpers/cli.js';

const BOT = 'api-bot';
const OUTSIDE_TEXT = 'a file of the user\'s, outside the bot\'s folder of locks\n';

/**
 * How long a child process may run before it counts as hung and is killed.
 * Well above the kit's own wait for a lock (ten seconds, src/book.js), so a
 * refusal after that wait is not taken for a hang.
 */
const HANG_MS = 20_000;

const isThere = (file) => access(file).then(() => true, () => false);
const said = (result) => `${result.stdout}${result.stderr}`.trim();

/** A file's bytes, or null when there is nothing at its name. */
async function bytesOf(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * api-bot, made by `init` and `bot create`, with one session already in its
 * book, so the book is there with known text. Answers the bots folder and the
 * bot home.
 */
async function aBot(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, `the setup: obk init\n${said(init)}`);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, `the setup: obk bot create\n${said(made)}`);
  const bots = box.path('bots');
  const home = botHomeOf(bots, BOT);
  await updateBook(home, (book) => {
    book.sessions = { ...book.sessions, daily: { tab: 'tab-before' } };
    return book;
  });
  assert.deepEqual(readBook(home).sessions?.daily, { tab: 'tab-before' }, 'the setup: the book holds daily');
  return { bots, home };
}

/** The two locks the issue names, and for each: its file, what it guards, and one operation under it. */
const LOCKS = [
  {
    key: 'book',
    label: 'the book\'s lock',
    lockFile: bookLockFile,
    guarded: (home) => path.join(home, 'sessions.yaml'),
    /** One change of the book: adds the session nightly. */
    take: (home) => updateBook(home, (book) => {
      book.sessions = { ...book.sessions, nightly: { tab: 'tab-new' } };
      return book;
    }),
    /** The change the operation was asked to make is in the book. */
    landed: (home) => assert.deepEqual(
      readBook(home).sessions,
      { daily: { tab: 'tab-before' }, nightly: { tab: 'tab-new' } },
      'the book holds nightly, and daily as it was',
    ),
  },
  {
    key: 'bot',
    label: 'the bot lock',
    lockFile: botLockFile,
    guarded: (home) => path.join(home, 'bot.yaml'),
    /** The bot lock taken and let go. */
    take: async (home) => {
      const turn = takeBotTurn(home);
      assert.equal(typeof turn?.release, 'function', 'takeBotTurn answers a turn with release()');
      turn.release();
    },
    landed: () => {},
  },
];

/** Run one operation under a lock, and answer how it ended: `{ went: true }`, or `{ went: false, error }`. */
async function attempt(lock, home) {
  try {
    await lock.take(home);
    return { went: true };
  } catch (error) {
    return { went: false, error };
  }
}

/** The file outside holds exactly `text`; told short, as a SQLite page is 4096 bytes of mostly nothing. */
async function assertKeeps(file, text) {
  const bytes = await readFile(file);
  assert.ok(
    bytes.equals(Buffer.from(text)),
    `the file outside keeps its bytes: it held ${Buffer.byteLength(text)} bytes, and now holds ${bytes.length}, `
    + `starting ${JSON.stringify(bytes.subarray(0, 16).toString('latin1'))}`,
  );
}

/** A folder outside the bot's folder of locks, in the sandbox, for a link to lead to. */
async function outsideFolder(box) {
  const dir = path.join(box.root, 'outside');
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Make the lock's folder if the kit has not yet, and clear the lock's name. */
async function clearName(lockFile) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  await rm(lockFile, { recursive: true, force: true });
}

/** A FIFO at `file`. Node has no call for one; mkfifo is in every macOS and Linux. */
const makeFifo = (file) => execFileSync('mkfifo', [file]);

// ------------------------------------------------- L1, L2: links, in this process

for (const lock of LOCKS) {
  test(`#605 L1 ${lock.label} with a link at its name to a name outside with nothing at it: no file is made outside, the operation refuses, and ${lock.key === 'book' ? 'the book' : 'bot.yaml'} is as it was`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await aBot(box);
    const outside = await outsideFolder(box);
    const target = path.join(outside, 'target.lock');
    const lockFile = lock.lockFile(bots, BOT);
    await clearName(lockFile);
    await symlink(target, lockFile);
    const guardedBefore = await bytesOf(lock.guarded(home));

    const ended = await attempt(lock, home);

    assert.equal(await isThere(target), false, `no file is made at the link's target ${target}`);
    assert.deepEqual(await readdir(outside), [], 'nothing at all is made in the folder outside');
    assert.equal(ended.went, false, `the operation refuses; it went through`);
    assert.deepEqual(await bytesOf(lock.guarded(home)), guardedBefore, `${path.basename(lock.guarded(home))} is as it was`);
  });

  for (const [kind, text] of [['a text file', OUTSIDE_TEXT], ['an empty file', '']]) {
    test(`#605 L2 ${lock.label} with a link at its name to ${kind} outside: that file keeps its bytes, the operation refuses, and ${lock.key === 'book' ? 'the book' : 'bot.yaml'} is as it was`, async (t) => {
      const box = await createSandbox(t);
      const { bots, home } = await aBot(box);
      const outside = await outsideFolder(box);
      const target = path.join(outside, 'target.lock');
      await writeFile(target, text);
      const lockFile = lock.lockFile(bots, BOT);
      await clearName(lockFile);
      await symlink(target, lockFile);
      const guardedBefore = await bytesOf(lock.guarded(home));

      const ended = await attempt(lock, home);

      await assertKeeps(target, text);
      assert.deepEqual(await readdir(outside), ['target.lock'], 'nothing is made beside the file outside');
      assert.equal(ended.went, false, 'the operation refuses; it went through');
      assert.deepEqual(await bytesOf(lock.guarded(home)), guardedBefore, `${path.basename(lock.guarded(home))} is as it was`);
    });
  }
}

// ------------------------------------------------- L3: not a file, not a link, in a child process

/** The module under test, as the child imports it. */
const bookModule = pathToFileURL(path.join(repoRoot, 'src', 'book.js')).href;

/**
 * Run the lock's operation in a child process of its own, killed after
 * HANG_MS. Answers `{ went, hung, said }`: `went` when the child says the
 * operation went through, `hung` when it was killed.
 */
async function attemptInAChild(box, lock, home) {
  const script = path.join(box.root, 'attempt.mjs');
  await writeFile(script, `${[
    `import { takeBotTurn, updateBook } from ${JSON.stringify(bookModule)};`,
    `const which = ${JSON.stringify(lock.key)};`,
    `const home = ${JSON.stringify(home)};`,
    'try {',
    "  if (which === 'book') {",
    "    await updateBook(home, (book) => { book.sessions = { ...book.sessions, nightly: { tab: 'tab-new' } }; return book; });",
    '  } else {',
    '    takeBotTurn(home).release();',
    '  }',
    "  process.stdout.write('WENT\\n');",
    '} catch (error) {',
    "  process.stdout.write(`REFUSED ${error.message}\\n`);",
    '}',
  ].join('\n')}\n`);
  const result = await node([script], { cwd: box.cwd, env: box.env, timeout: HANG_MS });
  return {
    went: result.stdout.startsWith('WENT'),
    hung: result.signal !== null,
    said: `exit ${result.code}, signal ${result.signal}: ${said(result)}`,
  };
}

const NOT_FILES = [
  ['a FIFO', makeFifo],
  ['a directory', (file) => mkdir(file)],
];

for (const lock of LOCKS) {
  for (const [kind, plant] of NOT_FILES) {
    test(`#605 L3 ${lock.label} with ${kind} at its name: the operation refuses, does not hang, and ${lock.key === 'book' ? 'the book' : 'bot.yaml'} is as it was`, async (t) => {
      const box = await createSandbox(t);
      const { bots, home } = await aBot(box);
      const lockFile = lock.lockFile(bots, BOT);
      await clearName(lockFile);
      await plant(lockFile);
      const guardedBefore = await bytesOf(lock.guarded(home));

      const ended = await attemptInAChild(box, lock, home);

      assert.equal(ended.hung, false, `the operation does not hang: it was still running after ${HANG_MS} ms (${ended.said})`);
      assert.equal(ended.went, false, `the operation refuses; it went through (${ended.said})`);
      assert.deepEqual(await bytesOf(lock.guarded(home)), guardedBefore, `${path.basename(lock.guarded(home))} is as it was`);
    });
  }
}

// ------------------------------------------------- L4: the other side, in this process

const PLAIN = [
  ['nothing', async () => {}],
  ['an empty plain file', (file) => writeFile(file, '')],
];

for (const lock of LOCKS) {
  for (const [kind, plant] of PLAIN) {
    test(`#605 L4 ${lock.label} with ${kind} at its name: the operation goes through and its change is there`, async (t) => {
      const box = await createSandbox(t);
      const { bots, home } = await aBot(box);
      const lockFile = lock.lockFile(bots, BOT);
      await clearName(lockFile);
      await plant(lockFile);

      const ended = await attempt(lock, home);

      assert.equal(ended.went, true, `the operation goes through; it refused: ${ended.error?.message}`);
      lock.landed(home);
      // Taken again, the lock is still to be had: the first one was let go.
      assert.equal((await attempt(lock, home)).went, true, 'the operation goes through a second time');
    });
  }
}

// ------------------------------------------------- the CLI: session add takes the bot lock

const ADD_OPS = ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'ops'];

/** `obk session add` of ops, killed after HANG_MS. */
const addOps = (box) => node([box.cli, ...ADD_OPS], { cwd: box.cwd, env: box.env, timeout: HANG_MS });

const botYamlOf = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');
const hasOps = (doc) => Array.isArray(doc?.sessions) && doc.sessions.some((one) => one?.name === 'ops');

/** What can be at the bot lock's name for the CLI, and what is planted outside first. */
const CLI_REFUSALS = [
  ['a link to a name outside with nothing at it (the repro on PR #603)', 'L1', null, (target, file) => symlink(target, file)],
  ['a link to an empty file outside', 'L2', '', (target, file) => symlink(target, file)],
  ['a link to a text file outside', 'L2', OUTSIDE_TEXT, (target, file) => symlink(target, file)],
  ['a FIFO', 'L3', undefined, (target, file) => makeFifo(file)],
];

for (const [kind, criterion, outsideText, plant] of CLI_REFUSALS) {
  test(`#605 ${criterion} obk session add with ${kind} at the bot lock's name exits non-zero, makes or changes no file outside, and leaves bot.yaml as it was`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await aBot(box);
    const outside = await outsideFolder(box);
    const target = path.join(outside, 'target.lock');
    if (typeof outsideText === 'string') await writeFile(target, outsideText);
    const lockFile = botLockFile(bots, BOT);
    await clearName(lockFile);
    await plant(target, lockFile);
    const outsideBefore = await readdir(outside);
    const yamlBefore = await readFile(botYamlOf(bots));

    const result = await addOps(box);

    assert.equal(result.signal, null, `session add does not hang: it was still running after ${HANG_MS} ms`);
    if (outsideText === null) assert.equal(await isThere(target), false, `no file is made at the link's target ${target}`);
    if (typeof outsideText === 'string') await assertKeeps(target, outsideText);
    assert.deepEqual(await readdir(outside), outsideBefore, 'nothing is made in the folder outside');
    assert.notEqual(result.code, 0, `session add refuses; it exited 0:\n${said(result)}`);
    assert.deepEqual(await readFile(botYamlOf(bots)), yamlBefore, 'bot.yaml is as it was');
  });
}

for (const [kind, plant] of PLAIN) {
  test(`#605 L4 obk session add with ${kind} at the bot lock's name exits 0, and ops is in bot.yaml`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await aBot(box);
    const lockFile = botLockFile(bots, BOT);
    await clearName(lockFile);
    await plant(lockFile);
    assert.equal(hasOps(parse(await readFile(botYamlOf(bots), 'utf8'))), false, 'the premise: no session ops before');

    const result = await addOps(box);

    assert.equal(result.code, 0, `session add goes through:\n${said(result)}`);
    assert.equal(hasOps(parse(await readFile(botYamlOf(bots), 'utf8'))), true, 'bot.yaml has the session ops');
  });
}

// ------------------------------------------------- the name looked at again, after the lock is held

// The tests above plant a link before the kit comes for the lock, so the kit
// meets the link when it opens the name itself. The issue asks for one more
// thing: whatever is at the name when the lock is taken is never followed, and
// SQLite never makes a file. That moment is reached here with no race: a
// second turn on one lock file in one process, taken while the first is held.
// The kit cannot open the name again for the second turn on its own (closing
// any descriptor on that file would let go of the first turn's lock), so what
// is at the name then is what the lock is taken on.
//
// The lock is a session's `lines` turn, which takeLineTurn takes shared: two
// can be held at once in one process. The session daily need not be in
// bot.yaml.
//
// N1  First turn held; the real `lines` file moved aside in its folder, and a
//     link at its name to a name outside with nothing at it. The second turn
//     is not taken (it throws, or answers undefined), and nothing is made
//     outside.
// N2  The same, with a link to an empty file outside: that file keeps its 0
//     bytes, nothing is made beside it, and the second turn is not taken.
// N3  The other side: with nothing swapped, the two turns are both taken and
//     both let go.

const LINE_WAIT_MS = 2_000;

/** Take a line turn, and answer how it ended: `{ turn }` (undefined when it did not come), or `{ error }`. */
function lineTurn(home) {
  try {
    return { turn: takeLineTurn(home, 'daily', LINE_WAIT_MS) };
  } catch (error) {
    return { error };
  }
}

const notTaken = (ended) => ended.error !== undefined || ended.turn === undefined;
const toldLine = (ended) => (ended.error ? `it threw: ${ended.error.message}` : ended.turn === undefined ? 'it answered undefined' : 'it was taken');

for (const [criterion, kind, outsideText] of [['N1', 'a name outside with nothing at it', null], ['N2', 'an empty file outside', '']]) {
  test(`#605 ${criterion} a second line turn, taken while the first is held and after the lines file was swapped for a link to ${kind}: it is not taken, and nothing is made or changed outside`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await aBot(box);
    const outside = await outsideFolder(box);
    const target = path.join(outside, 'target.lock');
    if (outsideText !== null) await writeFile(target, outsideText);
    const lines = turnLockFile(bots, BOT, 'daily', 'lines');

    const first = lineTurn(home);
    assert.equal(typeof first.turn?.release, 'function', `the premise: the first line turn is taken, ${toldLine(first)}`);
    let second;
    try {
      assert.equal(await isThere(lines), true, `the premise: the first turn holds its lock on ${lines}`);
      await rename(lines, `${lines}.moved`);
      await symlink(target, lines);

      second = lineTurn(home);

      if (outsideText === null) assert.equal(await isThere(target), false, `no file is made at the link's target ${target}`);
      else await assertKeeps(target, outsideText);
      assert.deepEqual(await readdir(outside), outsideText === null ? [] : ['target.lock'], 'nothing is made in the folder outside');
      assert.equal(notTaken(second), true, `the second line turn is not taken; ${toldLine(second)}`);
    } finally {
      // Let go of whatever was taken, so the sandbox can go; the claim is above.
      try { second?.turn?.release(); } catch { /* the claim is above */ }
      try { first.turn.release(); } catch { /* the claim is above */ }
    }
  });
}

test('#605 N3 two line turns held at once, with nothing swapped: both are taken, and both let go', async (t) => {
  const box = await createSandbox(t);
  const { home } = await aBot(box);

  const first = lineTurn(home);
  assert.equal(typeof first.turn?.release, 'function', `the first line turn is taken; ${toldLine(first)}`);
  const second = lineTurn(home);
  assert.equal(typeof second.turn?.release, 'function', `the second line turn is taken while the first is held; ${toldLine(second)}`);
  second.turn.release();
  first.turn.release();
  // Both let go: a third turn comes again.
  const third = lineTurn(home);
  assert.equal(typeof third.turn?.release, 'function', `a line turn is taken again after both were let go; ${toldLine(third)}`);
  third.turn.release();
});

// ------------------------------------------------- a swap while the lock is taken: a real race

// The tests above put something at the lock's name and leave it there. A
// session that can write in the bot's folder of locks can also change the name
// while the kit takes the lock: move the kit's file aside, put a link at the
// name to a file outside, and put the kit's file back, over and over. Then the
// kit may meet the plain file when it looks at the name, open the link, and
// meet the plain file again when it looks once more. The requirement is the
// same: no file outside is opened, made or written. So an empty file outside
// keeps its 0 bytes, and nothing is made beside it (a SQLite journal).
//
// R1  For each of the two locks: a child process of this test swaps the name
//     in a tight loop (move aside, link to an empty file outside, put back),
//     while this process takes the lock and lets it go many times. After each
//     take the file outside is looked at. Whether a take goes through or
//     refuses is left open; both are allowed.
//
// The seam is a real race, not a hook in node:fs: a hook would pin which call
// the kit makes and when, and the requirement says nothing of that. The cost
// is that a red is likely, not certain: a race is bounded by RACE_TAKES and
// RACE_MS, and the test says in a diagnostic how many takes and swaps it saw.
// The child stops itself at a stop file or its own deadline; if it has not
// ended soon after, it is killed by the pid captured when it was spawned.

const RACE_TAKES = 2_000;
const RACE_MS = 15_000;

/** The child that swaps the name, as a script: argv is lock, aside, target, ready, stop, ms. */
const SWAPPER = `${[
  "import { existsSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';",
  'const [lock, aside, target, ready, stop, ms] = process.argv.slice(2);',
  'const until = Date.now() + Number(ms);',
  'let swaps = 0;',
  'let rounds = 0;',
  'writeFileSync(ready, "");',
  'for (; Date.now() < until; rounds += 1) {',
  '  if (rounds % 256 === 0 && existsSync(stop)) break;',
  '  try { renameSync(lock, aside); } catch { continue; }',
  '  try { symlinkSync(target, lock); } catch { /* the kit made a file at the name meanwhile */ }',
  '  try { renameSync(aside, lock); swaps += 1; } catch { /* put back next round */ }',
  '}',
  'process.stdout.write(`${swaps} swaps in ${rounds} rounds`);',
].join('\n')}\n`;

/** Start the swapper on `lock`, and answer `stop()`, which ends it and answers what it said of its swaps. */
async function startSwapper(box, lock, target) {
  const dir = path.join(box.root, 'swapper');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, 'swap.mjs');
  await writeFile(script, SWAPPER);
  const ready = path.join(dir, 'ready');
  const stopFile = path.join(dir, 'stop');
  const child = spawn(process.execPath, [script, lock, `${lock}.aside`, target, ready, stopFile, String(RACE_MS + 5_000)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const { pid } = child;
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { out += chunk; });
  const ended = new Promise((resolve) => child.on('close', resolve));
  const until = Date.now() + 5_000;
  while (!(await isThere(ready)) && Date.now() < until) await delay(10);
  assert.equal(await isThere(ready), true, 'the premise: the swapper started');
  return {
    async stop() {
      await writeFile(stopFile, '');
      const done = await Promise.race([ended.then(() => true), delay(3_000).then(() => false)]);
      if (!done) {
        process.kill(pid, 'SIGKILL');
        await ended;
      }
      return out || 'nothing said';
    },
  };
}

for (const lock of LOCKS) {
  test(`#605 R1 ${lock.label}, taken again and again while its name is swapped for a link to an empty file outside and back: that file keeps its 0 bytes, and nothing is made beside it`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await aBot(box);
    const outside = await outsideFolder(box);
    const target = path.join(outside, 'empty.lock');
    await writeFile(target, '');
    const lockFile = lock.lockFile(bots, BOT);
    await clearName(lockFile);
    assert.equal((await attempt(lock, home)).went, true, 'the premise: the lock is taken once before the race, which leaves its file at the name');
    assert.equal(await isThere(lockFile), true, 'the premise: the lock\'s file is at its name');

    const swapper = await startSwapper(box, lockFile, target);
    let takes = 0;
    let went = 0;
    let damage;
    const until = Date.now() + RACE_MS;
    try {
      while (takes < RACE_TAKES && Date.now() < until) {
        takes += 1;
        if ((await attempt(lock, home)).went) went += 1;
        const bytes = await readFile(target);
        const listed = await readdir(outside);
        if (bytes.length !== 0 || listed.length !== 1) {
          damage = { bytes, listed };
          break;
        }
      }
    } finally {
      const swaps = await swapper.stop();
      t.diagnostic(`${takes} takes (${went} went through); the swapper: ${swaps}`);
    }

    if (damage !== undefined) {
      assert.fail(`after take ${takes}, the file outside holds ${damage.bytes.length} bytes, starting `
        + `${JSON.stringify(damage.bytes.subarray(0, 16).toString('latin1'))}, and the folder outside holds ${JSON.stringify(damage.listed)}`);
    }
    await assertKeeps(target, '');
    assert.deepEqual(await readdir(outside), ['empty.lock'], 'nothing is made beside the file outside');
  });
}
