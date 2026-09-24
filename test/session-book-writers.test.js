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
// before its own next line does. Making the write conditional on the book still
// being the file that was read was the next answer, and the fourth review broke
// that too: a pause between the check and the replace loses the same commit, and
// there is no gap small enough to be safe from a process that can be stopped
// anywhere in it.
//
// So a writer is no longer overtaken at all. The lock belongs to the process
// rather than to a timer: the operating system holds it while that process is
// stopped and lets it go when the process ends, well or badly, so there is
// nothing to refresh, nothing to call abandoned, and no seam between deciding to
// write and writing. What is left to pin is an impossibility — while one writer is
// inside the lock, no other writer can commit, whatever the first one is doing or
// not doing — and, on the other side, that a writer which cannot get in says so
// and writes nothing. No committed change is lost either way, which is the whole
// of what the book needs (round 4, finding 2, and the audit after it).
//
// One thing more, which the fifth review found by keeping the lock somewhere the
// environment decides. A lock only holds anybody out if it is the same lock, and
// the two programs that write a book do not agree about their environment: `up`
// runs from the user's shell, the kit's hook runs inside a session with whatever
// the harness was started with. A turn keyed on `TMPDIR` is therefore two turns —
// two writers, each holding a lock properly, each alone, neither the other's — and
// the review lost an id that way through two real `session record` runs with
// nothing else different: no cleanup, no expiry, no stopped process, nothing to
// blame but the two turns. So the turn is about the book itself, and the last two
// tests below hold that from outside: two writers started in different
// environments still wait for each other, and nothing of the kit's own ends up in
// the user's repo. Where the file lives is the kit's business; that everyone who
// can write a book takes the same one is not.
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
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  bookOf,
  botHomeOf,
  createSandbox,
  node,
  repoRoot,
  skipGit,
  snapshot,
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
 * That time is not the wall clock's (#255). The operating system slews the wall
 * clock while the machine runs — macOS pulls it back a few milliseconds every
 * so often — but a stop and a wait count the monotonic clock, so thirty-five
 * seconds really stopped could read as thirty-four and a bit on `Date.now()`.
 * The log uses `process.hrtime`, the clock Node's own timers count, so a window
 * reads as long as it really was. Node promises only that it counts from some
 * point in the past; what makes two writers' stamps comparable is that the
 * point is the machine's rather than the process's — the time since boot, on
 * macOS and on Linux alike.
 *
 * A change that has to take time is asynchronous and is awaited under the lock;
 * a writer with nothing to wait for changes the book in one step, as the kit's
 * own callers do.
 *
 * `env` is what that process was started with, for the case where two writers of
 * one book do not agree about their environment — `up` runs from the user's shell
 * and the kit's hook from inside a session, with the harness's.
 *
 * `blocks` is the other kind of slow, and the one that matters: the writer stops
 * its own thread for that long, the way a machine that swapped or a debugger that
 * stopped a process does. Nothing of that process runs while it is stopped — no
 * heartbeat, no notification, no handler — so a lock that is kept alive by a
 * timer is not kept alive at all (round 4, finding 2).
 *
 * `stopsBeforeTheLockFor` stops the writer at a point `blocks` cannot reach:
 * when it is about to put in place a book that does not hold its own change yet
 * — a book it made from what it read before its change ran, which is the first
 * write of #161 — it says `paused` and stops its thread until the named writer
 * has finished, or for three seconds at most, and then the real rename goes
 * ahead. A write that holds its change never pauses.
 *
 * Why the file system is wrapped: that gap is synchronous and comes before
 * `change` is ever called, so nothing the writer hands `updateBook` runs in it,
 * and a stop inside `change` is already past it. The rename is where any book
 * goes into place today (`writeBook`), so the writer process wraps
 * `fs.renameSync` and has Node carry that to the named import the book module
 * uses (`syncBuiltinESMExports`). It is instrumentation of this child process
 * only — it watches and delays the kit's own rename, and stands in for none of
 * the kit's code. A kit that puts the book in place some other way simply never
 * pauses here.
 *
 * `comesInOn` is the writer that comes into that gap: it starts once the named
 * writer has paused, or has finished without ever pausing.
 */
