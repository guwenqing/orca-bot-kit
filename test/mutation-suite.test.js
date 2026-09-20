// `scripts/mutation-suite.js` is the suite StrykerJS runs for every mutant: the
// same test files `npm test` runs, but one run per mutant, stopping the moment
// the mutant is known to be dead.
//
// Every test gets its own throwaway repo — a copy of the script under
// `scripts/`, and `test/` files of its own that mark a log when they start and
// when they end. The log is what tells a test which files ran, in what order,
// and whether two of them were running at the same time.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createSandbox, node, repoRoot } from './helpers/cli.js';

/**
 * End one process this test started, by its own pid, the way AGENTS.md requires
 * of any kill in this repo: what is about to be killed is printed first, and
 * anything that is not plainly a process of this test's own is refused.
 *
 * Never a negative id — that is a process group, and a group id this test did
 * not capture at spawn time is how a cleanup command took down every process on
 * the owner's machine on 2026-09-20.
 */
function killOne(pid) {
  assert.ok(Number.isInteger(pid) && pid > 1, `refusing to kill ${pid}: a pid of this test's own, never a group and never 1`);
  assert.notEqual(pid, process.pid, 'refusing to kill this test process');
  assert.notEqual(pid, process.ppid, 'refusing to kill the process that started this test');

  const listed = spawnSync('ps', ['-o', 'pid=,command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  process.stdout.write(`mutation-suite test: killing the process it started — ${listed || `${pid}, already gone`}\n`);
  // A pid that is not there any more is nothing to kill, and nothing to worry
  // about: the run it belonged to ended on its own.
  if (listed === '') return;
  assert.match(listed, /node/, `refusing to kill ${listed}: this test only ever starts node`);

  process.kill(pid, 'SIGKILL');
}

const scriptEntry = path.join(repoRoot, 'scripts', 'mutation-suite.js');

/** A value for `__STRYKER_ACTIVE_MUTANT__`: the script reads only that it is set. */
const A_LIVE_MUTANT = '7';

async function write(dir, rel, text) {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * A test file that marks the log when it starts and when it ends, each mark
 * carrying the id of the process running it. `delay` holds it open, so a test
 * can see whether two files ran at once and how long a run took; `fail` makes
 * it fail after it has marked its end.
 *
 * The log path is baked in rather than passed through the environment: the
 * script under test decides what environment the files it runs are given.
 */
function testFile({ name, log, delay = 0, fail = false }) {
  return [
    "import { appendFileSync } from 'node:fs';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    "import test from 'node:test';",
    '',
    `const mark = (kind) => appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name)} + ' ' + kind + ' ' + process.pid + '\\n');`,
    '',
    `test(${JSON.stringify(name)}, async () => {`,
    "  mark('start');",
    `  await sleep(${delay});`,
    "  mark('end');",
    ...(fail ? [`  throw new Error(${JSON.stringify(`${name} failed`)});`] : []),
    '});',
    '',
  ].join('\n');
}

/** What the fixture's files wrote: one `{ file, kind, pid }` per mark, in the order they were written. */
async function marksIn(log) {
  let text;
  try {
    text = await readFile(log, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').filter((line) => line !== '').map((line) => {
    const [file, kind, pid] = line.split(' ');
    return { file, kind, pid: Number(pid) };
  });
}

/** The files that ran, in the order they started. */
const startedIn = (marks) => marks.filter((mark) => mark.kind === 'start').map((mark) => mark.file);

/** A run is one file at a time when every file ended before the next one started. */
const oneAtATime = (marks) => marks.every((mark, at) => mark.kind === (at % 2 === 0 ? 'start' : 'end'));

/** The process a file ran in, or undefined when it never started. */
const pidOf = (marks, file) => marks.find((mark) => mark.file === file && mark.kind === 'start')?.pid;

/**
 * Wait until a file has started, and report the process running it. Starting a
 * process takes as long as the machine takes, so this waits rather than assumes.
 */
async function waitForStart(fixture, file) {
  for (let left = 200; left > 0; left -= 1) {
    const pid = pidOf(await fixture.marks(), file);
    if (pid !== undefined) return pid;
    await sleep(50);
  }
  throw new Error(`${file} never started`);
}

/**
 * A repo holding a copy of the script and the test files `spec` describes,
 * keyed by their path in the repo: `{ 'test/a.test.js': { delay, fail } }`.
 */
async function createRepo(t, spec) {
  const box = await createSandbox(t);
  const repo = path.join(box.root, 'repo');
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await copyFile(scriptEntry, path.join(repo, 'scripts', 'mutation-suite.js'));
  await write(repo, 'package.json', '{"name": "fixture", "type": "module"}\n');

  const log = path.join(box.root, 'ran.log');
  for (const [rel, options] of Object.entries(spec)) {
    await write(repo, rel, testFile({ name: rel, log, ...options }));
  }

  // The cache lives outside the repo, where a run cannot mistake it for a test
  // file; each fixture gets one of its own so tests can run at the same time.
  const cache = path.join(box.root, 'cache.json');

  // This suite is itself run by the script it describes, under the very tool
  // this script serves, so the ambient run's environment must not leak into a
  // fixture's. NODE_TEST_CONTEXT goes too: it is set in every process the test
  // runner starts, and a `node --test` that inherits it refuses to run any file.
  const {
    NODE_TEST_CONTEXT: _context,
    __STRYKER_ACTIVE_MUTANT__: _mutant,
    OBK_MUTATION_CACHE: _cache,
    OBK_MUTATION_TIMEOUT_MS: _timeout,
    ...bare
  } = box.env;

  return {
    repo,
    cache,
    /** Everything the fixture's test files recorded, in order. */
    marks: () => marksIn(log),
    /** What the cache file holds now. */
    readCache: async () => JSON.parse(await readFile(cache, 'utf8')),
    /** Put something in the cache file before a run. Text is written as it stands. */
    writeCache: (value) => writeFile(cache, typeof value === 'string' ? value : JSON.stringify(value)),
    /**
     * Run the script. `mutant` makes one live, `cache: false` names no cache
     * file at all, `timeoutMs` sets the variable the script must ignore,
     * `cwd` runs it elsewhere.
     */
    run: ({ mutant = false, cache: useCache = true, timeoutMs, cwd } = {}) => node(
      [path.join(repo, 'scripts', 'mutation-suite.js')],
      {
        cwd: cwd ?? repo,
        env: {
          ...bare,
          ...(mutant ? { __STRYKER_ACTIVE_MUTANT__: A_LIVE_MUTANT } : {}),
          ...(useCache ? { OBK_MUTATION_CACHE: cache } : {}),
          ...(timeoutMs === undefined ? {} : { OBK_MUTATION_TIMEOUT_MS: String(timeoutMs) }),
        },
      },
    ),
    /** The sandbox directory outside the repo, for running from elsewhere. */
    outside: box.cwd,
  };
}

/** Three files that pass, for the tests that are about something else. */
const THREE_PASSING = {
  'test/a.test.js': {},
  'test/b.test.js': {},
  'test/c.test.js': {},
};

// Each test owns a throwaway repo, so they can all run at the same time.
describe('mutation-suite', { concurrency: true }, () => {
  test('stryker runs this script rather than the whole suite', async () => {
    // Otherwise the script exists and nothing uses it, and every mutant still
    // pays for a full run of every test file.
    const config = (await import(pathToFileURL(path.join(repoRoot, 'stryker.config.mjs')).href)).default;

    assert.match(config.commandRunner?.command ?? '', /mutation-suite/);
  });

  test('stryker never mutates the runner it runs the suite with', async () => {
    // A mutated runner decides its own verdict: it supplies the failing exit
    // that means "killed", so the numbers say nothing about the tests. The
    // targets are globs, and `scripts/**/*.js` covers this file, so the config
    // is where that is taken back — `scripts/mutate.js` cannot filter a glob a
    // person typed.
    const config = (await import(pathToFileURL(path.join(repoRoot, 'stryker.config.mjs')).href)).default;

    const excluded = (config.mutate ?? []).filter((pattern) => /mutation-suite/.test(pattern));
    assert.deepEqual(excluded, ['!scripts/mutation-suite.js'], `got: ${JSON.stringify(config.mutate)}`);
  });

  test('only the repo\'s own test/*.test.js files are run', async (t) => {
    // The same files `npm test` runs: not the system tests, which need Orca on
    // a real desktop, and not a helper that happens to sit next to them.
    const fixture = await createRepo(t, {
      'test/a.test.js': {},
      'test/helpers/support.js': {},
      'test/system/live.test.js': {},
      'test/deeper/b.test.js': {},
    });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.deepEqual(startedIn(await fixture.marks()), ['test/a.test.js']);
  });

  test('it works on the repo the script lives in, whatever the working directory', async (t) => {
    // Stryker copies the repo into a sandbox and runs the copy from elsewhere.
    const fixture = await createRepo(t, THREE_PASSING);

    const result = await fixture.run({ cwd: fixture.outside });

    assert.equal(result.code, 0);
    assert.deepEqual(startedIn(await fixture.marks()).sort(), Object.keys(THREE_PASSING));
  });

  test('with no mutant live every file runs, several at a time, and the run passes', async (t) => {
    // The dry run and a person running it by hand: the whole suite, as fast as
    // the machine can take it.
    // Each file is held open well past the time a process takes to start, so a
    // machine that starts them raggedly still has them overlapping.
    const fixture = await createRepo(t, {
      'test/a.test.js': { delay: 1000 },
      'test/b.test.js': { delay: 1000 },
      'test/c.test.js': { delay: 1000 },
      'test/d.test.js': { delay: 1000 },
    });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    const marks = await fixture.marks();
    assert.deepEqual(startedIn(marks).sort(), ['test/a.test.js', 'test/b.test.js', 'test/c.test.js', 'test/d.test.js']);
    assert.ok(!oneAtATime(marks), `the files were run one after another:\n${JSON.stringify(marks)}`);
  });

  test('with no mutant live a failing file does not stop the others, and the run fails', async (t) => {
    const fixture = await createRepo(t, {
      'test/a.test.js': {},
      'test/b.test.js': { fail: true },
      'test/c.test.js': {},
    });

    const result = await fixture.run();

    assert.notEqual(result.code, 0);
    assert.deepEqual(startedIn(await fixture.marks()).sort(), ['test/a.test.js', 'test/b.test.js', 'test/c.test.js']);
    // Whoever reads a failing mutation run has to be able to find the file.
    assert.match(result.stdout + result.stderr, /test\/b\.test\.js/);
  });

  test('a live mutant stops at the first file that fails', async (t) => {
    // The mutant is dead as soon as one file fails; running the rest is time
    // spent on an answer that is already known.
    const fixture = await createRepo(t, {
      'test/a.test.js': {},
      'test/b.test.js': { fail: true },
      'test/c.test.js': {},
    });
    await fixture.writeCache({ ms: { 'test/b.test.js': 1, 'test/a.test.js': 2, 'test/c.test.js': 3 } });

    const result = await fixture.run({ mutant: true });

    assert.notEqual(result.code, 0);
    assert.deepEqual(startedIn(await fixture.marks()), ['test/b.test.js']);
    assert.match(result.stdout + result.stderr, /test\/b\.test\.js/);
  });

  test('a live mutant runs the files one at a time', async (t) => {
    // Files run in parallel are all paid for, even the ones started after the
    // one that already killed the mutant.
    const fixture = await createRepo(t, {
      'test/a.test.js': { delay: 150 },
      'test/b.test.js': { delay: 150 },
      'test/c.test.js': { delay: 150 },
    });

    const result = await fixture.run({ mutant: true });

    assert.equal(result.code, 0);
    const marks = await fixture.marks();
    assert.deepEqual(startedIn(marks).sort(), ['test/a.test.js', 'test/b.test.js', 'test/c.test.js']);
    assert.ok(oneAtATime(marks), `two files were running at once:\n${JSON.stringify(marks)}`);
  });

  test('the quickest file the cache knows of is tried first', async (t) => {
    // Cheapest chance of killing the mutant first.
    const fixture = await createRepo(t, THREE_PASSING);
    await fixture.writeCache({ ms: { 'test/c.test.js': 1, 'test/a.test.js': 2, 'test/b.test.js': 3 } });

    await fixture.run({ mutant: true });

    assert.deepEqual(startedIn(await fixture.marks()), ['test/c.test.js', 'test/a.test.js', 'test/b.test.js']);
  });

  test('the file that killed the last mutant is tried first, ahead of the quickest', async (t) => {
    // Mutants come in runs from the same file, so the last killer is the best
    // guess there is — worth more than a few milliseconds saved.
    const fixture = await createRepo(t, THREE_PASSING);
    await fixture.writeCache({
      order: ['test/b.test.js'],
      ms: { 'test/a.test.js': 5, 'test/b.test.js': 9, 'test/c.test.js': 2 },
    });

    await fixture.run({ mutant: true });

    assert.deepEqual(startedIn(await fixture.marks()), ['test/b.test.js', 'test/c.test.js', 'test/a.test.js']);
  });

  test('after a killed mutant the cache names the killer as the file to try first', async (t) => {
    const fixture = await createRepo(t, {
      'test/a.test.js': {},
      'test/b.test.js': { fail: true },
    });
    await fixture.writeCache({ ms: { 'test/a.test.js': 1, 'test/b.test.js': 2 } });

    const result = await fixture.run({ mutant: true });

    assert.notEqual(result.code, 0);
    const cache = await fixture.readCache();
    assert.equal(cache.order?.[0], 'test/b.test.js', `the killer should be first next time, got: ${JSON.stringify(cache.order)}`);
  });

  test('a run with no mutant live records how long each file took', async (t) => {
    // What the next run orders by; nobody times the files but this run. Each
    // number is that one file's own time: not a constant, not the whole run's,
    // and not another file's. The slow file is held open long enough that no
    // amount of load on the machine can blur the two apart.
    const held = 2500;
    const fixture = await createRepo(t, {
      'test/quick.test.js': {},
      'test/slow.test.js': { delay: held },
    });

    await fixture.run();

    const { ms } = await fixture.readCache();
    assert.deepEqual(Object.keys(ms ?? {}).sort(), ['test/quick.test.js', 'test/slow.test.js']);
    const shown = JSON.stringify(ms);
    assert.ok(ms['test/slow.test.js'] >= held, `the slow file waited ${held}ms, and was not timed that way: ${shown}`);
    assert.ok(ms['test/quick.test.js'] < held, `the quick file was not timed on its own: ${shown}`);
  });

  test('a test file that hangs is never cut off: the run is still waiting', async (t) => {
    // A cutoff here would hand StrykerJS the same failing exit a failing test
    // gives it, and a mutant that merely made the code slow would be recorded
    // as Killed. StrykerJS has a timeout of its own and reports it as Timeout —
    // its own outcome, and the honest one, because a run that never finished
    // says nothing about whether the mutant died. So this script waits.
    //
    // `OBK_MUTATION_TIMEOUT_MS` is set to a fraction of a second to prove it is
    // not read: a script that still honoured it would be back almost at once.
    const fixture = await createRepo(t, { 'test/hangs.test.js': { delay: 30000 } });

    const run = fixture.run({ mutant: true, timeoutMs: 300 });
    const stillWaiting = Symbol('still waiting');
    // Whichever comes first: the file gets going, or the run gives up on it.
    // Racing the two keeps a cut-off file from looking like a file that was
    // simply slow to start.
    const pid = await Promise.race([waitForStart(fixture, 'test/hangs.test.js'), run.then(() => undefined)]);
    assert.ok(pid, 'the run came back before the file that hangs had even started');

    const outcome = await Promise.race([run, sleep(2000).then(() => stillWaiting)]);

    assert.equal(outcome, stillWaiting, 'the run came back instead of waiting for the file that hangs');
    // Nothing is left behind: end the file this test started, and let the run
    // notice and finish, so the test owns no process by the time it is over.
    killOne(pid);
    await run;
  });

  test('with no cache file named, the run still works', async (t) => {
    const fixture = await createRepo(t, THREE_PASSING);

    const result = await fixture.run({ mutant: true, cache: false });

    assert.equal(result.code, 0);
    assert.deepEqual(startedIn(await fixture.marks()).sort(), Object.keys(THREE_PASSING));
  });

  test('nonsense in the cache file is ignored rather than fatal', async (t) => {
    // Several runs share the file at once, so a half-written one is normal.
    const fixture = await createRepo(t, THREE_PASSING);

    await fixture.writeCache('{"order": ["test/a.tes');
    const garbage = await fixture.run({ mutant: true });

    await fixture.writeCache([1, 2, 3]);
    const wrongShape = await fixture.run({ mutant: true });

    assert.equal(garbage.code, 0, `a half-written cache file broke the run: ${garbage.stderr}`);
    assert.equal(wrongShape.code, 0, `a cache file of the wrong shape broke the run: ${wrongShape.stderr}`);
    assert.equal(startedIn(await fixture.marks()).length, 2 * Object.keys(THREE_PASSING).length);
  });

  test('a cache file that cannot be read or written does not stop the run', async (t) => {
    const fixture = await createRepo(t, THREE_PASSING);
    // A directory in its place: every read and every write of it fails.
    await mkdir(fixture.cache);

    const result = await fixture.run({ mutant: true });

    assert.equal(result.code, 0, `an unusable cache file broke the run: ${result.stderr}`);
    assert.deepEqual(startedIn(await fixture.marks()).sort(), Object.keys(THREE_PASSING));
  });

  test('runs sharing one cache file at the same time all succeed', async (t) => {
    // Stryker runs mutants in parallel, so this is the normal case, not an edge.
    const fixture = await createRepo(t, { 'test/a.test.js': {}, 'test/b.test.js': {} });

    const results = await Promise.all([
      fixture.run({ mutant: true }),
      fixture.run({ mutant: true }),
      fixture.run({ mutant: true }),
    ]);

    assert.deepEqual(results.map((result) => result.code), [0, 0, 0], results.map((result) => result.stderr).join(''));
  });
});
