// The night gate as a system test meets it (#689): every system test that
// takes its `test` from test/helpers/system.js runs its body only in a run of
// the runner (OBK_SYSTEM_TESTS=1) that names its file (OBK_SYSTEM_NAMED),
// between midnight and 6 am local time. It is checked at the moment each test
// starts, not when it is registered. By day it is reported as skipped, with
// gateClosed's reason. A system test that does not touch Orca takes its `test`
// from test/helpers/system-no-orca.js instead: it runs at any hour, named or
// not, and the kit's Orca CLI (OBK_ORCA) names NO_ORCA, a path that does not
// exist.
//
// Run end to end, in a throwaway repo: copies of the real helpers, a fixture
// system test file beside them, and `node --test` on it, as the runner starts
// it. The clock is a preload of this test's own, written into the throwaway
// folder and loaded through NODE_OPTIONS: it replaces Date with a subclass
// that stands at a fixed local time, which a fixture can move. Nothing here
// talks to Orca: OBK_ORCA names a path in the throwaway folder that does not
// exist, and no fixture calls it.

import assert from 'node:assert/strict';
import { accessSync, constants, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { node, repoRoot } from './helpers/cli.js';

/** What a system test loaded without the runner tells the developer to run instead. */
const HOW_TO_RUN = 'npm run test:system -- --yes';

/**
 * A reporter that prints one JSON line per test: pass or fail, its name, and
 * its skip reason as the runner was given it (null when it was not skipped).
 */
const REPORTER = [
  'export default async function* report(source) {',
  '  for await (const event of source) {',
  "    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;",
  '    const { name, skip = null } = event.data;',
  "    yield JSON.stringify({ type: event.type, name, skip }) + '\\n';",
  '  }',
  '}',
  '',
].join('\n');

/**
 * The clock preload: Date stands at 2026-10-22 at `[hours, minutes, seconds]`
 * local time. `globalThis.fakeClock(hours, minutes, seconds)` moves it, for a
 * fixture that has to pass a time while it runs. `new Date(...)` with
 * arguments is the real one.
 */
const clockAt = ([hours, minutes, seconds = 0]) => [
  'const Real = globalThis.Date;',
  'let now = new Real(2026, 9, 22, ' + `${hours}, ${minutes}, ${seconds}` + ').getTime();',
  'class FixedDate extends Real {',
  '  constructor(...args) {',
  '    if (args.length === 0) super(now);',
  '    else super(...args);',
  '  }',
  '  static now() { return now; }',
  '}',
  'globalThis.Date = FixedDate;',
  'globalThis.fakeClock = (h, m, s = 0) => { now = new Real(2026, 9, 22, h, m, s).getTime(); };',
  '',
].join('\n');

/**
 * A throwaway repo with copies of the real helpers named in `helpers` (from
 * test/helpers/) and a package.json that makes its .js files ES modules.
 * Answers where things are, a way to write a fixture file, and `run`.
 */
async function throwawayRepo(t, helpers) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-helper-gate-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  await mkdir(path.join(repo, 'test', 'helpers'), { recursive: true });
  await mkdir(path.join(repo, 'test', 'system'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), '{"name": "fixture", "type": "module"}\n');
  for (const name of helpers) {
    await copyFile(path.join(repoRoot, 'test', 'helpers', name), path.join(repo, 'test', 'helpers', name));
  }
  const reporter = path.join(root, 'reporter.mjs');
  await writeFile(reporter, REPORTER);
  const ranLog = path.join(root, 'ran.log');
  const clock = path.join(root, 'clock.mjs');
  // Where OBK_ORCA points before any helper changes it: in the throwaway folder, and not there.
  const noOrcaHere = path.join(root, 'no-orca-here', 'orca');

  // NODE_TEST_CONTEXT is set in every process this suite's runner starts, and
  // a `node --test` that inherits it runs nothing. The gate's variables are
  // each run's to set, whatever this shell had.
  const {
    NODE_TEST_CONTEXT: _context,
    OBK_SYSTEM_TESTS: _gate,
    OBK_SYSTEM_NAMED: _named,
    OBK_ORCA: _orca,
    ...bare
  } = process.env;

  return {
    root,
    repo,
    ranLog,
    noOrcaHere,
    /** Write a fixture file at `rel` in the repo. Answers its absolute path. */
    async write(rel, text) {
      const file = path.join(repo, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
      return file;
    },
    /**
     * `node --test <file>` from the repo, with the clock at `at` (local
     * [h, m, s]), OBK_SYSTEM_TESTS as `gate` (left out when undefined) and
     * OBK_SYSTEM_NAMED as `named` (left out when undefined). `gate` is '1'
     * when the options do not name it at all, as the runner sets it.
     */
    async run(file, options) {
      const { at, named } = options;
      const gate = Object.hasOwn(options, 'gate') ? options.gate : '1';
      await writeFile(clock, clockAt(at));
      const env = {
        ...bare,
        OBK_ORCA: noOrcaHere,
        NODE_OPTIONS: [bare.NODE_OPTIONS, `--import=${pathToFileURL(clock).href}`].filter(Boolean).join(' '),
        ...(gate === undefined ? {} : { OBK_SYSTEM_TESTS: gate }),
        ...(named === undefined ? {} : { OBK_SYSTEM_NAMED: named }),
      };
      const result = await node([`--test-reporter=${reporter}`, '--test', file], { cwd: repo, env });
      return { ...result, tests: reported(result) };
    },
    /** What the fixture bodies wrote, one line each time a body ran: empty when none did. */
    async ran() {
      try {
        return (await readFile(ranLog, 'utf8')).split('\n').filter((line) => line !== '');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
    /** Forget what the bodies wrote so far. */
    clear: () => rm(ranLog, { force: true }),
  };
}

/** What the JSON reporter said, one entry per test, from a run's stdout. */
const reported = (result) => result.stdout
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line));

const everything = (result) => `${result.stdout}${result.stderr}`;

/**
 * A system test file written the way the real ones are, its `test` from the
 * helper at `helper` (relative to the file), with one test per name. Each body
 * writes its name in `ranLog`, and then runs `after` (JavaScript), when given.
 * `top` is JavaScript run at the top of the file after every test is registered.
 */
const systemFile = ({ helper = '../helpers/system.js', ranLog, names, after = {}, top = '' }) => [
  "import { appendFileSync } from 'node:fs';",
  '',
  `import test from ${JSON.stringify(helper)};`,
  '',
  ...names.flatMap((name) => [
    `test(${JSON.stringify(name)}, () => {`,
    `  appendFileSync(${JSON.stringify(ranLog)}, ${JSON.stringify(`${name}\n`)});`,
    ...(after[name] ? [`  ${after[name]}`] : []),
    '});',
  ]),
  top,
  '',
].join('\n');

/** One test was reported, as a skip (a pass with a reason), and the reason is answered. */
function skipReasonOf(result, name, what) {
  assert.equal(result.code, 0, `${what}: a skip is not a failure, got:\n${everything(result)}`);
  assert.deepEqual(result.tests.map((one) => one.name), [name], `${what}: one test, ${name}, got:\n${everything(result)}`);
  const [only] = result.tests;
  assert.equal(only.type, 'test:pass', `${what}: a skip is not a failure, got: ${JSON.stringify(only)}`);
  assert.equal(typeof only.skip, 'string', `${what}: it should be skipped with a reason, got: ${JSON.stringify(only)}\n${everything(result)}`);
  return only.skip;
}

/** One test was reported, it ran (not skipped) and passed. */
function assertRan(result, name, what) {
  assert.equal(result.code, 0, `${what}: ${everything(result)}`);
  assert.deepEqual(result.tests, [{ type: 'test:pass', name, skip: null }], `${what}: it should run and pass, not skip, got:\n${everything(result)}`);
}

// ------------------------------------------------------------- system.js

test('a system test on system.js, started by the runner by day, is skipped with the gate\'s reason and its body never runs; the same file at night and named runs', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/nested/day.test.js', systemFile({ helper: '../../helpers/system.js', ranLog: repo.ranLog, names: ['DAY'] }));

  const byDay = await repo.run(file, { at: [14, 5], named: file });

  const reason = skipReasonOf(byDay, 'DAY', 'named, at 14:05');
  assert.deepEqual(await repo.ran(), [], `by day the body should never run, got the reason: ${reason}`);
  assert.ok(reason.includes('14:05'), `the reason should name the time, 14:05, got: ${reason}`);
  assert.ok(
    reason.includes('npm run test:system -- --yes test/system/nested/day.test.js'),
    `the reason should give the command that runs the file, by its path from the repo root, got: ${reason}`,
  );
  assert.match(reason, /Orca/, `the reason should say what it did not do in Orca, got: ${reason}`);

  const atNight = await repo.run(file, { at: [3, 0], named: file });

  assertRan(atNight, 'DAY', 'named, at 03:00');
  assert.deepEqual(await repo.ran(), ['DAY'], 'at night and named, the body should run once');
});