async function aWriter(box, home, name, {
  holds = 0, blocks = 0, arrivesAfter = 0, stopsBeforeTheLockFor = null, comesInOn = null, env = {},
} = {}) {
  const dir = path.join(box.root, 'writers');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, `${name}.mjs`);
  const log = path.join(dir, 'writers.log');
  // Where the holder says, once, at what moment it took the lock.
  const holding = path.join(dir, 'holding');

  const put = `book.sessions[${JSON.stringify(name)}] = { tab: ${JSON.stringify(`tab-${name}`)} };`;
  await writeFile(script, `${[
    "import fs, { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    `import { bookFile, updateBook } from ${JSON.stringify(bookModule)};`,
    '',
    `const NAME = ${JSON.stringify(name)};`,
    `const HOME = ${JSON.stringify(home)};`,
    `const LOG = ${JSON.stringify(log)};`,
    `const HOLDING = ${JSON.stringify(holding)};`,
    `const HOLDS = ${JSON.stringify(holds)};`,
    `const BLOCKS = ${JSON.stringify(blocks)};`,
    `const ARRIVES_AFTER = ${JSON.stringify(arrivesAfter)};`,
    `const STOPS_FOR = ${JSON.stringify(stopsBeforeTheLockFor)};`,
    `const COMES_IN_ON = ${JSON.stringify(comesInOn)};`,
    '',
    '// Monotonic milliseconds, shared by every process on the machine: see above.',
    'const now = () => Number(process.hrtime.bigint()) / 1e6;',
    'const say = (what) => appendFileSync(LOG, `${JSON.stringify({ writer: NAME, what, at: now() })}\\n`);',
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
    '  await sleep(Math.max(0, took + ARRIVES_AFTER - now()));',
    '}',
    '',
    '// Whether a writer has said any of these steps yet, from the log they share.',
    'const said = (writer, whats) => existsSync(LOG) && readFileSync(LOG, \'utf8\').split(\'\\n\')',
    '  .filter((line) => line !== \'\').map((line) => JSON.parse(line))',
    '  .some((step) => step.writer === writer && whats.includes(step.what));',
    '',
    '// Coming in while somebody else is stopped before the lock, or once it is',
    '// done if it never stopped there. Bounded, so a writer that died does not',
    '// leave this one waiting for ever.',
    'if (COMES_IN_ON !== null) {',
    '  const until = Date.now() + 20_000;',
    '  while (!said(COMES_IN_ON, [\'paused\', \'committed\', \'refused\']) && Date.now() < until) await sleep(20);',
    '}',
    '',
    '// Stopped before its change is in: a book about to go into place without this',
    '// writer\'s own change is one it made from what it read earlier. Decided by',
    '// what is in the book, not by which write this is, and not at all once the',
    '// other writer has finished, since there is then nothing left to come into.',
    'if (STOPS_FOR !== null) {',
    '  const move = fs.renameSync;',
    '  fs.renameSync = (from, to) => {',
    `    if (to === bookFile(HOME) && !readFileSync(from, 'utf8').includes(${JSON.stringify(`tab-${name}`)})`,
    '      && !said(STOPS_FOR, [\'committed\', \'refused\'])) {',
    '      say(\'paused\');',
    '      const until = Date.now() + 3000;',
    '      while (!said(STOPS_FOR, [\'committed\', \'refused\']) && Date.now() < until) stop(20);',
    '      say(\'resumed\');',
    '    }',
    '    return move(from, to);',
    '  };',
    '  syncBuiltinESMExports();',
    '}',
    '',
    '// The lock, attempt by attempt. Nothing should take the book away from a',
    '// writer that holds it, so the change should run once — but a change that ran',
    '// twice would otherwise make two `holding` steps of one writer and trip the',
    '// timings rather than show themselves. So the first attempt says `holding` and',
    '// any after it say `retrying`, and the log tells whoever reads a failure which',
    '// it was.',
    '//',
    '// Only the first attempt waits: a process is stopped once, and a fixture that',
    '// stopped again on every attempt would pay for this window twice over.',
    'let attempt = 0;',
    'const took = () => {',
    '  attempt += 1;',
    '  if (attempt === 1) writeFileSync(HOLDING, String(now()));',
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
    run: () => node([script], { cwd: box.cwd, env: { ...box.env, ...env } }),
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

test('a writer cannot commit while another writer is stopped inside the lock', async (t) => {
  // The case three reviews have now driven, and the last shape of it: A reads
  // under the lock and its process stops for thirty-five seconds — a machine that
  // swapped, a laptop that slept, a debugger — while B comes for the lock at
  // thirty-one, past any window a lease or a check could have given it.
  //
  // Every earlier answer lost B's change here, and each for the same reason: A
  // could be overtaken, and a stopped process cannot be told so. Nothing may
  // overtake it now, so what this pins is that nothing does. B does not hold the
  // lock, and does not commit, until A has finished — whatever A is doing or not
  // doing in the meantime.
  //
  // After that, either road is right: B waits its turn and commits, or B gives up
  // and says so having written nothing. What must never happen is a commit in the
  // middle. It takes about thirty-five seconds, and there is no shortening a case
  // about a window measured in them.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const before = await readFile(bookOf(bots), 'utf8');

  const stopped = await aWriter(box, home, 'the-stopped-one', { blocks: 35_000 });
  const arriving = await aWriter(box, home, 'the-other-one', { arrivesAfter: 31_000 });
  const [paused, other] = await Promise.all([stopped.run(), arriving.run()]);

  // What really happened, read back rather than assumed: the first writer was
  // inside the lock and stopped for the whole window, and the second came for it
  // while it was.
  const steps = await stopped.steps();
  const holding = when(steps, 'the-stopped-one', 'holding');
  const woke = when(steps, 'the-stopped-one', 'committed');
  assert.ok(
    woke - holding >= 35_000,
    `the stopped writer should have been inside the lock for the whole window, got: ${JSON.stringify(steps)}`,
  );
  assert.ok(
    when(steps, 'the-other-one', 'arrived') - holding >= 30_000,
    `and the other one should have come for it while it was stopped, got: ${JSON.stringify(steps)}`,
  );

  // The impossibility itself: nothing of the other writer's happened inside that
  // window. Not a commit, and not the lock either — a writer that held the lock
  // there would be a writer that could have written.
  const what = { holding: 'take the lock', retrying: 'take the lock again', committed: 'commit' };
  for (const step of steps) {
    if (step.writer === 'the-other-one' && step.what !== 'arrived') {
      assert.ok(
        step.at >= woke,
        `the other writer must not ${what[step.what] ?? step.what} while the first is stopped inside`
        + ` the lock: ${JSON.stringify(steps)}`,
      );
    }
  }

  assert.equal(paused.code, 0, `nothing overtook the stopped writer, so it commits: ${paused.stderr}`);
  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  // And the other writer either has its change in the book or failed out loud
  // with nothing written; both are right, losing it quietly is not.
  assertNobodyLostAChange(book, [
    { name: 'the-stopped-one', ran: paused },
    { name: 'the-other-one', ran: other },
  ]);
  assertKeptWhatTheyWrote(before, text, { changed: ['sessions'] });
  assert.notEqual(book.sessions?.daily, undefined, `the session that was there is still there:\n${text}`);
});

test('a writer that waits too long for the lock says so and writes nothing', async (t) => {
  // The other side of the same rule, and the one road out of it: a writer cannot
  // wait for ever, so one that has waited its patience out gives up. What matters
  // is how it gives up — a message, no write, and a non-zero exit — because a
  // writer that quietly carried on would be exactly the writer this whole file
  // exists to rule out.
  //
  // The timings are chosen against the wait a writer is given, ten seconds: the
  // one inside the lock stops for fifteen, and the other comes for it at once, so
  // it is still waiting when its patience runs out. If that wait ever changes,
  // these two numbers change with it.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const before = await readFile(bookOf(bots), 'utf8');

  const stopped = await aWriter(box, home, 'the-stopped-one', { blocks: 15_000 });
  const arriving = await aWriter(box, home, 'the-impatient-one', { arrivesAfter: 500 });
  const [paused, impatient] = await Promise.all([stopped.run(), arriving.run()]);

  assert.equal(paused.code, 0, `the writer that had the lock keeps its change: ${paused.stderr}`);
  assert.notEqual(
    impatient.code,
    0,
    'the writer that could not get in should have given up rather than waited out a stopped process'
    + ` (if it now waits longer than the one inside the lock, these timings want revisiting): ${impatient.stdout}`,
  );
  assert.notEqual(impatient.stderr.trim(), '', 'and said what happened, in the kit\'s own words');
  assert.match(
    impatient.stderr,
    new RegExp(bookOf(bots).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `naming the file nobody could write: ${impatient.stderr}`,
  );
  // And every file it names is a file that is there. A message that sends the
  // user to a path which does not exist is worse than one that names none: they
  // go looking, find nothing, and have no way to tell whether they have fixed
  // anything. Where the kit keeps its lock is its own business — that this
  // sentence is true of it is not.
  for (const named of impatient.stderr.match(new RegExp(`${box.root.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\S*`, 'g')) ?? []) {
    const file = named.replace(/[.,;:)]+$/, '');
    assert.ok(existsSync(file), `the message points at ${file}, which is not there: ${impatient.stderr}`);
  }

  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assertNobodyLostAChange(book, [
    { name: 'the-stopped-one', ran: paused },
    { name: 'the-impatient-one', ran: impatient },
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

test('two writers of one book take the same turn, whatever environment each was started in', async (t) => {
  // `up` runs from the user's shell; the kit's hook runs inside a session, with
  // whatever environment the harness was started with. The two agree about the
  // book and about nothing else — so a turn that is keyed on anything the
  // environment decides is not one turn but two, and each writer holds its own
  // properly, alone, and never meets the other. The fifth review did exactly that
  // with `TMPDIR`, through two real `session record` runs with nothing else
  // different between them, and an id went missing: no cleanup, no expiry, no
  // stopped process, nothing to blame but the two turns.
  //
  // So: one book, two environments, and the second writer has to wait for the
  // first rather than work beside it.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const ownTemp = async (which) => {
    const dir = path.join(box.root, `temp-${which}`);
    await mkdir(dir, { recursive: true });
    return dir;
  };

  const first = await aWriter(box, home, 'the-first-one', {
    holds: 1200,
    env: { TMPDIR: await ownTemp('one') },
  });
  const second = await aWriter(box, home, 'the-second-one', {
    arrivesAfter: 200,
    env: { TMPDIR: await ownTemp('two') },
  });
  const [one, two] = await Promise.all([first.run(), second.run()]);

  assert.equal(one.code, 0, one.stderr);
  assert.equal(two.code, 0, `the writer that had to wait must not fail: ${two.stderr}`);

  const steps = await first.steps();
  assert.ok(
    when(steps, 'the-second-one', 'arrived') < when(steps, 'the-first-one', 'committed'),
    `the second writer should have wanted the book while the first held it, got: ${JSON.stringify(steps)}`,
  );
  assert.ok(
    when(steps, 'the-second-one', 'holding') - when(steps, 'the-second-one', 'arrived') >= 500,
    'the second writer went in beside the first instead of waiting for it, so the two of them were'
    + ` never taking the same turn: ${JSON.stringify(steps)}`,
  );

  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assertNobodyLostAChange(book, [{ name: 'the-first-one', ran: one }, { name: 'the-second-one', ran: two }]);
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

test('writing the book leaves nothing behind in the user\'s repo, not even while the lock is held', async (t) => {
  // Where the kit says a writer holds the book is the kit's own business. That it
  // is not said inside the user's repo is not: the bots folder is committed with
  // the rest of their work and nothing in it is ignored (PRD 6.10), so a file left
  // there sits in their git status for ever, and one that comes and goes turns up
  // in it at whatever moment they happen to look. The kit already has a place for
  // its own files — beside the bots folder, where a session's start prompt goes
  // (PRD 6.3) — and that is where this belongs too.
  //
  // So: the tree the user owns, before a write, while it is being written, and
  // after. The book's own bytes change; nothing else appears, at any of the three.
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  const before = await snapshot(bots, skipGit);

  // Long enough to be looked at while it is inside the lock, short enough to cost
  // the suite nothing.
  const writer = await aWriter(box, home, 'the-writer', { holds: 1500 });
  const run = writer.run();
  for (let look = 0; look < 200; look += 1) {
    if ((await writer.steps()).some((step) => step.what === 'holding')) break;
    await sleep(50);
  }
  const during = await snapshot(bots, skipGit);
  const ran = await run;
  const after = await snapshot(bots, skipGit);

  assert.equal(ran.code, 0, ran.stderr);
  assert.deepEqual(
    Object.keys(during),
    Object.keys(before),
    'while a writer holds the book, nothing new may exist in the user\'s repo',
  );
  assert.deepEqual(
    Object.keys(after),
    Object.keys(before),
    'and nothing may be left there when it is done',
  );
  const book = path.relative(bots, bookOf(bots));
  assert.notEqual(after[book], before[book], 'the write this is about did happen');
});

test('two writers of a bot with no book yet both keep their change, even with one stopped before the lock', async (t) => {
  // The very first write, the one that makes the file (#161). A writer that
  // finds no book has decided the book is empty; if it then puts that empty book
  // in place after another writer has taken the lock and recorded its id, the id
  // is gone, and nothing about the lock prevented it, because the book was never
  // put in place under the lock.
  //
  // So one writer is stopped in that gap: it has read that there is no book and
  // is about to put its empty one in place. The other comes in then, records its
  // change and finishes. Then the first carries on. However the book comes to be
  // made, both changes have to be in it at the end (ADR 0002).
  const box = await createSandbox(t);
  const { bots, home } = await aBook(box);
  await rm(bookOf(bots));

  const stopped = await aWriter(box, home, 'the-stopped-one', { stopsBeforeTheLockFor: 'the-other-one' });
  const other = await aWriter(box, home, 'the-other-one', { comesInOn: 'the-stopped-one' });
  const [paused, came] = await Promise.all([stopped.run(), other.run()]);

  assert.equal(paused.code, 0, paused.stderr);
  assert.equal(came.code, 0, `the writer that came in must not fail: ${came.stderr}`);

  // Where the stop really happened, the other writer came in while it lasted.
  // A kit that never puts a book in place without the writer's own change in it
  // never pauses here: then there is no gap, the other writer starts once the
  // first has committed, and this test is only the ordinary two writers. Read the
  // log before reading a pass as a gap that was closed — the step `paused` is in
  // it only when the stop happened.
  const steps = await stopped.steps();
  const pausedAt = steps.find((step) => step.writer === 'the-stopped-one' && step.what === 'paused')?.at;
  if (pausedAt !== undefined) {
    const resumedAt = steps.find((step) => step.writer === 'the-stopped-one' && step.what === 'resumed' && step.at >= pausedAt)?.at;
    const arrived = when(steps, 'the-other-one', 'arrived');
    assert.ok(
      arrived >= pausedAt && arrived < resumedAt,
      `the other writer should have come in while the first was stopped, got: ${JSON.stringify(steps)}`,
    );
  }

  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must be readable YAML, got:\n${text}`);
  assert.deepEqual(
    [book.sessions?.['the-stopped-one']?.tab, book.sessions?.['the-other-one']?.tab],
    ['tab-the-stopped-one', 'tab-the-other-one'],
    `both writers' changes must be in the book, got: ${JSON.stringify(steps)}\n${text}`,
  );
});
