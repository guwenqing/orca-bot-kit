// A writer that has lost the lock can never commit (round 3, finding 2).
//
// The book is written by two programs that know nothing of each other: `up`,
// writing a tab id down the moment Orca hands one over, and the kit's hook,
// writing a session's conversation from inside that session. Round two gave the
// lock a fixed thirty seconds: a lock older than that was called abandoned and
// taken over. The review drove two real processes at the book module and watched
// what that costs — writer A read under the lock and was held up for thirty-five
// seconds, writer B took the lock over at thirty-one and committed its change,
// and then A wrote the snapshot it had read at the start, over the top of B's.
//
// So a writer being slow no longer makes its lock anybody else's: the lock is
// kept alive while its owner lives, only a lock nobody is refreshing is taken
// over, and a writer that has lost its lock does not write at all. A writer that
// simply cannot get the lock yet waits for it, because the change it is holding
// is a conversation id nothing else in the kit knows.
//
// These go at `updateBook` itself, in separate processes, because that is where
// the guarantee is and there is no way to hold the book open for half a minute
// from the command line. Each writer below is one process, started by this test
// and left to finish on its own; nothing here signals or kills anything.
//
// The overlap is arranged rather than hoped for: the writer that is to come in
// late waits for the first one to say it has the lock, and then waits from that
// moment, so the timings in the assertions are the timings that really happened.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  bookOf,
  botHomeOf,
  createSandbox,
  node,
  repoRoot,
} from './helpers/cli.js';

/** The module under test, as the writers import it. */
const bookModule = pathToFileURL(path.join(repoRoot, 'src', 'book.js')).href;

/** A bots folder with a book in it: Bot Father's, written by `init`. */
async function aBook(box) {
  const ran = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(ran.code, 0, ran.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots), book: bookOf(bots) };
}

/**
 * One writer of the book, as its own process.
 *
 * `holds` keeps the lock for that long once it has it — the delayed writer of
 * the review's case — and `arrivesAfter` starts trying for the lock that long
 * after the holder said it had it. Every step it takes goes into a log with the
 * time, so a test can say what overlapped what rather than assume it.
 *
 * A change that has to take time is asynchronous and is awaited under the lock;
 * a writer with nothing to wait for changes the book in one step, as the kit's
 * own callers do.
 */
async function aWriter(box, home, name, { holds = 0, arrivesAfter = 0 } = {}) {
  const dir = path.join(box.root, 'writers');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, `${name}.mjs`);
  const log = path.join(dir, 'writers.log');
  // Where the holder says, once, at what moment it took the lock.
  const holding = path.join(dir, 'holding');

  const put = `book.sessions[${JSON.stringify(name)}] = { tab: ${JSON.stringify(`tab-${name}`)} };`;
  await writeFile(script, `${[
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    `import { updateBook } from ${JSON.stringify(bookModule)};`,
    '',
    `const NAME = ${JSON.stringify(name)};`,
    `const HOME = ${JSON.stringify(home)};`,
    `const LOG = ${JSON.stringify(log)};`,
    `const HOLDING = ${JSON.stringify(holding)};`,
    `const HOLDS = ${JSON.stringify(holds)};`,
    `const ARRIVES_AFTER = ${JSON.stringify(arrivesAfter)};`,
    '',
    'const say = (what) => appendFileSync(LOG, `${JSON.stringify({ writer: NAME, what, at: Date.now() })}\\n`);',
    '',
    '// Coming in while somebody else is inside the lock: wait for it to say so,',
    '// then wait from that moment for as long as the test asked.',
    'if (ARRIVES_AFTER > 0) {',
    '  while (!existsSync(HOLDING)) await sleep(50);',
    '  const took = Number(readFileSync(HOLDING, \'utf8\'));',
    '  await sleep(Math.max(0, took + ARRIVES_AFTER - Date.now()));',
    '}',
    '',
    'const change = HOLDS > 0',
    '  ? async (book) => {',
    '    say(\'holding\');',
    '    writeFileSync(HOLDING, String(Date.now()));',
    '    await sleep(HOLDS);',
    `    ${put}`,
    '  }',
    '  : (book) => {',
    '    say(\'holding\');',
    `    ${put}`,
    '  };',
    '',
    'say(\'arrived\');',
    'try {',
    '  await updateBook(HOME, change);',
    '  say(\'committed\');',
    '} catch (error) {',
    '  say(\'refused\');',
    '  process.stderr.write(`${error.message}\\n`);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n')}\n`);

  return {
    name,
    /** Run it, and answer as `box.run` does: the exit code and both streams. */
    run: () => node([script], { cwd: box.cwd, env: box.env }),
    /** Everything every writer wrote down, in the order it happened. */
    async steps() {
      const text = await readFile(log, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    },
  };
}

/** When one writer took one step, from the log the writers share. */
function when(steps, writer, what) {
  const found = steps.filter((step) => step.writer === writer && step.what === what);
  assert.equal(found.length, 1, `${writer} should have ${what} exactly once, got: ${JSON.stringify(steps)}`);
  return found[0].at;
}

