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

import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { createSandbox, fakeProgram, node, repoRoot } from './helpers/cli.js';

const scriptEntry = path.join(repoRoot, 'scripts', 'test-system.js');

/** The one deliberate step that lets the system tests drive this machine. */
const CONFIRM = '--yes';

/** The Orca CLI to fall back on when OBK_ORCA says nothing (tech notes, section 1). */
const BUILT_IN_ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca';

/** What `orca status --json` prints, as the fake Orca's stdout. */
const status = (value) => ({ stdout: `${JSON.stringify(value)}\n` });

/** Orca up and reachable: the only answer that lets the system tests run. */
const READY = status({ ok: true, result: { runtime: { reachable: true } } });

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
async function createRepo(t, { orca: orcaOptions = READY, files = DEFAULT_FILES } = {}) {
  const box = await createSandbox(t);
  const orca = await fakeProgram(box, 'orca', orcaOptions);
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

  const runScript = (args, options) => node(
    [path.join(repo, 'scripts', 'test-system.js'), ...args],
    { cwd: options.cwd ?? repo, env: options.env ?? { ...bare, OBK_ORCA: orcaPath } },
  );

  return {
    repo,
    orca,
    orcaPath,
    /** The environment the script is run with: the fake Orca as the CLI. */
    env: { ...bare, OBK_ORCA: orcaPath },
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

/** Each way of invoking it, for a fact that has to hold on both. */
const eitherWay = async (fixture) => [await fixture.run(), await fixture.confirmed()];

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

    assert.deepEqual(argsOf(await fixture.orca.calls()), [['status', '--json']]);
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
        assert.match(
          result.stdout,
          /OBK_ORCA/,
          `it should say the CLI came from OBK_ORCA, got: ${result.stdout}`,
        );
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
        assert.match(
          result.stdout,
          /OBK_ORCA/,
          `it should say the CLI came from OBK_ORCA, got: ${result.stdout}`,
        );
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
});