test('night is 00:00 to 05:59 at the test\'s start: a named file runs at 00:00 and 05:59:59, and is skipped at 06:00 and 23:59', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/edge.test.js', systemFile({ ranLog: repo.ranLog, names: ['EDGE'] }));

  for (const at of [[0, 0, 0], [5, 59, 59]]) {
    await repo.clear();
    const result = await repo.run(file, { at, named: file });
    assertRan(result, 'EDGE', `named, at ${at.join(':')}`);
    assert.deepEqual(await repo.ran(), ['EDGE'], `named, at ${at.join(':')}: the body should run`);
  }
  for (const at of [[6, 0, 0], [23, 59, 0]]) {
    await repo.clear();
    const result = await repo.run(file, { at, named: file });
    skipReasonOf(result, 'EDGE', `named, at ${at.join(':')}`);
    assert.deepEqual(await repo.ran(), [], `named, at ${at.join(':')}: the body should never run`);
  }
});

test('at night a system test the run does not name is skipped with a reason: a run of them all, another file named, OBK_SYSTEM_NAMED not set', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/alpha.test.js', systemFile({ ranLog: repo.ranLog, names: ['ALPHA'] }));
  const other = await repo.write('test/system/beta.test.js', systemFile({ ranLog: repo.ranLog, names: ['BETA'] }));

  for (const named of ['', other, undefined]) {
    const result = await repo.run(file, { at: [3, 7], named });
    const reason = skipReasonOf(result, 'ALPHA', `OBK_SYSTEM_NAMED=${JSON.stringify(named)} at 03:07`);
    assert.ok(reason.includes('03:07'), `the reason should name the time, 03:07, got: ${reason}`);
    assert.ok(reason.includes('npm run test:system -- --yes test/system/alpha.test.js'), `the reason should give the command, got: ${reason}`);
  }
  assert.deepEqual(await repo.ran(), [], 'not named, the body should never run');
});

