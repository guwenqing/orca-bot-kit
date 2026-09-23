// `scripts/test-system.js` runs the system tests: the ones that drive the real
// `obk` against the real Orca, which no CI machine can do.
//
// Every test gets its own throwaway repo — a copy of the script under
// `scripts/`, a `test/system/` of its own — and a fake Orca that `OBK_ORCA`
// points at, so every answer the preflight can get is played back without Orca
// running anywhere. Each fixture test file prints a marker, which is how a test
// here can tell which files the run picked up.
//
// Driving this machine takes a deliberate step, so a fixture has two ways to
// run: `run` is the command on its own, which drives nothing, and `confirmed`
// is the same command with the confirmation flag. A test about what the system
// tests do uses `confirmed`; a test about who may start them uses both.
//
// A real run mints an orchestration Run per session it brings up, and Orca
// offers no way to delete one, so the pile grows. The fake Orca therefore
// answers `orchestration run-list` as well as `status`, out of a world file the
// fixture's own system test files write to while they run: that is how a test
// here makes a Run appear mid-run without anything real being brought up.

import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { createSandbox, node, orcaCallsOf, repoRoot } from './helpers/cli.js';

const scriptEntry = path.join(repoRoot, 'scripts', 'test-system.js');

/** The one deliberate step that lets the system tests drive this machine. */
const CONFIRM = '--yes';

/** The Orca CLI to fall back on when OBK_ORCA says nothing (tech notes, section 1). */
const BUILT_IN_ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca';

/** What `orca status --json` prints, as the fake Orca's stdout. */
const status = (value) => ({ stdout: `${JSON.stringify(value)}\n` });

/** Orca up and reachable: the only answer that lets the system tests run. */
const READY = status({ ok: true, result: { runtime: { reachable: true } } });

/** The environment variable naming the fake Orca's world, for a fixture test file to write. */
const WORLD = 'OBK_FIXTURE_RUNS';

/**
 * How many Runs the listing hands back when the caller asked for no number.
 * Nobody has measured Orca's own default, and a cursor API always has one, so
 * the fake picks a small page: a kit that wants every Run on a machine has to
 * say how many it wants rather than hope the default is generous.
 */
const PAGE = 20;

/** The largest `--limit` Orca takes; above it the CLI refuses the call outright. */
const LIMIT_CAP = 100;

/** A count that outlives any one test: the listing behaves that way every time. */
const ALWAYS = 1e6;

/**
 * A fake Orca that answers two commands. `status` answers whatever the test
 * asked for, as before. `orchestration run-list --json` answers out of a world
 * file — `{ runs, runListFails, runListGarbles, runListEnvelope, appearsDuring }`
 * — which is read on every call,
 * so a Run written into it while the system tests are running is a Run that
 * appeared during the run.
 *
 * The listing is faithful where being faithful costs nothing: the answer is the
 * envelope every Orca call uses, `{ id, ok, result: { runs, nextCursor },
 * _meta }`, with Runs newest first; a `--limit` over 100 is refused the way the
 * real CLI refuses it; and a call that named no limit gets one page and is told
 * there is more. `runListEnvelope` spoils the envelope instead: `notOk` is an
 * answer that failed while still exiting 0, `notOkWithRuns` one that says it
 * failed while still carrying a list, and `noOk` one the kit has no way to read
 * as an answer at all.
 *
 * `appearsDuring` lands its Runs once the first listing has been answered, so
 * they are on the machine for the second and no test file made them: somebody
 * else's `obk up`, on a machine the tests do not have to themselves.
 */
