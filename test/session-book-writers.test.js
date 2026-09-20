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
// And then the third review stopped the owner's process instead of delaying it,
// which no lease can survive: a stopped process refreshes nothing, is told
// nothing, and runs nothing — so the notice that it lost the lock cannot reach it
// before its own next line does. The write is therefore conditional on the book
// still being the file that was read, checked immediately before the replace, and
// a writer that was overtaken reads again and applies its change to what is there
// now (round 4, finding 2). Which makes the guarantee simpler to state than the
// lock ever was: no committed change is lost, whichever way two writers
// interleave, and that is what the tests below hold it to.
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
 *
 * `blocks` is the other kind of slow, and the one that matters: the writer stops
 * its own thread for that long, the way a machine that swapped or a debugger that
 * stopped a process does. Nothing of that process runs while it is stopped — no
 * heartbeat, no notification, no handler — so a lock that is kept alive by a
 * timer is not kept alive at all (round 4, finding 2).
 */
async function aWriter(box, home, name, { holds = 0, blocks = 0, arrivesAfter = 0 } = {}) {
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
    `const BLOCKS = ${JSON.stringify(blocks)};`,
    `const ARRIVES_AFTER = ${JSON.stringify(arrivesAfter)};`,
    '',
    'const say = (what) => appendFileSync(LOG, `${JSON.stringify({ writer: NAME, what, at: Date.now() })}\\n`);',
    '',
    '// Stop this thread, so that nothing of this process runs at all: no timer,',
    '// no promise, no handler. A sleep that is awaited would leave all of them',
    '// running, which is the difference between the two cases below.',
    'const stop = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };',
    '',
    '// Coming in while somebody else is inside the lock: wait for it to say so,',
    '// then wait from that moment for as long as the test asked.',
    'if (ARRIVES_AFTER > 0) {',
    '  while (!existsSync(HOLDING)) await sleep(50);',
    '  const took = Number(readFileSync(HOLDING, \'utf8\'));',
    '  await sleep(Math.max(0, took + ARRIVES_AFTER - Date.now()));',
    '}',
    '',
    '// The lock, attempt by attempt. A writer that was overtaken while it held it',
    '// takes it again and applies its change to the book as it stands now, so the',
    '// change runs more than once: the first attempt says `holding` and every one',
    '// after it says `retrying`, which keeps each step a thing that happened once',
    '// and leaves the retries in the log for whoever reads a failure.',
    '//',
    '// Only the first attempt waits. A process is stopped once; a fixture that',
    '// stopped again on every attempt would pay for this window twice over.',
    'let attempt = 0;',
    'const took = () => {',
    '  attempt += 1;',
    '  if (attempt === 1) writeFileSync(HOLDING, String(Date.now()));',
    '  say(attempt === 1 ? \'holding\' : \'retrying\');',
    '  return attempt;',
    '};',
    '',
    'const change = HOLDS > 0',
    '  ? async (book) => {',
    '    if (took() === 1) await sleep(HOLDS);',
    `    ${put}`,
    '  }',
    '  : BLOCKS > 0',
    '    ? (book) => {',
    '      if (took() === 1) stop(BLOCKS);',
    `      ${put}`,
    '    }',
    '    : (book) => {',
    '      took();',
    `      ${put}`,
    '    };',
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

/**
 * When one writer took one step, from the log the writers share. Each step
 * happens once per writer — a second attempt at the lock says `retrying` rather
 * than `holding` again — so a step that turns up twice is something the fixture
 * did not expect and is worth failing on rather than reading past.
 */
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

test('a writer whose process is stopped inside the lock cannot lose what another one committed', async (t) => {
  // The case the third review reproduced, at the module and through two real
  // `session record` runs: A reads under the lock and its process stops for
  // thirty-five seconds — a machine that swapped, a laptop that slept, a debugger
  // — B takes the lock over at thirty-one and commits, and A wakes up holding a
  // book from before B's change and writes it back.
  //
  // A lease cannot catch this, however short it is: a stopped process refreshes
  // nothing and is told nothing, and the notice that its lock was taken cannot
  // run before its own next line. Only the file can say: the book A is about to
  // replace is no longer the one A read. A then takes the lock again and applies
  // its change to what is there now, which the log below shows as a `retrying`
  // between the first `holding` and the one `committed`.
  //
  // So both changes have to be in the book at the end, and neither writer may
  // fail — a conversation id a hook could not write down is a conversation the
  // book does not hold, and nothing else holds it. It takes about thirty-five
  // seconds, and there is no shortening a case about a window measured in them.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const before = await readFile(bookOf(bots), 'utf8');

  const stopped = await aWriter(box, home, 'the-stopped-one', { blocks: 35_000 });
  const overtaking = await aWriter(box, home, 'the-overtaking-one', { arrivesAfter: 31_000 });
  const [paused, over] = await Promise.all([stopped.run(), overtaking.run()]);

  // The interleaving the case is about, read back rather than assumed: the first
  // writer was inside the lock and stopped for the whole window, and the second
  // committed while it was.
  const steps = await stopped.steps();
  const holding = when(steps, 'the-stopped-one', 'holding');
  const woke = when(steps, 'the-stopped-one', 'committed');
  const overtook = when(steps, 'the-overtaking-one', 'committed');
  assert.ok(
    woke - holding >= 35_000,
    `the stopped writer should have been inside the lock for the whole window, got: ${JSON.stringify(steps)}`,
  );
  assert.ok(
    overtook > holding && overtook < woke,
    'the other writer should have committed while the first was stopped. If it waited for it'
    + ` instead, this test no longer reaches the case and wants rethinking, not relaxing: ${JSON.stringify(steps)}`,
  );

  assert.equal(over.code, 0, `the writer that got in must keep its change: ${over.stderr}`);
  assert.equal(
    paused.code, 0,
    `and the one that was overtaken must apply its change to what it finds, not fail: ${paused.stderr}`,
  );
  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assertNobodyLostAChange(book, [
    { name: 'the-stopped-one', ran: paused },
    { name: 'the-overtaking-one', ran: over },
  ]);
  assertKeptWhatTheyWrote(before, text, { changed: ['sessions'] });
  assert.notEqual(book.sessions?.daily, undefined, `the session that was there is still there:\n${text}`);
});

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