test('each test is checked at its own start: in a file whose first test runs at 05:59:58 and moves the clock to 06:00, the second is skipped', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/two.test.js', systemFile({
    ranLog: repo.ranLog,
    names: ['FIRST', 'SECOND'],
    after: { FIRST: 'globalThis.fakeClock(6, 0, 0);' },
  }));

  const result = await repo.run(file, { at: [5, 59, 58], named: file });

  assert.equal(result.code, 0, everything(result));
  assert.deepEqual(result.tests.map(({ type, name }) => ({ type, name })), [{ type: 'test:pass', name: 'FIRST' }, { type: 'test:pass', name: 'SECOND' }], everything(result));
  assert.equal(result.tests[0].skip, null, `FIRST started at 05:59:58 and should run, got: ${JSON.stringify(result.tests[0])}`);
  assert.equal(typeof result.tests[1].skip, 'string', `SECOND started at 06:00 and should be skipped, got: ${JSON.stringify(result.tests[1])}`);
  assert.ok(result.tests[1].skip.includes('06:00'), `SECOND's reason should name 06:00, got: ${result.tests[1].skip}`);
  assert.deepEqual(await repo.ran(), ['FIRST'], 'only the first body should have run');
});

test('the gate is read when the test starts, not when it is registered: a test registered at 14:00 that starts at 03:00 runs', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/late.test.js', systemFile({
    ranLog: repo.ranLog,
    names: ['LATE'],
    top: 'globalThis.fakeClock(3, 0, 0);',
  }));

  const result = await repo.run(file, { at: [14, 0], named: file });

  assertRan(result, 'LATE', 'registered at 14:00, started at 03:00, named');
  assert.deepEqual(await repo.ran(), ['LATE']);
});