async function fakeOrca(box, { stdout = '', stderr = '', exitCode = 0 }, world) {
  const log = path.join(box.root, 'orca.log');
  const file = path.join(box.root, 'bin', 'orca');
  await writeFile(file, [
    '#!/usr/bin/env node',
    "const { appendFileSync, readFileSync, writeFileSync, writeSync } = require('node:fs');",
    `const WORLD = ${JSON.stringify(world)};`,
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), env: process.env }) + '\\n');`,
    'const words = [];',
    "for (const arg of args) { if (arg.startsWith('-')) break; words.push(arg); }",
    "if (words.join(' ') === 'orchestration run-list') {",
    "  const state = JSON.parse(readFileSync(WORLD, 'utf8'));",
    '  const spend = (name) => { state[name] -= 1; writeFileSync(WORLD, JSON.stringify(state)); };',
    '  if (state.runListFails > 0) {',
    "    spend('runListFails');",
    "    writeSync(2, 'runtime_unavailable: Could not connect to the running Orca app\\n');",
    '    process.exit(1);',
    '  }',
    '  if (state.runListGarbles > 0) {',
    "    spend('runListGarbles');",
    "    writeSync(1, 'orca: this CLI cannot run for this user\\n');",
    '    process.exit(0);',
    '  }',
    "  const at = args.indexOf('--limit');",
    '  const asked = at >= 0 ? Number(args[at + 1]) : null;',
    `  if (asked !== null && !(asked >= 1 && asked <= ${LIMIT_CAP})) {`,
    `    writeSync(2, 'invalid_argument: Too big: expected number to be <=${LIMIT_CAP}\\n');`,
    '    process.exit(1);',
    '  }',
    '  const newest = state.runs.slice().reverse();',
    `  const page = newest.slice(0, asked === null ? ${PAGE} : asked);`,
    '  const nextCursor = page.length < newest.length ? String(page.length) : null;',
    "  const answer = { id: 'orc_fixture', ok: true, result: { runs: page, nextCursor }, _meta: {} };",
    "  if (state.runListEnvelope.startsWith('notOk')) {",
    '    answer.ok = false;',
    "    answer.error = { code: 'runtime_unavailable', message: 'Could not connect to the running Orca app' };",
    "    if (state.runListEnvelope === 'notOk') delete answer.result;",
    '  }',
    "  if (state.runListEnvelope === 'noOk') delete answer.ok;",
    '  if (state.appearsDuring.length > 0) {',
    '    state.runs = state.runs.concat(state.appearsDuring);',
    '    state.appearsDuring = [];',
    '    writeFileSync(WORLD, JSON.stringify(state));',
    '  }',
    "  writeSync(1, JSON.stringify(answer) + '\\n');",
    '  process.exit(0);',
    '}',
    `writeSync(1, ${JSON.stringify(stdout)});`,
    `writeSync(2, ${JSON.stringify(stderr)});`,
    `process.exit(${exitCode});`,
    '',
  ].join('\n'));
  await chmod(file, 0o755);

  return {
    async calls() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

/**
 * What a report says when its count of Runs is a floor rather than a total.
 * One list, used both ways: the report that must hedge says one of these, and
 * the report that must not says none of them, so a runner cannot pass the
 * second with a hedge the first would have counted.
 */
const HEDGE = /at least|incomplete|not all|may be more|might be more|could not reach/i;

/** A Run as `orchestration run-list` hands it over, named so a test can spot it. */
const runNamed = (name, at) => ({
  id: `run_${name}`,
  objective: `obk fixture-bot/${name}`,
  created_at: `2026-09-21T${at}:00Z`,
});

/** Runs that were on the machine before this run was ever started. */
const ALREADY_THERE = [runNamed('oldest', '08:00'), runNamed('older', '09:00')];

/** Runs a run brings into being by bringing sessions up. */
const MINTED = [runNamed('freshone', '11:00'), runNamed('freshtwo', '11:01')];

/** A system test file that passes and says so. */
const marker = (name) => [
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  '});',
  '',
].join('\n');

/**
 * A system test file that mints Runs, the way a real one does by bringing
 * sessions up: it writes them into the fake Orca's world, so the listing after
 * the run answers with them and the listing before it did not. `thenFails`
 * makes the test fail afterwards, which is a run that both left Runs behind and
 * has bad news of its own.
 */
const mintsRuns = (name, runs, { thenFails = false } = {}) => [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  const file = process.env[${JSON.stringify(WORLD)}];`,
  "  const world = JSON.parse(readFileSync(file, 'utf8'));",
  `  world.runs.push(...${JSON.stringify(runs)});`,
  '  writeFileSync(file, JSON.stringify(world));',
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  ...(thenFails ? [`  throw new Error(${JSON.stringify(`${name} failed`)});`] : []),
  '});',
  '',
].join('\n');

/**
 * The files every fixture repo starts with: one system test, one file next to
 * it that is not a test, and one test outside `test/system/`. The last two
 * catch a run that reaches wider than the system tests.
 */
const DEFAULT_FILES = {
  'test/system/alpha.test.js': marker('ALPHA'),
  'test/system/helper.js': "process.stdout.write('HELPER\\n');\n",
  'test/other.test.js': marker('OTHER'),
};