/**
 * The rule every one of these tests is about: a writer that says it wrote has
 * its change in the book, and a writer that does not has said why and changed
 * nothing. A change that is neither in the file nor refused out loud is a lost
 * conversation id, which is the failure the book exists to prevent.
 */
function assertNobodyLostAChange(book, writers) {
  for (const { name, ran } of writers) {
    const kept = book.sessions?.[name] !== undefined;
    if (ran.code === 0) {
      assert.ok(kept, `${name} said it wrote and its change is not in the book: ${JSON.stringify(book.sessions)}`);
      continue;
    }
    assert.ok(!kept, `${name} failed and wrote all the same: ${JSON.stringify(book.sessions)}`);
    assert.notEqual(ran.stderr.trim(), '', `${name} failed and said nothing about it`);
  }
}

test('a writer delayed well past thirty seconds cannot write over what another one committed', async (t) => {
  // The review's case, with its own timings: thirty-five seconds inside the lock
  // and another writer arriving at thirty-one — past the thirty the old lock
  // called abandoned. It takes about as long as it says; there is no way to
  // shorten a test about a window measured in seconds.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const before = await readFile(bookOf(bots), 'utf8');

  const delayed = await aWriter(box, home, 'the-delayed-one', { holds: 35_000 });
  const arriving = await aWriter(box, home, 'the-late-one', { arrivesAfter: 31_000 });
  const [held, late] = await Promise.all([delayed.run(), arriving.run()]);

  // It really happened the way the case describes: the first writer had the lock
  // for longer than the old window, and the second came for it while it did.
  const steps = await delayed.steps();
  const holding = when(steps, 'the-delayed-one', 'holding');
  assert.ok(
    when(steps, 'the-delayed-one', 'committed') - holding >= 30_000,
    `the delayed writer should have been inside the lock past the old window, got: ${JSON.stringify(steps)}`,
  );
  assert.ok(
    when(steps, 'the-late-one', 'arrived') - holding >= 30_000,
    `and the other one should have come for it after that window opened, got: ${JSON.stringify(steps)}`,
  );

  assert.equal(held.code, 0, `the writer that had the lock all along should have written: ${held.stderr}`);
  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assertNobodyLostAChange(book, [{ name: 'the-delayed-one', ran: held }, { name: 'the-late-one', ran: late }]);

  // And the rest of the file is the user's: nothing about two writers racing may
  // take away what was in it before either of them.
  assertKeptWhatTheyWrote(before, text, { changed: ['sessions'] });
  assert.notEqual(book.sessions?.daily, undefined, `the session that was there is still there:\n${text}`);
});

test('a writer that cannot get the lock waits for it rather than losing its change', async (t) => {
  // The ordinary overlap, at the speed the kit really works at: one writer is
  // inside the lock, another wants it, and the second one's change is a
  // conversation id nothing else knows. So it waits and then writes, and both
  // changes are in the book afterwards.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);

  const first = await aWriter(box, home, 'the-first-one', { holds: 1200 });
  const second = await aWriter(box, home, 'the-second-one', { arrivesAfter: 200 });
  const [one, two] = await Promise.all([first.run(), second.run()]);

  assert.equal(one.code, 0, one.stderr);
  assert.equal(two.code, 0, `the writer that had to wait must not fail: ${two.stderr}`);

  const steps = await first.steps();
  assert.ok(
    when(steps, 'the-second-one', 'arrived') < when(steps, 'the-first-one', 'committed'),
    `the second writer should have wanted the lock while the first held it, got: ${JSON.stringify(steps)}`,
  );
  assert.ok(
    when(steps, 'the-second-one', 'holding') - when(steps, 'the-second-one', 'arrived') >= 500,
    `and waited for it instead of giving up or going in beside it, got: ${JSON.stringify(steps)}`,
  );

  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assertNobodyLostAChange(book, [{ name: 'the-first-one', ran: one }, { name: 'the-second-one', ran: two }]);
  assert.notEqual(book.sessions?.['the-second-one'], undefined, `the waiting writer's change is in the book:\n${text}`);
});

test('a crowd of writers on one book all keep their change', async (t) => {
  // Six processes, no delays, all writing the same file at once. Whatever order
  // they land in, every change has to be in the file at the end and the file has
  // to be one a reader can parse.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const names = ['one', 'two', 'three', 'four', 'five', 'six'];

  const writers = [];
  for (const name of names) writers.push(await aWriter(box, home, `writer-${name}`));
  const ran = await Promise.all(writers.map((writer) => writer.run()));

  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  for (const [at, result] of ran.entries()) {
    assert.equal(result.code, 0, `writer-${names[at]}: ${result.stderr}`);
  }
  assert.deepEqual(
    names.map((name) => book.sessions?.[`writer-${name}`]?.tab),
    names.map((name) => `tab-writer-${name}`),
    `every writer's change must be in the file:\n${text}`,
  );
});