test('a system test on system.js not started by the runner is skipped with today\'s reason, at night and named too, and its body never runs', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js']);
  const file = await repo.write('test/system/alpha.test.js', systemFile({ ranLog: repo.ranLog, names: ['ALPHA'] }));

  for (const gate of [undefined, '0', '']) {
    const result = await repo.run(file, { at: [3, 0], named: file, gate });
    const reason = skipReasonOf(result, 'ALPHA', `OBK_SYSTEM_TESTS=${JSON.stringify(gate)}, at 03:00, named`);
    assert.ok(reason.includes(HOW_TO_RUN), `the reason should name \`${HOW_TO_RUN}\`, got: ${reason}`);
    assert.ok(!reason.includes('03:00'), `not started by the runner, the reason is today's, not the night gate's, got: ${reason}`);
  }
  assert.deepEqual(await repo.ran(), [], 'the body should never have run');
});

// ------------------------------------------------------------- system-no-orca.js

test('a system test on system-no-orca.js, started by the runner, runs at any hour, named or not, and in it OBK_ORCA is NO_ORCA', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js', 'system-no-orca.js']);
  const file = await repo.write('test/system/no-orca.test.js', [
    "import { appendFileSync } from 'node:fs';",
    '',
    "import test, { NO_ORCA } from '../helpers/system-no-orca.js';",
    '',
    "test('NOORCA', () => {",
    `  appendFileSync(${JSON.stringify(repo.ranLog)}, JSON.stringify({ orca: process.env.OBK_ORCA ?? null, NO_ORCA: NO_ORCA ?? null }) + '\\n');`,
    '});',
    '',
  ].join('\n'));

  const cases = [['by day, not named', { at: [14, 5], named: '' }], ['by day, named', { at: [9, 30], named: file }], ['at night, not named', { at: [3, 0] }]];
  for (const [what, options] of cases) {
    const result = await repo.run(file, options);
    assertRan(result, 'NOORCA', what);
  }

  const seen = (await repo.ran()).map((line) => JSON.parse(line));
  assert.equal(seen.length, cases.length, 'the body should have run once in each run');
  const [{ NO_ORCA }] = seen;
  assert.equal(typeof NO_ORCA, 'string', `NO_ORCA should be exported as a path, got ${JSON.stringify(NO_ORCA)}`);
  for (const one of seen) {
    assert.equal(one.orca, NO_ORCA, `inside the test, OBK_ORCA should be NO_ORCA (${NO_ORCA}), not ${JSON.stringify(one.orca)}`);
  }
  assert.notEqual(NO_ORCA, repo.noOrcaHere, 'the helper should set OBK_ORCA itself, not keep what the run was started with');
  assert.ok(path.isAbsolute(NO_ORCA), `NO_ORCA should be an absolute path, got ${NO_ORCA}`);
  assert.equal(existsSync(NO_ORCA), false, `NO_ORCA should not exist, got ${NO_ORCA}`);
  // It cannot be made by a normal user: the nearest folder above it that exists
  // is not one this user may write in. Asked, never tried.
  let above = path.dirname(NO_ORCA);
  while (!existsSync(above)) above = path.dirname(above);
  assert.throws(() => accessSync(above, constants.W_OK), `NO_ORCA should not be makeable by this user, but ${above}, the nearest folder above it, is writable`);
});

test('a system test on system-no-orca.js not started by the runner is skipped with the same reason as one on system.js, and its body never runs', async (t) => {
  const repo = await throwawayRepo(t, ['night-gate.js', 'system.js', 'system-no-orca.js']);
  const noOrca = await repo.write('test/system/no-orca.test.js', systemFile({ helper: '../helpers/system-no-orca.js', ranLog: repo.ranLog, names: ['NOORCA'] }));
  const onSystem = await repo.write('test/system/alpha.test.js', systemFile({ ranLog: repo.ranLog, names: ['ALPHA'] }));

  const itsReason = skipReasonOf(await repo.run(noOrca, { at: [14, 5], named: '', gate: undefined }), 'NOORCA', 'system-no-orca.js without OBK_SYSTEM_TESTS');
  const systemReason = skipReasonOf(await repo.run(onSystem, { at: [14, 5], named: '', gate: undefined }), 'ALPHA', 'system.js without OBK_SYSTEM_TESTS');

  assert.ok(itsReason.includes(HOW_TO_RUN), `the reason should name \`${HOW_TO_RUN}\`, got: ${itsReason}`);
  assert.equal(itsReason, systemReason, 'the two helpers should give the same reason when the runner did not start the test');
  assert.deepEqual(await repo.ran(), [], 'neither body should have run');
});