async function write(dir, rel, text) {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** The arguments of each call to a fake program, when the rest of the call does not matter. */
const argsOf = (calls) => calls.map((call) => call.args);

/**
 * A fresh repo holding a copy of the script, and a fake Orca for `OBK_ORCA` to
 * name. The fake is not found through PATH: the script resolves the CLI itself.
 */
async function createRepo(t, {
  orca: orcaOptions = READY,
  files = DEFAULT_FILES,
  runs = [],
  runListFails = 0,
  runListGarbles = 0,
  runListEnvelope = 'ok',
  appearsDuring = [],
} = {}) {
  const box = await createSandbox(t);
  const world = path.join(box.root, 'orca-runs.json');
  await writeFile(world, JSON.stringify({
    runs, runListFails, runListGarbles, runListEnvelope, appearsDuring,
  }));
  const orca = await fakeOrca(box, orcaOptions, world);
  const orcaPath = path.join(box.root, 'bin', 'orca');

  const repo = path.join(box.root, 'repo');
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await copyFile(scriptEntry, path.join(repo, 'scripts', 'test-system.js'));
  await write(repo, 'package.json', '{"name": "fixture", "type": "module"}\n');
  for (const [rel, text] of Object.entries(files)) await write(repo, rel, text);

  // This machine may have OBK_ORCA set for its own reasons; the fixture decides.
  // NODE_TEST_CONTEXT goes too: it is set in every process the test runner
  // starts, and a `node --test` that inherits it refuses to run any file. A
  // developer's shell does not have it, so neither does the script here.
  const { OBK_ORCA: _override, NODE_TEST_CONTEXT: _context, ...bare } = box.env;

  // The world goes into the environment as well as into the fake, because the
  // fixture's system test files are spawned by the script and read it from there.
  const env = { ...bare, OBK_ORCA: orcaPath, [WORLD]: world };

  const runScript = (args, options) => node(
    [path.join(repo, 'scripts', 'test-system.js'), ...args],
    { cwd: options.cwd ?? repo, env: options.env ?? env },
  );

  return {
    repo,
    orca,
    orcaPath,
    /** The environment the script is run with: the fake Orca as the CLI. */
    env,
    /** The same environment with no override at all, so the built-in path is used. */
    envWithoutOverride: bare,
    /**
     * Run it the way `npm run test:system` on its own does: no confirmation.
     * From the repo (or `options.cwd`, with `options.env`).
     */
    run: (options = {}) => runScript([], options),
    /** Run it the way the developer who means it does: with the confirmation flag. */
    confirmed: (options = {}) => runScript([CONFIRM], options),
    /** The sandbox directory outside the repo, for running from elsewhere. */
    outside: box.cwd,
  };
}

/**
 * What the announcement has to carry before anything is driven: the machine it
 * is about to drive, the Orca CLI it will drive it through, and every system
 * test file it would run, by name. The wording around them is the writer's.
 *
 * Read from stdout alone, because everything the runner says about itself goes
 * there on every path; stderr belongs to the run it starts.
 */
function assertAnnounces(result, fixture, files = [], cli = fixture.orcaPath) {
  const output = result.stdout;
  // As the machine reports itself, spelling and all. Matched as it is written
  // rather than loosely: this one answers `Mac`, and a loose match would take
  // the word `macOS` in a sentence about the machine for the name of it.
  const machine = os.hostname();

  assert.ok(
    output.includes(machine),
    `it should name the machine it will drive (${machine}), got: ${output}`,
  );
  assert.ok(
    output.includes(cli),
    `it should name the Orca CLI it asked (${cli}), got: ${output}`,
  );
  for (const file of files) {
    assert.ok(output.includes(file), `it should name ${file}, got: ${output}`);
  }
}

/**
 * The Orca the run asked is said to come from OBK_ORCA, not from the default.
 * The default's own wording names OBK_ORCA too ("OBK_ORCA names another"), so
 * the word alone tells nothing: what tells them apart is the line naming the
 * Orca asked, which says OBK_ORCA chose it and does not call it the default.
 */
function assertFromObkOrca(result, cli) {
  const told = result.stdout.split('\n').filter((line) => line.includes(cli));
  assert.ok(
    told.some((line) => /OBK_ORCA/.test(line) && !/default/i.test(line)),
    `the line naming ${cli} should say OBK_ORCA chose it, not the default, got: ${result.stdout}`,
  );
}

/** Each way of invoking it, for a fact that has to hold on both. */
const eitherWay = async (fixture) => [await fixture.run(), await fixture.confirmed()];

/**
 * What the runner said for itself once the system tests were over: stdout past
 * the last thing the run printed. A report about what the run left has to be
 * read apart from the announcement, because the announcement already warns that
 * the tests will leave Runs Orca cannot delete — every word of a report would
 * otherwise be matched before a single test had run.
 */
function afterTheRun(result, lastPrinted = 'ALPHA') {
  const at = result.stdout.lastIndexOf(lastPrinted);
  assert.ok(at >= 0, `the run's own output should reach stdout, got: ${result.stdout}`);
  const tail = result.stdout.slice(at + lastPrinted.length);

  // The test runner's own summary comes between the two, and it is full of the
  // words a report would use — `fail 0` alone would answer half of what is
  // asked below. It is the runner counting, not the command speaking for
  // itself, so a report is read from past the end of it. Its last line is the
  // duration, whichever reporter wrote it.
  const counted = tail.lastIndexOf('duration_ms');
  const ends = counted < 0 ? -1 : tail.indexOf('\n', counted);
  return ends < 0 ? tail : tail.slice(ends + 1);
}

/**
 * The report as one line. Every check below is on prose, and the runner hard
 * wraps its prose, so a phrase can be split by a line break that says nothing
 * about what the sentence means: "anything else" is one phrase whether or not
 * "else" begins a new line. Matching the wrapped text makes a check depend on
 * where the writer's lines happened to end.
 */
const unwrapped = (report) => report.replace(/\s+/g, ' ');

/**
 * It told the developer it could not find something out, rather than guessing
 * or dying.
 *
 * Naming no Run is the half that carries the weight. A report that lists Runs
 * is a report that knows which ones are new, and it will say they could not be
 * removed while it does so — words a wording check alone would take for this
 * one. What separates the two is whether anything is named at all.
 */
function assertSaidItCouldNotTell(report, runs = [...ALREADY_THERE, ...MINTED]) {
  for (const run of runs) {
    assert.ok(
      !report.includes(run.id),
      `it should name no Run when it could not find out which were left, got: ${report}`,
    );
  }
  assert.match(unwrapped(report), /run/i, `it should still speak of Runs, got: ${report}`);
  assert.match(
    unwrapped(report),
    /could ?n[o']t|cannot|can't|unable|did not|failed/i,
    `it should say it could not find out what was left, got: ${report}`,
  );
}

/** Orca is not ready: it says so on stdout, exits 0, and no system test ran. */
function assertSkipped(result) {
  assert.equal(result.code, 0);
  assert.match(result.stdout, /orca/i, `the message should name Orca, got: ${result.stdout}`);
  assert.match(result.stdout, /skip/i, `the message should say it skipped, got: ${result.stdout}`);
  assert.doesNotMatch(result.stdout + result.stderr, /ALPHA/);
}

// Each test owns a throwaway repo, so they can all run at the same time.
describe('test-system', { concurrency: true }, () => {
  test('the system tests are wired up as `npm run test:system`', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

    assert.match(pkg.scripts['test:system'] ?? '', /scripts\/test-system\.js/);
  });

  test('the preflight asks the Orca CLI for its status as JSON, once', async (t) => {
    const fixture = await createRepo(t);

    await fixture.confirmed();

    assert.deepEqual(argsOf(orcaCallsOf(await fixture.orca.calls(), 'status')), [['status', '--json']]);
  });

  test('Orca ready: the system tests run and it exits with their exit code', async (t) => {
    const fixture = await createRepo(t);

    const result = await fixture.confirmed();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /ALPHA/);
  });

  test('only the files in test/system/ that are test files are run', async (t) => {
    // A bare `node --test` would go hunting through the whole tree instead.
    const fixture = await createRepo(t);

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA/);
    assert.doesNotMatch(output, /OTHER/);
    assert.doesNotMatch(output, /HELPER/);
  });

  test('every system test file is run, not just the first', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': marker('ALPHA'),
        'test/system/beta.test.js': marker('BETA'),
      },
    });

    const result = await fixture.confirmed();

    assert.match(result.stdout, /ALPHA/);
    assert.match(result.stdout, /BETA/);
  });

  test('a system test in a folder under test/system/ is run, and a file that is not a test is not', async (t) => {
    // A folder under test/system/ is the obvious place to group system tests,
    // and a runner that only reads the top level loses them without a word:
    // `npm test` does not match them either, so both layers report success
    // while nobody runs the file.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': marker('ALPHA'),
        'test/system/nested/forgotten.test.js': marker('FORGOTTEN'),
        'test/system/nested/support.js': "process.stdout.write('NOT-A-TEST\\n');\n",
      },
    });

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA/);
    assert.match(output, /FORGOTTEN/);
    assert.doesNotMatch(output, /NOT-A-TEST/);
  });

  test('a failing system test under test/system/ fails the command from any depth', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/nested/forgotten.test.js': [
          "import test from 'node:test';",
          '',
          "test('forgotten', () => { throw new Error('FORGOTTEN failed'); });",
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1);
  });

  test('a failing system test makes the command fail', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => { throw new Error('ALPHA failed'); });",
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1);
  });

  test('the run\'s output reaches the developer on both streams', async (t) => {
    // Nothing is swallowed: the test runner folds a test file's stderr into its
    // own stdout, so what matters is that both markers come out somewhere.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => {",
          "  process.stdout.write('ALPHA out\\n');",
          "  process.stderr.write('ALPHA err\\n');",
          '});',
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA out/);
    assert.match(output, /ALPHA err/);
  });

  test('it works on the repo the script lives in, whatever the working directory', async (t) => {
    const fixture = await createRepo(t);

    const result = await fixture.confirmed({ cwd: fixture.outside });

    assert.match(result.stdout, /ALPHA/);
  });

  test('the system tests are run in the repo, whatever the working directory', async (t) => {
    // Anywhere else they would resolve the wrong files and the wrong package.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => {",
          "  process.stdout.write(`CWD:${process.cwd()}\\n`);",
          '});',
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed({ cwd: fixture.outside });

    assert.match(result.stdout, new RegExp(`CWD:${fixture.repo}\\n`));
  });

  test('no system test files: it says so, exits 0 and runs no test at all', async (t) => {
    // Nothing to drive is nothing to confirm, so the command on its own is
    // still the right way to ask this one.
    const fixture = await createRepo(t, { files: { 'test/other.test.js': marker('OTHER') } });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /system test/i);
    assert.doesNotMatch(result.stdout + result.stderr, /OTHER/);
  });

  test('an empty test/system folder counts as no system test files', async (t) => {
    const fixture = await createRepo(t, { files: { 'test/other.test.js': marker('OTHER') } });
    await mkdir(path.join(fixture.repo, 'test', 'system'), { recursive: true });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /system test/i);
    assert.doesNotMatch(result.stdout + result.stderr, /OTHER/);
  });

  test('no Orca CLI to run: it skips and says what to do about it', async (t) => {
    const fixture = await createRepo(t);
    const missing = path.join(path.dirname(fixture.orcaPath), 'not-installed');

    const result = await fixture.confirmed({ env: { ...fixture.env, OBK_ORCA: missing } });

    assertSkipped(result);
    // A skip is not a failure, and the reader is told how to turn it into a run.
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /start|open|launch|run/i);
  });

  test('the status command failing is a skip', async (t) => {
    const fixture = await createRepo(t, { orca: { ...READY, exitCode: 1 } });

    assertSkipped(await fixture.confirmed());
  });

  test('status printing something that is not JSON is a skip', async (t) => {
    // `/usr/local/bin/orca` on the owner's Mac exits 0 and prints an error:
    // reading the exit code alone would take that for a running Orca.
    const fixture = await createRepo(t, {
      orca: { stdout: 'orca: this CLI cannot run for this user\n' },
    });

    assertSkipped(await fixture.confirmed());
  });

  test('`ok: false` is a skip', async (t) => {
    const fixture = await createRepo(t, {
      orca: status({ ok: false, result: { runtime: { reachable: true } } }),
    });

    assertSkipped(await fixture.confirmed());
  });

  test('a runtime that is not reachable is a skip', async (t) => {
    const fixture = await createRepo(t, {
      orca: status({ ok: true, result: { runtime: { reachable: false } } }),
    });

    assertSkipped(await fixture.confirmed());
  });

  test('a status that says nothing about a reachable runtime is a skip, not a crash', async (t) => {
    // Orca is entitled to answer in any of these shapes; only the one shape
    // that says a runtime is reachable may start a run.
    for (const value of [null, { ok: true }, { ok: true, result: {} }, { ok: true, result: { runtime: {} } }]) {
      const fixture = await createRepo(t, { orca: status(value) });

      assertSkipped(await fixture.confirmed());
    }
  });

  test('with no OBK_ORCA it asks the Orca in /Applications, and an empty one is the same', async (t) => {
    // No sandbox can stand in for an absolute path into /Applications. What can
    // be checked is that leaving OBK_ORCA out, setting it empty, and naming that
    // path outright all reach the same answer on this machine — and that none of
    // them settles for an `orca` found on PATH.
    const fixture = await createRepo(t);

    const decisions = [];
    for (const override of [undefined, '', BUILT_IN_ORCA]) {
      const env = { ...fixture.envWithoutOverride };
      if (override !== undefined) env.OBK_ORCA = override;
      const result = await fixture.confirmed({ env });
      decisions.push({ code: result.code, skipped: /skip/i.test(result.stdout), ran: /ALPHA/.test(result.stdout) });
    }

    assert.deepEqual(decisions[1], decisions[0]);
    assert.deepEqual(decisions[2], decisions[0]);
    assert.deepEqual(argsOf(await fixture.orca.calls()), []);
  });

  // A test author once ran `npm run test:system` taking it for an ordinary
  // check, and it started driving the machine it was typed on without a word.
  describe('nobody drives this machine by accident', { concurrency: true }, () => {
    test('the command on its own drives nothing, and does not read as a pass', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.run();

      assert.equal(result.signal, null, `it should decide and exit, not die: ${result.signal}`);
      assert.notEqual(result.code, 0, 'a run that ran no system test must not exit 0');
      assert.doesNotMatch(result.stdout + result.stderr, /ALPHA/);
      // Asking Orca how it is drives nothing; anything past that would.
      assert.deepEqual(argsOf(await fixture.orca.calls()), [['status', '--json']]);
    });

    test('the command on its own says what it would have driven, and how to drive it', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.run();

      assertAnnounces(result, fixture, ['test/system/alpha.test.js']);
      assert.ok(
        result.stdout.includes(CONFIRM),
        `it should say how to run them for real, got: ${result.stdout}`,
      );
      // It has a whole stdout to say this on, and nothing was driven that
      // could own stderr.
      assert.equal(result.stderr, '');
    });

    test('the announcement says which Orca CLI, and that OBK_ORCA chose it', async (t) => {
      const fixture = await createRepo(t);

      for (const result of await eitherWay(fixture)) {
        assert.ok(
          result.stdout.includes(fixture.orcaPath),
          `it should name the CLI in use, got: ${result.stdout}`,
        );
        assertFromObkOrca(result, fixture.orcaPath);
      }
    });

    test('the announcement names every file it would run, one in a subfolder included', async (t) => {
      // The reader is agreeing to what these files do; a file left out of the
      // list is a thing driven that nobody agreed to.
      const fixture = await createRepo(t, {
        files: {
          'test/system/alpha.test.js': marker('ALPHA'),
          'test/system/nested/forgotten.test.js': marker('FORGOTTEN'),
          'test/system/nested/support.js': "process.stdout.write('NOT-A-TEST\\n');\n",
          'test/other.test.js': marker('OTHER'),
        },
      });

      const result = await fixture.run();

      assertAnnounces(result, fixture, [
        'test/system/alpha.test.js',
        'test/system/nested/forgotten.test.js',
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(!output.includes('support.js'), `it should not name a file it will not run, got: ${output}`);
      assert.ok(!output.includes('other.test.js'), `it should not name a file it will not run, got: ${output}`);
    });

    test('the confirmed run announces first, then drives, then answers with their exit code', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.confirmed();

      assertAnnounces(result, fixture, ['test/system/alpha.test.js']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /ALPHA/);
      // Said before it happens, not reported after: the order is the whole
      // point, so the announcement has to share the stream the run comes out on.
      const announced = result.stdout.indexOf(fixture.orcaPath);
      assert.ok(announced >= 0, `the announcement should reach stdout, got: ${result.stdout}`);
      assert.ok(
        announced < result.stdout.indexOf('ALPHA'),
        `the announcement should come before the run, got: ${result.stdout}`,
      );
    });

    test('Orca not answering is a skip that drives nothing, and still says which Orca it asked', async (t) => {
      // The skip itself this design leaves alone, so half of this is a guard.
      // The other half is new: whether a skip is the right answer is the
      // developer's to judge, and they cannot judge it without knowing which
      // Orca went unanswered.
      const fixture = await createRepo(t, {
        orca: status({ ok: true, result: { runtime: { reachable: false } } }),
      });

      for (const result of await eitherWay(fixture)) {
        assertSkipped(result);
        assertAnnounces(result, fixture);
        assertFromObkOrca(result, fixture.orcaPath);
      }
    });

    test('a skip names the Orca CLI it actually asked, not the one it would have preferred', async (t) => {
      const fixture = await createRepo(t);
      const missing = path.join(path.dirname(fixture.orcaPath), 'not-installed');

      const result = await fixture.confirmed({ env: { ...fixture.env, OBK_ORCA: missing } });

      assertSkipped(result);
      assertAnnounces(result, fixture, [], missing);
    });
  });

  // 99 Runs named `obk …` piled up on the owner's machine in a day of running
  // these. A Run is a session's address and outlives its tab, Orca offers no
  // way to delete one, and the only reset would empty the whole machine's
  // mailbox. So the pile cannot be cleared; what it can be is admitted, by the
  // run that made it, at the moment it made it.
  describe('what a run leaves behind', { concurrency: true }, () => {
    test('a run that made Runs names each one, and says why it could not remove them', async (t) => {
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
        assert.ok(
          report.includes(run.objective),
          `it should say what ${run.id} is for (${run.objective}), got: ${report}`,
        );
      }
      // An id alone is not actionable. Why it is still there is the other half.
      assert.match(unwrapped(report), /delet|remov/i, `it should say they were not deleted, got: ${report}`);
      assert.match(
        unwrapped(report),
        /could ?n[o']t|cannot|can't|no way|unable|offers no|does not/i,
        `it should say why they are still there, got: ${report}`,
      );
    });

    test('a run that made no Runs says so, rather than saying nothing', async (t) => {
      // Silence reads as "the runner forgot", and a developer who has seen the
      // pile grow cannot tell the two apart.
      const fixture = await createRepo(t, { runs: ALREADY_THERE });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.match(unwrapped(report), /run/i, `it should still speak of Runs, got: ${report}`);
      assert.match(
        unwrapped(report),
        /\b(no|none|nothing|zero)\b/i,
        `it should say there were none, got: ${report}`,
      );
    });

    test('Runs that were already there are not reported as left by this run', async (t) => {
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      const report = afterTheRun(result);
      // The half that makes the other half mean something: a report that names
      // nothing at all leaves out the old ones too, and proves nothing.
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
      for (const run of ALREADY_THERE) {
        assert.ok(!report.includes(run.id), `${run.id} was there before the run, got: ${report}`);
        assert.ok(!report.includes(run.objective), `${run.id} was there before the run, got: ${report}`);
      }
    });

    test('it names every Run it left, not just the first page of the listing', async (t) => {
      // The machine this came from was 99 Runs deep. A report that stops at
      // whatever one call hands back is a report that understates the pile
      // exactly when the pile is worth knowing about.
      const many = Array.from({ length: PAGE + 5 }, (_, n) => runNamed(`many${String(n).padStart(2, '0')}`, '12:00'));
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', many) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of many) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
    });

    test('a passing run still passes and a failing run still fails, report and all', async (t) => {
      // The report is an aside. What the command answers is the tests' verdict,
      // and nothing about what they left may move it either way.
      for (const thenFails of [false, true]) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED, { thenFails }) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, thenFails ? 1 : 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assert.ok(
          result.stdout.includes(MINTED[0].id),
          `it should name what it left however the tests went, got: ${result.stdout}`,
        );
      }
    });

    test('the command on its own lists no Runs: nothing was driven, so nothing was left', async (t) => {
      const fixture = await createRepo(t, { runs: ALREADY_THERE });

      const result = await fixture.run();

      assert.notEqual(result.code, 0);
      assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'orchestration run-list'), []);
    });

    test('a skip lists no Runs: nothing was driven, so nothing was left', async (t) => {
      const fixture = await createRepo(t, {
        orca: status({ ok: true, result: { runtime: { reachable: false } } }),
        runs: ALREADY_THERE,
      });

      for (const result of await eitherWay(fixture)) assertSkipped(result);

      assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'orchestration run-list'), []);
    });

    test('Orca refusing the listing does not fail the run, and does not hide the tests\' verdict', async (t) => {
      for (const thenFails of [false, true]) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          runListFails: ALWAYS,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED, { thenFails }) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, thenFails ? 1 : 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assertSaidItCouldNotTell(afterTheRun(result));
      }
    });

    test('Orca answering the listing with something that is not JSON is the same as refusing it', async (t) => {
      // `/usr/local/bin/orca` on the owner's Mac exits 0 and prints an error.
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        runListGarbles: ALWAYS,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
      assertSaidItCouldNotTell(afterTheRun(result));
    });

    test('a Run that appeared is not by that fact one of the tests\'', async (t) => {
      // The machine is shared. An ordinary `obk up` — the owner's, another
      // developer's, Bot Father's — mints a mailbox through `run-create` at any
      // moment, and the runner cannot tell that Run from one of its own: the
      // tests work in throwaway folders whose names it never learns. So
      // "appeared while the tests ran" is all the two listings establish.
      //
      // Saying more is not a stylistic matter. Telling the owner that the live
      // mailbox of a session they are working in belongs to the tests and can
      // be ignored is the one line here that can cost them something.
      // Written out rather than built by `runNamed`, because the whole point of
      // it is that it is nobody in this fixture: another bot, another session.
      const live = { id: 'run_ownerlive', objective: 'obk owner-live/daily', created_at: '2026-09-21T13:00:00Z' };
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        appearsDuring: [live],
        // The tests themselves make nothing at all.
        files: { 'test/system/alpha.test.js': marker('ALPHA') },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.ok(report.includes(live.id), `it should still name ${live.id}, got: ${report}`);
      assert.ok(report.includes(live.objective), `it should say what ${live.id} is, got: ${report}`);
      assert.doesNotMatch(
        unwrapped(report),
        /ignore/i,
        `it should not tell the reader to disregard a Run it cannot account for, got: ${report}`,
      );
      // Asserted as something the report must say, not as words it must avoid.
      // The honest sentence here contains "the tests made" — inside "which of
      // them the tests made is not established" — so a report that denies the
      // attribution and one that asserts it share their words, and only the
      // denial can be looked for.
      assert.match(
        unwrapped(report),
        /not established|not known|do(es)? not know|cannot say|can't say|unknown|\bmay\b|\bmight\b|anything else|somebody else|someone else|another session/i,
        `it should say whose the Run is was not established, got: ${report}`,
      );
    });

    test('a window that cannot reach back past the run does not state a total', async (t) => {
      // Both listings are the newest hundred. The subtraction is exact as long
      // as the window reaches back past the start of the run — but the listing
      // covers every actor on the machine, not only the tests, so a hundred
      // Runs can appear from elsewhere and push the window off its own
      // beginning. Here the oldest new Run falls out of it unseen, and a bare
      // total would be a completeness two snapshots cannot establish.
      const appeared = Array.from({ length: LIMIT_CAP + 1 }, (_, n) => runNamed(`new${String(n).padStart(3, '0')}`, '12:00'));
      const fixture = await createRepo(t, {
        runs: Array.from({ length: 200 }, (_, n) => runNamed(`old${String(n).padStart(3, '0')}`, '09:00')),
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', appeared) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.match(
        unwrapped(report),
        HEDGE,
        `it should say the count is a floor, not a total, got: ${report}`,
      );
      // The gap is real, and it is the oldest of the new ones: the window never
      // reached it. What the runner did see, it still names.
      assert.ok(report.includes(appeared.at(-1).id), `it should name what it did see, got: ${report}`);
      assert.ok(!report.includes(appeared[0].id), `it never saw ${appeared[0].id}, got: ${report}`);
    });

    test('a full listing that still reaches back past the run is complete, and is not hedged', async (t) => {
      // The other side of it. This machine already carries a hundred Runs, so a
      // listing comes back full on every ordinary day; a runner that hedges
      // whenever it is full hedges always, and a qualifier that is always there
      // is one nobody reads. Full is not the test — overlap is.
      const fixture = await createRepo(t, {
        runs: Array.from({ length: 150 }, (_, n) => runNamed(`old${String(n).padStart(3, '0')}`, '09:00')),
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
      assert.doesNotMatch(
        unwrapped(report),
        HEDGE,
        `the window reached back past the run, so nothing needs hedging, got: ${report}`,
      );
    });

    test('a listing that exits 0 without saying `ok` is not an empty machine', async (t) => {
      // The quiet one. Every Orca answer is `{ id, ok, result, _meta }`, and a
      // refusal exits 0 just the same, carrying an error where the result would
      // be. Reaching for `result.runs` and finding nothing there reads as a
      // machine with no new Runs on it — the runner would report the good news
      // it was never told, on the one path where it knows least.
      //
      // `ok` is the only thing that says whether an answer is one. An envelope
      // that carries a list while saying it failed, and one that carries a list
      // and says nothing either way, are both answers nobody has vouched for.
      for (const runListEnvelope of ['notOk', 'notOkWithRuns', 'noOk']) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          runListEnvelope,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assertSaidItCouldNotTell(afterTheRun(result));
      }
    });

    test('the listing before the run failing does not make every Run look new', async (t) => {
      // Without a before, there is no new. Naming the Runs a developer already
      // had under "what this run left" is worse than saying nothing: it is the
      // opposite of the truth, at the length of the whole pile.
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        runListFails: 1,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assertSaidItCouldNotTell(report);
    });
  });
});
